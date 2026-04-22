import { useRef, useEffect, useState } from 'react';
import { BOARD_SIZE, Color, type Point } from '../engine/types';
import { useGameStore } from '../store/gameStore';
import { useReplayStore } from '../store/replayStore';
import { useSettingsStore } from '../store/settingsStore';
import { getTheme, type Theme } from '../theme/themes';
import { AnimationManager } from './animations/AnimationManager';
import {
  createPlacementAnimation,
  createCaptureAnimation,
} from './animations/stoneAnimations';

const BOARD_PADDING = 40;
const CANVAS_SIZE = 700;
const STAR_POINTS = [
  [3, 3], [3, 9], [3, 15],
  [9, 3], [9, 9], [9, 15],
  [15, 3], [15, 9], [15, 15],
];

const boardPixels = CANVAS_SIZE - BOARD_PADDING * 2;
const cellSize = boardPixels / (BOARD_SIZE - 1);
const stoneRadius = cellSize * 0.45;

function toScreen(row: number, col: number) {
  return {
    x: BOARD_PADDING + col * cellSize,
    y: BOARD_PADDING + row * cellSize,
  };
}

function toBoard(clientX: number, clientY: number, canvas: HTMLCanvasElement): Point | null {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
  const y = (clientY - rect.top) * (CANVAS_SIZE / rect.height);
  const col = Math.round((x - BOARD_PADDING) / cellSize);
  const row = Math.round((y - BOARD_PADDING) / cellSize);
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
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
  grid: number[],
  lastMove: Point | null,
  lastMoveNumber: number,
  atariGroups: { color: Color; stones: Point[]; liberty: Point }[],
  hoverPoint: Point | null,
  phase: string,
  territory: TerritoryMap | null = null,
  deadStones: DeadStone[] = [],
) {
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
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = toScreen(i, 0);
    const pe = toScreen(i, BOARD_SIZE - 1);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pe.x, p.y); ctx.stroke();
    const q = toScreen(0, i);
    const qe = toScreen(BOARD_SIZE - 1, i);
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, qe.y); ctx.stroke();
  }

  // Star points
  ctx.fillStyle = theme.starColor;
  for (const [r, c] of STAR_POINTS) {
    const { x, y } = toScreen(r, c);
    ctx.beginPath(); ctx.arc(x, y, theme.starRadius, 0, Math.PI * 2); ctx.fill();
  }

  // Coordinates
  const labels = 'ABCDEFGHJKLMNOPQRST';
  ctx.fillStyle = theme.coordinateColor;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < BOARD_SIZE; i++) {
    ctx.fillText(labels[i], toScreen(0, i).x, 15);
    ctx.fillText(String(BOARD_SIZE - i), 15, toScreen(i, 0).y);
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
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const color = grid[row * BOARD_SIZE + col];
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
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
      const { x, y } = toScreen(row, col);
      theme.drawTerritory(ctx, x, y, cellSize, 'black');
    }
    for (const idx of territory.white) {
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
      const { x, y } = toScreen(row, col);
      theme.drawTerritory(ctx, x, y, cellSize, 'white');
    }
    ctx.restore();

    // Territory count markers on empty intersections
    ctx.globalAlpha = 0.7;
    for (const idx of territory.black) {
      if (grid[idx] !== Color.Empty) continue;
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
      const { x, y } = toScreen(row, col);
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = theme.territoryMarkerBlack; ctx.fill();
    }
    for (const idx of territory.white) {
      if (grid[idx] !== Color.Empty) continue;
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
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

  // Last move marker — halo ring around the stone + move number inside
  if (lastMove && lastMoveNumber > 0) {
    const { x, y } = toScreen(lastMove.row, lastMove.col);
    const c = grid[lastMove.row * BOARD_SIZE + lastMove.col];

    // Halo ring just outside the stone
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, stoneRadius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = theme.lastMoveHalo;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Move number centered on the stone — scale font for 1/2/3+ digit numbers
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
    const occupied = grid[hoverPoint.row * BOARD_SIZE + hoverPoint.col] !== Color.Empty;
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
  const theme = getTheme(themeId);

  // Replay mode overrides the live game
  const replayActive = useReplayStore((s) => s.active);
  const replayGrid = useReplayStore((s) => s.grid);
  const replayLastMove = useReplayStore((s) => s.lastMove);
  const replayCurrentMove = useReplayStore((s) => s.currentMove);
  const replayTerritory = useReplayStore((s) => s.territory);
  const replayDeadStones = useReplayStore((s) => s.deadStones);

  const liveGrid = useGameStore((s) => s.grid);
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

  const grid = replayActive ? replayGrid : liveGrid;
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
    drawBoard(ctx, theme, grid, lastMove, lastMoveNumber, activeAtari, hoverPoint, effectivePhase, activeTerritory, activeDead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, lastMove, lastMoveNumber, hoverPoint, effectivePhase, moveCount, replayCurrentMove, themeId,
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
      const stoneColor = grid[lastMove.row * BOARD_SIZE + lastMove.col];
      if (stoneColor !== Color.Empty) {
        animManager.attach(canvas, () => {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawBoard(ctx, theme, grid, lastMove, lastMoveNumber, atariGroups, null, effectivePhase, activeTerritory, activeDead);
        });
        animManager.add(createPlacementAnimation(lastMove, stoneColor as Color, theme));
      }
    }

    if (lastCaptures.length > 0 && lastMove) {
      const capturedColor = currentColor;
      animManager.add(createCaptureAnimation(lastCaptures, lastMove, capturedColor, theme));
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
        const p = toBoard(e.clientX, e.clientY, canvasRef.current!);
        if (p) playMove(p);
      }}
      onMouseMove={(e) => {
        if (!canClick) { setHoverPoint(null); return; }
        setHoverPoint(toBoard(e.clientX, e.clientY, canvasRef.current!));
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
