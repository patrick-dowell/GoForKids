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
import { geometry as geom } from '../geometry';

/**
 * Stone placement: satisfying snap with squash/stretch and shadow settle.
 * Intensity scales the squash amount and ripple — low for classic, full for cosmic.
 */
export function createPlacementAnimation(point: Point, color: Color, theme: Theme, size: number = BOARD_SIZE): Animation {
  const { stoneRadius, toScreen } = geom(size);
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
 * Capture tiers control how dramatic the celebration is.
 * - small  (1–2 stones): subtle pop, no shockwave
 * - medium (3–6 stones): flash + single shockwave (the previous "big" tier)
 * - hero   (7+ stones): big flash, double shockwave, longer duration, hero color
 */
type CaptureTier = 'small' | 'medium' | 'hero';

interface TierSpec {
  durationMs: number;
  flashEnabled: boolean;
  flashColor: 'small' | 'big';
  shockwaveCount: 0 | 1 | 2;
  shockwaveScale: number;     // multiplier on first wave radius
  shockwaveAlpha: number;     // first wave starting alpha
  particleSpeedMultiplier: number;
}

function tierFor(count: number): CaptureTier {
  if (count >= 7) return 'hero';
  if (count >= 3) return 'medium';
  return 'small';
}

const TIER_SPECS: Record<CaptureTier, TierSpec> = {
  small:  { durationMs: 500, flashEnabled: false, flashColor: 'small', shockwaveCount: 0, shockwaveScale: 2, shockwaveAlpha: 0.3, particleSpeedMultiplier: 0.85 },
  medium: { durationMs: 700, flashEnabled: true,  flashColor: 'small', shockwaveCount: 1, shockwaveScale: 3, shockwaveAlpha: 0.5, particleSpeedMultiplier: 1.0 },
  hero:   { durationMs: 950, flashEnabled: true,  flashColor: 'big',   shockwaveCount: 2, shockwaveScale: 4, shockwaveAlpha: 0.7, particleSpeedMultiplier: 1.25 },
};

/**
 * Capture animation: stones shatter outward, particles scatter, flash at impact.
 * Bigger captures = more dramatic (3 tiers). Intensity dampens for classic theme.
 */
export function createCaptureAnimation(
  captured: Point[],
  captorPoint: Point,
  color: Color,
  theme: Theme,
  size: number = BOARD_SIZE,
): Animation {
  const { stoneRadius, toScreen } = geom(size);
  const captor = toScreen(captorPoint.row, captorPoint.col);
  const count = captured.length;
  const tier = tierFor(count);
  const spec = TIER_SPECS[tier];
  const intensity = theme.animationIntensity;

  const particleSpeed = spec.particleSpeedMultiplier;
  const particles = captured.map((stone) => {
    const { x, y } = toScreen(stone.row, stone.col);
    const dx = x - captor.x;
    const dy = y - captor.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x, y,
      vx: (dx / dist) * (40 + Math.random() * 30) * intensity * particleSpeed,
      vy: (dy / dist) * (40 + Math.random() * 30) * intensity * particleSpeed - 20 * intensity,
      fragments: Array.from({ length: Math.max(1, Math.floor((3 + Math.random() * 3) * intensity)) }, () => ({
        angle: Math.random() * Math.PI * 2,
        speed: (15 + Math.random() * 35) * intensity * particleSpeed,
        size: 1.5 + Math.random() * 2.5,
      })),
    };
  });

  return {
    id: `capture-${Date.now()}`,
    duration: spec.durationMs,
    draw: (ctx, progress) => {
      for (let i = 0; i < captured.length; i++) {
        const p = particles[i];

        if (progress < 0.15) {
          // Flash and swell
          const t = progress / 0.15;
          const swell = 1 + t * 0.3 * intensity;
          const flashAlpha = t;

          ctx.save();
          if (spec.flashEnabled && intensity > 0.5) {
            ctx.globalAlpha = flashAlpha * (tier === 'hero' ? 0.7 : 0.5);
            ctx.beginPath();
            ctx.arc(p.x, p.y, stoneRadius * swell * (tier === 'hero' ? 2 : 1.5), 0, Math.PI * 2);
            ctx.fillStyle = spec.flashColor === 'big' ? theme.captureFlashBig : theme.captureFlashSmall;
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

      // Primary shockwave (medium + hero only)
      if (spec.shockwaveCount >= 1 && intensity > 0.5 && progress > 0.1 && progress < 0.6) {
        const waveT = (progress - 0.1) / 0.5;
        const waveRadius = stoneRadius * (1 + waveT * spec.shockwaveScale);
        const waveAlpha = (1 - waveT) * spec.shockwaveAlpha;

        ctx.save();
        ctx.globalAlpha = waveAlpha;
        ctx.beginPath();
        ctx.arc(captor.x, captor.y, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = tier === 'hero' ? theme.shockwaveBig : (tier === 'medium' ? theme.shockwaveBig : theme.shockwaveSmall);
        ctx.lineWidth = tier === 'hero' ? 3.5 : 2.5;
        ctx.stroke();
        ctx.restore();
      }

      // Trailing shockwave (hero only)
      if (spec.shockwaveCount >= 2 && intensity > 0.5 && progress > 0.2 && progress < 0.8) {
        const waveT = (progress - 0.2) / 0.6;
        const waveRadius = stoneRadius * (1 + waveT * (spec.shockwaveScale + 2));
        const waveAlpha = (1 - waveT) * 0.4;

        ctx.save();
        ctx.globalAlpha = waveAlpha;
        ctx.beginPath();
        ctx.arc(captor.x, captor.y, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = theme.shockwaveBig;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}

/**
 * Connection pulse — fires once when a move merges 2+ same-color groups.
 * Three layers per stone:
 *   1. A bright halo flash at impact (first ~150ms).
 *   2. A big primary ring sweeping outward (~1.7× stone radius).
 *   3. A trailing secondary ring (~1.3× stone radius) starting later.
 * Combined, the merge feels like the stones share an energetic moment.
 */
export function createConnectionAnimation(
  stones: Point[],
  color: Color,
  theme: Theme,
  size: number = BOARD_SIZE,
): Animation {
  const { stoneRadius, toScreen } = geom(size);
  const intensity = theme.animationIntensity;
  const ringColor = color === Color.Black ? theme.placementRippleBlack : theme.placementRippleWhite;
  // Hotter color for the impact flash so the moment reads as "energetic
  // connection" rather than another generic ring.
  const flashColor = color === Color.Black ? '#a8c6ff' : '#ffe9b8';

  return {
    id: `connect-${Date.now()}`,
    duration: 900,
    draw: (ctx, progress) => {
      for (const stone of stones) {
        const { x, y } = toScreen(stone.row, stone.col);

        // 1. Impact halo (bright filled glow, fades fast)
        if (progress < 0.35) {
          const t = progress / 0.35;
          const haloAlpha = (1 - t) * 0.55 * intensity;
          const haloR = stoneRadius * (1 + t * 0.6);
          ctx.save();
          ctx.globalAlpha = haloAlpha;
          ctx.beginPath();
          ctx.arc(x, y, haloR, 0, Math.PI * 2);
          ctx.fillStyle = flashColor;
          ctx.fill();
          ctx.restore();
        }

        // 2. Primary ring sweeping outward
        const t1 = Math.min(1, progress / 0.75);
        const r1 = stoneRadius * (1 + t1 * 1.2);
        const a1 = Math.sin(t1 * Math.PI) * 0.95 * intensity;
        if (a1 > 0) {
          ctx.save();
          ctx.globalAlpha = a1;
          ctx.beginPath();
          ctx.arc(x, y, r1, 0, Math.PI * 2);
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        }

        // 3. Trailing ring (starts later, smaller travel)
        if (progress > 0.2) {
          const t2 = Math.min(1, (progress - 0.2) / 0.7);
          const r2 = stoneRadius * (1 + t2 * 0.8);
          const a2 = Math.sin(t2 * Math.PI) * 0.7 * intensity;
          if (a2 > 0) {
            ctx.save();
            ctx.globalAlpha = a2;
            ctx.beginPath();
            ctx.arc(x, y, r2, 0, Math.PI * 2);
            ctx.strokeStyle = ringColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    },
  };
}

/**
 * Success ring — a celebratory golden burst at the placed stone, used in
 * lessons when the user makes the correct move. Two concentric rings expand
 * outward and fade, plus a brief inner halo.
 */
export function createSuccessRingAnimation(
  point: Point,
  size: number = BOARD_SIZE,
): Animation {
  const { stoneRadius, toScreen } = geom(size);
  const { x, y } = toScreen(point.row, point.col);
  const gold = '#ffd166';

  return {
    id: `success-${point.row}-${point.col}-${Date.now()}`,
    duration: 900,
    draw: (ctx, progress) => {
      // Inner halo flash — bright at start, fades fast.
      if (progress < 0.4) {
        const t = progress / 0.4;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.55;
        ctx.beginPath();
        ctx.arc(x, y, stoneRadius * (1 + t * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = gold;
        ctx.fill();
        ctx.restore();
      }

      // Primary expanding ring.
      const t1 = Math.min(1, progress / 0.85);
      const r1 = stoneRadius * (1 + t1 * 1.6);
      const a1 = Math.sin(t1 * Math.PI) * 0.95;
      if (a1 > 0) {
        ctx.save();
        ctx.globalAlpha = a1;
        ctx.beginPath();
        ctx.arc(x, y, r1, 0, Math.PI * 2);
        ctx.strokeStyle = gold;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.restore();
      }

      // Trailing ring — slightly delayed.
      if (progress > 0.18) {
        const t2 = Math.min(1, (progress - 0.18) / 0.75);
        const r2 = stoneRadius * (1 + t2 * 1.1);
        const a2 = Math.sin(t2 * Math.PI) * 0.7;
        if (a2 > 0) {
          ctx.save();
          ctx.globalAlpha = a2;
          ctx.beginPath();
          ctx.arc(x, y, r2, 0, Math.PI * 2);
          ctx.strokeStyle = gold;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
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
  size: number = BOARD_SIZE,
): Animation {
  const { stoneRadius, toScreen } = geom(size);
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
