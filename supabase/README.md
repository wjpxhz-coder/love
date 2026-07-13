# Supabase security migration

This directory contains the auditable database and Storage security work for
the private two-person diary. It is intentionally additive: no migration drops
legacy rows or Storage objects.

## Files

- `migrations/202607130001_auth_spaces_rls.sql` adds Supabase Auth identity,
  the two-person `spaces`/`space_members` model, strict RLS, ownership triggers,
  immutable diary/comment rows, atomic recall/delete RPCs, normalized
  notification receipts, protected notification RPCs, indexes and private-path
  Storage policies.
- `manual/01_provision_and_backfill.sql` maps the two existing usernames to two
  pre-created `auth.users` UUIDs and backfills all legacy rows transactionally.
- `manual/02_finalize_constraints.sql` validates foreign/check constraints and
  makes the new identity columns non-null after backfill.
- `manual/03_verify.sql` is a read-only audit of mappings, grants, policies and
  Storage state.
- `manual/04_make_photos_private.sql` is the guarded final switch from a legacy
  public `photos` bucket to a private bucket.
- `functions/ai-chat/index.ts` is the authenticated, RLS-scoped DeepSeek
  gateway; `AUTHORIZATION.md` defines its release checklist and trust boundary.
- `config.toml` explicitly keeps gateway JWT verification enabled.
- `DEPLOY.md` is the required production runbook.

## Data model

```text
auth.users
    │
    ├── profiles.user_id ── profiles.space_id
    │                              │
    └── space_members(user_id, space_id) ── spaces
                                      │
                                      ├── moments / comments / moods
                                      ├── likes / stars / ai_content
                                      └── notifications ── notification_receipts
```

The legacy display fields `author`, `actor` and `username` remain for UI
compatibility. They are no longer authority. On every authenticated write,
triggers derive `user_id`/`actor_id`, `space_id` and the legacy display name
from `auth.uid()` plus the mapped profile. RLS then verifies the same identity.
Database checks also enforce type allowlists, non-empty bounded diary/comment/AI
content, mood score/note limits, and bounded notification content/read markers;
client validation is treated only as user experience.

## Frontend contract

- Sign in with Supabase Auth email/password. Never use `verify_login`.
- Resolve the current identity with
  `profiles.select('*').eq('user_id', session.user.id).single()`.
- Treat `currentUserProfile.space_id` as the space scope for queries and
  Realtime/Presence topics. RLS remains the final authority.
- Use only the private Realtime topic
  `space:<currentUserProfile.space_id>:presence`. Database authorization grants
  Presence/Broadcast read and write only when that exact topic belongs to the
  caller's mapped profile space.
- Update profiles with `.update(...).eq('user_id', session.user.id)`. Do not use
  the former username upsert; profile creation is an admin provisioning step.
- The mood uniqueness key is `(user_id, date)`. The server fills `author` and
  `space_id`.
- Call `send_miss_you()` without identity/content arguments.
- Never INSERT interaction notifications from the browser. AFTER INSERT
  triggers on `moments`, `comments` and `comment_likes` derive the actor,
  recipient, space, type and relation from authenticated rows and create the
  partner notification atomically. Authenticated clients have no direct
  `notifications` INSERT privilege; `send_miss_you()` is the only entry point
  for a user-initiated “想你” notification.
- Call `mark_notification_read(p_notification_id)` or
  `mark_all_notifications_read()` instead of replacing `read_by` client-side.
  During rollout the RPCs maintain both `read_by` and `notification_receipts`.
- Treat moments and comments as immutable after INSERT. Authenticated clients
  have no direct UPDATE or DELETE privilege on either table. To remove authored
  content, call `recall_and_delete_moment(p_moment_id)` or
  `recall_and_delete_comment(p_comment_id)`. The moment RPC permits recall only
  during the first 24 hours; both RPCs verify ownership and membership, recall
  dependent notifications and delete/cascade dependents in one transaction.
- Store new media paths, not permanent public URLs. The required object layout
  is `<space_id>/<user_id>/<kind>/<random filename>`, including
  `<space_id>/<user_id>/avatars/<random>.<ext>` for avatars.
- The `photos` bucket and object INSERT/UPDATE policies both enforce a 20 MiB
  limit and the audited JPEG/PNG/WebP/GIF, MP4/WebM/QuickTime and
  WebM/Ogg/MP4-audio MIME allowlist. Client `accept` attributes are not security.
- Save an avatar object path in `profiles.avatar_path` and render it through a
  short-lived signed URL. `avatar_url` remains temporarily for legacy display.

## Deliberate compatibility windows

The main migration creates a new `photos` bucket as private, but does not flip
an already-existing bucket from public to private. Existing permanent URLs may
therefore continue to work during media migration. This is a temporary privacy
gap, not the completed state. Production hardening is complete only after every
object uses the UUID path layout and `manual/04_make_photos_private.sql` reports
success.

Likewise, `notifications.read_by` remains present while the UI changes to the
receipt RPCs. Recipients have no direct notification UPDATE policy; the audited
RPCs append the current username and write normalized receipts atomically.

The AI gateway accepts only an allowlisted browser origin, independently calls
Supabase Auth, checks the caller profile and membership through the caller's RLS
session, validates bounded messages, consumes an atomic database quota, and
uses fixed provider/model/output settings. Configure `AI_CHAT_ALLOWED_ORIGINS`
and `DEEPSEEK_API_KEY` as deployed secrets before enabling the UI.
