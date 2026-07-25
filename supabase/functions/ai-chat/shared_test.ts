import {
  allowedOrigins,
  hasCurrentAgnesConsentProtocol,
  safeLog,
} from "./shared.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("safe logger emits only the approved metadata fields", () => {
  const originalLog = console.log;
  const output: string[] = [];
  console.log = (value?: unknown) => output.push(String(value));

  try {
    safeLog("request-id", "user-id", "provider_timeout", Date.now());
  } finally {
    console.log = originalLog;
  }

  assert(output.length === 1, "Expected exactly one structured log line");
  const parsed: unknown = JSON.parse(output[0]);
  assert(
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
    "Expected a JSON object",
  );

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify([
      "latency_ms",
      "request_id",
      "status",
      "user_id",
    ]),
    `Unexpected log fields: ${keys.join(",")}`,
  );
  assert(
    !output[0].includes("Authorization") &&
      !output[0].includes("signedUrl") &&
      !output[0].includes("messages") &&
      !output[0].includes("AGNES_API_KEY"),
    "Log output contains a forbidden sensitive field name",
  );
});

Deno.test("allowed origins are pinned to the production Pages origin", () => {
  const previous = Deno.env.get("AI_CHAT_ALLOWED_ORIGINS");
  Deno.env.delete("AI_CHAT_ALLOWED_ORIGINS");

  try {
    const origins = [...allowedOrigins()];
    assert(
      JSON.stringify(origins) ===
        JSON.stringify(["https://wjpxhz-coder.github.io"]),
      `Unexpected origins: ${origins.join(",")}`,
    );

    Deno.env.set("AI_CHAT_ALLOWED_ORIGINS", "https://example.com");
    let rejected = false;
    try {
      allowedOrigins();
    } catch {
      rejected = true;
    }
    assert(rejected, "A configured alternate origin must be rejected");
  } finally {
    if (previous === undefined) Deno.env.delete("AI_CHAT_ALLOWED_ORIGINS");
    else Deno.env.set("AI_CHAT_ALLOWED_ORIGINS", previous);
  }
});

Deno.test("Agnes calls require the current consent protocol marker", () => {
  const current = new Request("https://example.test", {
    headers: { "x-agnes-consent-version": "agnes-2.0-v1" },
  });
  const oldClient = new Request("https://example.test");
  const wrongVersion = new Request("https://example.test", {
    headers: { "x-agnes-consent-version": "deepseek-v1" },
  });

  assert(
    hasCurrentAgnesConsentProtocol(current),
    "Current consent marker should pass",
  );
  assert(
    !hasCurrentAgnesConsentProtocol(oldClient),
    "A cached old client without the marker must fail",
  );
  assert(
    !hasCurrentAgnesConsentProtocol(wrongVersion),
    "A different provider/version marker must fail",
  );
});
