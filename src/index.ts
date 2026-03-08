import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";

import { apiKeyAuth } from "./lib/auth.js";
import { createDb } from "./lib/db.js";
import { challengeRouter } from "./routes/challenge.js";
import { cronRouter } from "./routes/cron.js";
import { leaderboardRouter } from "./routes/leaderboard.js";
import { userRouter } from "./routes/user.js";
import type { Env } from "./routes/types.js";

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
// Vercel Handler
// ----------------------------------------------------------------------------#
export default handle(app);
