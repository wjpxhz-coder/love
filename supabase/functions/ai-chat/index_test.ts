import {
  buildProviderMessages,
  classifyProviderFetchFailure,
  hasValidAgnesKeyShape,
  mapProviderHttpFailure,
  normalizeAgnesKey,
} from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("provider messages preserve pure text requests", () => {
  const messages = buildProviderMessages(
    [{ role: "user", content: "你好" }],
    [],
  );

  assert(messages.length === 2, "Expected server prompt plus user message");
  assert(messages[0].role === "system", "First message must be server-owned");
  assert(messages[1].role === "user", "Second message must be the user");
  assert(messages[1].content === "你好", "Pure text must stay a string");
});

Deno.test("one image is attached only to the final user message", () => {
  const messages = buildProviderMessages(
    [
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "收到" },
      { role: "user", content: "请分析" },
    ],
    ["https://signed.example/one"],
  );

  assert(messages[1].content === "第一轮", "Earlier turns must stay text-only");
  const finalContent = messages[3].content;
  assert(Array.isArray(finalContent), "Final user content must be multimodal");
  assert(finalContent.length === 2, "Expected one text and one image block");
  assert(
    finalContent[0].type === "text" && finalContent[0].text === "请分析",
    "The text block must be preserved",
  );
  assert(
    finalContent[1].type === "image_url" &&
      finalContent[1].image_url.url === "https://signed.example/one",
    "The signed image URL must be server-constructed",
  );
});

Deno.test("nine mixed-source images retain order in one request", () => {
  const urls = Array.from(
    { length: 9 },
    (_, index) => `https://signed.example/${index + 1}`,
  );
  const messages = buildProviderMessages(
    [{ role: "user", content: "请描述并分析这些图片中的关键信息" }],
    urls,
  );
  const content = messages[1].content;

  assert(
    Array.isArray(content),
    "Image-only UI requests need multimodal blocks",
  );
  assert(content.length === 10, "Expected one text and nine image blocks");
  const actualUrls = content.slice(1).map((block) =>
    block.type === "image_url" ? block.image_url.url : ""
  );
  assert(
    JSON.stringify(actualUrls) === JSON.stringify(urls),
    "All nine signed URLs must retain selection order",
  );
});

Deno.test("provider HTTP failures expose stable codes without response bodies", () => {
  const expected = [
    [401, 503, "PROVIDER_AUTH_FAILED"],
    [403, 503, "PROVIDER_AUTH_FAILED"],
    [402, 503, "PROVIDER_BILLING_REQUIRED"],
    [429, 503, "PROVIDER_RATE_LIMITED"],
    [400, 502, "PROVIDER_REQUEST_REJECTED"],
    [422, 502, "PROVIDER_REQUEST_REJECTED"],
    [500, 502, "PROVIDER_UNAVAILABLE"],
  ] as const;

  for (const [upstreamStatus, responseStatus, code] of expected) {
    const result = mapProviderHttpFailure(upstreamStatus);
    assert(
      result.status === responseStatus,
      `Unexpected mapping for ${upstreamStatus}`,
    );
    assert(result.code === code, `Unexpected code for ${upstreamStatus}`);
  }
});

Deno.test("provider key and network failures are classified without raw details", () => {
  const validKey = `${"sk"}-${"abcdefghijklmnopqrstuvwxyz123456"}`;
  const secondKey = `${"sk"}-${"zyxwvutsrqponmlkjihgfedcba654321"}`;

  assert(
    hasValidAgnesKeyShape(validKey),
    "Valid key shape was rejected",
  );
  assert(
    !hasValidAgnesKeyShape(`AGNES_API_KEY=${validKey}`),
    "Name/value pair must not be accepted as a key",
  );
  assert(
    !hasValidAgnesKeyShape(`${"sk"}-short`),
    "Short key must be rejected",
  );
  assert(
    normalizeAgnesKey(`AGNES_API_KEY='${validKey}'`) === validKey,
    "Quoted dotenv assignment was not normalized",
  );
  assert(
    normalizeAgnesKey(`"${validKey}"`) === validKey,
    "Quoted key was not normalized",
  );
  assert(
    normalizeAgnesKey(`说明：${validKey}，请保密`) === validKey,
    "One embedded key was not normalized",
  );
  assert(
    normalizeAgnesKey(`${validKey} ${secondKey}`) === null,
    "Multiple embedded keys must remain ambiguous",
  );

  assert(
    classifyProviderFetchFailure(
      new TypeError("fetch failed", {
        cause: { code: "ENOTFOUND", message: "dns lookup failed" },
      }),
    ) === "PROVIDER_DNS_ERROR",
    "DNS error mapping failed",
  );
  assert(
    classifyProviderFetchFailure(new TypeError("invalid header value")) ===
      "PROVIDER_KEY_INVALID_FORMAT",
    "Header error mapping failed",
  );
  assert(
    classifyProviderFetchFailure(new TypeError("connection refused")) ===
      "PROVIDER_CONNECT_ERROR",
    "Connection error mapping failed",
  );
});
