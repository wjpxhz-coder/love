# Production deployment runbook

This is a security migration, not a normal zero-downtime feature release. The
old anonymous policies are removed before legacy identity is mapped, so private
rows are intentionally unavailable during the short maintenance window.

## 0. Revoke historically exposed credentials

This is a release blocker and must happen before reopening the site:

1. Revoke and rotate every login secret and AI/provider key that ever appeared
   in a commit, patch, build artifact or shared log. Treat deletion in a later
   commit as insufficient because Git history remains readable.
2. Never reuse either legacy diary passphrase as a Supabase Auth password. Give
   both Auth users new, unique passwords that have not appeared in the repo or
   any other service.
3. Review provider usage, billing and access logs for the exposed-key period;
   investigate unexpected traffic before enabling AI again.
4. Rotate first, then clean the Git history using the repository host's
   documented secret-removal procedure. If the repository was ever cloned,
   forked or shared, notify collaborators that old clones/refs must be removed
   or re-cloned according to that procedure.
5. Enable repository secret scanning/push protection and add a CI secret scan.

Do not put replacement passwords, UUID mappings, provider keys or service-role
keys in this runbook, SQL, Git history, browser code or deployment logs.

## 1. Back up and rehearse

1. Put the public site into maintenance mode or protect it at the hosting edge.
2. Create a current database backup from the Supabase dashboard. Also take a
   schema-only dump so any pre-existing policy definitions can be recovered.
3. Export a Storage object manifest (`bucket_id`, `name`, size and timestamp)
   and copy every irreplaceable `photos` object to independent storage.
4. Record row counts for all nine legacy tables before changing anything.
5. Rehearse the full sequence on a restored/staging project. Test with two
   staging Auth users, not the production UUIDs.

Do not rely on a Git rollback for database state. Migration SQL and deployed
database state are separate systems.

## 2. Create the two Auth users

In Supabase Dashboard -> Authentication -> Users, create exactly two
email/password users. Use two private email addresses, strong unique passwords,
and confirm the addresses according to the project's email policy.

Disable public self-signup (or require administrator invitations) so this
private project does not accumulate unrelated Auth users. RLS still treats any
unmapped account as unauthorized; disabling signup reduces attack and cost
surface rather than replacing RLS.

Copy each user's `auth.users.id` UUID and privately record which UUID maps to:

| Legacy username | Auth UUID |
| --- | --- |
| 小蛇 | first real UUID |
| 小奚 | second real UUID |

Do not store passwords, refresh tokens, service-role keys or AI keys in Git.

## 3. Dry-run the migration

Run `migrations/202607130001_auth_spaces_rls.sql` against the staging restore.
The file is a single transaction. Any SQL error rolls the migration back.

Review these expected effects:

- no legacy row or Storage object is deleted;
- all old policies on the app tables are replaced because permissive policies
  are ORed in PostgreSQL;
- `anon` loses all app-table privileges and obsolete `verify_login` execution;
- authenticated reads are hidden until membership/backfill is complete;
- all Storage object policies are replaced. This project is assumed to be
  dedicated to the diary; if it contains another bucket/application, stop and
  add explicit policies for it before production;
- all `realtime.messages` policies are replaced with exact private-topic
  Presence/Broadcast policies for this dedicated project;
- an existing public `photos` bucket remains public only for the staged media
  compatibility window.
- every new `photos` upload is capped server-side at 20 MiB and must match the
  migration's explicit MIME allowlist; both bucket configuration and RLS
  metadata checks enforce this.
- moments/comments expose only SELECT and INSERT to authenticated clients;
  authored removal goes through the ownership-checked recall/delete RPCs.
- interaction notifications are created atomically by versioned AFTER INSERT
  triggers on moments, comments and comment likes; authenticated clients have
  no direct notification INSERT privilege, so any legacy client-side INSERT
  must be removed before release.

Inspect errors rather than weakening RLS to make the dry-run pass.

## 4. Apply and map production data

1. Apply `migrations/202607130001_auth_spaces_rls.sql` in the maintenance
   window.
2. Open `manual/01_provision_and_backfill.sql`.
3. Replace both sentinel UUIDs with the real Auth UUIDs. Do not change the two
   legacy usernames.
4. Run the whole file as one transaction. It creates one two-member space,
   stores the explicit mapping, rejects unmapped authors/duplicates, backfills
   identity columns and converts existing `read_by` markers into receipts.
5. Save the emitted shared-space UUID and backfill counts in the deployment
   record. Compare counts to the pre-migration snapshot.

If backfill reports duplicate moods/likes/stars, stop. Inspect and resolve each
duplicate after a fresh backup; the procedure never picks a row to delete.

## 5. Verify and finalize

1. Run every query in `manual/03_verify.sql`.
2. Confirm all unmapped counts are zero and `anon` has no listed privileges.
3. Confirm there is no broad policy such as `USING (true)`.
4. Run `manual/02_finalize_constraints.sql`. It validates the deferred FKs and
   checks, then sets identity columns `NOT NULL` in one transaction.
5. Run `manual/03_verify.sql` again.

Using only the public/publishable key and no user JWT, make REST `select`,
`insert`, `update` and `delete` probes against every private table. Each must be
denied and must never return row content. Do not issue destructive probes with
an authenticated production account; use staging for write tests.

With each real user's JWT, verify:

- both can read only the shared space;
- each can create moments/comments, but direct UPDATE and DELETE on both tables
  are denied even for the author;
- `recall_and_delete_moment(p_moment_id)` succeeds only for the author in the
  same space and only before 24 hours have elapsed; the partner, an unrelated
  user and the author after the deadline are denied;
