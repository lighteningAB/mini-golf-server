import type { Course } from "../db/schema.js";

// ----------------------------------------------------------------------------#
// Types
// ----------------------------------------------------------------------------#
interface StrokeEntry {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

// ----------------------------------------------------------------------------#
// Stroke Validation
// ----------------------------------------------------------------------------#
const EPSILON = 2.0;
const MAX_STROKES = 50;

export function validateStrokeHistory(
  course: Course,
  strokes: number,
  completed: boolean,
  strokeHistory: StrokeEntry[],
): { valid: boolean; reason?: string } {
  if (!Array.isArray(strokeHistory) || strokeHistory.length === 0) {
    return { valid: false, reason: "stroke_history is empty or missing" };
  }

  if (strokes !== strokeHistory.length) {
    return { valid: false, reason: "stroke count does not match history length" };
  }

  if (strokes < 1 || strokes > MAX_STROKES) {
    return { valid: false, reason: `stroke count must be 1-${MAX_STROKES}` };
  }

  const first = strokeHistory[0];
  const distFromStart = Math.hypot(
    first.from.x - course.start.x,
    first.from.y - course.start.y,
  );
  if (distFromStart > EPSILON) {
    return { valid: false, reason: "first stroke does not start near course start" };
  }

  for (let i = 1; i < strokeHistory.length; i++) {
    const prev = strokeHistory[i - 1];
    const curr = strokeHistory[i];
    const gap = Math.hypot(curr.from.x - prev.to.x, curr.from.y - prev.to.y);
    if (gap > EPSILON) {
      return { valid: false, reason: `discontinuity between strokes ${i - 1} and ${i}` };
    }
  }

  if (completed) {
    const last = strokeHistory[strokeHistory.length - 1];
    const distToHole = Math.hypot(
      last.to.x - course.hole.x,
      last.to.y - course.hole.y,
    );
    if (distToHole > course.hole.radius + EPSILON) {
      return { valid: false, reason: "last stroke does not end near hole" };
    }
  }

  for (const entry of strokeHistory) {
    for (const pt of [entry.from, entry.to]) {
      if (pt.x < -EPSILON || pt.x > 100 + EPSILON || pt.y < -EPSILON || pt.y > 100 + EPSILON) {
        return { valid: false, reason: "position out of bounds" };
      }
    }
  }

  return { valid: true };
}
