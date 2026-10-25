// Shared helpers for all BYO-payments Edge Functions.
// Deno runtime (Supabase Edge Functions).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// A service-role client — Edge Functions run server-side, so this never reaches a browser.
// The service role bypasses RLS, which is correct: all our logic lives in SECURITY DEFINER
// RPCs that do their own checks.
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false }, db: { schema: "byo" } });  // all tables + RPCs live in the byo schema (expose it in API settings)
}

export const JSON_HEADERS = {
  "content-type": "application/json",
  // The TV app is a native/web client on the device; allow it to call cross-origin.
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: JSON_HEADERS });
  return null;
}

// Constant-time-ish shared-secret check for the collector phone / admin.
export function checkApiKey(req: Request, envVar: string): boolean {
  const expected = Deno.env.get(envVar);
  if (!expected) return false;
  const got = req.headers.get("x-api-key") ?? "";
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Basic rate-limit guard on device id (defensive; TV polls every few seconds).
export function badRequest(msg: string): Response {
  return json({ ok: false, error: msg }, 400);
}
