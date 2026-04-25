import {
  BOARD_SIZE,
  Color,
  oppositeColor,
  Point,
  pointToIndex,
  neighbors,
  isValidPoint,
  MoveResult,
} from './types';

/**
 * Core Go board — handles stone placement, captures, ko, and superko.
 * Pure logic, no UI dependencies.
 */
export class Board {
  /** Board dimension (9, 13, or 19). */
  readonly size: number;
  /** Flat grid: index = row * size + col */
  grid: Color[];
  /** Number of stones captured by each side */
  captures: { [Color.Black]: number; [Color.White]: number };
  /** Previous board hash for simple ko (null if no ko) */
  koPoint: Point | null;
  /** Set of all previous board hashes for positional superko */
  private positionHistory: Set<string>;

  constructor(size: number = BOARD_SIZE) {
    this.size = size;
    this.grid = new Array(size * size).fill(Color.Empty);
    this.captures = { [Color.Black]: 0, [Color.White]: 0 };
    this.koPoint = null;
    this.positionHistory = new Set();
    this.positionHistory.add(this.hash());
  }

  /** Deep clone */
  clone(): Board {
    const b = new Board(this.size);
    b.grid = [...this.grid];
    b.captures = { ...this.captures };
    b.koPoint = this.koPoint ? { ...this.koPoint } : null;
    b.positionHistory = new Set(this.positionHistory);
    return b;
  }

  get(p: Point): Color {
    return this.grid[pointToIndex(p, this.size)];
  }

  private set(p: Point, c: Color): void {
    this.grid[pointToIndex(p, this.size)] = c;
  }

  /** Hash the current board state for superko detection */
  hash(): string {
    return this.grid.join('');
  }

  /**
   * Try to play a stone. Returns MoveResult and captured stones.
   * Does NOT mutate if the move is illegal.
   */
  tryPlay(color: Color, point: Point): { result: MoveResult; captures: Point[] } {
    if (!isValidPoint(point, this.size)) {
      return { result: MoveResult.Occupied, captures: [] };
    }

    if (this.get(point) !== Color.Empty) {
      return { result: MoveResult.Occupied, captures: [] };
    }

    // Place the stone tentatively
    const backup = this.clone();
    this.set(point, color);

    // Check for captures of opponent groups
    const opponent = oppositeColor(color);
    const captured: Point[] = [];
    const capturedSet = new Set<number>();
    for (const nb of neighbors(point, this.size)) {
      if (this.get(nb) === opponent && !capturedSet.has(pointToIndex(nb, this.size))) {
        const group = this.getGroup(nb);
        if (this.countLiberties(group) === 0) {
          for (const s of group) {
            const idx = pointToIndex(s, this.size);
            if (!capturedSet.has(idx)) {
              capturedSet.add(idx);
              captured.push(s);
            }
          }
        }
      }
    }

    // Remove captured stones
    for (const cp of captured) {
      this.set(cp, Color.Empty);
    }

    // Check suicide: if our group has no liberties after removing captures
    const ownGroup = this.getGroup(point);
    if (this.countLiberties(ownGroup) === 0) {
      this.grid = backup.grid;
      this.captures = backup.captures;
      this.koPoint = backup.koPoint;
      this.positionHistory = backup.positionHistory;
      return { result: MoveResult.Suicide, captures: [] };
    }

    // Check positional superko
    const newHash = this.hash();
    if (this.positionHistory.has(newHash)) {
      this.grid = backup.grid;
      this.captures = backup.captures;
      this.koPoint = backup.koPoint;
      this.positionHistory = backup.positionHistory;
      return { result: MoveResult.Ko, captures: [] };
    }

    // Move is legal — commit
    this.captures[color] += captured.length;
    this.positionHistory.add(newHash);

    // Simple ko detection: if exactly 1 stone captured and placed stone has exactly 1 liberty
    if (captured.length === 1 && ownGroup.length === 1 && this.countLiberties(ownGroup) === 1) {
      this.koPoint = captured[0];
    } else {
      this.koPoint = null;
    }

    return { result: MoveResult.Ok, captures: captured };
  }

  /** Get all stones in the group containing the stone at p */
  getGroup(p: Point): Point[] {
    const color = this.get(p);
    if (color === Color.Empty) return [];

    const visited = new Set<number>();
    const group: Point[] = [];
    const stack: Point[] = [p];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const idx = pointToIndex(current, this.size);
      if (visited.has(idx)) continue;
      if (this.get(current) !== color) continue;

      visited.add(idx);
      group.push(current);

      for (const nb of neighbors(current, this.size)) {
        if (!visited.has(pointToIndex(nb, this.size))) {
          stack.push(nb);
        }
      }
    }

