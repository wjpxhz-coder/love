export interface Env {
  PHOTOS_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ALLOWED_SPACE_ID: string;
  ALLOWED_USER_IDS: string;
  SIGNING_SECRET: string;
  MIGRATION_TOKEN: string;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MiB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/wav",
  "audio/x-m4a",
]);

const authCache = new Map<string, { userId: string; expiresAt: number }>();

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, apikey, Content-Type, x-upsert, cache-control, Range, x-client-info, x-migration-token",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(
  data: unknown,
  status: number,
  request: Request,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...getCorsHeaders(request),
      ...extraHeaders,
    },
  });
}

function sanitizeObjectPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string") return "";
  const decoded = rawPath
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/")
    .replace(/^\/+/, "");
  if (
    !decoded ||
    decoded.includes("..") ||
    decoded.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(decoded)
  ) {
    return "";
  }
  return decoded;
}

function encodeObjectPath(objectPath: string): string {
  return objectPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function inferMimeTypeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };
  return map[ext] || "application/octet-stream";
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

let cachedCryptoKey: CryptoKey | null = null;
let cachedSecretStr = "";

async function getSigningKey(secret: string): Promise<CryptoKey> {
  if (cachedCryptoKey && cachedSecretStr === secret) {
    return cachedCryptoKey;
  }
  const enc = new TextEncoder();
  cachedCryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret || "default-fallback-secret-key"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  cachedSecretStr = secret;
  return cachedCryptoKey;
}

async function signObjectPath(
  objectPath: string,
  expiresInSec: number,
  secret: string
): Promise<string> {
  const ttl = Math.max(60, Math.min(Number(expiresInSec) || 3600, 86400 * 7));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const key = await getSigningKey(secret);
  const payload = new TextEncoder().encode(`${objectPath}:${exp}`);
  const sigBuf = await crypto.subtle.sign("HMAC", key, payload);
  const sig = base64UrlEncode(new Uint8Array(sigBuf));
  return `${exp}.${sig}`;
}

async function verifyObjectToken(
  objectPath: string,
  token: string,
  secret: string
): Promise<boolean> {
  if (!token || typeof token !== "string") return false;
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) return false;
  const expStr = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const key = await getSigningKey(secret);
  const payload = new TextEncoder().encode(`${objectPath}:${exp}`);
  const expectedBuf = await crypto.subtle.sign("HMAC", key, payload);
  const expectedSig = base64UrlEncode(new Uint8Array(expectedBuf));
  if (sig.length !== expectedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return diff === 0;
}

async function authenticateUser(
  request: Request,
  env: Env
): Promise<{ userId: string; spaceId: string } | null> {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  const now = Date.now();
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > now) {
    return { userId: cached.userId, spaceId: env.ALLOWED_SPACE_ID };
  }

  const allowedUsers = new Set(
    (env.ALLOWED_USER_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  try {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });
    if (!resp.ok) return null;
    const user = (await resp.json()) as { id?: string };
    if (!user || !user.id || !allowedUsers.has(user.id)) {
      return null;
    }
    authCache.set(token, { userId: user.id, expiresAt: now + 5 * 60 * 1000 });
    if (authCache.size > 200) {
      const firstKey = authCache.keys().next().value;
      if (firstKey) authCache.delete(firstKey);
    }
    return { userId: user.id, spaceId: env.ALLOWED_SPACE_ID };
  } catch {
    return null;
  }
}

function isAllowedWritePath(
  objectPath: string,
  userId: string,
  spaceId: string
): boolean {
  if (objectPath.startsWith(`${spaceId}/${userId}/`)) return true;
  if (objectPath.startsWith(`avatars/${userId}/`) || objectPath.startsWith("avatars/")) return true;
  return false;
}

function isAllowedDeletePath(
  objectPath: string,
  userId: string,
  spaceId: string
): boolean {
  if (objectPath.startsWith(`${spaceId}/${userId}/`)) return true;
  if (objectPath.startsWith(`${spaceId}/`)) return true;
  if (objectPath.startsWith(`avatars/${userId}/`) || objectPath.startsWith("avatars/")) return true;
  return false;
}

