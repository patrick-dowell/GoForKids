/**
 * Stone placement and capture animations.
 * Per design doc: "Every stone feels good."
 */

import type { Animation } from './AnimationManager';
import { easeOutBack, easeOutCubic, easeInCubic } from './AnimationManager';
import type { Point } from '../../engine/types';
import { Color, BOARD_SIZE } from '../../engine/types';

const BOARD_PADDING = 40;
const CANVAS_SIZE = 700;
const boardSize = CANVAS_SIZE - BOARD_PADDING * 2;
const cellSize = boardSize / (BOARD_SIZE - 1);
const stoneRadius = cellSize * 0.45;

function toScreen(row: number, col: number) {
  return {
    x: BOARD_PADDING + col * cellSize,
    y: BOARD_PADDING + row * cellSize,
  };
}

/**
 * Stone placement: satisfying snap with squash/stretch and shadow settle.
 */
export function createPlacementAnimation(point: Point, color: Color): Animation {
  const { x, y } = toScreen(point.row, point.col);

  return {
    id: `place-${point.row}-${point.col}`,
    duration: 280,
    draw: (ctx, progress) => {
      const t = easeOutBack(progress);
      const scale = t;

      // Slight squash at landing
      const squashT = Math.max(0, (progress - 0.7) / 0.3);
      const scaleX = scale * (1 + 0.06 * Math.sin(squashT * Math.PI));
      const scaleY = scale * (1 - 0.04 * Math.sin(squashT * Math.PI));

      // Drop shadow
      ctx.save();
      ctx.globalAlpha = 0.2 * Math.min(progress * 3, 1);
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 3, stoneRadius * scaleX, stoneRadius * scaleY * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();

      // Impact ripple (expands outward on contact)
      if (progress > 0.3) {
        const rippleT = (progress - 0.3) / 0.7;
        const rippleRadius = stoneRadius * (1 + rippleT * 0.8);
        const rippleAlpha = (1 - rippleT) * 0.25;
        ctx.save();
        ctx.globalAlpha = rippleAlpha;
        ctx.beginPath();
        ctx.arc(x, y, rippleRadius, 0, Math.PI * 2);
        ctx.strokeStyle = color === Color.Black ? '#7777bb' : '#aaaadd';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // Stone body
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scaleX, scaleY);

      ctx.beginPath();
      ctx.arc(0, 0, stoneRadius, 0, Math.PI * 2);
      if (color === Color.Black) {
        ctx.fillStyle = '#2d2d48';
        ctx.fill();
        ctx.strokeStyle = 'rgba(100,100,150,0.6)';
      } else {
        ctx.fillStyle = '#d8d8ee';
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,160,190,0.6)';
      }
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();
    },
  };
}

/**
 * Capture animation: stones shatter outward, particles scatter, flash at impact.
 * Bigger captures = more dramatic.
 */
