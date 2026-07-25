import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isRecord } from "./validation.ts";

const PRODUCTION_ORIGIN = "https://wjpxhz-coder.github.io";
export const AGNES_CONSENT_HEADER = "x-agnes-consent-version";
export const AGNES_CONSENT_VERSION = "agnes-2.0-v1";

export type AuthenticatedContext = {
  supabase: SupabaseClient;
  supabaseUrl: string;
  userId: string;
  spaceId: string;
};

export function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getPublishableKey(): string {
  for (const name of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }

  const keysJson = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (keysJson) {
    const parsed: unknown = JSON.parse(keysJson);
    if (isRecord(parsed)) {
      const preferred = parsed.default;
      if (typeof preferred === "string" && preferred.trim()) return preferred;
      const first = Object.values(parsed).find(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      );
      if (first) return first;
    }
  }

  throw new Error("No Supabase publishable key is configured");
}

export function allowedOrigins(): Set<string> {
  const configuredOrigin = Deno.env.get("AI_CHAT_ALLOWED_ORIGINS")?.trim();
  if (configuredOrigin && configuredOrigin !== PRODUCTION_ORIGIN) {
    throw new Error(
      `AI_CHAT_ALLOWED_ORIGINS must equal ${PRODUCTION_ORIGIN}`,
    );
  }

  return new Set([PRODUCTION_ORIGIN]);
}

export function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "vary": "Origin",
  });

  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set(
      "access-control-allow-headers",
      `authorization, apikey, content-type, x-client-info, ${AGNES_CONSENT_HEADER}`,
    );
    headers.set("access-control-max-age", "600");
  }

  return headers;
}

export function jsonResponse(
  status: number,
  code: string,
  requestId: string,
  origin: string | null,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({ code, request_id: requestId, ...extra }),
    {
      status,
      headers: responseHeaders(origin),
    },
  );
}

export function parseBearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function hasCurrentAgnesConsentProtocol(request: Request): boolean {
  return request.headers.get(AGNES_CONSENT_HEADER)?.trim() ===
    AGNES_CONSENT_VERSION;
}

export function safeLog(
  requestId: string,
  userId: string | null,
  status: string,
  startedAt: number,
): void {
  console.log(JSON.stringify({
    request_id: requestId,
    user_id: userId,
    status,
    latency_ms: Date.now() - startedAt,
  }));
}

export function checkOrigin(
  request: Request,
  requestId: string,
  startedAt: number,
): { origin: string; preflight?: Response } | { response: Response } {
  const origin = request.headers.get("origin");

  let origins: Set<string>;
  try {
    origins = allowedOrigins();
  } catch {
    safeLog(requestId, null, "misconfigured_origins", startedAt);
    return {
      response: jsonResponse(
        503,
        "SERVICE_MISCONFIGURED",
        requestId,
        null,
      ),
    };
  }

  if (!origin || !origins.has(origin)) {
    safeLog(requestId, null, "origin_rejected", startedAt);
    return {
      response: jsonResponse(403, "ORIGIN_NOT_ALLOWED", requestId, null),
    };
  }

  if (request.method === "OPTIONS") {
    return {
      origin,
      preflight: new Response(null, {
        status: 204,
        headers: responseHeaders(origin),
      }),
    };
  }

  return { origin };
}

export async function authenticateMembership(
  request: Request,
  requestId: string,
  origin: string,
  startedAt: number,
): Promise<
  { context: AuthenticatedContext } | { response: Response }
> {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) {
    return {
      response: jsonResponse(401, "AUTH_REQUIRED", requestId, origin),
    };
  }

  let supabaseUrl: string;
  let supabase: SupabaseClient;
  try {
    supabaseUrl = env("SUPABASE_URL");
    supabase = createClient(supabaseUrl, getPublishableKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  } catch {
    safeLog(requestId, null, "misconfigured_supabase", startedAt);
    return {
      response: jsonResponse(
        503,
        "SERVICE_MISCONFIGURED",
        requestId,
        origin,
      ),
    };
  }

  // This performs an Auth server round trip. Identity is never taken from
  // request JSON, user_metadata, or an unverified local JWT decode.
  const { data: userData, error: userError } = await supabase.auth.getUser(
    token,
  );
  if (userError || !userData.user) {
    safeLog(requestId, null, "invalid_token", startedAt);
    return {
      response: jsonResponse(401, "INVALID_TOKEN", requestId, origin),
    };
  }
  const userId = userData.user.id;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, space_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (
    profileError ||
    !profile?.space_id ||
    profile.user_id !== userId
  ) {
    safeLog(requestId, userId, "profile_denied", startedAt);
    return {
      response: jsonResponse(
        403,
        "MEMBERSHIP_REQUIRED",
        requestId,
        origin,
      ),
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("space_members")
    .select("space_id, user_id")
    .eq("space_id", profile.space_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError || !membership) {
    safeLog(requestId, userId, "membership_denied", startedAt);
    return {
      response: jsonResponse(
        403,
        "MEMBERSHIP_REQUIRED",
        requestId,
        origin,
      ),
    };
  }

  return {
    context: {
      supabase,
      supabaseUrl,
      userId,
      spaceId: profile.space_id,
    },
  };
}
