/**
 * Capture flight animation — stones fly from the board to the prisoner tray.
 *
 * Uses absolute-positioned DOM elements that animate from the board canvas
 * coordinates to the target prisoner tray, then disappear.
 */

import { useEffect, useRef, useState } from 'react';
import { Color, BOARD_SIZE } from '../engine/types';
import { useGameStore } from '../store/gameStore';
import './CaptureAnimation.css';

const BOARD_PADDING = 40;
const CANVAS_SIZE = 700;
const boardPixels = CANVAS_SIZE - BOARD_PADDING * 2;
const cellSize = boardPixels / (BOARD_SIZE - 1);

interface FlyingStone {
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: 'black' | 'white';
  delay: number;
}

let stoneIdCounter = 0;

export function CaptureAnimation() {
  const [flyingStones, setFlyingStones] = useState<FlyingStone[]>([]);
  const prevMoveCount = useRef(0);

  const lastCaptures = useGameStore((s) => s.lastCaptures);
  const moveCount = useGameStore((s) => s.moveCount);
  const currentColor = useGameStore((s) => s.currentColor);
  const playerColor = useGameStore((s) => s.playerColor);

  useEffect(() => {
    if (moveCount <= prevMoveCount.current || lastCaptures.length === 0) {
      prevMoveCount.current = moveCount;
      return;
    }
    prevMoveCount.current = moveCount;

    // The captures just happened. currentColor is now the NEXT player's turn,
    // so the capturing player is the opposite of currentColor.
    const capturingColor = currentColor === Color.Black ? Color.White : Color.Black;
    const capturedStoneColor = currentColor === Color.Black ? 'black' : 'white';

    // Determine which tray to fly to (top = opponent, bottom = player)
    const isPlayerCapture = capturingColor === playerColor;

    // Find DOM elements for positioning
    const canvas = document.querySelector('.board-container canvas') as HTMLCanvasElement;
    const traySelector = isPlayerCapture
      ? '.player-card-bottom .prisoner-tray'
      : '.player-card-top .prisoner-tray';
    const tray = document.querySelector(traySelector) as HTMLElement;
    const layout = document.querySelector('.game-layout') as HTMLElement;

    if (!canvas || !tray || !layout) return;

    const canvasRect = canvas.getBoundingClientRect();
    const trayRect = tray.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();

    // Scale factor: canvas CSS size vs internal coordinate system
    const scale = canvasRect.width / CANVAS_SIZE;

    // Target: center of the prisoner tray, relative to game-layout
    const endX = trayRect.left + trayRect.width / 2 - layoutRect.left;
    const endY = trayRect.top + trayRect.height / 2 - layoutRect.top;

    const newStones: FlyingStone[] = lastCaptures.map((point, i) => {
      // Source: board position, relative to game-layout
      const boardX = BOARD_PADDING + point.col * cellSize;
      const boardY = BOARD_PADDING + point.row * cellSize;
      const startX = canvasRect.left - layoutRect.left + boardX * scale;
      const startY = canvasRect.top - layoutRect.top + boardY * scale;

      return {
        id: ++stoneIdCounter,
        startX,
        startY,
        endX,
        endY,
        color: capturedStoneColor,
        delay: i * 60, // stagger
      };
    });

    setFlyingStones((prev) => [...prev, ...newStones]);

    // Clean up after animation completes
    const maxDuration = 600 + newStones.length * 60;
    setTimeout(() => {
      const ids = new Set(newStones.map((s) => s.id));
      setFlyingStones((prev) => prev.filter((s) => !ids.has(s.id)));
    }, maxDuration);
  }, [moveCount]);

  return (
    <div className="capture-animation-layer">
      {flyingStones.map((stone) => (
        <div
          key={stone.id}
          className={`flying-stone flying-stone-${stone.color}`}
          style={{
            '--start-x': `${stone.startX}px`,
            '--start-y': `${stone.startY}px`,
            '--end-x': `${stone.endX}px`,
            '--end-y': `${stone.endY}px`,
            animationDelay: `${stone.delay}ms`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
