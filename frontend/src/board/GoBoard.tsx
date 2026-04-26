import { useRef, useEffect, useState } from 'react';
import { Color, type Point } from '../engine/types';
import { useGameStore } from '../store/gameStore';
import { useReplayStore } from '../store/replayStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLearnStore } from '../store/learnStore';
import { LESSONS } from '../learn/lessons';
import { getTheme, withDensity, type Theme } from '../theme/themes';
import { densityMultiplier } from '../store/settingsStore';
import { AnimationManager } from './animations/AnimationManager';
import {
  createPlacementAnimation,
  createCaptureAnimation,
  createConnectionAnimation,
  createSuccessRingAnimation,
} from './animations/stoneAnimations';
import { CANVAS_SIZE, geometry } from './geometry';

/** Standard hoshi (star point) positions per board size. */
const STAR_POINTS: Record<number, [number, number][]> = {
  9: [
    [2, 2], [2, 6],
    [6, 2], [6, 6],
    [4, 4],
  ],
  13: [
    [3, 3], [3, 9],
    [9, 3], [9, 9],
    [6, 6],
  ],
  19: [
    [3, 3], [3, 9], [3, 15],
    [9, 3], [9, 9], [9, 15],
    [15, 3], [15, 9], [15, 15],
  ],
};

function toBoard(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  size: number,
): Point | null {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
  const y = (clientY - rect.top) * (CANVAS_SIZE / rect.height);
  const { cellSize, padding } = geometry(size);
  const col = Math.round((x - padding) / cellSize);
  const row = Math.round((y - padding) / cellSize);
  if (row < 0 || row >= size || col < 0 || col >= size) return null;
  return { row, col };
}

interface TerritoryMap {
  black: Set<number>;
  white: Set<number>;
  neutral: Set<number>;
}

interface DeadStone { row: number; col: number; color: Color; }