    return group;
  }

  /** Count liberties of a group (set of points) */
  countLiberties(group: Point[]): number {
    const libertySet = new Set<number>();
    for (const stone of group) {
      for (const nb of neighbors(stone, this.size)) {
        if (this.get(nb) === Color.Empty) {
          libertySet.add(pointToIndex(nb, this.size));
        }
      }
    }
    return libertySet.size;
  }

  /** Get liberty points of a group */
  getLiberties(group: Point[]): Point[] {
    const libertySet = new Set<number>();
    const liberties: Point[] = [];
    for (const stone of group) {
      for (const nb of neighbors(stone, this.size)) {
        const idx = pointToIndex(nb, this.size);
        if (this.get(nb) === Color.Empty && !libertySet.has(idx)) {
          libertySet.add(idx);
          liberties.push(nb);
        }
      }
    }
    return liberties;
  }

  /** Find all groups on the board */
  getAllGroups(): { color: Color; stones: Point[]; liberties: number }[] {
    const visited = new Set<number>();
    const groups: { color: Color; stones: Point[]; liberties: number }[] = [];

    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        const idx = row * this.size + col;
        if (visited.has(idx)) continue;
        const color = this.grid[idx];
        if (color === Color.Empty) continue;

        const group = this.getGroup({ row, col });
        for (const s of group) visited.add(pointToIndex(s, this.size));
        groups.push({
          color,
          stones: group,
          liberties: this.countLiberties(group),
        });
      }
    }

    return groups;
  }

  /**
   * If `color` plays at `point`, would the move connect 2+ separate own-color
   * groups? Returns all stones that would be merged (NOT including the new
   * stone) if so, otherwise an empty array.
   *
   * Call BEFORE `tryPlay` — once the stone is placed, the groups are already
   * one. Used to detect connection events for the merge pulse animation.
   */
  detectMergedGroups(color: Color, point: Point): Point[] {
    const seen = new Set<number>();
    const merged: Point[] = [];
    let groupCount = 0;
    for (const nb of neighbors(point, this.size)) {
      if (this.get(nb) !== color) continue;
      const idx = pointToIndex(nb, this.size);
      if (seen.has(idx)) continue;
      const group = this.getGroup(nb);
      for (const s of group) seen.add(pointToIndex(s, this.size));
      groupCount++;
      merged.push(...group);
    }
    return groupCount >= 2 ? merged : [];
  }

  /** Find all groups in atari (exactly 1 liberty) */
  getAtariGroups(): { color: Color; stones: Point[]; liberty: Point }[] {
    return this.getAllGroups()
      .filter((g) => g.liberties === 1)
      .map((g) => ({
        color: g.color,
        stones: g.stones,
        liberty: this.getLiberties(g.stones)[0],
      }));
  }

  /**
   * Score the board using territory (Japanese-style).
   * Returns territory for each color.
   */
  scoreTerritory(): {
    blackTerritory: Set<number>;
    whiteTerritory: Set<number>;
    neutral: Set<number>;
  } {
    const visited = new Set<number>();
    const blackTerritory = new Set<number>();
    const whiteTerritory = new Set<number>();
    const neutral = new Set<number>();

    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        const idx = row * this.size + col;
        if (visited.has(idx)) continue;
        if (this.grid[idx] !== Color.Empty) continue; // skip stones, don't mark visited

        // Flood fill empty region
        const region: number[] = [];
        const stack: Point[] = [{ row, col }];
        let touchesBlack = false;
        let touchesWhite = false;

        while (stack.length > 0) {
          const current = stack.pop()!;
          const ci = pointToIndex(current, this.size);

          const color = this.get(current);
          if (color === Color.Black) {
            touchesBlack = true;
            continue;
          }
          if (color === Color.White) {
            touchesWhite = true;
            continue;
          }

          if (visited.has(ci)) continue;
          visited.add(ci);
          region.push(ci);

          for (const nb of neighbors(current, this.size)) {
            if (!visited.has(pointToIndex(nb, this.size))) {
              stack.push(nb);
            }
          }
        }

        // Assign territory
        const target =
          touchesBlack && !touchesWhite
            ? blackTerritory
            : !touchesBlack && touchesWhite
              ? whiteTerritory
              : neutral;

        for (const ri of region) {
          target.add(ri);
        }
      }
    }

    return { blackTerritory, whiteTerritory, neutral };
  }

  /** Count stones of each color */
  countStones(): { black: number; white: number } {
    let black = 0;
    let white = 0;
    for (const c of this.grid) {
      if (c === Color.Black) black++;
      else if (c === Color.White) white++;
    }
    return { black, white };
  }

  /** Check if two boards have the same stone positions */
  equals(other: Board): boolean {
    return this.size === other.size && this.hash() === other.hash();
  }
}
