export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type TemporaryAttachment = {
  source: "temporary";
  path: string;
};

export type MomentAttachment = {
  source: "moment";
  moment_id: string;
  image_index: number;
};

export type Attachment = TemporaryAttachment | MomentAttachment;

export type AIRequest = {
  messages: ChatMessage[];
  attachments: Attachment[];
};

export type ValidatedImageInfo = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
};

export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARACTERS = 4_000;
export const MAX_TOTAL_CHARACTERS = 12_000;
export const MAX_ATTACHMENTS = 9;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;

const MAX_STORAGE_PATH_CHARACTERS = 1_024;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const STORAGE_REFERENCE_PREFIX = "storage://photos/";
const PUBLIC_PHOTO_PATH_PREFIX = "/storage/v1/object/public/photos/";
const ALLOWED_ROLES = new Set<ChatRole>(["system", "user", "assistant"]);
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export class InputValidationError extends Error {
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "InputValidationError";
    this.status = status;
  }
}

export function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

export function validateMessages(value: unknown): ChatMessage[] {
  if (
    !Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES
  ) {
    throw new InputValidationError("INVALID_MESSAGES_COUNT");
  }

  let totalCharacters = 0;
  const validated: ChatMessage[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      throw new InputValidationError("INVALID_MESSAGE");
    }
    if (!hasExactKeys(item, ["role", "content"])) {
      throw new InputValidationError("INVALID_MESSAGE_FIELDS");
    }
    if (
      typeof item.role !== "string" ||
      !ALLOWED_ROLES.has(item.role as ChatRole)
    ) {
      throw new InputValidationError("INVALID_MESSAGE_ROLE");
    }
    if (typeof item.content !== "string" || !item.content.trim()) {
      throw new InputValidationError("INVALID_MESSAGE_CONTENT");
    }

    const length = codePointLength(item.content);
    if (length > MAX_MESSAGE_CHARACTERS) {
      throw new InputValidationError("MESSAGE_TOO_LONG");
    }
    totalCharacters += length;
    if (totalCharacters > MAX_TOTAL_CHARACTERS) {
      throw new InputValidationError("MESSAGES_TOO_LONG");
    }

    // Only the audited server prompt has provider-level system authority.
    validated.push({
      role: item.role === "system" ? "user" : item.role as ChatRole,
      content: item.role === "system"
        ? `[用户提供的背景说明]\n${item.content}`
        : item.content,
    });
  }

  return validated;
}

function validateMomentId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) {
    throw new InputValidationError("INVALID_MOMENT_ID");
  }

  try {
    if (BigInt(value) > MAX_POSTGRES_BIGINT) {
      throw new InputValidationError("INVALID_MOMENT_ID");
    }
  } catch (error) {
    if (error instanceof InputValidationError) throw error;
    throw new InputValidationError("INVALID_MOMENT_ID");
  }

  return value;
}

function validateImageIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InputValidationError("INVALID_IMAGE_INDEX");
  }
  return value as number;
}

function assertStoragePathShape(
  path: string,
  code: string,
  minimumSegments = 1,
): void {
  if (
    !path ||
    codePointLength(path) > MAX_STORAGE_PATH_CHARACTERS ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new InputValidationError(code);
  }

  const segments = path.split("/");
  if (
    segments.length < minimumSegments ||
    segments.some((segment) => !segment)
  ) {
    throw new InputValidationError(code);
  }

  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new InputValidationError(code);
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      throw new InputValidationError(code);
    }
  }
}

function validateAttachment(value: unknown): Attachment {
  if (!isRecord(value) || typeof value.source !== "string") {
    throw new InputValidationError("INVALID_ATTACHMENT");
  }

  if (value.source === "temporary") {
    if (
      !hasExactKeys(value, ["source", "path"]) ||
      typeof value.path !== "string"
    ) {
      throw new InputValidationError("INVALID_ATTACHMENT");
    }
    assertStoragePathShape(value.path, "INVALID_TEMPORARY_PATH", 3);
    return { source: "temporary", path: value.path };
  }

  if (value.source === "moment") {
    if (
      !hasExactKeys(value, ["source", "moment_id", "image_index"])
    ) {
      throw new InputValidationError("INVALID_ATTACHMENT");
    }
    return {
      source: "moment",
      moment_id: validateMomentId(value.moment_id),
      image_index: validateImageIndex(value.image_index),
    };
  }

  throw new InputValidationError("INVALID_ATTACHMENT");
}

