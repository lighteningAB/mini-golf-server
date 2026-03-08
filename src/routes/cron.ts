import { Hono } from "hono";

import { challenges } from "../db/schema.js";
import { computePar, generateCourse } from "../lib/course-generator.js";
import type { Env } from "./types.js";

// ----------------------------------------------------------------------------#
// Router
// ----------------------------------------------------------------------------#
export const cronRouter = new Hono<Env>();

// ----------------------------------------------------------------------------#
// Routes
// ----------------------------------------------------------------------------#
cronRouter.get("/generate-course", async (c) => {
  const authHeader = c.req.header("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const db = c.get("db");
  const today = new Date().toISOString().slice(0, 10);
  const course = generateCourse(today);
  const par = computePar(course);

  await db
    .insert(challenges)
    .values({ id: today, par, course })
    .onConflictDoNothing();

  return c.json({ generated: today, par });
});
