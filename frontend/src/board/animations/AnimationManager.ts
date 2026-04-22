/**
 * Animation system for the Go board.
 * Manages timed animations that overlay on the Canvas2D board.
 */

export interface Animation {
  id: string;
  startTime: number;
  duration: number;
  draw: (ctx: CanvasRenderingContext2D, progress: number) => void;
  onComplete?: () => void;
}

export class AnimationManager {
  private animations: Map<string, Animation> = new Map();
  private frameId: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private drawBoard: (() => void) | null = null;

  attach(canvas: HTMLCanvasElement, drawBoard: () => void) {
    this.canvas = canvas;
    this.drawBoard = drawBoard;
  }

  detach() {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.canvas = null;
    this.drawBoard = null;
  }

  add(anim: Omit<Animation, 'startTime'>) {
    this.animations.set(anim.id, {
      ...anim,
      startTime: performance.now(),
    });
    this.startLoop();
  }

  clear() {
    this.animations.clear();
  }

  get isAnimating(): boolean {
    return this.animations.size > 0;
  }

  private startLoop() {
    if (this.frameId !== null) return;
    const tick = () => {
      this.update();
      if (this.animations.size > 0) {
        this.frameId = requestAnimationFrame(tick);
      } else {
        // Final clean base-board draw so any per-frame overlays
        // (e.g. the placement stone drawn at scale=1) don't cover
        // persistent markers like the last-move ring/number.
        if (this.drawBoard) this.drawBoard();
        this.frameId = null;
      }
    };
    this.frameId = requestAnimationFrame(tick);
  }

  private update() {
    if (!this.canvas || !this.drawBoard) return;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    const completed: string[] = [];

    // Redraw the base board (this handles its own DPR scaling)
    this.drawBoard();

    // Draw animation overlays — drawBoard already set the canvas size
    // and scaled the context, so we DON'T scale again here.
    // We just need to save/restore so animations don't leak state.
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    // The canvas was just reset by drawBoard, so we need to re-apply DPR scale
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const [id, anim] of this.animations) {
      const elapsed = now - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);

      anim.draw(ctx, progress);

      if (progress >= 1) {
        completed.push(id);
        anim.onComplete?.();
      }
    }

    ctx.restore();

    for (const id of completed) {
      this.animations.delete(id);
    }
  }
}

// Easing functions
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  const p = 0.3;
  return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
}
