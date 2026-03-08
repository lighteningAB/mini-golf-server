import seedrandom from "seedrandom";

import type { Course, CourseObstacle } from "../db/schema.js";

// ----------------------------------------------------------------------------#
// Constants
// ----------------------------------------------------------------------------#
const GRID = 100;
const WALL_THICKNESS = 2;
const BALL_RADIUS = 2;
const CLEARANCE = BALL_RADIUS + 5;
const MIN_OBSTACLES = 2;
const MAX_OBSTACLES = 5;

// ----------------------------------------------------------------------------#
// Boundary Walls
// ----------------------------------------------------------------------------#
const BOUNDARY_WALLS: CourseObstacle[] = [
  { type: "rect", x: 0, y: 0, w: GRID, h: WALL_THICKNESS },
  { type: "rect", x: 0, y: GRID - WALL_THICKNESS, w: GRID, h: WALL_THICKNESS },
  { type: "rect", x: 0, y: 0, w: WALL_THICKNESS, h: GRID },
  { type: "rect", x: GRID - WALL_THICKNESS, y: 0, w: WALL_THICKNESS, h: GRID },
];

// ----------------------------------------------------------------------------#
// Helpers
// ----------------------------------------------------------------------------#
function randRange(rng: seedrandom.PRNG, min: number, max: number): number {
  return min + rng() * (max - min);
}

function overlaps(
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  px: number,
  py: number,
  clearance: number,
): boolean {
  const cx = ox + ow / 2;
  const cy = oy + oh / 2;
  return Math.abs(cx - px) < ow / 2 + clearance && Math.abs(cy - py) < oh / 2 + clearance;
}

function circleOverlapsPoint(
  cx: number,
  cy: number,
  r: number,
  px: number,
  py: number,
  clearance: number,
): boolean {
  return Math.hypot(cx - px, cy - py) < r + clearance;
}

/**
 * Simple grid-based BFS to verify the ball can navigate from start to hole.
 * Checks a 1-unit resolution grid for blocked cells.
 */
function isSolvable(
  start: { x: number; y: number },
  hole: { x: number; y: number },
  obstacles: CourseObstacle[],
): boolean {
  const res = 2;
  const cols = Math.ceil(GRID / res);
  const rows = Math.ceil(GRID / res);
  const blocked = new Uint8Array(cols * rows);

  for (const obs of obstacles) {
    if (obs.type === "rect") {
      const x0 = Math.floor((obs.x ?? 0) / res);
      const y0 = Math.floor((obs.y ?? 0) / res);
      const x1 = Math.ceil(((obs.x ?? 0) + (obs.w ?? 0)) / res);
      const y1 = Math.ceil(((obs.y ?? 0) + (obs.h ?? 0)) / res);
      for (let gy = Math.max(0, y0); gy < Math.min(rows, y1); gy++) {
        for (let gx = Math.max(0, x0); gx < Math.min(cols, x1); gx++) {
          blocked[gy * cols + gx] = 1;
        }
      }
    } else if (obs.type === "circle") {
      const cr = obs.radius ?? 0;
      const cx = obs.x ?? 0;
      const cy = obs.y ?? 0;
      const x0 = Math.floor((cx - cr) / res);
      const y0 = Math.floor((cy - cr) / res);
      const x1 = Math.ceil((cx + cr) / res);
      const y1 = Math.ceil((cy + cr) / res);
      for (let gy = Math.max(0, y0); gy < Math.min(rows, y1); gy++) {
        for (let gx = Math.max(0, x0); gx < Math.min(cols, x1); gx++) {
          const px = gx * res + res / 2;
          const py = gy * res + res / 2;
          if (Math.hypot(px - cx, py - cy) <= cr + BALL_RADIUS) {
            blocked[gy * cols + gx] = 1;
          }
        }
      }
    }
  }

  const sx = Math.floor(start.x / res);
  const sy = Math.floor(start.y / res);
  const hx = Math.floor(hole.x / res);
  const hy = Math.floor(hole.y / res);

  if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) return false;
  if (hx < 0 || hx >= cols || hy < 0 || hy >= rows) return false;

  const visited = new Uint8Array(cols * rows);
  const queue: number[] = [sy * cols + sx];
  visited[sy * cols + sx] = 1;

  const target = hy * cols + hx;
  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  while (queue.length > 0) {
    const idx = queue.shift()!;
    if (idx === target) return true;

    const cx = idx % cols;
    const cy = Math.floor(idx / cols);

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (visited[ni] || blocked[ni]) continue;
      visited[ni] = 1;
      queue.push(ni);
    }
  }

  return false;
}

// ----------------------------------------------------------------------------#
// Course Generator
// ----------------------------------------------------------------------------#
export function generateCourse(dateStr: string): Course {
  const rng = seedrandom(dateStr);

  const start = {
    x: Math.round(randRange(rng, 10, 40)),
    y: Math.round(randRange(rng, 70, 90)),
  };

  const hole = {
    x: Math.round(randRange(rng, 60, 90)),
    y: Math.round(randRange(rng, 8, 30)),
    radius: 3,
  };

  const allObstacles = [...BOUNDARY_WALLS];
  const courseObstacles: CourseObstacle[] = [];
  const count = Math.round(randRange(rng, MIN_OBSTACLES, MAX_OBSTACLES));

  for (let i = 0; i < count; i++) {
    const useCircle = rng() > 0.6;
    let obs: CourseObstacle;

    if (useCircle) {
      const r = Math.round(randRange(rng, 3, 6));
      const cx = Math.round(randRange(rng, 15, 85));
      const cy = Math.round(randRange(rng, 15, 85));

      if (
        circleOverlapsPoint(cx, cy, r, start.x, start.y, CLEARANCE) ||
        circleOverlapsPoint(cx, cy, r, hole.x, hole.y, CLEARANCE)
      ) {
        continue;
      }

      obs = { type: "circle", x: cx, y: cy, radius: r };
    } else {
      const w = Math.round(randRange(rng, 10, 25));
      const h = Math.round(randRange(rng, 2, 4));
      const ox = Math.round(randRange(rng, 10, GRID - 10 - w));
      const oy = Math.round(randRange(rng, 10, GRID - 10 - h));

      if (
        overlaps(ox, oy, w, h, start.x, start.y, CLEARANCE) ||
        overlaps(ox, oy, w, h, hole.x, hole.y, CLEARANCE)
      ) {
        continue;
      }

      obs = { type: "rect", x: ox, y: oy, w, h };
    }

    const testObstacles = [...allObstacles, ...courseObstacles, obs];
    if (isSolvable(start, hole, testObstacles)) {
      courseObstacles.push(obs);
    }
  }

  return {
    start,
    hole,
    walls: BOUNDARY_WALLS,
    obstacles: courseObstacles,
  };
}

// ----------------------------------------------------------------------------#
// Par Computation
// ----------------------------------------------------------------------------#
export function computePar(course: Course): number {
  const dx = course.hole.x - course.start.x;
  const dy = course.hole.y - course.start.y;
  const dist = Math.hypot(dx, dy);
  const avgShotLength = 20;
  return Math.max(2, Math.round(dist / avgShotLength) + 1 + course.obstacles.length);
}
