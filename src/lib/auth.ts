import type { MiddlewareHandler } from "hono";

// ----------------------------------------------------------------------------#
// API Key Middleware
// ----------------------------------------------------------------------------#
export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const validKeys = (process.env.API_KEY ?? "").split(",").map((k) => k.trim());
    const provided = c.req.header("x-api-key");

    if (!provided || !validKeys.includes(provided)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}
