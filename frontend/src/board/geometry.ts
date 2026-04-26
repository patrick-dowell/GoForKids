/**
 * Single source of board geometry — used by the renderer and every animation.
 *
 * Padding scales with board size so that stones at the first line never extend
 * past the board border. Without this, small boards (5x5/7x7) used in lessons
 * have huge cells and stones clip the edge.
 */

export const CANVAS_SIZE = 700;

/**
 * Padding in pixels from the canvas edge to the first/last grid line.
 *
 * Derivation: a stone has radius `cellSize * 0.45`, where
 *   cellSize = (CANVAS_SIZE - 2 * padding) / (size - 1).
 * To keep the first-line stone inside the board surface (with a small margin),
 * we need `padding >= stoneRadius + margin`. Solving for `padding` gives the
 * formula below; we floor at 40 (the original value, which is plenty for 9+).
 */
export function boardPadding(size: number): number {
  // For 5: ~70, 7: ~52, 9: 40, 13/19: 40.
  const margin = 6;
  const ideal = Math.ceil((CANVAS_SIZE * 0.45 + margin * (size - 1)) / (size - 1 + 0.9));
  return Math.max(40, ideal);
}

export function geometry(size: number) {
  const padding = boardPadding(size);
  const boardPixels = CANVAS_SIZE - padding * 2;
  const cellSize = boardPixels / (size - 1);
  return {
    padding,
    cellSize,
    stoneRadius: cellSize * 0.45,
    toScreen: (row: number, col: number) => ({
      x: padding + col * cellSize,
      y: padding + row * cellSize,
    }),
  };
}
