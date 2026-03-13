import type { MiddlewareHandler } from "hono";

// ----------------------------------------------------------------------------#
// HMAC Request Signing Middleware
// ----------------------------------------------------------------------------#
const MAX_AGE_SECONDS = 300; // 5 minutes

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export function hmacAuth(): MiddlewareHandler {
  return async (c, next) => {
    const secret = process.env.HMAC_SECRET;
    if (!secret) {
      return c.json({ error: "server misconfigured: HMAC_SECRET not set" }, 500);
    }

    const signature = c.req.header("x-hmac-signature");
    const timestamp = c.req.header("x-hmac-timestamp");

    if (!signature || !timestamp) {
      return c.json({ error: "missing HMAC signature or timestamp" }, 401);
    }

    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(ts) || Math.abs(now - ts) > MAX_AGE_SECONDS) {
      return c.json({ error: "request timestamp expired" }, 401);
    }

    const body = await c.req.text();
    const signingString = `${timestamp}.${body}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signingString));
    const expected = bytesToHex(new Uint8Array(mac));

    if (!timingSafeEqual(encoder.encode(expected), encoder.encode(signature))) {
      return c.json({ error: "invalid HMAC signature" }, 401);
    }

    // Re-parse the body so downstream handlers can read it
    // Hono caches the body internally, so we need to override the json getter
    const parsed = JSON.parse(body);
    c.req.json = () => Promise.resolve(parsed);

    await next();
  };
}