function drawBoard(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  size: number,
  grid: number[],
  lastMove: Point | null,
  lastMoveNumber: number,
  atariGroups: { color: Color; stones: Point[]; liberty: Point }[],
  hoverPoint: Point | null,
  phase: string,
  territory: TerritoryMap | null = null,
  deadStones: DeadStone[] = [],
  highlights: Point[] = [],
  highlightPulse: number = 0,
  /** When set, the hover preview takes a tint that reflects this color (e.g. white in
   *  lessons where the user plays White). Empty falls back to the theme default. */
  hoverColor: Color = Color.Empty,
) {
  const { cellSize, stoneRadius, toScreen } = geometry(size);
  const starPoints = STAR_POINTS[size] ?? [];

  // Canvas background
  ctx.fillStyle = theme.canvasBackground;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Board background
  ctx.beginPath();
  ctx.roundRect(10, 10, 680, 680, theme.boardBorderRadius);
  ctx.fillStyle = theme.boardBackground;
  ctx.fill();

  // Grid
  ctx.strokeStyle = theme.lineColor;
  ctx.lineWidth = theme.lineWidth;
  for (let i = 0; i < size; i++) {
    const p = toScreen(i, 0);
    const pe = toScreen(i, size - 1);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pe.x, p.y); ctx.stroke();
    const q = toScreen(0, i);
    const qe = toScreen(size - 1, i);
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, qe.y); ctx.stroke();
  }

  // Star points — radius scales mildly with cellSize so 9x9 hoshi don't look huge
  const starRadius = Math.max(2, theme.starRadius * (size === 19 ? 1 : 0.85));
  ctx.fillStyle = theme.starColor;
  for (const [r, c] of starPoints) {
    const { x, y } = toScreen(r, c);
    ctx.beginPath(); ctx.arc(x, y, starRadius, 0, Math.PI * 2); ctx.fill();
  }

  // Coordinates
  const labels = 'ABCDEFGHJKLMNOPQRST';
  ctx.fillStyle = theme.coordinateColor;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < size; i++) {
    ctx.fillText(labels[i], toScreen(0, i).x, 15);
    ctx.fillText(String(size - i), 15, toScreen(i, 0).y);
  }

  // Atari glow
  for (const group of atariGroups) {
    for (const s of group.stones) {
      const { x, y } = toScreen(s.row, s.col);
      ctx.beginPath(); ctx.arc(x, y, stoneRadius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = theme.atariGlow; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // Lesson highlights — pulsing golden glow on empty intersections to guide the user.
  // Rendered behind stones so an occupied highlight (rare) doesn't obscure the stone.
  if (highlights.length > 0) {
    ctx.save();
    for (const h of highlights) {
      const occupied = grid[h.row * size + h.col] !== Color.Empty;
      if (occupied) continue;
      const { x, y } = toScreen(h.row, h.col);
      // Two-ring pulse: outer halo grows + fades, inner ring stays bright.
      const outerR = stoneRadius * (1.4 + 0.5 * highlightPulse);
      const outerAlpha = 0.45 * (1 - highlightPulse);
      ctx.beginPath();
      ctx.arc(x, y, outerR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 209, 102, ${outerAlpha.toFixed(3)})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, stoneRadius * 0.95, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Stones
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const color = grid[row * size + col];
      if (color === Color.Empty) continue;
      const { x, y } = toScreen(row, col);
      theme.drawStone(ctx, x, y, stoneRadius, color as Color);
    }
  }

  // Territory overlay
  if (territory && (phase === 'finished' || phase === 'scoring')) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (const idx of territory.black) {
      const row = Math.floor(idx / size);
      const col = idx % size;
      const { x, y } = toScreen(row, col);
      theme.drawTerritory(ctx, x, y, cellSize, 'black');
    }
    for (const idx of territory.white) {
      const row = Math.floor(idx / size);
      const col = idx % size;
      const { x, y } = toScreen(row, col);
      theme.drawTerritory(ctx, x, y, cellSize, 'white');
    }
    ctx.restore();

    // Territory count markers on empty intersections
    ctx.globalAlpha = 0.7;
    for (const idx of territory.black) {
      if (grid[idx] !== Color.Empty) continue;
      const row = Math.floor(idx / size);
      const col = idx % size;
      const { x, y } = toScreen(row, col);
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = theme.territoryMarkerBlack; ctx.fill();
    }
    for (const idx of territory.white) {
      if (grid[idx] !== Color.Empty) continue;
      const row = Math.floor(idx / size);
      const col = idx % size;
      const { x, y } = toScreen(row, col);
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = theme.territoryMarkerWhite; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Dead stones — faded with X marker
  if (deadStones.length > 0) {
    for (const ds of deadStones) {
      const { x, y } = toScreen(ds.row, ds.col);

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x, y, stoneRadius, 0, Math.PI * 2);
      ctx.fillStyle = ds.color === Color.Black ? theme.deadStoneBlack : theme.deadStoneWhite;
      ctx.fill();
      ctx.restore();

      const xSize = stoneRadius * 0.45;
      ctx.save();
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x - xSize, y - xSize);
      ctx.lineTo(x + xSize, y + xSize);
      ctx.moveTo(x + xSize, y - xSize);
      ctx.lineTo(x - xSize, y + xSize);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Last move marker
  if (lastMove && lastMoveNumber > 0) {
    const { x, y } = toScreen(lastMove.row, lastMove.col);
    const c = grid[lastMove.row * size + lastMove.col];

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, stoneRadius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = theme.lastMoveHalo;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    const numStr = String(lastMoveNumber);
    const fontScale = numStr.length >= 3 ? 0.7 : numStr.length === 2 ? 0.85 : 1.0;
    const fontPx = Math.round(stoneRadius * fontScale);
    ctx.save();
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = c === Color.Black ? theme.lastMoveTextOnBlack : theme.lastMoveTextOnWhite;
    ctx.fillText(numStr, x, y);
    ctx.restore();
  }

  // Hover
  if (hoverPoint && phase === 'playing') {
    const { x, y } = toScreen(hoverPoint.row, hoverPoint.col);
    const occupied = grid[hoverPoint.row * size + hoverPoint.col] !== Color.Empty;
    if (!occupied) {
      ctx.beginPath(); ctx.arc(x, y, stoneRadius, 0, Math.PI * 2);
      // White-color hover (used in lessons where the user plays White) needs a
      // light tint so it reads as a white ghost stone, not the default dark dot.
      ctx.fillStyle = hoverColor === Color.White
        ? 'rgba(230, 230, 245, 0.35)'
        : theme.hoverValid;
      ctx.fill();
    }
  }
}

export function GoBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animManagerRef = useRef(new AnimationManager());
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);

  const themeId = useSettingsStore((s) => s.themeId);
  const density = useSettingsStore((s) => s.density);
  const theme = withDensity(getTheme(themeId), densityMultiplier(density));

  // Replay mode overrides the live game
  const replayActive = useReplayStore((s) => s.active);
  const replayGrid = useReplayStore((s) => s.grid);
  const replayBoardSize = useReplayStore((s) => s.boardSize);
  const replayLastMove = useReplayStore((s) => s.lastMove);
  const replayCurrentMove = useReplayStore((s) => s.currentMove);
  const replayTerritory = useReplayStore((s) => s.territory);
  const replayDeadStones = useReplayStore((s) => s.deadStones);

  // Learn (lesson) mode — takes precedence when active.
  const learnActive = useLearnStore((s) => s.active);
  const learnGrid = useLearnStore((s) => s.grid);
  const learnSize = useLearnStore((s) => s.boardSize);
  const learnLastMove = useLearnStore((s) => s.lastMove);
  const learnLastCaptures = useLearnStore((s) => s.lastCaptures);
  const learnLastMoveColor = useLearnStore((s) => s.lastMoveColor);
  const learnMoveSeq = useLearnStore((s) => s.moveSeq);
  const learnSuccessSeq = useLearnStore((s) => s.successSeq);
  const learnDeniedSeq = useLearnStore((s) => s.deniedSeq);
  const learnLastDeniedPoint = useLearnStore((s) => s.lastDeniedPoint);
  const learnStatus = useLearnStore((s) => s.status);
  const learnLessonIndex = useLearnStore((s) => s.lessonIndex);
  const learnShowHint = useLearnStore((s) => s.showHint);
  const learnTryMove = useLearnStore((s) => s.tryMove);

  const liveGrid = useGameStore((s) => s.grid);
  const liveBoardSize = useGameStore((s) => s.boardSize);
  const phase = useGameStore((s) => s.phase);
  const liveLastMove = useGameStore((s) => s.lastMove);
  const lastCaptures = useGameStore((s) => s.lastCaptures);
  const atariGroups = useGameStore((s) => s.atariGroups);
  const currentColor = useGameStore((s) => s.currentColor);
  const playMove = useGameStore((s) => s.playMove);
  const moveCount = useGameStore((s) => s.moveCount);
  const aiThinking = useGameStore((s) => s.aiThinking);
  const territory = useGameStore((s) => s.territory);
  const deadStones = useGameStore((s) => s.deadStones);
  const lastMerged = useGameStore((s) => s.lastMerged);

  const grid = learnActive ? learnGrid : replayActive ? replayGrid : liveGrid;
  const size = learnActive ? learnSize : replayActive ? replayBoardSize : liveBoardSize;
  const lastMove = learnActive ? learnLastMove : replayActive ? replayLastMove : liveLastMove;
  const replayTotalMoves = useReplayStore((s) => s.totalMoves);
  const lastMoveNumber = learnActive
    ? 0  // Don't draw move-number labels in lessons
    : replayActive
      ? replayCurrentMove
      : moveCount;
  const effectivePhase = learnActive
    ? 'playing'
    : replayActive
      ? (replayCurrentMove >= replayTotalMoves ? 'finished' : 'playing')
      : phase;

  const gameMode = useGameStore((s) => s.gameMode);
  const canClick = learnActive
    ? learnStatus === 'awaiting' || learnStatus === 'retry'
    : !replayActive && phase === 'playing' && !aiThinking && gameMode !== 'botvsbot';

  // Lesson highlights — only when the learn store says to show them.
  const highlights: Point[] = learnActive && learnShowHint
    ? LESSONS[learnLessonIndex]?.highlight ?? []
    : [];

  // Set canvas size once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;
  }, []);

  // Pulse value (0..1) for the lesson highlight glow. Only ticks while a
  // highlight is being shown — otherwise we don't want to burn a RAF loop.
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (highlights.length === 0) return;
    let raf = 0;
    const tick = (t: number) => {
      // 1.4s period sin-wave 0..1.
      setPulse(0.5 - 0.5 * Math.cos((t / 1400) * Math.PI * 2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [highlights.length]);

  // Main render effect — redraws without resizing (no flicker)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const activeAtari = learnActive || replayActive ? [] : atariGroups;
    const activeTerritory = learnActive ? null : replayActive ? replayTerritory : territory;
    const activeDead = learnActive ? [] : replayActive ? replayDeadStones : deadStones;
    const hoverColor = learnActive
      ? (LESSONS[learnLessonIndex]?.userPlays ?? Color.Empty)
      : Color.Empty;
    drawBoard(
      ctx, theme, size, grid, lastMove, lastMoveNumber, activeAtari, hoverPoint,
      effectivePhase, activeTerritory, activeDead, highlights, pulse, hoverColor,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, size, lastMove, lastMoveNumber, hoverPoint, effectivePhase, moveCount, replayCurrentMove, themeId,
      atariGroups.length, deadStones.length,
      territory ? territory.black.size : -1,
      replayTerritory ? replayTerritory.black.size : -1,
      replayDeadStones.length,
      learnActive, highlights.length, pulse,
  ]);

  // Trigger animations on new moves (live-game only — lessons drive their own visuals).
  const prevMoveCountRef = useRef(0);
  useEffect(() => {
    if (learnActive) return;
    if (moveCount <= prevMoveCountRef.current) {
      prevMoveCountRef.current = moveCount;
      return;
    }
    prevMoveCountRef.current = moveCount;
    // (live-game animation logic continues below)

    const canvas = canvasRef.current;
    if (!canvas) return;
    const animManager = animManagerRef.current;

    const activeTerritory = replayActive ? replayTerritory : territory;
    const activeDead = replayActive ? replayDeadStones : deadStones;

    if (lastMove) {
      const stoneColor = grid[lastMove.row * size + lastMove.col];
      if (stoneColor !== Color.Empty) {
        animManager.attach(canvas, () => {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawBoard(ctx, theme, size, grid, lastMove, lastMoveNumber, atariGroups, null, effectivePhase, activeTerritory, activeDead);
        });
        animManager.add(createPlacementAnimation(lastMove, stoneColor as Color, theme, size));
      }
    }

    if (lastCaptures.length > 0 && lastMove) {
      const capturedColor = currentColor;
      animManager.add(createCaptureAnimation(lastCaptures, lastMove, capturedColor, theme, size));
    }

    // Connection pulse — fires when the latest move merged 2+ same-color groups.
    if (!replayActive && lastMerged.stones.length > 0) {
      animManager.add(createConnectionAnimation(lastMerged.stones, lastMerged.color, theme, size));
    }

    return () => {
      animManager.detach();
    };
  }, [moveCount]);

  // Lesson animations — fire on every learn-mode move (user or auto-placed).
  // Mirrors the live-game effect above but reads from learnStore.
  const prevLearnMoveSeqRef = useRef(0);

  // When the lesson changes (auto-advance or manual jump), cut any leftover
  // animation closure from the previous lesson — otherwise the AnimationManager
  // can repaint with stale state and the new lesson's setup may flicker.
  useEffect(() => {
    if (!learnActive) return;
    animManagerRef.current.clear();
    animManagerRef.current.detach();
    prevLearnMoveSeqRef.current = learnMoveSeq;
  }, [learnLessonIndex, learnActive]);

  useEffect(() => {
    if (!learnActive) return;
    if (learnMoveSeq <= prevLearnMoveSeqRef.current) {
      prevLearnMoveSeqRef.current = learnMoveSeq;
      return;
    }
    prevLearnMoveSeqRef.current = learnMoveSeq;

    const canvas = canvasRef.current;
    if (!canvas || !learnLastMove || learnLastMoveColor === Color.Empty) return;
    const animManager = animManagerRef.current;
    animManager.attach(canvas, () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBoard(ctx, theme, size, grid, learnLastMove, 0, [], null, 'playing', null, [], highlights, pulse);
    });
    animManager.add(createPlacementAnimation(learnLastMove, learnLastMoveColor, theme, size));
    if (learnLastCaptures.length > 0) {
      // The captured color is the opposite of the placing color.
      const captured = learnLastMoveColor === Color.Black ? Color.White : Color.Black;
      animManager.add(createCaptureAnimation(learnLastCaptures, learnLastMove, captured, theme, size));
    }
    return () => animManager.detach();
  }, [learnMoveSeq]);

  // Lesson success ring — celebratory golden burst, only on correct user moves.
  const prevSuccessSeqRef = useRef(0);
  useEffect(() => {
    if (!learnActive) return;
    if (learnSuccessSeq <= prevSuccessSeqRef.current) {
      prevSuccessSeqRef.current = learnSuccessSeq;
      return;
    }
    prevSuccessSeqRef.current = learnSuccessSeq;
    const canvas = canvasRef.current;
    if (!canvas || !learnLastMove) return;
    animManagerRef.current.add(createSuccessRingAnimation(learnLastMove, size));
  }, [learnSuccessSeq]);

  // Denied flash — red ring on the existing stone when the user clicks an
  // occupied intersection. Runs its own short RAF loop instead of going through
  // the AnimationManager, since this is a transient overlay (not paired with
  // a board-state change) and shouldn't fight with placement animations.
  useEffect(() => {
    if (!learnActive || learnDeniedSeq === 0) return;
    const canvas = canvasRef.current;
    if (!canvas || !learnLastDeniedPoint) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const start = performance.now();
    const duration = 480;
    let raf = 0;
    const { stoneRadius, toScreen } = geometry(size);
    const { x, y } = toScreen(learnLastDeniedPoint.row, learnLastDeniedPoint.col);

    const tick = () => {
      const t = Math.min((performance.now() - start) / duration, 1);
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Repaint the board underneath so the ring fades cleanly.
      drawBoard(ctx, theme, size, grid, learnLastMove, 0, [], null, 'playing', null, [], highlights, pulse);
      // Outer expanding ring.
      const r = stoneRadius * (1 + t * 0.65);
      const alpha = (1 - t) * 0.95;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 107, 107, 1)';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      // Brief inner halo at the start.
      if (t < 0.25) {
        ctx.globalAlpha = (1 - t / 0.25) * 0.35;
        ctx.beginPath();
        ctx.arc(x, y, stoneRadius * 1.05, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 107, 107, 1)';
        ctx.fill();
      }
      ctx.restore();
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [learnDeniedSeq]);

  return (
    <canvas
      ref={canvasRef}
      onClick={(e) => {
        if (!canClick) return;
        const p = toBoard(e.clientX, e.clientY, canvasRef.current!, size);
        if (!p) return;
        if (learnActive) {
          learnTryMove(p);
        } else {
          playMove(p);
        }
      }}
      onMouseMove={(e) => {
        if (!canClick) { setHoverPoint(null); return; }
        setHoverPoint(toBoard(e.clientX, e.clientY, canvasRef.current!, size));
      }}
      onMouseLeave={() => setHoverPoint(null)}
      style={{
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        borderRadius: 8,
        cursor: canClick ? 'pointer' : aiThinking ? 'wait' : 'default',
      }}
    />
  );
}
