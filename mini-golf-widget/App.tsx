import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Defs, Line, Pattern, Polygon, Rect } from 'react-native-svg';
import { tokens } from './src/styles/tokens';

// ----------------------------------------------------------------------------#
// Constants
// ----------------------------------------------------------------------------#
const API_BASE = 'https://mini-golf-server.vercel.app/api';
const API_KEY = 'gk_replace_me';
const HMAC_SECRET = '310ff372388952444c41410e88993f55aebd6dd0392c75e28501343bd68fca98';
const HEADERS: Record<string, string> = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

const STORAGE_KEYS = {
  userId: '@mg_user_id',
  displayName: '@mg_display_name',
  challenge: '@mg_current_challenge',
  gameState: '@mg_game_state',
  pending: '@mg_pending_submission',
  stats: '@mg_personal_stats',
} as const;

const GRID = 100;
const BALL_RADIUS = 2.5;
const FRICTION = 0.98;
const MAX_SPEED = 3.5;
const STOP_THRESHOLD = 0.15;
const SINK_THRESHOLD = 0.6;
const BOUNCE_DAMPING = 0.7;
const DAY_CHECK_MS = 60_000;

const WIDGET_SIZE = 166;
const VIEW_SIZE = 55;
const COURSE_BG = '#262626';
const GRID_DOT_COLOR = '#3A3A3E';

// ----------------------------------------------------------------------------#
// Types
// ----------------------------------------------------------------------------#
interface Obstacle {
  type: 'rect' | 'circle';
  x: number;
  y: number;
  w?: number;
  h?: number;
  radius?: number;
}

interface Course {
  start: { x: number; y: number };
  hole: { x: number; y: number; radius: number };
  walls: Obstacle[];
  obstacles: Obstacle[];
}

interface ChallengeData {
  challenge_id: string;
  par: number;
  course: Course;
  expires_at: string;
}

interface StrokeEntry {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface GameProgress {
  challenge_id: string;
  strokes: number;
  ball: { x: number; y: number };
  completed: boolean;
  stroke_history: StrokeEntry[];
}

interface SubmitResult {
  accepted: boolean;
  strokes: number;
  par: number;
  rank: number;
  total_players: number;
  display_name_censored: string | null;
}

interface LeaderboardEntry {
  rank: number;
  display_name: string;
  strokes: number;
}

interface UserStats {
  display_name: string;
  games_played: number;
  average_strokes: number;
  best_round: number | null;
  current_streak: number;
  best_streak: number;
}

type Screen = 'onboarding' | 'loading' | 'playing' | 'submitting' | 'results' | 'error';

interface State {
  screen: Screen;
  userId: string | null;
  displayName: string;
  challenge: ChallengeData | null;
  ball: { x: number; y: number; vx: number; vy: number };
  strokes: number;
  strokeHistory: StrokeEntry[];
  isMoving: boolean;
  completed: boolean;
  sinking: boolean;
  sinkScale: number;
  submitResult: SubmitResult | null;
  leaderboard: LeaderboardEntry[];
  stats: UserStats | null;
  error: string | null;
}

type Action =
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_USER'; userId: string; displayName: string }
  | { type: 'SET_CHALLENGE'; challenge: ChallengeData }
  | { type: 'SET_BALL'; x: number; y: number; vx: number; vy: number }
  | { type: 'SET_MOVING'; isMoving: boolean }
  | { type: 'STROKE_START' }
  | { type: 'STROKE_END'; to: { x: number; y: number } }
  | { type: 'BALL_SUNK' }
  | { type: 'SINK_ANIMATE'; scale: number }
  | { type: 'SET_RESULT'; result: SubmitResult; leaderboard: LeaderboardEntry[]; stats: UserStats | null }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET_FOR_NEW_DAY' }
  | { type: 'REPLAY' };

// ----------------------------------------------------------------------------#
// Reducer
// ----------------------------------------------------------------------------#
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_SCREEN':
      return { ...state, screen: action.screen };
    case 'SET_USER':
      return { ...state, userId: action.userId, displayName: action.displayName };
    case 'SET_CHALLENGE': {
      const c = action.challenge;
      return {
        ...state,
        challenge: c,
        ball: { x: c.course.start.x, y: c.course.start.y, vx: 0, vy: 0 },
        strokes: 0,
        strokeHistory: [],
        completed: false,
        sinking: false,
        sinkScale: 1,
        screen: 'playing',
      };
    }
    case 'SET_BALL':
      return { ...state, ball: { x: action.x, y: action.y, vx: action.vx, vy: action.vy } };
    case 'SET_MOVING':
      return { ...state, isMoving: action.isMoving };
    case 'STROKE_START':
      return { ...state, strokes: state.strokes + 1 };
    case 'STROKE_END':
      return {
        ...state,
        strokeHistory: [
          ...state.strokeHistory,
          {
            from: state.strokeHistory.length === 0
              ? { x: state.challenge!.course.start.x, y: state.challenge!.course.start.y }
              : state.strokeHistory[state.strokeHistory.length - 1].to,
            to: action.to,
          },
        ],
      };
    case 'BALL_SUNK':
      return { ...state, completed: true, sinking: true, sinkScale: 1 };
    case 'SINK_ANIMATE':
      return { ...state, sinkScale: action.scale };
    case 'SET_RESULT':
      return {
        ...state,
        submitResult: action.result,
        leaderboard: action.leaderboard,
        stats: action.stats,
        screen: 'results',
      };
    case 'SET_ERROR':
      return { ...state, error: action.error, screen: 'error' };
    case 'RESET_FOR_NEW_DAY':
      return {
        ...state,
        challenge: null,
        ball: { x: 0, y: 0, vx: 0, vy: 0 },
        strokes: 0,
        strokeHistory: [],
        completed: false,
        sinking: false,
        sinkScale: 1,
        submitResult: null,
        leaderboard: [],
        screen: 'loading',
      };
    case 'REPLAY': {
      if (!state.challenge) return state;
      const start = state.challenge.course.start;
      return {
        ...state,
        ball: { x: start.x, y: start.y, vx: 0, vy: 0 },
        strokes: 0,
        strokeHistory: [],
        completed: false,
        sinking: false,
        sinkScale: 1,
        isMoving: false,
        screen: 'playing',
      };
    }
    default:
      return state;
  }
}

