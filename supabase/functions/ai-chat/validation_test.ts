import {
  addImageBytes,
  collectOwnedTemporaryPaths,
  InputValidationError,
  MAX_IMAGE_BYTES,
  parseTrustedPhotoReference,
  resolveMomentImageReference,
  validateAIRequest,
  validateImageFileInfo,
  validateImageSignature,
  validateMessages,
  validateTemporaryPath,
} from "./validation.ts";

const SPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const TEMP_PATH = `${SPACE_ID}/${USER_ID}/chat/image.webp`;
const SUPABASE_URL = "https://project-ref.supabase.co";

function fail(message: string): never {
  throw new Error(message);
}

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) fail(message);
}

function comparableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (
      nestedValue &&
      typeof nestedValue === "object" &&
      !Array.isArray(nestedValue)
    ) {
      return Object.fromEntries(
        Object.entries(nestedValue).sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      );
    }
    return nestedValue;
  });
}

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = comparableJson(actual);
  const expectedJson = comparableJson(expected);
  if (actualJson !== expectedJson) {
    fail(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

function assertThrowsCode(
  callback: () => unknown,
  code: string,
  status?: number,
): void {
  try {
    callback();
  } catch (error) {
    assert(
      error instanceof InputValidationError,
      `Expected InputValidationError, received ${String(error)}`,
    );
    assertEquals(error.message, code);
    if (status !== undefined) assertEquals(error.status, status);
    return;
  }
  fail(`Expected ${code} to be thrown`);
}

Deno.test("messages accept audited roles and downgrade client system authority", () => {
  const messages = validateMessages([
    { role: "system", content: "背景" },
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好呀" },
  ]);

  assertEquals(messages, [
    { role: "user", content: "[用户提供的背景说明]\n背景" },
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好呀" },
  ]);
});

Deno.test("messages enforce count, fields, roles, and character limits", () => {
  assertThrowsCode(() => validateMessages([]), "INVALID_MESSAGES_COUNT");
  assertThrowsCode(
    () =>
      validateMessages(
        Array.from(
          { length: 21 },
          () => ({ role: "user", content: "x" }),
        ),
      ),
    "INVALID_MESSAGES_COUNT",
  );
  assertThrowsCode(
    () => validateMessages([{ role: "tool", content: "x" }]),
    "INVALID_MESSAGE_ROLE",
  );
  assertThrowsCode(
    () => validateMessages([{ role: "user", content: " " }]),
    "INVALID_MESSAGE_CONTENT",
  );
  assertThrowsCode(
    () => validateMessages([{ role: "user", content: "x", model: "evil" }]),
    "INVALID_MESSAGE_FIELDS",
  );
  assertThrowsCode(
    () =>
      validateMessages([{
        role: "user",
        content: "😀".repeat(4_001),
      }]),
    "MESSAGE_TOO_LONG",
  );
  assertThrowsCode(
    () =>
      validateMessages([
        { role: "user", content: "a".repeat(4_000) },
        { role: "assistant", content: "b".repeat(4_000) },
        { role: "user", content: "c".repeat(4_000) },
        { role: "assistant", content: "d" },
      ]),
    "MESSAGES_TOO_LONG",
  );
});

Deno.test("request accepts only the two attachment variants", () => {
  const result = validateAIRequest({
    messages: [{ role: "user", content: "分析图片" }],
    attachments: [
      { source: "temporary", path: TEMP_PATH },
      { source: "moment", moment_id: "42", image_index: 0 },
    ],
  });

  assertEquals(result.attachments, [
    { source: "temporary", path: TEMP_PATH },
    { source: "moment", moment_id: "42", image_index: 0 },
  ]);
  assertThrowsCode(
    () =>
      validateAIRequest({
        messages: [{ role: "user", content: "x" }],
        model: "agnes-2.5-pro",
      }),
    "INVALID_REQUEST_FIELDS",
  );
  assertThrowsCode(
    () =>
      validateAIRequest({
        messages: [{ role: "user", content: "x" }],
        attachments: [{ source: "temporary", path: "https://evil.test/a.jpg" }],
      }),
    "INVALID_TEMPORARY_PATH",
  );
  assertThrowsCode(
    () =>
      validateAIRequest({
        messages: [{ role: "user", content: "x" }],
        attachments: [{
          source: "moment",
          moment_id: 42,
          image_index: 0,
        }],
      }),
    "INVALID_MOMENT_ID",
  );
  assertThrowsCode(
    () =>
      validateAIRequest({
        messages: [{ role: "user", content: "x" }],
        attachments: [{
          source: "moment",
          moment_id: "42",
          image_index: 0.5,
        }],
      }),
    "INVALID_IMAGE_INDEX",
  );
});

Deno.test("request caps images at nine and requires a user message", () => {
  assertThrowsCode(
    () =>
      validateAIRequest({
        messages: [{ role: "user", content: "x" }],
        attachments: Array.from(
          { length: 10 },
          (_, index) => ({
            source: "moment",
            moment_id: String(index + 1),
            image_index: 0,
          }),
        ),
      }),
    "TOO_MANY_ATTACHMENTS",
  );
  assertThrowsCode(
    () =>
      validateAIRequest({
        messages: [{ role: "assistant", content: "x" }],
        attachments: [{ source: "moment", moment_id: "1", image_index: 0 }],
      }),
    "ATTACHMENTS_REQUIRE_USER_MESSAGE",
  );
});

Deno.test("temporary paths are bound to the authenticated space and user", () => {
  assertEquals(
    validateTemporaryPath(TEMP_PATH, SPACE_ID, USER_ID),
    TEMP_PATH,
  );
  assertThrowsCode(
    () =>
      validateTemporaryPath(
        `${SPACE_ID}/${OTHER_USER_ID}/chat/a.jpg`,
        SPACE_ID,
        USER_ID,
      ),
    "TEMPORARY_PATH_FORBIDDEN",
    403,
  );
  assertThrowsCode(
    () =>
      validateTemporaryPath(
        `${SPACE_ID}/${USER_ID}/../a.jpg`,
        SPACE_ID,
        USER_ID,
      ),
    "INVALID_TEMPORARY_PATH",
  );
  assertThrowsCode(
    () =>
      validateTemporaryPath(
        `${SPACE_ID}/${USER_ID}/%2e%2e/a.jpg`,
        SPACE_ID,
        USER_ID,
      ),
    "INVALID_TEMPORARY_PATH",
  );
});

Deno.test("cleanup collector keeps only caller-owned temporary objects", () => {
  const paths = collectOwnedTemporaryPaths(
    [
      { source: "temporary", path: TEMP_PATH },
      { source: "temporary", path: TEMP_PATH },
      {
        source: "temporary",
        path: `${SPACE_ID}/${OTHER_USER_ID}/chat/other.jpg`,
      },
      { source: "moment", moment_id: "1", image_index: 0 },
    ],
    SPACE_ID,
    USER_ID,
  );

  assertEquals(paths, [TEMP_PATH]);
});

Deno.test("photo references accept storage refs and exact project public URLs", () => {
  assertEquals(
    parseTrustedPhotoReference(
      `storage://photos/${SPACE_ID}/${USER_ID}/moments/a.jpg`,
      SUPABASE_URL,
    ),
    `${SPACE_ID}/${USER_ID}/moments/a.jpg`,
  );
  assertEquals(
    parseTrustedPhotoReference(
      `${SUPABASE_URL}/storage/v1/object/public/photos/${SPACE_ID}/${USER_ID}/moments/%E7%85%A7%E7%89%87.png`,
      SUPABASE_URL,
    ),
    `${SPACE_ID}/${USER_ID}/moments/照片.png`,
  );
  assertEquals(
    parseTrustedPhotoReference(
      "storage://photos/legacy-root-photo.jpg",
      SUPABASE_URL,
    ),
    "legacy-root-photo.jpg",
  );
  assertEquals(
    parseTrustedPhotoReference(
      `${SUPABASE_URL}/storage/v1/object/public/photos/legacy-root-photo.jpg`,
      SUPABASE_URL,
    ),
    "legacy-root-photo.jpg",
  );
  assertThrowsCode(
    () =>
      parseTrustedPhotoReference(
        "https://evil.test/storage/v1/object/public/photos/a/b/c.jpg",
        SUPABASE_URL,
      ),
    "IMAGE_UNAVAILABLE",
    422,
  );
  assertThrowsCode(
    () =>
      parseTrustedPhotoReference(
        `${SUPABASE_URL}/storage/v1/object/sign/photos/a/b/c.jpg?token=abc`,
        SUPABASE_URL,
      ),
    "IMAGE_UNAVAILABLE",
    422,
  );
});

Deno.test("moment image indexes preserve legacy and structured semantics", () => {
  assertEquals(
    resolveMomentImageReference(
      { type: "photo", content: "storage://photos/a/b/legacy.jpg" },
      0,
    ),
    "storage://photos/a/b/legacy.jpg",
  );
  assertThrowsCode(
    () =>
      resolveMomentImageReference(
        { type: "photo", content: "storage://photos/a/b/legacy.jpg" },
        1,
      ),
    "INVALID_IMAGE_INDEX",
  );
  assertEquals(
    resolveMomentImageReference(
      {
        type: "moment",
        content: JSON.stringify({ images: ["first.jpg", "second.jpg"] }),
      },
      1,
    ),
    "second.jpg",
  );
  assertThrowsCode(
    () =>
      resolveMomentImageReference(
        {
          type: "moment",
          content: JSON.stringify({ images: ["first.jpg"] }),
        },
        1,
      ),
    "INVALID_IMAGE_INDEX",
  );
});

Deno.test("image metadata enforces MIME and per-image size", () => {
  assertEquals(
    validateImageFileInfo({
      size: MAX_IMAGE_BYTES,
      contentType: "IMAGE/WEBP; charset=binary",
    }),
    { size: MAX_IMAGE_BYTES, mimeType: "image/webp" },
  );
  assertThrowsCode(
    () =>
      validateImageFileInfo({
        size: 100,
        contentType: "image/gif",
      }),
    "UNSUPPORTED_IMAGE_TYPE",
    415,
  );
  assertThrowsCode(
    () =>
      validateImageFileInfo({
        size: MAX_IMAGE_BYTES + 1,
        contentType: "image/jpeg",
      }),
    "IMAGE_TOO_LARGE",
    413,
  );
  assertThrowsCode(
    () => validateImageFileInfo({ size: 100 }),
    "IMAGE_UNAVAILABLE",
    422,
  );
});

Deno.test("image signatures must match the declared JPEG, PNG, or WebP type", () => {
  validateImageSignature(
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    "image/jpeg",
  );
  validateImageSignature(
    new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ]),
    "image/png",
  );
  validateImageSignature(
    new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46,
      0x00,
      0x00,
      0x00,
      0x00,
      0x57,
      0x45,
      0x42,
      0x50,
    ]),
    "image/webp",
  );
  assertThrowsCode(
    () =>
      validateImageSignature(
        new TextEncoder().encode("GIF89a disguised as image/png"),
        "image/png",
      ),
    "IMAGE_CONTENT_MISMATCH",
    415,
  );
  assertThrowsCode(
    () =>
      validateImageSignature(
        new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
        "image/jpeg",
      ),
    "IMAGE_CONTENT_MISMATCH",
    415,
  );
});

Deno.test("combined image metadata is capped at forty MiB", () => {
  let total = 0;
  for (let index = 0; index < 4; index += 1) {
    total = addImageBytes(total, MAX_IMAGE_BYTES);
  }
  assertEquals(total, 40 * 1024 * 1024);
  assertThrowsCode(
    () => addImageBytes(total, 1),
    "IMAGES_TOO_LARGE",
    413,
  );
});
