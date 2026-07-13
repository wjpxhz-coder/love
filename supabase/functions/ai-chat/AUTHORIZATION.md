# `ai-chat` Edge Function release requirements

`index.ts` implements this trust boundary. Deployment remains blocked until the
implementation and every item below pass staging tests; a permissive fallback
would turn the project into an unauthenticated paid-model proxy.

## Gateway and identity

- Deploy with JWT verification enabled. Never use `--no-verify-jwt`.
- Require one `Authorization: Bearer <access token>` header. Reject missing,
  malformed, expired and refresh tokens.
- Resolve the user from the verified token; never accept `user_id`, `username`,
  `space_id`, role or membership from JSON input.
- Query the caller's `profiles.user_id = auth user id` row with the caller's JWT
  (or a narrowly scoped server client), then verify the corresponding
  `(space_id,user_id)` membership. Reject an unmapped user before any AI call.
- Never return a service-role key, provider key or raw upstream error body.

## CORS and HTTP surface

- Maintain an exact HTTPS origin allowlist in a deployed environment variable.
  Do not reflect arbitrary `Origin` and do not use `*` with Authorization.
- Answer `OPTIONS` only for allowlisted origins and only advertise `POST`,
  `authorization`, `content-type` and the required Supabase client headers.
- Reject non-`POST` requests with `405` and set `Vary: Origin`.
- Require `application/json` and enforce a small request-body byte limit before
  parsing. Reject duplicate/unknown top-level fields if practical.

## Message validation

- Accept one `messages` array only.
- Limit the array to at most 20 items and total content to at most 12,000 UTF-8
  characters (or a stricter token-aware limit).
- Every item must contain only a role in `system`, `user`, `assistant` and a
  string `content`; limit each content value to 4,000 characters.
- Reject empty content, nested objects, tool/function messages, URLs supplied as
  provider endpoints, and client-provided model/sampling/billing controls.
- Prepend the audited server system prompt. Client `system` content is context,
  not authority, and cannot override privacy/safety/format limits.

## Provider and cost controls

- Read `DEEPSEEK_API_KEY` only from Supabase Edge Function secrets.
- Fix the provider HTTPS endpoint and model server-side. The current audited
  model is `deepseek-v4-flash`. Do not accept `model`,
  `base_url`, `max_tokens`, `temperature`, streaming targets or API keys from
  the client.
- Enforce a server maximum output (recommended no more than 800 tokens), request
  timeout, response-size ceiling and safe fixed sampling settings.
- Add a distributed per-user/per-space rate limit and daily token/cost quota.
  In-memory counters are insufficient because Edge instances are ephemeral.
- Abort upstream work when the client disconnects where supported.

## Data handling and observability

- Obtain explicit in-product consent before sending diary content to DeepSeek.
- Send only the minimum selected diary excerpts; never query an entire space by
  default and never accept another space id from the client.
- Log request id, caller UUID, status, latency and coarse token counts. Do not
  log messages, diary text, Authorization headers, signed URLs or provider keys.
- Return stable, non-sensitive error codes to the browser. Keep raw provider
  diagnostics in access-controlled server telemetry only.
- Document retention/deletion behavior and provide a user-visible way to disable
  AI processing.

## Required tests before deployment

- no token, expired token, anon key and refresh token are rejected;
- a valid but unmapped Auth user is rejected;
- both mapped members succeed, while a forged space/user field has no effect;
- disallowed origin/preflight, oversized body, 21 messages, 4,001-character
  content, unknown role and client model/token settings are rejected;
- quota exhaustion does not call the provider;
- provider timeout/error does not leak secrets or raw response bodies.
