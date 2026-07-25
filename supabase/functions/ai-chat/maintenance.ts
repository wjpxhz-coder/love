import { withFinallyCleanup } from "./cleanup.ts";
import {
  type AuthenticatedContext,
  authenticateMembership,
  checkOrigin,
  jsonResponse,
  safeLog,
} from "./shared.ts";
import { collectOwnedTemporaryPaths, isRecord } from "./validation.ts";

const MAX_BODY_BYTES = 64 * 1024;
const AI_INPUT_BUCKET = "ai-inputs";

async function cleanupTemporaryObjects(
  context: AuthenticatedContext,
  paths: Set<string>,
  requestId: string,
  startedAt: number,
): Promise<void> {
  if (paths.size === 0) return;

  try {
    const { error } = await context.supabase.storage
      .from(AI_INPUT_BUCKET)
      .remove([...paths]);
    if (error) {
      safeLog(
        requestId,
        context.userId,
        "temporary_cleanup_failed",
        startedAt,
      );
    }
  } catch {
    safeLog(
      requestId,
      context.userId,
      "temporary_cleanup_failed",
      startedAt,
    );
  }
}

export async function handleMaintenanceRequest(
  request: Request,
): Promise<Response> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const originResult = checkOrigin(request, requestId, startedAt);
  if ("response" in originResult) return originResult.response;
  const { origin } = originResult;
  if (originResult.preflight) return originResult.preflight;

  if (request.method !== "POST") {
    return jsonResponse(405, "METHOD_NOT_ALLOWED", requestId, origin);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return jsonResponse(415, "JSON_REQUIRED", requestId, origin);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse(413, "REQUEST_TOO_LARGE", requestId, origin);
  }

  try {
    const authResult = await authenticateMembership(
      request,
      requestId,
      origin,
      startedAt,
    );
    if ("response" in authResult) return authResult.response;
    const context = authResult.context;
    const temporaryPaths = new Set<string>();

    return await withFinallyCleanup(
      async () => {
        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
          return jsonResponse(413, "REQUEST_TOO_LARGE", requestId, origin);
        }

        try {
          const parsedBody: unknown = JSON.parse(rawBody);
          if (isRecord(parsedBody)) {
            for (
              const path of collectOwnedTemporaryPaths(
                parsedBody.attachments,
                context.spaceId,
                context.userId,
              )
            ) {
              temporaryPaths.add(path);
            }
          }
        } catch {
          // Maintenance does not need to validate the request body. A malformed
          // body simply cannot provide a safely scoped cleanup path.
        }

        safeLog(
          requestId,
          context.userId,
          "service_maintenance",
          startedAt,
        );
        return jsonResponse(503, "SERVICE_MAINTENANCE", requestId, origin, {
          retry_after_seconds: 300,
        });
      },
      () =>
        cleanupTemporaryObjects(
          context,
          temporaryPaths,
          requestId,
          startedAt,
        ),
    );
  } catch {
    safeLog(requestId, null, "internal_error", startedAt);
    return jsonResponse(500, "INTERNAL_ERROR", requestId, origin);
  }
}

if (import.meta.main) {
  Deno.serve(handleMaintenanceRequest);
}