- `recall_and_delete_comment(p_comment_id)` succeeds only for that comment's
  author in the same space; the partner and unrelated users are denied;
- a successful recall changes dependent interaction notifications to
  `recalled`, then deletes the target and cascades its comments, likes and
  stars atomically;
- a forged `author`, `user_id`, `actor_id`, `recipient_id` or `space_id` is
  overwritten or rejected;
- profile updates work only by the caller's `user_id`;
- a user cannot edit the partner's profile;
- mood duplicates for the same `(user_id,date)` are rejected;
- notification RPCs work without actor/username parameters;
- inserting one moment, one comment and one comment like creates exactly one
  `moment`, `comment` and `like` notification respectively, with the caller as
  actor, the partner as recipient, the mapped space and the correct target id;
- direct notification INSERT is denied, while `send_miss_you()` still creates
  exactly one server-authored `miss` notification and enforces its cooldown;
- direct recipient notification updates are denied; the read RPCs append the
  caller's `read_by` marker and receipt;
- an unrelated staging Auth user sees no profiles or diary rows.

In Dashboard -> Realtime Settings, disable **Allow public access**. This setting
cannot be safely inferred from migration SQL and is a release blocker. Then
verify that both members can subscribe to the private topic
`space:<their mapped space UUID>:presence`, while an unrelated user, a forged
space UUID, a suffix other than `:presence`, and a non-private subscription are
all denied. Refresh the Realtime JWT after Auth token refresh; authorization is
cached for the connection lifetime.

## 6. Deploy the Auth-aware frontend

Deploy the frontend in the same maintenance window. It must meet the contract
in `README.md`, including real `auth.signInWithPassword`, `auth.signOut`, session
change handling, user-id profile lookup, space-scoped Presence topics and signed
media URLs.

Do not reopen public access while the UI still calls `verify_login`, treats
localStorage as authentication, or uploads legacy object paths.

## 7. Migrate Storage without breaking old media

The strict policy accepts only:

```text
<space UUID>/<uploader Auth UUID>/<kind>/<random filename>
```

For every legacy object:

1. determine its owning legacy username and mapped Auth UUID;
2. copy it to a new random path under the correct space/user prefix;
3. update database content to store the object path rather than a public URL;
4. for avatars, set `profiles.avatar_path` while retaining `avatar_url` during
   the compatibility window;
5. generate short-lived signed URLs at display time and verify all media;
6. retain the independently backed-up original until restoration is tested.

The allowed MIME values are `image/jpeg`, `image/png`, `image/webp`,
`image/gif`, `video/mp4`, `video/webm`, `video/quicktime`, `audio/webm`,
`audio/ogg` and `audio/mp4`. A filename extension does not override MIME or the
20 MiB byte limit. Review the existing-object exception counts in
`manual/03_verify.sql`; legacy exceptions remain stored but new/replacement
uploads with those properties are rejected.

Run `manual/04_make_photos_private.sql` only when `03_verify.sql` reports zero
legacy object paths and every legacy avatar has an `avatar_path`. The cutover
changes only `storage.buckets.public`; it does not delete objects. Afterward,
verify that old `/object/public/photos/...` URLs fail and authenticated signed
URLs work only for the two members.

The public-bucket compatibility window should be short and tracked as a release
blocker because new-path objects are still publicly fetchable while the bucket
flag remains public.

## 8. Edge Function release gate

`ai-chat` must not be exposed until `functions/ai-chat/index.ts` and every
requirement in `functions/ai-chat/AUTHORIZATION.md` have been reviewed and
tested. In particular:

Apply the focused Agnes migrations in order:
`20260724144233_agnes_ai_inputs_and_cache_metadata.sql`, then
`20260725004913_fix_ai_inputs_insert_policy_metadata_stage.sql`. Do not replay
the drifted July Auth/RLS monolith against an already-migrated production
database.

- gateway JWT verification must be enabled;
- the function must independently resolve the Auth user and mapped membership;
- CORS must use an exact allowlist;
- request size/message limits and a distributed per-user quota are mandatory;
- model, endpoint, token limit and sampling settings are server-controlled;
- `AGNES_API_KEY` is a rotated deployed secret and never reaches the
  browser/logs;
- Storage-backed image inputs must pass ownership, MIME, file-signature and size
  validation, and temporary objects must be removed on every exit path.

Set `AI_CHAT_ALLOWED_ORIGINS` to exactly
`https://wjpxhz-coder.github.io` (no wildcard) and set `AGNES_API_KEY` with the
Edge Function secret manager. Remove the obsolete `DEEPSEEK_API_KEY` only after
its provider credential has been revoked. The migration's
`claim_ai_chat_quota()` allows 8 calls per 10-minute window and 60 per UTC
database day for each member.

Keep `[functions.ai-chat] verify_jwt = true`; never deploy with
`--no-verify-jwt`. A failed function test is a blocking production failure, not
a reason to weaken authentication.

## Rollback and incident notes

- Before `COMMIT`, an error automatically restores the prior state.
- After commit, prefer a forward fix. Re-enabling anonymous policies would
  recreate the original data exposure and is not an acceptable rollback.
- The migration drops old policy definitions. A schema backup is required if
  they must be inspected; do not blindly restore them.
- If the frontend fails, keep maintenance/edge access control enabled while
  repairing it. Server/service-role access may be used only from trusted admin
  tooling and must never be placed in browser code.
- Do not make `photos` public again after the final cutover. Restore missing
  paths/metadata from backup instead.
- Keep `read_by` until all deployed clients use the receipt RPCs. Remove it only
  in a later audited migration after measuring that no legacy client writes it.
