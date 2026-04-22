/**
 * Stone placement and capture animations.
 * Per design doc: "Every stone feels good."
 * Colors and intensity come from the active theme.
 */

import type { Animation } from './AnimationManager';
import { easeOutBack, easeOutCubic } from './AnimationManager';
import type { Point } from '../../engine/types';
import { Color, BOARD_SIZE } from '../../engine/types';
import type { Theme } from '../../theme/themes';

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
 * Intensity scales the squash amount and ripple — low for classic, full for cosmic.
 */
export function createPlacementAnimation(point: Point, color: Color, theme: Theme): Animation {
  const { x, y } = toScreen(point.row, point.col);
  const intensity = theme.animationIntensity;

  return {
    id: `place-${point.row}-${point.col}`,
    duration: 280,
    draw: (ctx, progress) => {
      const t = easeOutBack(progress);
      const scale = t;

      const squashT = Math.max(0, (progress - 0.7) / 0.3);
      const squashAmt = 0.06 * intensity;
      const scaleX = scale * (1 + squashAmt * Math.sin(squashT * Math.PI));
      const scaleY = scale * (1 - (squashAmt * 0.7) * Math.sin(squashT * Math.PI));

      // Drop shadow
      ctx.save();
      ctx.globalAlpha = 0.2 * Math.min(progress * 3, 1);
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 3, stoneRadius * scaleX, stoneRadius * scaleY * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();

      // Impact ripple — only for higher-intensity themes
      if (intensity > 0.5 && progress > 0.3) {
        const rippleT = (progress - 0.3) / 0.7;
        const rippleRadius = stoneRadius * (1 + rippleT * 0.8 * intensity);
        const rippleAlpha = (1 - rippleT) * 0.25 * intensity;
        ctx.save();
        ctx.globalAlpha = rippleAlpha;
        ctx.beginPath();
        ctx.arc(x, y, rippleRadius, 0, Math.PI * 2);
        ctx.strokeStyle = color === Color.Black ? theme.placementRippleBlack : theme.placementRippleWhite;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // Stone body — use theme renderer for the final look, with scale applied
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scaleX, scaleY);
      // Mid-animation uses the solid silhouette so gradient centers stay correct under scale;
      // at landing, the full theme render takes over on the next board draw.
      ctx.beginPath();
      ctx.arc(0, 0, stoneRadius, 0, Math.PI * 2);
      ctx.fillStyle = color === Color.Black ? theme.stoneBlackSolid : theme.stoneWhiteSolid;
      ctx.fill();
      ctx.strokeStyle = color === Color.Black ? theme.stoneBlackOutline : theme.stoneWhiteOutline;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    },
  };
}

/**
 * Capture animation: stones shatter outward, particles scatter, flash at impact.
 * Bigger captures = more dramatic. Intensity dampens the whole thing for classic.
 */