export function validateAIRequest(value: unknown): AIRequest {
  if (
    !isRecord(value) ||
    !("messages" in value) ||
    !Object.keys(value).every((key) =>
      key === "messages" || key === "attachments"
    )
  ) {
    throw new InputValidationError("INVALID_REQUEST_FIELDS");
  }

  const messages = validateMessages(value.messages);
  const rawAttachments = value.attachments ?? [];
  if (!Array.isArray(rawAttachments)) {
    throw new InputValidationError("INVALID_ATTACHMENT");
  }
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    throw new InputValidationError("TOO_MANY_ATTACHMENTS");
  }

  const attachments = rawAttachments.map(validateAttachment);
  if (
    attachments.length > 0 &&
    !messages.some((message) => message.role === "user")
  ) {
    throw new InputValidationError("ATTACHMENTS_REQUIRE_USER_MESSAGE");
  }

  return { messages, attachments };
}

export function validateTemporaryPath(
  path: string,
  spaceId: string,
  userId: string,
): string {
  assertStoragePathShape(path, "INVALID_TEMPORARY_PATH", 3);
  const [pathSpaceId, pathUserId] = path.split("/");
  if (pathSpaceId !== spaceId || pathUserId !== userId) {
    throw new InputValidationError("TEMPORARY_PATH_FORBIDDEN", 403);
  }
  return path;
}

export function collectOwnedTemporaryPaths(
  value: unknown,
  spaceId: string,
  userId: string,
): string[] {
  if (!Array.isArray(value)) return [];

  const paths = new Set<string>();
  for (const item of value.slice(0, 64)) {
    if (
      !isRecord(item) ||
      item.source !== "temporary" ||
      typeof item.path !== "string"
    ) {
      continue;
    }
    try {
      paths.add(validateTemporaryPath(item.path, spaceId, userId));
    } catch {
      // Cleanup is best-effort and must never widen beyond the caller's exact
      // space/user prefix.
    }
  }
  return [...paths];
}

function normalizePhotoObjectPath(
  path: string,
  errorCode: string,
): string {
  assertStoragePathShape(path, errorCode);
  return path;
}

export function parseTrustedPhotoReference(
  value: unknown,
  supabaseUrl: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  if (value.startsWith(STORAGE_REFERENCE_PREFIX)) {
    return normalizePhotoObjectPath(
      value.slice(STORAGE_REFERENCE_PREFIX.length),
      "IMAGE_UNAVAILABLE",
    );
  }

  let mediaUrl: URL;
  let projectUrl: URL;
  try {
    mediaUrl = new URL(value);
    projectUrl = new URL(supabaseUrl);
  } catch {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  if (
    mediaUrl.protocol !== "https:" ||
    mediaUrl.origin !== projectUrl.origin ||
    mediaUrl.search ||
    mediaUrl.hash ||
    !mediaUrl.pathname.startsWith(PUBLIC_PHOTO_PATH_PREFIX)
  ) {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  const encodedPath = mediaUrl.pathname.slice(PUBLIC_PHOTO_PATH_PREFIX.length);
  let decodedPath: string;
  try {
    decodedPath = encodedPath
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  return normalizePhotoObjectPath(decodedPath, "IMAGE_UNAVAILABLE");
}

export function resolveMomentImageReference(
  moment: unknown,
  imageIndex: number,
): unknown {
  if (!isRecord(moment) || typeof moment.type !== "string") {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  if (moment.type === "photo") {
    if (imageIndex !== 0) {
      throw new InputValidationError("INVALID_IMAGE_INDEX");
    }
    return moment.content;
  }

  if (moment.type !== "moment" || typeof moment.content !== "string") {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(moment.content);
  } catch {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.images) ||
    imageIndex >= parsed.images.length
  ) {
    throw new InputValidationError("INVALID_IMAGE_INDEX");
  }

  return parsed.images[imageIndex];
}

export function validateImageFileInfo(value: unknown): ValidatedImageInfo {
  if (!isRecord(value)) {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  const size = value.size;
  const rawContentType = value.contentType;
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    typeof rawContentType !== "string"
  ) {
    throw new InputValidationError("IMAGE_UNAVAILABLE", 422);
  }

  const mimeType = rawContentType.split(";", 1)[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new InputValidationError("UNSUPPORTED_IMAGE_TYPE", 415);
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new InputValidationError("IMAGE_TOO_LARGE", 413);
  }

  return {
    mimeType: mimeType as ValidatedImageInfo["mimeType"],
    size,
  };
}

export function validateImageSignature(
  bytes: Uint8Array,
  mimeType: ValidatedImageInfo["mimeType"],
): void {
  const matches = mimeType === "image/jpeg"
    ? bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    : mimeType === "image/png"
    ? bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    : bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;

  if (!matches) {
    throw new InputValidationError("IMAGE_CONTENT_MISMATCH", 415);
  }
}

export function addImageBytes(currentTotal: number, imageSize: number): number {
  const nextTotal = currentTotal + imageSize;
  if (!Number.isSafeInteger(nextTotal) || nextTotal > MAX_TOTAL_IMAGE_BYTES) {
    throw new InputValidationError("IMAGES_TOO_LARGE", 413);
  }
  return nextTotal;
}
