/** Core types for the Go game engine */

export const BOARD_SIZE = 19;
export const TOTAL_INTERSECTIONS = BOARD_SIZE * BOARD_SIZE;

export enum Color {
  Empty = 0,
  Black = 1,
  White = 2,
}

export function oppositeColor(c: Color): Color {
  if (c === Color.Black) return Color.White;
  if (c === Color.White) return Color.Black;
  return Color.Empty;
}

/** Board coordinates: row 0..18, col 0..18 (top-left origin) */
export interface Point {
  row: number;
  col: number;
}

/** Encode a point as a single integer for fast set operations */
export function pointToIndex(p: Point): number {
  return p.row * BOARD_SIZE + p.col;
}

export function indexToPoint(i: number): Point {
  return { row: Math.floor(i / BOARD_SIZE), col: i % BOARD_SIZE };
}

export function pointsEqual(a: Point, b: Point): boolean {
  return a.row === b.row && a.col === b.col;
}

export function isValidPoint(p: Point): boolean {
  return p.row >= 0 && p.row < BOARD_SIZE && p.col >= 0 && p.col < BOARD_SIZE;
}

/** Get orthogonal neighbors of a point */
export function neighbors(p: Point): Point[] {
  const result: Point[] = [];
  if (p.row > 0) result.push({ row: p.row - 1, col: p.col });
  if (p.row < BOARD_SIZE - 1) result.push({ row: p.row + 1, col: p.col });
  if (p.col > 0) result.push({ row: p.row, col: p.col - 1 });
  if (p.col < BOARD_SIZE - 1) result.push({ row: p.row, col: p.col + 1 });
  return result;
}

export enum MoveResult {
  Ok = 'ok',
  Occupied = 'occupied',
  Suicide = 'suicide',
  Ko = 'ko',
  GameOver = 'game_over',
}

export interface MoveRecord {
  color: Color;
  point: Point | null; // null = pass
  captures: Point[];
  moveNumber: number;
}

export interface GameResult {
  winner: Color;
  blackScore: number;
  whiteScore: number;
  blackTerritory: number;
  whiteTerritory: number;
  blackCaptures: number;
  whiteCaptures: number;
  komi: number;
}
