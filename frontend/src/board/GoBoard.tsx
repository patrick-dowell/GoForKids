import { useRef, useEffect, useState } from 'react';
import { BOARD_SIZE, Color, type Point } from '../engine/types';
import { useGameStore } from '../store/gameStore';
import { useReplayStore } from '../store/replayStore';
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

const BG_COLOR = '#0d1117';
const BOARD_BG = 'rgba(50, 38, 20, 0.6)';
const LINE_COLOR = 'rgba(140, 115, 65, 0.45)';
const STAR_COLOR = 'rgba(180, 150, 80, 0.7)';
const ATARI_GLOW = 'rgba(255, 107, 107, 0.5)';
const HOVER_VALID = 'rgba(88, 166, 255, 0.25)';

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

/** Draw the full board state (grid, stones, markers, territory) */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  grid: number[],
  lastMove: Point | null,
  atariGroups: { color: Color; stones: Point[]; liberty: Point }[],
  hoverPoint: Point | null,
  phase: string,
  territory: TerritoryMap | null = null,
  deadStones: DeadStone[] = [],
) {
  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Board bg
  ctx.beginPath();
  ctx.roundRect(10, 10, 680, 680, 8);
  ctx.fillStyle = BOARD_BG;
  ctx.fill();

  // Grid
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = toScreen(i, 0);
    const pe = toScreen(i, BOARD_SIZE - 1);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pe.x, p.y); ctx.stroke();
    const q = toScreen(0, i);
    const qe = toScreen(BOARD_SIZE - 1, i);
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, qe.y); ctx.stroke();
  }

  // Star points
  ctx.fillStyle = STAR_COLOR;
  for (const [r, c] of STAR_POINTS) {
    const { x, y } = toScreen(r, c);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }

  // Coordinates
  const labels = 'ABCDEFGHJKLMNOPQRST';
  ctx.fillStyle = '#555';
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
      ctx.strokeStyle = ATARI_GLOW; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // Stones
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const color = grid[row * BOARD_SIZE + col];
      if (color === Color.Empty) continue;
      const { x, y } = toScreen(row, col);

      if (color === Color.Black) {
        // Outer ring for visibility against dark board
        ctx.beginPath(); ctx.arc(x, y, stoneRadius + 1, 0, Math.PI * 2);
        ctx.fillStyle = '#4a4a6a'; ctx.fill();
        // Main stone body
        ctx.beginPath(); ctx.arc(x, y, stoneRadius, 0, Math.PI * 2);
        const bgr = ctx.createRadialGradient(x - stoneRadius * 0.25, y - stoneRadius * 0.25, stoneRadius * 0.1, x, y, stoneRadius);
        bgr.addColorStop(0, '#3d3d5c');
        bgr.addColorStop(0.7, '#252540');
        bgr.addColorStop(1, '#1a1a30');
        ctx.fillStyle = bgr; ctx.fill();
        ctx.strokeStyle = 'rgba(100,100,150,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
        // Specular highlight
        ctx.beginPath(); ctx.arc(x - stoneRadius * 0.22, y - stoneRadius * 0.22, stoneRadius * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,120,180,0.35)'; ctx.fill();
      } else {
        // Main stone body
        ctx.beginPath(); ctx.arc(x, y, stoneRadius, 0, Math.PI * 2);
        const wgr = ctx.createRadialGradient(x - stoneRadius * 0.2, y - stoneRadius * 0.2, stoneRadius * 0.1, x, y, stoneRadius);
        wgr.addColorStop(0, '#f0f0ff');
        wgr.addColorStop(0.6, '#d8d8ee');
        wgr.addColorStop(1, '#c0c0d8');
        ctx.fillStyle = wgr; ctx.fill();
        ctx.strokeStyle = 'rgba(160,160,190,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
        // Specular highlight
        ctx.beginPath(); ctx.arc(x - stoneRadius * 0.18, y - stoneRadius * 0.18, stoneRadius * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      }
    }
  }

  // Territory overlay — soft nebula-like shading
  if (territory && (phase === 'finished' || phase === 'scoring')) {
    const halfCell = cellSize / 2;

    // Draw black territory
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (const idx of territory.black) {
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
      const { x, y } = toScreen(row, col);

      // Soft radial glow at each territory point
      const grad = ctx.createRadialGradient(x, y, 0, x, y, halfCell);
      grad.addColorStop(0, 'rgba(100, 120, 220, 0.6)');
      grad.addColorStop(0.6, 'rgba(80, 100, 200, 0.3)');
      grad.addColorStop(1, 'rgba(60, 80, 180, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - halfCell, y - halfCell, cellSize, cellSize);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.25;
    for (const idx of territory.white) {
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
      const { x, y } = toScreen(row, col);

      const grad = ctx.createRadialGradient(x, y, 0, x, y, halfCell);
      grad.addColorStop(0, 'rgba(230, 220, 200, 0.6)');
      grad.addColorStop(0.6, 'rgba(210, 200, 180, 0.3)');
      grad.addColorStop(1, 'rgba(190, 180, 160, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - halfCell, y - halfCell, cellSize, cellSize);
    }
    ctx.restore();

    // Territory count markers (small dots)
    ctx.globalAlpha = 0.7;
    for (const idx of territory.black) {
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
      if (grid[idx] === Color.Empty) {
        const { x, y } = toScreen(row, col);
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#6677cc'; ctx.fill();
      }
    }
    for (const idx of territory.white) {
      const row = Math.floor(idx / BOARD_SIZE);
      const col = idx % BOARD_SIZE;
      if (grid[idx] === Color.Empty) {
        const { x, y } = toScreen(row, col);
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ccbbaa'; ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Dead stones — faded with X marker
  if (deadStones.length > 0) {
    for (const ds of deadStones) {
      const { x, y } = toScreen(ds.row, ds.col);

      // Draw faded stone
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x, y, stoneRadius, 0, Math.PI * 2);
      ctx.fillStyle = ds.color === Color.Black ? '#2d2d48' : '#c8c8dd';
      ctx.fill();
      ctx.restore();

      // Draw X marker
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
  if (lastMove) {
    const { x, y } = toScreen(lastMove.row, lastMove.col);
    const c = grid[lastMove.row * BOARD_SIZE + lastMove.col];
    ctx.beginPath(); ctx.arc(x, y, stoneRadius * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = c === Color.Black ? 'rgba(170,170,204,0.8)' : 'rgba(51,51,85,0.8)';
    ctx.fill();
  }

  // Hover
  if (hoverPoint && phase === 'playing') {
    const { x, y } = toScreen(hoverPoint.row, hoverPoint.col);
    const occupied = grid[hoverPoint.row * BOARD_SIZE + hoverPoint.col] !== Color.Empty;
    if (!occupied) {
      ctx.beginPath(); ctx.arc(x, y, stoneRadius, 0, Math.PI * 2);
      ctx.fillStyle = HOVER_VALID; ctx.fill();
    }
  }
}

export function GoBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animManagerRef = useRef(new AnimationManager());
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);

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

  // Use replay data when active, otherwise live game
  const grid = replayActive ? replayGrid : liveGrid;
  const lastMove = replayActive ? replayLastMove : liveLastMove;
  const replayTotalMoves = useReplayStore((s) => s.totalMoves);
  const effectivePhase = replayActive
    ? (replayCurrentMove >= replayTotalMoves ? 'finished' : 'playing')
    : phase;

  const canClick = !replayActive && phase === 'playing' && !aiThinking;

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
    drawBoard(ctx, grid, lastMove, activeAtari, hoverPoint, effectivePhase, activeTerritory, activeDead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, lastMove, hoverPoint, effectivePhase, moveCount, replayCurrentMove,
      // Use lengths/sizes as stable deps instead of object refs
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

    // Placement animation for the last move
    if (lastMove) {
      const stoneColor = grid[lastMove.row * BOARD_SIZE + lastMove.col];
      if (stoneColor !== Color.Empty) {
        animManager.attach(canvas, () => {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawBoard(ctx, grid, lastMove, atariGroups, null, effectivePhase, activeTerritory, activeDead);
        });
        animManager.add(createPlacementAnimation(lastMove, stoneColor as Color));
      }
    }

    // Capture animation
    if (lastCaptures.length > 0 && lastMove) {
      const capturedColor = currentColor; // The captured stones were the current player's color (since turn already switched)
      animManager.add(createCaptureAnimation(lastCaptures, lastMove, capturedColor));
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