export function createCaptureAnimation(
  captured: Point[],
  captorPoint: Point,
  color: Color
): Animation {
  const captor = toScreen(captorPoint.row, captorPoint.col);
  const count = captured.length;
  const isBigCapture = count >= 3;

  // Pre-compute random particle directions for each captured stone
  const particles = captured.map((stone) => {
    const { x, y } = toScreen(stone.row, stone.col);
    // Direction: away from the captor
    const dx = x - captor.x;
    const dy = y - captor.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x, y,
      // Main direction away from captor with some randomness
      vx: (dx / dist) * (40 + Math.random() * 30),
      vy: (dy / dist) * (40 + Math.random() * 30) - 20, // slight upward bias
      // Small fragment particles
      fragments: Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => ({
        angle: Math.random() * Math.PI * 2,
        speed: 15 + Math.random() * 35,
        size: 1.5 + Math.random() * 2.5,
      })),
    };
  });

  return {
    id: `capture-${Date.now()}`,
    duration: isBigCapture ? 700 : 550,
    draw: (ctx, progress) => {
      // Phase 1 (0-0.15): stones flash white and expand
      // Phase 2 (0.15-1.0): stones shatter and particles scatter

      for (let i = 0; i < captured.length; i++) {
        const p = particles[i];

        if (progress < 0.15) {
          // Flash and swell
          const t = progress / 0.15;
          const swell = 1 + t * 0.3;
          const flashAlpha = t;

          ctx.save();
          // Glow
          ctx.globalAlpha = flashAlpha * 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, stoneRadius * swell * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = isBigCapture ? '#ffd700' : '#58a6ff';
          ctx.fill();

          // Stone still visible but whitening
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, stoneRadius * swell, 0, Math.PI * 2);
          const stoneColor = color === Color.Black ? '#2d2d48' : '#d8d8ee';
          ctx.fillStyle = stoneColor;
          ctx.fill();

          // White flash overlay
          ctx.globalAlpha = flashAlpha * 0.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, stoneRadius * swell, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();

          ctx.restore();
        } else {
          // Shatter phase
          const t = (progress - 0.15) / 0.85;
          const fadeAlpha = Math.max(0, 1 - t * 1.2);

          if (fadeAlpha <= 0) continue;

          // Main stone remnant — shrinks and moves away
          const mainX = p.x + p.vx * easeOutCubic(t);
          const mainY = p.y + p.vy * easeOutCubic(t) + 30 * t * t; // gravity
          const mainScale = Math.max(0, 1 - t * 1.5);

          if (mainScale > 0) {
            ctx.save();
            ctx.globalAlpha = fadeAlpha * 0.7;
            ctx.beginPath();
            ctx.arc(mainX, mainY, stoneRadius * mainScale, 0, Math.PI * 2);
            ctx.fillStyle = color === Color.Black ? '#2d2d48' : '#c8c8dd';
            ctx.fill();
            ctx.restore();
          }

          // Fragment particles
          for (const frag of p.fragments) {
            const fx = p.x + Math.cos(frag.angle) * frag.speed * easeOutCubic(t);
            const fy = p.y + Math.sin(frag.angle) * frag.speed * easeOutCubic(t) + 20 * t * t;
            const fragAlpha = fadeAlpha * 0.8;
            const fragSize = frag.size * (1 - t * 0.5);

            if (fragAlpha > 0 && fragSize > 0) {
              ctx.save();
              ctx.globalAlpha = fragAlpha;
              ctx.beginPath();
              ctx.arc(fx, fy, fragSize, 0, Math.PI * 2);
              ctx.fillStyle = color === Color.Black ? '#5555aa' : '#ddddff';
              ctx.fill();
              ctx.restore();
            }
          }
        }
      }

      // Shockwave ring at captor position
      if (progress > 0.1 && progress < 0.6) {
        const waveT = (progress - 0.1) / 0.5;
        const waveRadius = stoneRadius * (1 + waveT * (isBigCapture ? 3 : 2));
        const waveAlpha = (1 - waveT) * (isBigCapture ? 0.5 : 0.3);

        ctx.save();
        ctx.globalAlpha = waveAlpha;
        ctx.beginPath();
        ctx.arc(captor.x, captor.y, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = isBigCapture ? '#ffd700' : '#58a6ff';
        ctx.lineWidth = isBigCapture ? 2.5 : 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // Second shockwave for big captures
      if (isBigCapture && progress > 0.2 && progress < 0.7) {
        const waveT = (progress - 0.2) / 0.5;
        const waveRadius = stoneRadius * (1 + waveT * 4);
        const waveAlpha = (1 - waveT) * 0.25;

        ctx.save();
        ctx.globalAlpha = waveAlpha;
        ctx.beginPath();
        ctx.arc(captor.x, captor.y, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}

/**
 * Connection pulse: glow along newly-shared liberties when groups join.
 */
export function createConnectionAnimation(
  stones: Point[],
  color: Color
): Animation {
  return {
    id: `connect-${Date.now()}`,
    duration: 600,
    draw: (ctx, progress) => {
      const pulseAlpha = Math.sin(progress * Math.PI) * 0.3;

      for (const stone of stones) {
        const { x, y } = toScreen(stone.row, stone.col);

        ctx.save();
        ctx.globalAlpha = pulseAlpha;
        ctx.beginPath();
        ctx.arc(x, y, stoneRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color === Color.Black ? '#6666aa' : '#aaaaee';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}

/**
 * Atari warning: intensifying glow on threatened groups.
 */
export function createAtariAnimation(
  stones: Point[],
  color: Color
): Animation {
  return {
    id: `atari-${stones[0].row}-${stones[0].col}`,
    duration: 1000,
    draw: (ctx, progress) => {
      const pulse = Math.sin(progress * Math.PI * 2) * 0.5 + 0.5;
      const alpha = pulse * 0.4;

      for (const stone of stones) {
        const { x, y } = toScreen(stone.row, stone.col);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, stoneRadius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}