export function createCaptureAnimation(
  captured: Point[],
  captorPoint: Point,
  color: Color,
  theme: Theme,
): Animation {
  const captor = toScreen(captorPoint.row, captorPoint.col);
  const count = captured.length;
  const isBigCapture = count >= 3;
  const intensity = theme.animationIntensity;

  const particles = captured.map((stone) => {
    const { x, y } = toScreen(stone.row, stone.col);
    const dx = x - captor.x;
    const dy = y - captor.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x, y,
      vx: (dx / dist) * (40 + Math.random() * 30) * intensity,
      vy: (dy / dist) * (40 + Math.random() * 30) * intensity - 20 * intensity,
      fragments: Array.from({ length: Math.max(1, Math.floor((3 + Math.random() * 3) * intensity)) }, () => ({
        angle: Math.random() * Math.PI * 2,
        speed: (15 + Math.random() * 35) * intensity,
        size: 1.5 + Math.random() * 2.5,
      })),
    };
  });

  return {
    id: `capture-${Date.now()}`,
    duration: isBigCapture ? 700 : 550,
    draw: (ctx, progress) => {
      for (let i = 0; i < captured.length; i++) {
        const p = particles[i];

        if (progress < 0.15) {
          // Flash and swell
          const t = progress / 0.15;
          const swell = 1 + t * 0.3 * intensity;
          const flashAlpha = t;

          ctx.save();
          if (intensity > 0.5) {
            ctx.globalAlpha = flashAlpha * 0.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, stoneRadius * swell * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = isBigCapture ? theme.captureFlashBig : theme.captureFlashSmall;
            ctx.fill();
          }

          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, stoneRadius * swell, 0, Math.PI * 2);
          ctx.fillStyle = color === Color.Black ? theme.stoneBlackSolid : theme.stoneWhiteSolid;
          ctx.fill();

          ctx.globalAlpha = flashAlpha * 0.6 * intensity;
          ctx.beginPath();
          ctx.arc(p.x, p.y, stoneRadius * swell, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();

          ctx.restore();
        } else {
          const t = (progress - 0.15) / 0.85;
          const fadeAlpha = Math.max(0, 1 - t * 1.2);
          if (fadeAlpha <= 0) continue;

          const mainX = p.x + p.vx * easeOutCubic(t);
          const mainY = p.y + p.vy * easeOutCubic(t) + 30 * t * t * intensity;
          const mainScale = Math.max(0, 1 - t * 1.5);

          if (mainScale > 0) {
            ctx.save();
            ctx.globalAlpha = fadeAlpha * 0.7;
            ctx.beginPath();
            ctx.arc(mainX, mainY, stoneRadius * mainScale, 0, Math.PI * 2);
            ctx.fillStyle = color === Color.Black ? theme.stoneBlackSolid : theme.stoneWhiteSolid;
            ctx.fill();
            ctx.restore();
          }

          // Fragments — reduced count on low intensity
          for (const frag of p.fragments) {
            const fx = p.x + Math.cos(frag.angle) * frag.speed * easeOutCubic(t);
            const fy = p.y + Math.sin(frag.angle) * frag.speed * easeOutCubic(t) + 20 * t * t * intensity;
            const fragAlpha = fadeAlpha * 0.8;
            const fragSize = frag.size * (1 - t * 0.5);

            if (fragAlpha > 0 && fragSize > 0) {
              ctx.save();
              ctx.globalAlpha = fragAlpha;
              ctx.beginPath();
              ctx.arc(fx, fy, fragSize, 0, Math.PI * 2);
              ctx.fillStyle = color === Color.Black ? theme.captureFragmentBlack : theme.captureFragmentWhite;
              ctx.fill();
              ctx.restore();
            }
          }
        }
      }

      // Shockwave — only for higher-intensity themes
      if (intensity > 0.5 && progress > 0.1 && progress < 0.6) {
        const waveT = (progress - 0.1) / 0.5;
        const waveRadius = stoneRadius * (1 + waveT * (isBigCapture ? 3 : 2));
        const waveAlpha = (1 - waveT) * (isBigCapture ? 0.5 : 0.3);

        ctx.save();
        ctx.globalAlpha = waveAlpha;
        ctx.beginPath();
        ctx.arc(captor.x, captor.y, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = isBigCapture ? theme.shockwaveBig : theme.shockwaveSmall;
        ctx.lineWidth = isBigCapture ? 2.5 : 1.5;
        ctx.stroke();
        ctx.restore();
      }

      if (intensity > 0.5 && isBigCapture && progress > 0.2 && progress < 0.7) {
        const waveT = (progress - 0.2) / 0.5;
        const waveRadius = stoneRadius * (1 + waveT * 4);
        const waveAlpha = (1 - waveT) * 0.25;

        ctx.save();
        ctx.globalAlpha = waveAlpha;
        ctx.beginPath();
        ctx.arc(captor.x, captor.y, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = theme.shockwaveBig;
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
  color: Color,
  theme: Theme,
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
        ctx.strokeStyle = color === Color.Black ? theme.placementRippleBlack : theme.placementRippleWhite;
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
  _color: Color,
  theme: Theme,
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
        ctx.strokeStyle = theme.atariGlow;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}