const initialState: State = {
  screen: 'onboarding',
  userId: null,
  displayName: '',
  challenge: null,
  ball: { x: 0, y: 0, vx: 0, vy: 0 },
  strokes: 0,
  strokeHistory: [],
  isMoving: false,
  completed: false,
  sinking: false,
  sinkScale: 1,
  submitResult: null,
  leaderboard: [],
  stats: null,
  error: null,
};

// ----------------------------------------------------------------------------#
// Helpers
// ----------------------------------------------------------------------------#
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ----------------------------------------------------------------------------#
// Network
// ----------------------------------------------------------------------------#
async function fetchChallenge(): Promise<ChallengeData> {
  const res = await fetch(`${API_BASE}/challenge/today`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSign(body: string): Promise<{ signature: string; timestamp: string }> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signingString = `${timestamp}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signingString));
  return { signature: bytesToHex(new Uint8Array(mac)), timestamp };
}

async function submitScore(challengeId: string, body: object): Promise<SubmitResult> {
  const jsonBody = JSON.stringify(body);
  const { signature, timestamp } = await hmacSign(jsonBody);
  const res = await fetch(`${API_BASE}/challenge/${challengeId}/submit`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'x-hmac-signature': signature,
      'x-hmac-timestamp': timestamp,
    },
    body: jsonBody,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Submit error ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchLeaderboard(challengeId: string, userId?: string): Promise<{ entries: LeaderboardEntry[]; yourRank: number | null }> {
  const params = new URLSearchParams({ limit: '50' });
  if (userId) params.set('user_id', userId);
  const res = await fetch(`${API_BASE}/leaderboard/challenge/${challengeId}?${params}`, {
    headers: HEADERS,
  });
  if (!res.ok) return { entries: [], yourRank: null };
  const data = await res.json();
  return { entries: data.entries ?? [], yourRank: data.your_rank ?? null };
}

async function fetchStats(userId: string): Promise<UserStats | null> {
  const res = await fetch(`${API_BASE}/user/${userId}/stats`, { headers: HEADERS });
  if (!res.ok) return null;
  return res.json();
}

// ----------------------------------------------------------------------------#
// Physics
// ----------------------------------------------------------------------------#
function collideWalls(
  x: number,
  y: number,
  vx: number,
  vy: number,
  walls: Obstacle[],
): { x: number; y: number; vx: number; vy: number } {
  for (const w of walls) {
    if (w.type !== 'rect' || w.w == null || w.h == null) continue;
    const left = w.x;
    const right = w.x + w.w;
    const top = w.y;
    const bottom = w.y + w.h;

    const nearestX = clamp(x, left, right);
    const nearestY = clamp(y, top, bottom);
    const dx = x - nearestX;
    const dy = y - nearestY;
    const dist = Math.hypot(dx, dy);

    if (dist < BALL_RADIUS && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      const dot = vx * nx + vy * ny;
      if (dot < 0) {
        vx -= 2 * dot * nx * BOUNCE_DAMPING;
        vy -= 2 * dot * ny * BOUNCE_DAMPING;
      }
      x = nearestX + nx * BALL_RADIUS;
      y = nearestY + ny * BALL_RADIUS;
    }
  }
  return { x, y, vx, vy };
}

function collideCircles(
  x: number,
  y: number,
  vx: number,
  vy: number,
  obstacles: Obstacle[],
): { x: number; y: number; vx: number; vy: number } {
  for (const obs of obstacles) {
    if (obs.type !== 'circle' || obs.radius == null) continue;
    const dx = x - obs.x;
    const dy = y - obs.y;
    const dist = Math.hypot(dx, dy);
    const minDist = BALL_RADIUS + obs.radius;

    if (dist < minDist && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      const dot = vx * nx + vy * ny;
      if (dot < 0) {
        vx -= 2 * dot * nx * BOUNCE_DAMPING;
        vy -= 2 * dot * ny * BOUNCE_DAMPING;
      }
      x = obs.x + nx * minDist;
      y = obs.y + ny * minDist;
    }
  }
  return { x, y, vx, vy };
}

function collideRectObstacles(
  x: number,
  y: number,
  vx: number,
  vy: number,
  obstacles: Obstacle[],
): { x: number; y: number; vx: number; vy: number } {
  for (const obs of obstacles) {
    if (obs.type !== 'rect' || obs.w == null || obs.h == null) continue;
    const left = obs.x;
    const right = obs.x + obs.w;
    const top = obs.y;
    const bottom = obs.y + obs.h;

    const nearestX = clamp(x, left, right);
    const nearestY = clamp(y, top, bottom);
    const dx = x - nearestX;
    const dy = y - nearestY;
    const dist = Math.hypot(dx, dy);

    if (dist < BALL_RADIUS && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      const dot = vx * nx + vy * ny;
      if (dot < 0) {
        vx -= 2 * dot * nx * BOUNCE_DAMPING;
        vy -= 2 * dot * ny * BOUNCE_DAMPING;
      }
      x = nearestX + nx * BALL_RADIUS;
      y = nearestY + ny * BALL_RADIUS;
    }
  }
  return { x, y, vx, vy };
}

// ----------------------------------------------------------------------------#
// App Component
// ----------------------------------------------------------------------------#
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const animRef = useRef<number | null>(null);
  const aimRef = useRef<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const [, forceRender] = useReducer((c: number) => c + 1, 0);

  // Hole pulse animation
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (state.screen !== 'playing') return;
    let frame: number;
    let t = 0;
    const tick = () => {
      t += 0.04;
      setPulse((Math.sin(t) + 1) / 2); // 0..1
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.screen]);

  // Camera viewBox centered on ball
  const halfView = VIEW_SIZE / 2;
  const vbX = clamp(state.ball.x - halfView, 0, GRID - VIEW_SIZE);
  const vbY = clamp(state.ball.y - halfView, 0, GRID - VIEW_SIZE);
  const dynamicViewBox = `${vbX} ${vbY} ${VIEW_SIZE} ${VIEW_SIZE}`;

  // ---- Init ----------------------------------------------------------------
  useEffect(() => {
    (async () => {
      let userId: string | null = null;
      let displayName = '';
      try {
        userId = await AsyncStorage.getItem(STORAGE_KEYS.userId);
        displayName = (await AsyncStorage.getItem(STORAGE_KEYS.displayName)) ?? '';
      } catch {
        // AsyncStorage unavailable — fall through to onboarding
      }

      if (!userId) {
        // Already on onboarding (initial state) — nothing to do
        return;
      }

      dispatch({ type: 'SET_USER', userId, displayName });
      dispatch({ type: 'SET_SCREEN', screen: 'loading' });

      try {
        const pending = await AsyncStorage.getItem(STORAGE_KEYS.pending);
        if (pending) {
          try {
            const parsed = JSON.parse(pending);
            const { challenge_id: pendingChallengeId, ...pendingBody } = parsed;
            await submitScore(pendingChallengeId ?? todayUTC(), pendingBody);
            await AsyncStorage.removeItem(STORAGE_KEYS.pending);
          } catch {}
        }

        const savedGame = await AsyncStorage.getItem(STORAGE_KEYS.gameState);
        if (savedGame) {
          const gp: GameProgress = JSON.parse(savedGame);
          if (gp.challenge_id === todayUTC() && gp.completed) {
            const { entries: lb, yourRank } = await fetchLeaderboard(gp.challenge_id, userId ?? undefined).catch(() => ({ entries: [] as LeaderboardEntry[], yourRank: null }));
            const stats = userId ? await fetchStats(userId).catch(() => null) : null;
            dispatch({
              type: 'SET_RESULT',
              result: { accepted: true, strokes: gp.strokes, par: 0, rank: yourRank ?? 0, total_players: lb.length, display_name_censored: null },
              leaderboard: lb,
              stats,
            });
            return;
          }
        }
      } catch {}

      try {
        const challenge = await fetchChallenge();
        dispatch({ type: 'SET_CHALLENGE', challenge });
      } catch {
        try {
          const cached = await AsyncStorage.getItem(STORAGE_KEYS.challenge);
          if (cached) {
            dispatch({ type: 'SET_CHALLENGE', challenge: JSON.parse(cached) });
            return;
          }
        } catch {}
        dispatch({ type: 'SET_ERROR', error: 'Connect to play today\'s course' });
      }
    })();
  }, []);

  // ---- Day rollover check ---------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      const s = stateRef.current;
      if (!s.challenge) return;
      if (s.challenge.challenge_id !== todayUTC() && !s.isMoving) {
        dispatch({ type: 'RESET_FOR_NEW_DAY' });
        AsyncStorage.multiRemove([STORAGE_KEYS.gameState, STORAGE_KEYS.challenge]);
        fetchChallenge()
          .then((c) => dispatch({ type: 'SET_CHALLENGE', challenge: c }))
          .catch(() => dispatch({ type: 'SET_ERROR', error: 'Failed to load new course' }));
      }
    }, DAY_CHECK_MS);
    return () => clearInterval(interval);
  }, []);

  // ---- Physics loop ---------------------------------------------------------
  const startPhysics = useCallback((vx: number, vy: number) => {
    const s = stateRef.current;
    if (!s.challenge) return;

    const course = s.challenge.course;
    let bx = s.ball.x;
    let by = s.ball.y;
    let bvx = vx;
    let bvy = vy;

    dispatch({ type: 'SET_MOVING', isMoving: true });
    dispatch({ type: 'STROKE_START' });

    const allWalls = course.walls;
    const rectObs = course.obstacles.filter((o) => o.type === 'rect');
    const circleObs = course.obstacles.filter((o) => o.type === 'circle');

    const step = () => {
      bx += bvx;
      by += bvy;
      bvx *= FRICTION;
      bvy *= FRICTION;

      let result = collideWalls(bx, by, bvx, bvy, allWalls);
      bx = result.x; by = result.y; bvx = result.vx; bvy = result.vy;

      result = collideRectObstacles(bx, by, bvx, bvy, rectObs);
      bx = result.x; by = result.y; bvx = result.vx; bvy = result.vy;

      result = collideCircles(bx, by, bvx, bvy, circleObs);
      bx = result.x; by = result.y; bvx = result.vx; bvy = result.vy;

      bx = clamp(bx, BALL_RADIUS, GRID - BALL_RADIUS);
      by = clamp(by, BALL_RADIUS, GRID - BALL_RADIUS);

      dispatch({ type: 'SET_BALL', x: bx, y: by, vx: bvx, vy: bvy });

      const speed = Math.hypot(bvx, bvy);
      const distToHole = Math.hypot(bx - course.hole.x, by - course.hole.y);

      if (distToHole < course.hole.radius && speed < SINK_THRESHOLD) {
        dispatch({ type: 'STROKE_END', to: { x: course.hole.x, y: course.hole.y } });
        dispatch({ type: 'BALL_SUNK' });
        dispatch({ type: 'SET_MOVING', isMoving: false });
        animRef.current = null;
        return;
      }

      if (speed < STOP_THRESHOLD) {
        dispatch({ type: 'SET_BALL', x: bx, y: by, vx: 0, vy: 0 });
        dispatch({ type: 'SET_MOVING', isMoving: false });
        dispatch({ type: 'STROKE_END', to: { x: bx, y: by } });
        persistGameState(bx, by);
        animRef.current = null;
        return;
      }

      animRef.current = requestAnimationFrame(step);
    };

    animRef.current = requestAnimationFrame(step);
  }, []);

  const persistGameState = async (bx: number, by: number) => {
    const s = stateRef.current;
    if (!s.challenge) return;
    const gp: GameProgress = {
      challenge_id: s.challenge.challenge_id,
      strokes: s.strokes,
      ball: { x: bx, y: by },
      completed: false,
      stroke_history: s.strokeHistory,
    };
    await AsyncStorage.setItem(STORAGE_KEYS.gameState, JSON.stringify(gp));
  };

  // ---- Handle sink animation then submit ------------------------------------
  useEffect(() => {
    if (!state.sinking) return;

    let scale = 1;
    const shrink = () => {
      scale -= 0.05;
      if (scale <= 0) {
        dispatch({ type: 'SINK_ANIMATE', scale: 0 });
        handleSubmit();
        return;
      }
      dispatch({ type: 'SINK_ANIMATE', scale });
      requestAnimationFrame(shrink);
    };
    requestAnimationFrame(shrink);
  }, [state.sinking]);

  const handleSubmit = async () => {
    const s = stateRef.current;
    if (!s.challenge || !s.userId) return;

    dispatch({ type: 'SET_SCREEN', screen: 'submitting' });

    const challengeId = s.challenge.challenge_id;
    const body = {
      user_id: s.userId,
      display_name: s.displayName || null,
      strokes: s.strokes,
      completed: true,
      stroke_history: s.strokeHistory,
    };

    try {
      const result = await submitScore(challengeId, body);
      AsyncStorage.removeItem(STORAGE_KEYS.pending).catch(() => {});
      // Update local display name to match censored server version
      if (result.display_name_censored) {
        dispatch({ type: 'SET_USER', userId: s.userId, displayName: result.display_name_censored });
        AsyncStorage.setItem(STORAGE_KEYS.displayName, result.display_name_censored).catch(() => {});
      }
      const { entries: lb } = await fetchLeaderboard(s.challenge.challenge_id, s.userId);
      const stats = await fetchStats(s.userId);
      dispatch({ type: 'SET_RESULT', result, leaderboard: lb, stats });

      const gp: GameProgress = {
        challenge_id: s.challenge.challenge_id,
        strokes: s.strokes,
        ball: { x: s.challenge.course.hole.x, y: s.challenge.course.hole.y },
        completed: true,
        stroke_history: s.strokeHistory,
      };
      AsyncStorage.setItem(STORAGE_KEYS.gameState, JSON.stringify(gp)).catch(() => {});
    } catch (err) {
      console.error('Submit failed:', err);
      await AsyncStorage.setItem(STORAGE_KEYS.pending, JSON.stringify({ challenge_id: challengeId, ...body })).catch(() => {});
      // Still try to fetch leaderboard even if submit failed
      const { entries: lb } = await fetchLeaderboard(s.challenge.challenge_id, s.userId).catch(() => ({ entries: [] as LeaderboardEntry[], yourRank: null }));
      dispatch({
        type: 'SET_RESULT',
        result: { accepted: false, strokes: s.strokes, par: s.challenge.par, rank: 0, total_players: 0, display_name_censored: null },
        leaderboard: lb,
        stats: null,
      });
    }
  };

  // ---- Aim PanResponder -----------------------------------------------------
  const panResponder = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => !stateRef.current.isMoving && !stateRef.current.completed && stateRef.current.screen === 'playing',
      onMoveShouldSetPanResponder: () => !stateRef.current.isMoving && !stateRef.current.completed && stateRef.current.screen === 'playing',
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        aimRef.current = { startX: locationX, startY: locationY, curX: locationX, curY: locationY };
        forceRender();
      },
      onPanResponderMove: (evt) => {
        if (!aimRef.current) return;
        aimRef.current.curX = evt.nativeEvent.locationX;
        aimRef.current.curY = evt.nativeEvent.locationY;
        forceRender();
      },
      onPanResponderRelease: () => {
        if (!aimRef.current) return;
        const aim = aimRef.current;
        aimRef.current = null;
        forceRender();

        const dx = aim.startX - aim.curX;
        const dy = aim.startY - aim.curY;
        const power = Math.min(Math.hypot(dx, dy) / (WIDGET_SIZE * 0.3), 1);

        if (power < 0.02) return;

        const angle = Math.atan2(dy, dx);
        const vx = Math.cos(angle) * power * MAX_SPEED;
        const vy = Math.sin(angle) * power * MAX_SPEED;
        startPhysics(vx, vy);
      },
    }),
  [startPhysics]);

  // ---- Onboarding submit ----------------------------------------------------
  const handleOnboarding = async () => {
    const userId = uuid();
    const name = state.displayName.trim() || `anon_${userId.slice(0, 4)}`;
    dispatch({ type: 'SET_USER', userId, displayName: name });
    dispatch({ type: 'SET_SCREEN', screen: 'loading' });

    // Persist — but don't block on failure
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.userId, userId);
      await AsyncStorage.setItem(STORAGE_KEYS.displayName, name);
    } catch {
      console.warn('Could not persist user to AsyncStorage');
    }

    try {
      const challenge = await fetchChallenge();
      AsyncStorage.setItem(STORAGE_KEYS.challenge, JSON.stringify(challenge)).catch(() => {});
      dispatch({ type: 'SET_CHALLENGE', challenge });
    } catch {
      dispatch({ type: 'SET_ERROR', error: 'Connect to play today\'s course' });
    }
  };

  // ---- Render ---------------------------------------------------------------
  return (
    <View style={[styles.root, state.screen === 'playing' && { backgroundColor: COURSE_BG, borderRadius: 32 }]}>
      {state.screen === 'onboarding' && (
        <View style={styles.centeredContainer}>
          <Text style={styles.onboardingTitle}>MINI GOLF</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 8 }).map((_, i) => (
              <View key={i} style={styles.decorDotGray} />
            ))}
          </View>
          <Text style={styles.onboardingSubtitle}>DAILY CHALLENGE</Text>
          <TextInput
            style={styles.nameInput}
            placeholder="ENTER NAME"
            placeholderTextColor={tokens.colors['secondary-dark']}
            value={state.displayName}
            onChangeText={(t) => dispatch({ type: 'SET_USER', userId: state.userId ?? '', displayName: t })}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleOnboarding}>
            <Text style={styles.primaryBtnText}>START</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.screen === 'loading' && (
        <View style={styles.centeredContainer}>
          <Text style={styles.loadingTitle}>LOADING</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <View key={i} style={[styles.decorDotRed, { opacity: 0.3 + i * 0.15 }]} />
            ))}
          </View>
          <Text style={styles.loadingFooter}>MINI GOLF WIDGET</Text>
        </View>
      )}

      {state.screen === 'playing' && state.challenge && (() => {
        const hole = state.challenge.course.hole;
        // Arrow at bottom-center of visible viewport, pointing toward hole
        const arrowDx = hole.x - state.ball.x;
        const arrowDy = hole.y - state.ball.y;
        const arrowDist = Math.hypot(arrowDx, arrowDy);
        const arrowAngle = Math.atan2(arrowDy, arrowDx);
        // Bottom-center of current viewBox
        const arrowCx = vbX + VIEW_SIZE / 2;
        const arrowCy = vbY + VIEW_SIZE - 5;
        const arrowSize = 2.5;

        const ballR = BALL_RADIUS * (state.sinking ? state.sinkScale : 1);

        return (
          <View style={{ flex: 1, borderRadius: 32, overflow: 'hidden', backgroundColor: COURSE_BG }}>
            <View style={{ width: WIDGET_SIZE, height: WIDGET_SIZE }} {...panResponder.panHandlers}>
              <Svg width={WIDGET_SIZE} height={WIDGET_SIZE} viewBox={dynamicViewBox}>
                <Defs>
                  <Pattern id="dotGrid" width="5" height="5" patternUnits="userSpaceOnUse">
                    <Circle cx="2.5" cy="2.5" r="0.3" fill={GRID_DOT_COLOR} />
                  </Pattern>
                </Defs>

                {/* Extended background to fill behind rounded corners */}
                <Rect x="-20" y="-20" width={GRID + 40} height={GRID + 40} fill={COURSE_BG} />
                <Rect x="0" y="0" width={GRID} height={GRID} fill="url(#dotGrid)" />

                {state.challenge.course.walls.map((w, i) =>
                  w.type === 'rect' ? (
                    <Rect key={`w${i}`} x={w.x} y={w.y} width={w.w} height={w.h} fill={tokens.colors.light} opacity={0.9} />
                  ) : null,
                )}

                {state.challenge.course.obstacles.map((o, i) =>
                  o.type === 'rect' ? (
                    <Rect key={`o${i}`} x={o.x} y={o.y} width={o.w} height={o.h} fill="#E5E7EB" opacity={0.9} rx="0.5" />
                  ) : o.type === 'circle' ? (
                    <Circle key={`o${i}`} cx={o.x} cy={o.y} r={o.radius} fill="#E5E7EB" opacity={0.9} />
                  ) : null,
                )}

                {/* Hole - pulsing yellow glow */}
                <Circle cx={hole.x} cy={hole.y} r={hole.radius + 2.5 + pulse * 1.5} fill="#FDE047" opacity={0.06 + pulse * 0.06} />
                <Circle cx={hole.x} cy={hole.y} r={hole.radius + 1.2 + pulse * 0.8} fill="#FDE047" opacity={0.1 + pulse * 0.08} />
                <Circle cx={hole.x} cy={hole.y} r={hole.radius} fill="#1a1a1a" stroke="#FDE047" strokeWidth={0.4 + pulse * 0.3} opacity={0.7 + pulse * 0.3} />
                <Circle cx={hole.x} cy={hole.y} r={hole.radius * 0.4} fill="#292524" />

                {/* Aim line */}
                {aimRef.current && !state.isMoving && (() => {
                  const aim = aimRef.current!;
                  const dx = aim.startX - aim.curX;
                  const dy = aim.startY - aim.curY;
                  const len = Math.hypot(dx, dy);
                  if (len < 3) return null;
                  const nx = dx / len;
                  const ny = dy / len;
                  const power = Math.min(len / (WIDGET_SIZE * 0.3), 1);
                  const lineLen = power * 25;
                  return (
                    <Line x1={state.ball.x} y1={state.ball.y} x2={state.ball.x + nx * lineLen} y2={state.ball.y + ny * lineLen} stroke={tokens.colors.red} strokeWidth="0.8" strokeDasharray="1.5,1" opacity={0.8} />
                  );
                })()}

                {/* Ball glow + ball */}
                {!state.completed && (
                  <>
                    <Circle cx={state.ball.x} cy={state.ball.y} r={ballR * 3.5} fill="#EF4444" opacity={0.08} />
                    <Circle cx={state.ball.x} cy={state.ball.y} r={ballR * 2.2} fill="#EF4444" opacity={0.15} />
                    <Circle cx={state.ball.x} cy={state.ball.y} r={ballR * 1.4} fill="#EF4444" opacity={0.3} />
                    <Circle cx={state.ball.x} cy={state.ball.y} r={ballR} fill="#EF4444" />
                    <Circle cx={state.ball.x - ballR * 0.3} cy={state.ball.y - ballR * 0.3} r={ballR * 0.35} fill="#FCA5A5" opacity={0.6} />
                  </>
                )}
                {state.sinking && state.sinkScale > 0 && (
                  <>
                    <Circle cx={hole.x} cy={hole.y} r={BALL_RADIUS * state.sinkScale * 2.2} fill="#EF4444" opacity={0.15} />
                    <Circle cx={hole.x} cy={hole.y} r={BALL_RADIUS * state.sinkScale} fill="#EF4444" />
                  </>
                )}

                {/* Direction arrow toward hole - bottom center of screen */}
                {arrowDist > hole.radius + 2 && !state.completed && (
                  <>
                    <Circle cx={arrowCx} cy={arrowCy} r={arrowSize * 1.8} fill="#FDE047" opacity={0.1} />
                    <Circle cx={arrowCx} cy={arrowCy} r={arrowSize * 1.2} fill="#FDE047" opacity={0.15} />
                    <Polygon
                      points={`${arrowCx + Math.cos(arrowAngle) * arrowSize},${arrowCy + Math.sin(arrowAngle) * arrowSize} ${arrowCx + Math.cos(arrowAngle + 2.4) * arrowSize * 0.7},${arrowCy + Math.sin(arrowAngle + 2.4) * arrowSize * 0.7} ${arrowCx + Math.cos(arrowAngle - 2.4) * arrowSize * 0.7},${arrowCy + Math.sin(arrowAngle - 2.4) * arrowSize * 0.7}`}
                      fill="#FDE047"
                      opacity={0.85}
                    />
                  </>
                )}
              </Svg>
            </View>

            {/* Floating HUD overlay */}
            <View style={styles.hudOverlay}>
              <View style={styles.hud}>
                {state.submitResult && (
                  <>
                    <TouchableOpacity
                      activeOpacity={0.6}
                      onPress={() => dispatch({ type: 'SET_SCREEN', screen: 'results' })}
                      style={styles.hudBackBtn}
                    >
                      <Text style={styles.hudBackBtnText}>{'◀'}</Text>
                    </TouchableOpacity>
                    <View style={styles.hudDivider} />
                  </>
                )}
                <View style={styles.hudItem}>
                  <Text style={styles.hudLabel}>STROKES</Text>
                  <Text style={styles.hudValue}>{state.strokes}</Text>
                </View>
                <View style={styles.hudDivider} />
                <View style={styles.hudItem}>
                  <Text style={styles.hudLabel}>PAR</Text>
                  <Text style={styles.hudValue}>{state.challenge.par}</Text>
                </View>
              </View>
            </View>
          </View>
        );
      })()}

      {state.screen === 'submitting' && (
        <View style={styles.centeredContainer}>
          <Text style={styles.submittingTitle}>SUBMITTING</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 3 }).map((_, i) => (
              <View key={i} style={styles.decorDotRed} />
            ))}
          </View>
          <Text style={styles.submittingStatus}>SYNCING...</Text>
        </View>
      )}

      {state.screen === 'results' && (
        <View style={styles.resultsContainer}>
          {/* Header: your score + stats row */}
          <View style={styles.resultsHeader}>
            <View style={styles.resultsMeta}>
              <View style={styles.resultsStat}>
                <Text style={styles.resultStatValue}>{state.submitResult?.strokes ?? state.strokes}</Text>
                <Text style={styles.resultStatLabel}>STROKES</Text>
              </View>
              <View style={styles.resultsDivider} />
              <View style={styles.resultsStat}>
                <Text style={styles.resultStatValue}>{state.submitResult?.par ?? state.challenge?.par ?? '-'}</Text>
                <Text style={styles.resultStatLabel}>PAR</Text>
              </View>
              {state.submitResult && state.submitResult.rank > 0 && (
                <>
                  <View style={styles.resultsDivider} />
                  <View style={styles.resultsStat}>
                    <Text style={[styles.resultStatValue, state.submitResult.rank <= 3 && { color: tokens.colors.red }]}>
                      #{state.submitResult.rank}
                    </Text>
                    <Text style={styles.resultStatLabel}>RANK</Text>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* Scrollable leaderboard */}
          <View style={styles.lbHeader}>
            <Text style={styles.lbHeaderText}>LEADERBOARD</Text>
          </View>
          <ScrollView style={styles.leaderboard} showsVerticalScrollIndicator={false}>
            {state.leaderboard.length > 0 ? state.leaderboard.map((entry) => {
              const isYou = !!(state.displayName && entry.display_name &&
                entry.display_name.toLowerCase() === state.displayName.toLowerCase());
              return (
                <View key={entry.rank} style={[styles.lbRow, isYou && styles.lbRowYou]}>
                  <Text style={[styles.lbRank, entry.rank <= 3 && { color: tokens.colors.red }]}>
                    {entry.rank}
                  </Text>
                  <Text style={styles.lbName} numberOfLines={1}>
                    {isYou ? 'YOU' : entry.display_name}
                  </Text>
                  <Text style={styles.lbScore}>{entry.strokes}</Text>
                </View>
              );
            }) : (
              <Text style={styles.lbEmpty}>No scores yet</Text>
            )}
          </ScrollView>

          {/* Replay button */}
          <TouchableOpacity
            activeOpacity={0.6}
            style={styles.replayBtn}
            onPress={() => {
              dispatch({ type: 'REPLAY' });
              AsyncStorage.removeItem(STORAGE_KEYS.gameState).catch(() => {});
            }}
          >
            <Text style={styles.replayBtnText}>REPLAY</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.screen === 'error' && (
        <View style={styles.centeredContainer}>
          <Text style={styles.errorTitle}>OFFLINE</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 3 }).map((_, i) => (
              <View key={i} style={styles.decorDotRed} />
            ))}
          </View>
          <Text style={styles.errorSubtitle}>{'CONNECT TO PLAY\nTODAY\'S COURSE'}</Text>
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------#
// Styles
// ----------------------------------------------------------------------------#
const styles = StyleSheet.create({
  root: {
    width: WIDGET_SIZE,
    height: WIDGET_SIZE,
    backgroundColor: tokens.colors.dark,
    overflow: 'hidden',
  },

  // Shared centered layout
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },

  // Dot rows
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginVertical: 4,
  },
  decorDotGray: {
    width: 3,
    height: 3,
    borderRadius: 9999,
    backgroundColor: tokens.colors['secondary-dark'],
  },
  decorDotRed: {
    width: 3,
    height: 3,
    borderRadius: 9999,
    backgroundColor: tokens.colors.red,
  },

  // --- Onboarding ---
  onboardingTitle: {
    fontFamily: 'ndot',
    fontSize: 16,
    lineHeight: 18,
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  onboardingSubtitle: {
    fontFamily: 'Inter',
    fontSize: 8,
    fontWeight: '700',
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    opacity: 0.8,
  },
  nameInput: {
    fontFamily: 'Inter',
    fontSize: 9,
    fontWeight: '500',
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 2,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors['secondary-dark'],
    paddingVertical: 4,
    width: 120,
    textAlign: 'center',
    marginTop: 6,
  },
  primaryBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: tokens.colors.light,
    borderRadius: 6,
    alignSelf: 'stretch',
    marginHorizontal: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: 'Inter',
    fontSize: 9,
    fontWeight: '600',
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  // --- Loading ---
  loadingTitle: {
    fontFamily: 'ndot',
    fontSize: 14,
    lineHeight: 16,
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  loadingFooter: {
    fontFamily: 'ndot',
    fontSize: 8,
    lineHeight: 10,
    color: tokens.colors['secondary-dark'],
    textTransform: 'uppercase',
    marginTop: 8,
  },

  // --- Game / Playing ---
  hudOverlay: {
    position: 'absolute',
    top: 5,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 3,
    gap: 8,
  },
  hudItem: {
    alignItems: 'center',
  },
  hudLabel: {
    fontFamily: 'Inter',
    fontSize: 7,
    fontWeight: '700',
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: -0.3,
    opacity: 0.7,
  },
  hudValue: {
    fontFamily: 'ndot',
    fontSize: 12,
    lineHeight: 14,
    color: tokens.colors.light,
    textTransform: 'uppercase',
  },
  hudBackBtn: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  hudBackBtnText: {
    fontSize: 8,
    color: tokens.colors.light,
    opacity: 0.7,
  },
  hudDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },

  // --- Submitting ---
  submittingTitle: {
    fontFamily: 'ndot',
    fontSize: 10,
    lineHeight: 12,
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  submittingStatus: {
    fontFamily: 'Inter',
    fontSize: 9,
    fontWeight: '400',
    color: tokens.colors['secondary-light'],
    marginTop: 4,
  },

  // --- Results ---
  resultsContainer: {
    flex: 1,
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 4,
  },
  resultsHeader: {
    alignItems: 'center',
    marginBottom: 4,
  },
  resultsMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultsStat: {
    alignItems: 'center',
  },
  resultStatValue: {
    fontFamily: 'ndot',
    fontSize: 12,
    lineHeight: 13,
    color: tokens.colors.light,
    textTransform: 'uppercase',
  },
  resultStatLabel: {
    fontFamily: 'Inter',
    fontSize: 7,
    fontWeight: '500',
    color: tokens.colors['secondary-light'],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 1,
  },
  resultsDivider: {
    width: 1,
    height: 14,
    backgroundColor: tokens.colors['secondary-dark'],
    opacity: 0.4,
  },

  // Leaderboard
  lbHeader: {
    paddingHorizontal: 3,
    marginBottom: 2,
  },
  lbHeaderText: {
    fontFamily: 'Inter',
    fontSize: 7,
    fontWeight: '700',
    color: tokens.colors['secondary-light'],
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  leaderboard: {
    flex: 1,
    width: '100%',
    marginBottom: 4,
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 3,
    borderRadius: 3,
  },
  lbRowYou: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  lbRank: {
    fontFamily: 'Inter',
    fontSize: 8,
    fontWeight: '500',
    color: tokens.colors['secondary-light'],
    width: 14,
    textAlign: 'right',
    marginRight: 4,
  },
  lbName: {
    fontFamily: 'Inter',
    fontSize: 8,
    fontWeight: '400',
    color: tokens.colors.light,
    flex: 1,
  },
  lbScore: {
    fontFamily: 'ndot',
    fontSize: 8,
    lineHeight: 9,
    color: tokens.colors.light,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  lbEmpty: {
    fontFamily: 'Inter',
    fontSize: 8,
    fontWeight: '400',
    color: tokens.colors['secondary-dark'],
    textAlign: 'center',
    marginTop: 8,
  },

  replayBtn: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    marginHorizontal: 10,
    borderWidth: 1,
    borderColor: tokens.colors.light,
    borderRadius: 6,
    alignItems: 'center',
  },
  replayBtnText: {
    fontFamily: 'Inter',
    fontSize: 9,
    fontWeight: '600',
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  // --- Error ---
  errorTitle: {
    fontFamily: 'ndot',
    fontSize: 14,
    lineHeight: 16,
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  errorSubtitle: {
    fontFamily: 'Inter',
    fontSize: 8,
    fontWeight: '400',
    color: tokens.colors['secondary-light'],
    textAlign: 'center',
    lineHeight: 12,
  },
});
