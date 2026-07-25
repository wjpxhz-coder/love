# `ai-chat` Agnes 2.0 release requirements

`index.ts` is the only supported production AI gateway. It fixes the Agnes
endpoint, model, sampling and output ceiling server-side and never accepts
provider configuration or image URLs from a browser.

## Emergency maintenance deployment

`maintenance.ts` is a provider-free, origin-restricted fallback. It still
requires a valid Auth user, mapped profile and current space membership before
returning `503 SERVICE_MAINTENANCE`.

To deploy it, temporarily add the following line to the existing function block
in `supabase/config.toml` (the path is relative to `supabase/config.toml`):

```toml
[functions.ai-chat]
verify_jwt = true
entrypoint = "./functions/ai-chat/maintenance.ts"
```

Then deploy normally:

```powershell
supabase functions deploy ai-chat --project-ref YOUR_PROJECT_REF
```

Never pass `--no-verify-jwt`. Verify a missing token is rejected, a disallowed
Origin is rejected, an unmapped user is rejected, and a valid member receives
`503 SERVICE_MAINTENANCE`. To restore Agnes, remove only the `entrypoint` line,
leave `verify_jwt = true`, deploy again, and repeat the authorization tests.
Never roll back to an older function version that had JWT verification disabled.

## Secrets and fixed provider configuration

- Delete/reset every Agnes key ever pasted into chat, source, screenshots or
  logs before deployment.
- Configure the replacement only as the Edge Function secret `AGNES_API_KEY`.
- Remove the obsolete `DEEPSEEK_API_KEY` secret after the maintenance version is
  live.
- Set `AI_CHAT_ALLOWED_ORIGINS` to exactly `https://wjpxhz-coder.github.io`.
- The production code calls only
  `https://apihub.agnes-ai.com/v1/chat/completions` with `agnes-2.0-flash`,
  `stream=false`, `max_tokens=800`, `temperature=0.7`, and a 60-second timeout.

## Browser request contract

Every Agnes request must include `X-Agnes-Consent-Version: agnes-2.0-v1`. This
is checked after Auth/membership and before quota/provider access, so a cached
pre-Agnes client cannot reuse its old provider consent. Missing or different
markers return `428 AGNES_CONSENT_VERSION_REQUIRED`.

The JSON object may contain only `messages` and optional `attachments`:

```ts
type AIRequest = {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  attachments?: Array<
    | { source: "temporary"; path: string }
    | { source: "moment"; moment_id: string; image_index: number }
  >;
};
```

- `moment_id` is a positive decimal string, preserving PostgreSQL `bigint`
  precision. JavaScript numbers are rejected.
- A legacy `moments.type = 'photo'` row has only `image_index = 0`.
- A structured `moments.type = 'moment'` row uses the original zero-based
  `images[]` array index.
- Temporary paths must be
  `<current space UUID>/<current Auth user UUID>/<non-empty remainder>`.
- A caller may select at most nine images. Only JPEG, PNG and WebP are allowed,
  each object is at most 10 MiB, and the combined size is at most 40 MiB.
  Storage MIME metadata is not trusted by itself: the function fetches a bounded
  prefix through the signed URL and verifies the matching JPEG, PNG or WebP file
  signature before Agnes is called.
- The server accepts diary references only after querying the moment through the
  caller's JWT/RLS. It resolves only `storage://photos/...` references or exact
  HTTPS public-object URLs on this project's Supabase origin.
- The browser cannot submit a model, base URL, API key, signed URL or arbitrary
  image URL. Unknown top-level and attachment fields are rejected.

The server validates Storage metadata, creates 300-second signed URLs, and adds
the images to the final user message as Agnes `image_url` content blocks.
Temporary `ai-inputs` objects are deleted in one `finally` path after success,
validation failure, quota failure, provider error or timeout. The browser also
drains active uploads before an explicit logout and removes caller-owned stale
objects on the next login. Diary originals in `photos` are never deleted. Image
references are not persisted by the function.

## Identity, quotas and observability

- The gateway and function both require `Authorization: Bearer <access token>`.
- CORS permits the fixed Agnes consent header only from the pinned production
  Pages origin.
- The function resolves the user with `auth.getUser(token)`, then checks
  `profiles` and `space_members` through the same caller-scoped client.
- `claim_ai_chat_quota()` remains the distributed limit: eight requests per ten
  minutes and sixty per database day for each member.
- Logs contain only request ID, caller UUID, coarse status and latency. They
  never contain messages, object paths, signed URLs, provider bodies or keys.
- Successful responses retain `choices[0].message.content`; failures return a
  stable `code` and `request_id`.

Stable attachment codes are:

```text
INVALID_ATTACHMENT
TOO_MANY_ATTACHMENTS
ATTACHMENTS_REQUIRE_USER_MESSAGE
INVALID_TEMPORARY_PATH
TEMPORARY_PATH_FORBIDDEN
INVALID_MOMENT_ID
INVALID_IMAGE_INDEX
ATTACHMENT_FORBIDDEN
ATTACHMENT_LOOKUP_FAILED
IMAGE_UNAVAILABLE
UNSUPPORTED_IMAGE_TYPE
IMAGE_CONTENT_MISMATCH
IMAGE_TOO_LARGE
IMAGES_TOO_LARGE
```

Provider codes include `PROVIDER_TIMEOUT`, `PROVIDER_AUTH_FAILED`,
`PROVIDER_BILLING_REQUIRED`, `PROVIDER_RATE_LIMITED`,
`PROVIDER_REQUEST_REJECTED`, `PROVIDER_UNAVAILABLE`,
`INVALID_PROVIDER_RESPONSE`, and `EMPTY_PROVIDER_RESPONSE`. The browser never
receives the upstream response body.

## Required checks before enabling the frontend

Run:

```powershell
deno fmt --check supabase/functions/ai-chat
deno check --config supabase/functions/ai-chat/deno.json supabase/functions/ai-chat/index.ts supabase/functions/ai-chat/maintenance.ts
deno test --allow-env --config supabase/functions/ai-chat/deno.json supabase/functions/ai-chat/*_test.ts
```

In staging, verify:

- missing/expired token, anon key, refresh token and unmapped Auth users fail;
- wrong Origin and forged user/space/model/URL fields fail before Agnes;
- pure text, one image, mixed sources and nine images work;
- ten images, GIF/video, oversized metadata, forged moment IDs, another space's
  moment and arbitrary URLs fail with the documented codes;
- quota exhaustion never calls Agnes;
- temporary objects are deleted after success, upstream failure and timeout;
- logs and browser errors contain no request content, object paths, signed URLs
  or secrets.

A real nine-image Agnes request is a release gate. If Agnes rejects it, measure
the highest stable provider-supported count and lower the backend, frontend,
tests and documentation together before release.
