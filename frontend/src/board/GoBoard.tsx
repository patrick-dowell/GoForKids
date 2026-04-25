import { useRef, useEffect, useState } from 'react';
import { Color, type Point } from '../engine/types';
import { useGameStore } from '../store/gameStore';
import { useReplayStore } from '../store/replayStore';
import { useSettingsStore } from '../store/settingsStore';
import { getTheme, withDensity, type Theme } from '../theme/themes';
import { densityMultiplier } from '../store/settingsStore';
import { AnimationManager } from './animations/AnimationManager';
import {
  createPlacementAnimation,
  createCaptureAnimation,
  createConnectionAnimation,
} from './animations/stoneAnimations';

const BOARD_PADDING = 40;
const CANVAS_SIZE = 700;

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

/** Compute board geometry for a given size. cellSize, stoneRadius scale with size. */
function geometry(size: number) {
  const boardPixels = CANVAS_SIZE - BOARD_PADDING * 2;
  const cellSize = boardPixels / (size - 1);
  return {
    cellSize,
    stoneRadius: cellSize * 0.45,
    toScreen: (row: number, col: number) => ({
      x: BOARD_PADDING + col * cellSize,
      y: BOARD_PADDING + row * cellSize,
    }),
  };
}

function toBoard(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  size: number,
): Point | null {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
  const y = (clientY - rect.top) * (CANVAS_SIZE / rect.height);
  const { cellSize } = geometry(size);
  const col = Math.round((x - BOARD_PADDING) / cellSize);
  const row = Math.round((y - BOARD_PADDING) / cellSize);
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
      ctx.fillStyle = theme.hoverValid; ctx.fill();
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

  const grid = replayActive ? replayGrid : liveGrid;
  const size = replayActive ? replayBoardSize : liveBoardSize;
  const lastMove = replayActive ? replayLastMove : liveLastMove;
  const replayTotalMoves = useReplayStore((s) => s.totalMoves);
  const lastMoveNumber = replayActive ? replayCurrentMove : moveCount;
  const effectivePhase = replayActive
    ? (replayCurrentMove >= replayTotalMoves ? 'finished' : 'playing')
    : phase;

  const gameMode = useGameStore((s) => s.gameMode);
  const canClick = !replayActive && phase === 'playing' && !aiThinking && gameMode !== 'botvsbot';

  // Set canvas size once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;
  }, []);

  // Main render effect — redraws without resizing (no flicker)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const activeAtari = replayActive ? [] : atariGroups;
    const activeTerritory = replayActive ? replayTerritory : territory;
    const activeDead = replayActive ? replayDeadStones : deadStones;
    drawBoard(ctx, theme, size, grid, lastMove, lastMoveNumber, activeAtari, hoverPoint, effectivePhase, activeTerritory, activeDead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, size, lastMove, lastMoveNumber, hoverPoint, effectivePhase, moveCount, replayCurrentMove, themeId,
      atariGroups.length, deadStones.length,
      territory ? territory.black.size : -1,
      replayTerritory ? replayTerritory.black.size : -1,
      replayDeadStones.length,
  ]);

  // Trigger animations on new moves
  const prevMoveCountRef = useRef(0);
  useEffect(() => {
    if (moveCount <= prevMoveCountRef.current) {
      prevMoveCountRef.current = moveCount;
      return;
    }
    prevMoveCountRef.current = moveCount;

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

  return (
    <canvas
      ref={canvasRef}
      onClick={(e) => {
        if (!canClick) return;
        const p = toBoard(e.clientX, e.clientY, canvasRef.current!, size);
        if (p) playMove(p);
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