function parseRangeHeader(
  rangeHeader: string | null,
  totalSize: number
): { offset: number; length: number; start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=") || totalSize <= 0) {
    return null;
  }
  const spec = rangeHeader.slice(6).trim().split(",")[0];
  const [startStr, endStr] = spec.split("-");
  let start = startStr ? parseInt(startStr, 10) : NaN;
  let end = endStr ? parseInt(endStr, 10) : NaN;

  if (Number.isNaN(start) && !Number.isNaN(end)) {
    // suffix range: bytes=-500
    const suffixLen = Math.min(end, totalSize);
    start = Math.max(0, totalSize - suffixLen);
    end = totalSize - 1;
  } else if (!Number.isNaN(start) && Number.isNaN(end)) {
    end = totalSize - 1;
  }

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    start >= totalSize ||
    end < start
  ) {
    return null;
  }
  end = Math.min(end, totalSize - 1);
  return {
    offset: start,
    length: end - start + 1,
    start,
    end,
  };
}

async function ensureObjectInR2(
  objectPath: string,
  env: Env,
  ctx: ExecutionContext
): Promise<R2Object | null> {
  const headObj = await env.PHOTOS_BUCKET.head(objectPath);
  if (headObj) return headObj;

  // Fallback pull from Supabase Storage if not yet in R2
  try {
    const supaUrl = `${env.SUPABASE_URL}/storage/v1/object/public/photos/${encodeObjectPath(objectPath)}`;
    const resp = await fetch(supaUrl);
    if (!resp.ok || !resp.body) return null;
    const contentType =
      resp.headers.get("content-type") || inferMimeTypeFromPath(objectPath);
    const bytes = await resp.arrayBuffer();
    await env.PHOTOS_BUCKET.put(objectPath, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    return await env.PHOTOS_BUCKET.head(objectPath);
  } catch {
    return null;
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // ---------------------------------------------------------
    // 1. Admin Migration & Verification Endpoints
    // ---------------------------------------------------------
    if (pathname.startsWith("/_admin/")) {
      const migToken = request.headers.get("x-migration-token") || "";
      if (!env.MIGRATION_TOKEN || migToken !== env.MIGRATION_TOKEN) {
        return jsonResponse({ error: "Unauthorized" }, 401, request);
      }

      if (pathname === "/_admin/stats" && request.method === "GET") {
        const objects: Array<{ key: string; size: number; etag: string }> = [];
        let cursor: string | undefined = undefined;
        let totalBytes = 0;
        do {
          const listed = await env.PHOTOS_BUCKET.list({ cursor, limit: 1000 });
          for (const obj of listed.objects) {
            objects.push({ key: obj.key, size: obj.size, etag: obj.etag });
            totalBytes += obj.size;
          }
          cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);

        return jsonResponse(
          {
            bucket: "love-photos",
            count: objects.length,
            totalBytes,
            objects,
          },
          200,
          request
        );
      }

      if (pathname === "/_admin/migrate" && request.method === "POST") {
        const body = (await request.json()) as {
          objects?: Array<{ name: string; mimetype?: string; size?: number }>;
          force?: boolean;
        };
        const items = Array.isArray(body.objects) ? body.objects : [];
        const force = Boolean(body.force);

        const results = await Promise.all(
          items.map(async (item) => {
            const key = sanitizeObjectPath(item.name);
            if (!key) {
              return { name: item.name, status: "invalid_key" };
            }
            try {
              if (!force) {
                const existing = await env.PHOTOS_BUCKET.head(key);
                if (
                  existing &&
                  (!item.size || existing.size === Number(item.size))
                ) {
                  return {
                    name: key,
                    status: "already_exists",
                    size: existing.size,
                  };
                }
              }

              const supaUrl = `${env.SUPABASE_URL}/storage/v1/object/public/photos/${encodeObjectPath(key)}`;
              const resp = await fetch(supaUrl);
              if (!resp.ok || !resp.body) {
                return {
                  name: key,
                  status: "fetch_failed",
                  httpStatus: resp.status,
                };
              }
              const contentType =
                item.mimetype ||
                resp.headers.get("content-type") ||
                inferMimeTypeFromPath(key);

              const putRes = await env.PHOTOS_BUCKET.put(key, resp.body, {
                httpMetadata: {
                  contentType,
                  cacheControl: "public, max-age=31536000, immutable",
                },
              });

              return {
                name: key,
                status: "migrated",
                size: putRes.size,
                expectedSize: item.size || null,
              };
            } catch (err) {
              return {
                name: key,
                status: "error",
                error: err instanceof Error ? err.message : String(err),
              };
            }
          })
        );

        return jsonResponse({ results }, 200, request);
      }
    }

    // ---------------------------------------------------------
    // 2. Batch Signed URLs: POST /storage/v1/object/sign/photos
    // ---------------------------------------------------------
    if (
      request.method === "POST" &&
      (pathname === "/storage/v1/object/sign/photos" ||
        pathname === "/object/sign/photos")
    ) {
      const auth = await authenticateUser(request, env);
      if (!auth) {
        return jsonResponse({ error: "Unauthorized" }, 401, request);
      }
      let body: { expiresIn?: number; paths?: string[] } = {};
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400, request);
      }
      const expiresIn = Number(body.expiresIn) || 3600;
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const result = await Promise.all(
        paths.map(async (rawP) => {
          const cleanPath = sanitizeObjectPath(rawP);
          if (!cleanPath) {
            return { error: "Invalid path", path: rawP, signedURL: null, signedUrl: null };
          }
          const token = await signObjectPath(cleanPath, expiresIn, env.SIGNING_SECRET);
          const relPath = `/object/sign/photos/${encodeObjectPath(cleanPath)}?token=${token}`;
          const fullUrl = `${url.origin}/storage/v1${relPath}`;
          return {
            error: null,
            path: rawP,
            signedURL: relPath,
            signedUrl: fullUrl,
          };
        })
      );
      return jsonResponse(result, 200, request);
    }

    // ---------------------------------------------------------
    // 3. Single Signed URL: POST /storage/v1/object/sign/photos/<path>
    // ---------------------------------------------------------
    const singleSignMatch = pathname.match(
      /^(?:\/storage\/v1)?\/object\/sign\/photos\/(.+)$/
    );
    if (request.method === "POST" && singleSignMatch) {
      const auth = await authenticateUser(request, env);
      if (!auth) {
        return jsonResponse({ error: "Unauthorized" }, 401, request);
      }
      const cleanPath = sanitizeObjectPath(singleSignMatch[1]);
      if (!cleanPath) {
        return jsonResponse({ error: "Invalid path" }, 400, request);
      }
      let expiresIn = 3600;
      try {
        const body = (await request.json()) as { expiresIn?: number };
        if (body && body.expiresIn) expiresIn = Number(body.expiresIn);
      } catch {}

      const token = await signObjectPath(cleanPath, expiresIn, env.SIGNING_SECRET);
      const relPath = `/object/sign/photos/${encodeObjectPath(cleanPath)}?token=${token}`;
      const fullUrl = `${url.origin}/storage/v1${relPath}`;
      return jsonResponse(
        {
          signedURL: relPath,
          signedUrl: fullUrl,
        },
        200,
        request
      );
    }

    // ---------------------------------------------------------
    // 4. Object Info: GET /storage/v1/object/info/(authenticated|public)?/photos/<path>
    // ---------------------------------------------------------
    const infoMatch = pathname.match(
      /^(?:\/storage\/v1)?\/object\/info\/(?:(?:authenticated|public)\/)?photos\/(.+)$/
    );
    if ((request.method === "GET" || request.method === "HEAD") && infoMatch) {
      const cleanPath = sanitizeObjectPath(infoMatch[1]);
      if (!cleanPath) {
        return jsonResponse({ error: "Invalid path" }, 400, request);
      }
      const obj = await ensureObjectInR2(cleanPath, env, ctx);
      if (!obj) {
        return jsonResponse({ error: "Not found", statusCode: "404" }, 404, request);
      }
      const contentType =
        obj.httpMetadata?.contentType || inferMimeTypeFromPath(cleanPath);
      return jsonResponse(
        {
          id: obj.etag,
          name: cleanPath,
          bucket_id: "photos",
          size: obj.size,
          content_type: contentType,
          cache_control: obj.httpMetadata?.cacheControl || "public, max-age=3600",
          etag: obj.httpEtag,
          metadata: {
            size: obj.size,
            mimetype: contentType,
          },
          created_at: obj.uploaded.toISOString(),
          updated_at: obj.uploaded.toISOString(),
        },
        200,
        request
      );
    }

    // ---------------------------------------------------------
    // 5. Batch Delete Objects: DELETE /storage/v1/object/photos
    // ---------------------------------------------------------
    if (
      request.method === "DELETE" &&
      (pathname === "/storage/v1/object/photos" || pathname === "/object/photos")
    ) {
      const auth = await authenticateUser(request, env);
      if (!auth) {
        return jsonResponse({ error: "Unauthorized" }, 401, request);
      }
      let body: { prefixes?: string[] } = {};
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400, request);
      }
      const prefixes = Array.isArray(body.prefixes) ? body.prefixes : [];
      const validPaths = prefixes
        .map((p) => sanitizeObjectPath(p))
        .filter((p) => p && isAllowedDeletePath(p, auth.userId, auth.spaceId));

      if (validPaths.length > 0) {
        await env.PHOTOS_BUCKET.delete(validPaths);
      }
      return jsonResponse(
        validPaths.map((name) => ({ name, bucket_id: "photos" })),
        200,
        request
      );
    }

    // ---------------------------------------------------------
    // 6. Upload Object: POST or PUT /storage/v1/object/photos/<path>
    // ---------------------------------------------------------
    const uploadMatch = pathname.match(
      /^(?:\/storage\/v1)?\/object\/photos\/(.+)$/
    );
    if (
      (request.method === "POST" || request.method === "PUT") &&
      uploadMatch
    ) {
      const auth = await authenticateUser(request, env);
      if (!auth) {
        return jsonResponse({ error: "Unauthorized" }, 401, request);
      }
      const cleanPath = sanitizeObjectPath(uploadMatch[1]);
      if (
        !cleanPath ||
        !isAllowedWritePath(cleanPath, auth.userId, auth.spaceId)
      ) {
        return jsonResponse({ error: "Forbidden path" }, 403, request);
      }

      const upsertHeader = request.headers.get("x-upsert");
      if (upsertHeader === "false") {
        const existing = await env.PHOTOS_BUCKET.head(cleanPath);
        if (existing) {
          return jsonResponse(
            { error: "Duplicate", message: "The resource already exists" },
            409,
            request
          );
        }
      }

      const reqContentType = request.headers.get("content-type") || "";
      let uploadBody: ReadableStream | ArrayBuffer | Blob | null = null;
      let finalMime = "";
      let fileSize = 0;

      if (reqContentType.toLowerCase().includes("multipart/form-data")) {
        const formData = await request.formData();
        let foundBlob: Blob | null = null;
        for (const val of formData.values()) {
          if (typeof val === "object" && val !== null && "arrayBuffer" in val) {
            foundBlob = val as Blob;
            break;
          }
        }
        if (!foundBlob) {
          return jsonResponse({ error: "Missing file in form data" }, 400, request);
        }
        fileSize = foundBlob.size;
        finalMime =
          (foundBlob.type ? foundBlob.type.split(";")[0].trim().toLowerCase() : "") ||
          inferMimeTypeFromPath(cleanPath);
        uploadBody = await foundBlob.arrayBuffer();
      } else {
        const contentLength = Number(request.headers.get("content-length") || 0);
        fileSize = contentLength;
        finalMime =
          reqContentType.split(";")[0].trim().toLowerCase() ||
          inferMimeTypeFromPath(cleanPath);
        uploadBody = request.body;
      }

      if (fileSize > MAX_UPLOAD_BYTES) {
        return jsonResponse({ error: "Payload too large (max 20 MiB)" }, 413, request);
      }
      if (finalMime === "image/jpg") finalMime = "image/jpeg";
      if (!ALLOWED_MIME_TYPES.has(finalMime)) {
        const inferred = inferMimeTypeFromPath(cleanPath);
        if (ALLOWED_MIME_TYPES.has(inferred)) {
          finalMime = inferred;
        } else {
          return jsonResponse(
            { error: `Unsupported MIME type: ${finalMime}` },
            415,
            request
          );
        }
      }

      if (!uploadBody) {
        return jsonResponse({ error: "Empty body" }, 400, request);
      }

      await env.PHOTOS_BUCKET.put(cleanPath, uploadBody, {
        httpMetadata: {
          contentType: finalMime,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });

      return jsonResponse(
        {
          Key: `photos/${cleanPath}`,
          Id: cleanPath,
        },
        200,
        request
      );
    }

    // ---------------------------------------------------------
    // 7. Read / Stream Object: GET or HEAD /storage/v1/object/(sign|public|authenticated)?/photos/<path>
    // ---------------------------------------------------------
    const getMatch = pathname.match(
      /^(?:\/storage\/v1)?\/object\/(?:(sign|public|authenticated)\/)?photos\/(.+)$/
    );
    if ((request.method === "GET" || request.method === "HEAD") && getMatch) {
      const mode = getMatch[1] || "direct";
      const cleanPath = sanitizeObjectPath(getMatch[2]);
      if (!cleanPath) {
        return jsonResponse({ error: "Invalid path" }, 400, request);
      }

      // If mode === 'sign', verify token if provided
      const token = url.searchParams.get("token");
      if (mode === "sign" && token) {
        const valid = await verifyObjectToken(cleanPath, token, env.SIGNING_SECRET);
        if (!valid) {
          return jsonResponse({ error: "Invalid or expired signature token" }, 403, request);
        }
      }

      const headObj = await ensureObjectInR2(cleanPath, env, ctx);
      if (!headObj) {
        return jsonResponse({ error: "Object not found" }, 404, request);
      }

      const contentType =
        headObj.httpMetadata?.contentType || inferMimeTypeFromPath(cleanPath);
      const commonHeaders: Record<string, string> = {
        ...getCorsHeaders(request),
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        ETag: headObj.httpEtag,
        "Cache-Control": "public, max-age=31536000, immutable",
      };

      const ifNoneMatch = request.headers.get("If-None-Match");
      if (ifNoneMatch && ifNoneMatch === headObj.httpEtag) {
        return new Response(null, { status: 304, headers: commonHeaders });
      }

      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            ...commonHeaders,
            "Content-Length": String(headObj.size),
          },
        });
      }

      const rangeHeader = request.headers.get("Range");
      const parsedRange = parseRangeHeader(rangeHeader, headObj.size);

      if (parsedRange) {
        const r2Obj = await env.PHOTOS_BUCKET.get(cleanPath, {
          range: { offset: parsedRange.offset, length: parsedRange.length },
        });
        if (!r2Obj || !("body" in r2Obj)) {
          return jsonResponse({ error: "Object not found" }, 404, request);
        }
        return new Response(r2Obj.body, {
          status: 206,
          headers: {
            ...commonHeaders,
            "Content-Range": `bytes ${parsedRange.start}-${parsedRange.end}/${headObj.size}`,
            "Content-Length": String(parsedRange.length),
          },
        });
      }

      const r2Obj = await env.PHOTOS_BUCKET.get(cleanPath);
      if (!r2Obj || !("body" in r2Obj)) {
        return jsonResponse({ error: "Object not found" }, 404, request);
      }
      return new Response(r2Obj.body, {
        status: 200,
        headers: {
          ...commonHeaders,
          "Content-Length": String(headObj.size),
        },
      });
    }

    return jsonResponse(
      {
        service: "love-media-r2-gateway",
        status: "ok",
      },
      200,
      request
    );
  },
};
