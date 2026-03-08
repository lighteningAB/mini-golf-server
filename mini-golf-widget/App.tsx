import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Defs, Line, Pattern, Rect } from 'react-native-svg';
import { tokens } from './src/styles/tokens';

// ----------------------------------------------------------------------------#
// Constants
// ----------------------------------------------------------------------------#
const API_BASE = 'https://mini-golf-server.vercel.app/api';
const API_KEY = 'gk_replace_me';
const HEADERS = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

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

const COURSE_BG = '#2A2A2E';
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
  | { type: 'RESET_FOR_NEW_DAY' };

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
    default:
      return state;
  }
}

const initialState: State = {
  screen: 'loading',
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

async function submitScore(body: object): Promise<SubmitResult> {
  const challengeId = todayUTC();
  const res = await fetch(`${API_BASE}/challenge/${challengeId}/submit`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Submit error: ${res.status}`);
  return res.json();
}

async function fetchLeaderboard(challengeId: string): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API_BASE}/leaderboard/challenge/${challengeId}?limit=10`, {
    headers: HEADERS,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.entries ?? [];
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

  const { width: screenW } = Dimensions.get('window');
  const CANVAS_W = Math.min(screenW - 32, 322);
  const CANVAS_H = Math.round(CANVAS_W * (GRID / GRID));
  const SCALE = CANVAS_W / GRID;

  // ---- Init ----------------------------------------------------------------
  useEffect(() => {
    (async () => {
      let userId = await AsyncStorage.getItem(STORAGE_KEYS.userId);
      let displayName = (await AsyncStorage.getItem(STORAGE_KEYS.displayName)) ?? '';

      if (!userId) {
        dispatch({ type: 'SET_SCREEN', screen: 'onboarding' });
        return;
      }

      dispatch({ type: 'SET_USER', userId, displayName });

      const pending = await AsyncStorage.getItem(STORAGE_KEYS.pending);
      if (pending) {
        try {
          await submitScore(JSON.parse(pending));
          await AsyncStorage.removeItem(STORAGE_KEYS.pending);
        } catch {}
      }

      const savedGame = await AsyncStorage.getItem(STORAGE_KEYS.gameState);
      if (savedGame) {
        const gp: GameProgress = JSON.parse(savedGame);
        if (gp.challenge_id === todayUTC() && gp.completed) {
          dispatch({ type: 'SET_SCREEN', screen: 'results' });
          return;
        }
      }

      try {
        const challenge = await fetchChallenge();
        dispatch({ type: 'SET_CHALLENGE', challenge });
      } catch {
        const cached = await AsyncStorage.getItem(STORAGE_KEYS.challenge);
        if (cached) {
          dispatch({ type: 'SET_CHALLENGE', challenge: JSON.parse(cached) });
        } else {
          dispatch({ type: 'SET_ERROR', error: 'Connect to play today\'s course' });
        }
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

    const body = {
      user_id: s.userId,
      display_name: s.displayName || null,
      strokes: s.strokes,
      completed: true,
      stroke_history: s.strokeHistory,
    };

    try {
      const result = await submitScore(body);
      await AsyncStorage.removeItem(STORAGE_KEYS.pending);
      const lb = await fetchLeaderboard(s.challenge.challenge_id);
      const stats = await fetchStats(s.userId);
      dispatch({ type: 'SET_RESULT', result, leaderboard: lb, stats });

      const gp: GameProgress = {
        challenge_id: s.challenge.challenge_id,
        strokes: s.strokes,
        ball: { x: s.challenge.course.hole.x, y: s.challenge.course.hole.y },
        completed: true,
        stroke_history: s.strokeHistory,
      };
      await AsyncStorage.setItem(STORAGE_KEYS.gameState, JSON.stringify(gp));
    } catch {
      await AsyncStorage.setItem(STORAGE_KEYS.pending, JSON.stringify(body));
      dispatch({ type: 'SET_RESULT', result: { accepted: false, strokes: s.strokes, par: s.challenge.par, rank: 0, total_players: 0, display_name_censored: null }, leaderboard: [], stats: null });
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
        const power = Math.min(Math.hypot(dx, dy) / (CANVAS_W * 0.3), 1);

        if (power < 0.02) return;

        const angle = Math.atan2(dy, dx);
        const vx = Math.cos(angle) * power * MAX_SPEED;
        const vy = Math.sin(angle) * power * MAX_SPEED;
        startPhysics(vx, vy);
      },
    }),
  [startPhysics, CANVAS_W]);

  // ---- Onboarding submit ----------------------------------------------------
  const handleOnboarding = async () => {
    const userId = uuid();
    const name = state.displayName.trim() || `anon_${userId.slice(0, 4)}`;
    await AsyncStorage.setItem(STORAGE_KEYS.userId, userId);
    await AsyncStorage.setItem(STORAGE_KEYS.displayName, name);
    dispatch({ type: 'SET_USER', userId, displayName: name });
    dispatch({ type: 'SET_SCREEN', screen: 'loading' });

    try {
      const challenge = await fetchChallenge();
      await AsyncStorage.setItem(STORAGE_KEYS.challenge, JSON.stringify(challenge));
      dispatch({ type: 'SET_CHALLENGE', challenge });
    } catch {
      dispatch({ type: 'SET_ERROR', error: 'Connect to play today\'s course' });
    }
  };

  // ---- Render ---------------------------------------------------------------
  return (
    <View style={styles.root}>
      {state.screen === 'onboarding' && (
        <View style={styles.centeredContainer}>
          <Text style={styles.titleText}>MINI GOLF</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 8 }).map((_, i) => (
              <View key={i} style={styles.decorDot} />
            ))}
          </View>
          <Text style={styles.subtitleText}>DAILY CHALLENGE</Text>
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
          <Text style={styles.titleText}>LOADING</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <View key={i} style={[styles.decorDot, { opacity: 0.3 + i * 0.15 }]} />
            ))}
          </View>
        </View>
      )}

      {state.screen === 'playing' && state.challenge && (
        <View style={styles.gameContainer}>
          <View style={styles.hud}>
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

          <View style={{ width: CANVAS_W, height: CANVAS_H }} {...panResponder.panHandlers}>
            <Svg width={CANVAS_W} height={CANVAS_H} viewBox={`0 0 ${GRID} ${GRID}`}>
              <Defs>
                <Pattern id="dotGrid" width="5" height="5" patternUnits="userSpaceOnUse">
                  <Circle cx="2.5" cy="2.5" r="0.3" fill={GRID_DOT_COLOR} />
                </Pattern>
              </Defs>

              {/* Course background */}
              <Rect x="0" y="0" width={GRID} height={GRID} fill={COURSE_BG} rx="1" />
              <Rect x="0" y="0" width={GRID} height={GRID} fill="url(#dotGrid)" />

              {/* Walls */}
              {state.challenge.course.walls.map((w, i) =>
                w.type === 'rect' ? (
                  <Rect
                    key={`w${i}`}
                    x={w.x}
                    y={w.y}
                    width={w.w}
                    height={w.h}
                    fill={tokens.colors.light}
                    opacity={0.9}
                  />
                ) : null,
              )}

              {/* Obstacles */}
              {state.challenge.course.obstacles.map((o, i) =>
                o.type === 'rect' ? (
                  <Rect
                    key={`o${i}`}
                    x={o.x}
                    y={o.y}
                    width={o.w}
                    height={o.h}
                    fill={tokens.colors.light}
                    opacity={0.7}
                    rx="0.5"
                  />
                ) : o.type === 'circle' ? (
                  <Circle
                    key={`o${i}`}
                    cx={o.x}
                    cy={o.y}
                    r={o.radius}
                    fill="none"
                    stroke={tokens.colors.light}
                    strokeWidth="0.8"
                    opacity={0.7}
                  />
                ) : null,
              )}

              {/* Hole */}
              <Circle
                cx={state.challenge.course.hole.x}
                cy={state.challenge.course.hole.y}
                r={state.challenge.course.hole.radius + 0.8}
                fill={tokens.colors['secondary-light']}
                opacity={0.3}
              />
              <Circle
                cx={state.challenge.course.hole.x}
                cy={state.challenge.course.hole.y}
                r={state.challenge.course.hole.radius}
                fill={tokens.colors.dark}
                stroke={tokens.colors['secondary-light']}
                strokeWidth="0.5"
              />

              {/* Aim line */}
              {aimRef.current && !state.isMoving && (() => {
                const aim = aimRef.current!;
                const dx = aim.startX - aim.curX;
                const dy = aim.startY - aim.curY;
                const len = Math.hypot(dx, dy);
                if (len < 3) return null;
                const nx = dx / len;
                const ny = dy / len;
                const power = Math.min(len / (CANVAS_W * 0.3), 1);
                const lineLen = power * 25;
                return (
                  <Line
                    x1={state.ball.x}
                    y1={state.ball.y}
                    x2={state.ball.x + nx * lineLen}
                    y2={state.ball.y + ny * lineLen}
                    stroke={tokens.colors.red}
                    strokeWidth="0.8"
                    strokeDasharray="1.5,1"
                    opacity={0.8}
                  />
                );
              })()}

              {/* Ball */}
              {!state.completed && (
                <Circle
                  cx={state.ball.x}
                  cy={state.ball.y}
                  r={BALL_RADIUS * (state.sinking ? state.sinkScale : 1)}
                  fill={tokens.colors.red}
                />
              )}
              {state.sinking && state.sinkScale > 0 && (
                <Circle
                  cx={state.challenge.course.hole.x}
                  cy={state.challenge.course.hole.y}
                  r={BALL_RADIUS * state.sinkScale}
                  fill={tokens.colors.red}
                />
              )}
            </Svg>
          </View>
        </View>
      )}

      {state.screen === 'submitting' && (
        <View style={styles.centeredContainer}>
          <Text style={styles.titleText}>SUBMITTING</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 3 }).map((_, i) => (
              <View key={i} style={styles.decorDot} />
            ))}
          </View>
        </View>
      )}

      {state.screen === 'results' && (
        <View style={styles.resultsContainer}>
          <View style={styles.resultsHeader}>
            <Text style={styles.titleText}>
              {state.submitResult?.strokes ?? state.strokes}
            </Text>
            <Text style={styles.hudLabel}>STROKES</Text>
          </View>

          {state.submitResult && (
            <View style={styles.resultsMeta}>
              <View style={styles.resultsStat}>
                <Text style={styles.resultStatValue}>
                  {state.submitResult.par}
                </Text>
                <Text style={styles.resultStatLabel}>PAR</Text>
              </View>
              <View style={styles.resultsDivider} />
              <View style={styles.resultsStat}>
                <Text style={[styles.resultStatValue, state.submitResult.rank <= 3 && { color: tokens.colors.red }]}>
                  #{state.submitResult.rank}
                </Text>
                <Text style={styles.resultStatLabel}>RANK</Text>
              </View>
              <View style={styles.resultsDivider} />
              <View style={styles.resultsStat}>
                <Text style={styles.resultStatValue}>
                  {state.submitResult.total_players}
                </Text>
                <Text style={styles.resultStatLabel}>PLAYERS</Text>
              </View>
            </View>
          )}

          {state.leaderboard.length > 0 && (
            <View style={styles.leaderboard}>
              <Text style={styles.lbTitle}>LEADERBOARD</Text>
              {state.leaderboard.slice(0, 5).map((entry) => (
                <View key={entry.rank} style={styles.lbRow}>
                  <Text style={[styles.lbRank, entry.rank <= 3 && { color: tokens.colors.red }]}>
                    {entry.rank}
                  </Text>
                  <Text style={styles.lbName} numberOfLines={1}>
                    {entry.display_name}
                  </Text>
                  <Text style={styles.lbScore}>{entry.strokes}</Text>
                </View>
              ))}
            </View>
          )}

          {state.stats && (
            <View style={styles.statsRow}>
              <View style={styles.miniStat}>
                <Text style={styles.miniStatValue}>{state.stats.games_played}</Text>
                <Text style={styles.miniStatLabel}>PLAYED</Text>
              </View>
              <View style={styles.miniStat}>
                <Text style={styles.miniStatValue}>{state.stats.current_streak}</Text>
                <Text style={styles.miniStatLabel}>STREAK</Text>
              </View>
              <View style={styles.miniStat}>
                <Text style={styles.miniStatValue}>{state.stats.best_round ?? '-'}</Text>
                <Text style={styles.miniStatLabel}>BEST</Text>
              </View>
            </View>
          )}

          <View style={styles.dotRow}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={styles.decorDot} />
            ))}
          </View>
          <Text style={styles.footerText}>COME BACK TOMORROW</Text>
        </View>
      )}

      {state.screen === 'error' && (
        <View style={styles.centeredContainer}>
          <Text style={styles.titleText}>OFFLINE</Text>
          <View style={styles.dotRow}>
            {Array.from({ length: 3 }).map((_, i) => (
              <View key={i} style={[styles.decorDot, { backgroundColor: tokens.colors.red }]} />
            ))}
          </View>
          <Text style={styles.subtitleText}>{state.error}</Text>
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
    flex: 1,
    backgroundColor: tokens.colors.dark,
    width: '100%',
    height: '100%',
  },

  // Centered screens (onboarding, loading, error)
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing[4],
  },
  titleText: {
    fontFamily: 'ndot',
    fontSize: 32,
    lineHeight: 32,
    color: tokens.colors.light,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  subtitleText: {
    ...tokens.textStyles.labelUppercasedSmall,
    color: tokens.colors['secondary-light'],
    marginTop: tokens.spacing[2],
    textAlign: 'center',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing[1],
    marginVertical: tokens.spacing[2],
  },
  decorDot: {
    width: 4,
    height: 4,
    borderRadius: tokens.borderRadius.full,
    backgroundColor: tokens.colors['secondary-dark'],
  },
  nameInput: {
    ...tokens.textStyles.labelUppercasedMedium,
    color: tokens.colors.light,
    borderBottomWidth: 1,
    borderBottomColor: tokens.colors['secondary-dark'],
    paddingVertical: tokens.spacing[2],
    width: 160,
    textAlign: 'center',
    marginTop: tokens.spacing[3],
  },
  primaryBtn: {
    marginTop: tokens.spacing[4],
    paddingHorizontal: tokens.spacing[6],
    paddingVertical: tokens.spacing[2],
    borderWidth: 1,
    borderColor: tokens.colors.light,
    borderRadius: tokens.borderRadius.sm,
  },
  primaryBtnText: {
    ...tokens.textStyles.labelUppercasedMedium,
    color: tokens.colors.light,
  },

  // Game screen
  gameContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing[4],
  },
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: tokens.spacing[2],
    gap: tokens.spacing[4],
  },
  hudItem: {
    alignItems: 'center',
  },
  hudLabel: {
    ...tokens.textStyles.labelUppercasedSmall,
    color: tokens.colors['secondary-light'],
  },
  hudValue: {
    fontFamily: 'ndot',
    fontSize: 20,
    lineHeight: 20,
    color: tokens.colors.light,
    textTransform: 'uppercase',
  },
  hudDivider: {
    width: 1,
    height: 20,
    backgroundColor: tokens.colors['secondary-dark'],
  },

  // Results screen
  resultsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing[4],
  },
  resultsHeader: {
    alignItems: 'center',
    marginBottom: tokens.spacing[2],
  },
  resultsMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing[3],
    marginBottom: tokens.spacing[3],
  },
  resultsStat: {
    alignItems: 'center',
  },
  resultStatValue: {
    fontFamily: 'ndot',
    fontSize: 16,
    lineHeight: 16,
    color: tokens.colors.light,
    textTransform: 'uppercase',
  },
  resultStatLabel: {
    ...tokens.textStyles.labelUppercasedSmall,
    color: tokens.colors['secondary-light'],
    marginTop: 2,
  },
  resultsDivider: {
    width: 1,
    height: 16,
    backgroundColor: tokens.colors['secondary-dark'],
  },

  // Leaderboard
  leaderboard: {
    width: '100%',
    maxWidth: 240,
    marginBottom: tokens.spacing[3],
  },
  lbTitle: {
    ...tokens.textStyles.labelUppercasedSmall,
    color: tokens.colors['secondary-light'],
    marginBottom: tokens.spacing[1],
    textAlign: 'center',
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  lbRank: {
    ...tokens.textStyles.labelSmall,
    color: tokens.colors['secondary-light'],
    width: 20,
    textAlign: 'right',
    marginRight: tokens.spacing[2],
  },
  lbName: {
    ...tokens.textStyles.bodySmall,
    color: tokens.colors.light,
    flex: 1,
  },
  lbScore: {
    fontFamily: 'ndot',
    fontSize: 14,
    lineHeight: 14,
    color: tokens.colors.light,
    textTransform: 'uppercase',
    marginLeft: tokens.spacing[2],
  },

  // Mini stats
  statsRow: {
    flexDirection: 'row',
    gap: tokens.spacing[4],
    marginBottom: tokens.spacing[3],
  },
  miniStat: {
    alignItems: 'center',
  },
  miniStatValue: {
    fontFamily: 'ndot',
    fontSize: 14,
    lineHeight: 14,
    color: tokens.colors.light,
    textTransform: 'uppercase',
  },
  miniStatLabel: {
    ...tokens.textStyles.labelUppercasedSmall,
    color: tokens.colors['secondary-light'],
    marginTop: 2,
  },

  footerText: {
    ...tokens.textStyles.labelUppercasedSmall,
    color: tokens.colors['secondary-dark'],
    marginTop: tokens.spacing[1],
  },
});
