import { Hono } from "hono";
import { cors } from "hono/cors";
import { html } from "hono/html";

import { apiKeyAuth } from "./lib/auth.js";
import { createDb } from "./lib/db.js";
import { challengeRouter } from "./routes/challenge.js";
import { cronRouter } from "./routes/cron.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { userRouter } from "./routes/user.js";
import type { Env } from "./routes/types.js";

// ----------------------------------------------------------------------------#
// Landing Page
// ----------------------------------------------------------------------------#
const landingHtml = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mini Golf — Daily Challenge</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛳</text></svg>" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1B1B1D;
      background-image: radial-gradient(circle, #2a2a2e 1px, transparent 1px);
      background-size: 12px 12px;
      font-family: 'DotGothic16', monospace;
      color: #e5e5e5;
    }
    .card {
      text-align: center;
      padding: 3rem 2rem;
    }
    .dots {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin: 1rem 0;
    }
    .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #3a3a3e;
    }
    .dot.accent { background: #e53935; }
    h1 {
      font-size: 2.5rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
    }
    .subtitle {
      color: #888;
      font-size: 0.85rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-top: 0.25rem;
    }
    .hint {
      margin-top: 1.5rem;
      font-size: 0.75rem;
      color: #555;
      letter-spacing: 0.05em;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>MINI GOLF</h1>
    <div class="dots">
      <span class="dot"></span><span class="dot"></span><span class="dot accent"></span>
      <span class="dot"></span><span class="dot"></span>
    </div>
    <p class="subtitle">Daily Challenge Server</p>
    <p class="hint">API &mdash; /api/*</p>
  </div>
</body>
</html>`;

// ----------------------------------------------------------------------------#
// App
// ----------------------------------------------------------------------------#
const app = new Hono<Env>().basePath("/api");

// ----------------------------------------------------------------------------#
// Middleware
// ----------------------------------------------------------------------------#
app.use("*", cors());

app.use("*", async (c, next) => {
  const db = createDb(process.env.STORAGE_POSTGRES_URL ?? process.env.POSTGRES_URL!);
  c.set("db", db);
  await next();
});

// Landing page — no auth required
const serveLanding = (c: any) => c.html(landingHtml);
app.get("/", serveLanding);
app.on("GET", ["/api", "/api/"], serveLanding);

// Cron endpoint uses its own auth (Bearer CRON_SECRET)
app.route("/cron", cronRouter);

// All other routes require the widget API key
app.use("*", apiKeyAuth());

app.route("/challenge", challengeRouter);
app.route("/leaderboard", leaderboardRouter);
app.route("/user", userRouter);

// ----------------------------------------------------------------------------#
// Health
// ----------------------------------------------------------------------------#
app.get("/health", (c) => c.json({ status: "ok" }));

// ----------------------------------------------------------------------------#
// Not Found
// ----------------------------------------------------------------------------#
app.notFound((c) => {
  const path = c.req.path;
  if (path === "/" || path === "" || path === "/api" || path === "/api/") {
    return c.html(landingHtml);
  }
  return c.json({ error: "not found" }, 404);
});

// ----------------------------------------------------------------------------#
// Export
// ----------------------------------------------------------------------------#
export default app;
