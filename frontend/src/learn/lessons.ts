import { Color, type Point, pointToIndex } from '../engine/types';
import type { Board } from '../engine/Board';

/** Verdict returned by a lesson's validator when the user makes a (legal) move. */
export type LessonVerdict = 'success' | 'retry';

export interface AfterSuccess {
  /** Stone that the system places automatically once the user succeeds. */
  color: Color;
  point: Point;
  /** ms to wait before placing it (so the user can read the success message). */
  delayMs: number;
  /** Message shown after the auto-placement lands. */
  followUpMessage: string;
}

/** Marks lesson types: a hand-built puzzle vs a live game against the bot. */
export type LessonKind = 'puzzle' | 'game';

export interface SecondTurn {
  /** Top instruction for the second move. Defaults to whatever message is showing. */
  instruction?: string;
  /** Optional validator. Defaults to "any legal move ok" (used by Lesson 1's free placement). */
  validate?: (args: { board: Board; point: Point; capturedCount: number }) => LessonVerdict;
  /** Shown when validate fails. Defaults to lesson.retryMessage. */
  retryMessage?: string;
}

export interface GameConfig {
  boardSize: number;
  /** Bot rank string used by the backend (matches gameStore's targetRank). */
  opponentRank: string;
}

export interface Lesson {
  id: string;
  /** Hand-built puzzle (default) vs a live game against the bot. */
  kind?: LessonKind;
  title: string;
  /** Top-of-screen prompt. Kept short — one sentence ideally. */
  instruction: string;
  /** Puzzle-only: board state. Game lessons skip these. */
  boardSize?: number;
  initialStones?: Array<{ row: number; col: number; color: Color }>;
  /** Color the user plays in this lesson. Most lessons are Black. */
  userPlays?: Color;
  /** Highlighted intersections — drawn as a glow to guide the user (also used as the hint target). */
  highlight?: Point[];
  /** Called after a *legal* move. Decides whether the user solved the puzzle. */
  validate?: (args: {
    board: Board;
    point: Point;
    capturedCount: number;
  }) => LessonVerdict;
  /** Short celebration shown right after the user's correct move. */
  successMessage?: string;
  /** One sentence explaining *why* the move was the right one. Shown below the celebration. */
  successExplanation?: string;
  /** Optional override of the celebration text shown during the brief 'animating'
   *  phase (between user's first move and the system's auto-placement). Defaults
   *  to successMessage / successExplanation. Use this when the first user move is
   *  an intermediate step (e.g. lesson 4) and you don't want to celebrate "done"
   *  prematurely. */
  interimSuccessMessage?: string;
  interimSuccessExplanation?: string;
  retryMessage?: string;
  afterSuccess?: AfterSuccess;
  /** If true, the highlight glow shows from the start (no Hint click needed). */
  defaultShowHint?: boolean;
  /** When set, the user gets a SECOND turn after their first correct move
   *  (and any auto-placement). Lesson 1 uses this for turn-by-turn cadence;
   *  Lesson 4 uses it for a multi-step rescue with a validator on each step. */
  secondTurn?: SecondTurn;
  /** Game lessons only: bot config. */
  gameConfig?: GameConfig;
}

export const LESSONS: Lesson[] = [
  // ---------------------------------------------------------------------------
  // Lesson 1 — Drop Your First Stone
  // Empty 5x5. User taps anywhere to place a black stone. Then we auto-place
  // a white stone to show "players take turns."
  // ---------------------------------------------------------------------------
  {
    id: 'drop-first-stone',
    title: 'Drop Your First Stone',
    instruction: 'Tap the glowing spot to place your first stone.',
    boardSize: 5,
    initialStones: [],
    userPlays: Color.Black,
    highlight: [{ row: 2, col: 2 }],
    validate: () => 'success',
    // Shown right after the FIRST stone (during the brief animating window
    // before White takes its turn).
    interimSuccessMessage: "You're playing Go!",
    interimSuccessExplanation: 'Once you place a stone it stays there — Go is about choosing where to build.',
    // Shown after the SECOND user stone (the lesson's true conclusion).
    successMessage: 'Keep going!',
    successExplanation: 'In Go, each player keeps placing new stones, turn by turn, until the game is over.',
    retryMessage: 'Stones can only be placed on empty spots — try another!',
    afterSuccess: {
      color: Color.White,
      point: { row: 2, col: 3 },
      // 5s gives the user time to read the celebration headline + explanation
      // before White takes its turn.
      delayMs: 5000,
      followUpMessage: 'Now White takes a turn. Your turn again — tap any empty spot!',
    },
    defaultShowHint: true,
    secondTurn: {},  // any legal move ok — just feel the cadence
  },

  // ---------------------------------------------------------------------------
  // Lesson 2 — Trap One Stone
  // White stone with one liberty. User plays Black on that liberty to capture.
  //   . . . . .
  //   . B . . .
  //   B W . . .       (B at (1,1) and (2,0) and (2,2); W at (2,1))
  //   . B . . .       (B at (3,1) is the LAST liberty — user fills it? no, wait)
  // Re-design: put white at (2,2) with three black neighbors and one open liberty.
  //   . . . . .
  //   . . B . .       black (1,2)
  //   . B W B .       black (2,1), white (2,2), black (2,3)
  //   . . . . .       <-- (3,2) is the last liberty
  //   . . . . .
  // User plays Black at (3,2) to capture.
  // ---------------------------------------------------------------------------
  {
    id: 'trap-one-stone',
    title: 'Trap One Stone',
    instruction: 'Fill the last breathing space to capture White!',
    boardSize: 5,
    initialStones: [
      { row: 1, col: 2, color: Color.Black },
      { row: 2, col: 1, color: Color.Black },
      { row: 2, col: 3, color: Color.Black },
      { row: 2, col: 2, color: Color.White },
    ],
    userPlays: Color.Black,
    highlight: [{ row: 3, col: 2 }],
    validate: ({ capturedCount }) => (capturedCount >= 1 ? 'success' : 'retry'),
    successMessage: 'Captured!',
    successExplanation: 'A stone with zero breathing spaces is removed from the board — you keep it as a prisoner.',
    retryMessage: "Almost! Look for the white stone's last breathing space.",
  },

  // ---------------------------------------------------------------------------
  // Lesson 3 — Big Capture
  // Two connected white stones with one shared liberty. User captures both.
  //   . . . . .
  //   . B B . .       black (1,1), (1,2)
  //   B W W B .       black (2,0), white (2,1)(2,2), black (2,3)
  //   . . B . .       black (3,2)  <-- liberty is (3,1)
  //   . . . . .
  // Hmm that gives white liberties at (3,1) only. Let me verify:
  //   white group {(2,1),(2,2)}: neighbors = (1,1)B, (1,2)B, (3,1)?, (3,2)B, (2,0)B, (2,3)B
  //   liberty at (3,1). Yes — playing Black at (3,1) captures both.
  // ---------------------------------------------------------------------------
  {
    id: 'big-capture',
    title: 'Big Capture',
    instruction: 'Capture both white stones in one move!',
    boardSize: 5,
    initialStones: [
      { row: 1, col: 1, color: Color.Black },
      { row: 1, col: 2, color: Color.Black },
      { row: 2, col: 0, color: Color.Black },
      { row: 2, col: 3, color: Color.Black },
      { row: 3, col: 2, color: Color.Black },
      { row: 2, col: 1, color: Color.White },
      { row: 2, col: 2, color: Color.White },
    ],
    userPlays: Color.Black,
    highlight: [{ row: 3, col: 1 }],
    validate: ({ capturedCount }) => (capturedCount >= 2 ? 'success' : 'retry'),
    successMessage: 'Big capture!',
    successExplanation: 'Stones that touch form a group and share breathing spaces — fill the last one and the whole group goes.',
    retryMessage: 'Almost! Look for the spot that traps both stones at once.',
  },

  // ---------------------------------------------------------------------------
  // Lesson 4 — Save Your Team (multi-step rescue with a chasing opponent)
  // White at (2,2) is in atari. User extends to (3,2), saving the group for the
  // moment — but Black auto-plays at (4,2) to chase, putting the group right
  // back in atari. User must extend AGAIN (e.g. to (3,3)) to truly escape.
  // Teaches "your group can keep running" — and that opponents play back.
  //   . . . . .
  //   . . B . .       black (1,2)
  //   . B W B .       black (2,1), white (2,2), black (2,3)
  //   . B . . .       black (3,1)  <-- corner so the escape stays narrow
  //   . . . . .       <-- (4,2) starts EMPTY; Black plays here after move 1
  // Move 1: white at (3,2). Group is now {(2,2),(3,2)} with 2 liberties.
  // Auto-place: black at (4,2). Group is back in atari with only (3,3) free.
  // Move 2: white at (3,3) (or another extension). Group has 2+ liberties — safe.
  // ---------------------------------------------------------------------------
  {
    id: 'save-your-team',
    title: 'Save Your Team',
    instruction: 'Black is trapped! Add a stone to give it more breathing room.',
    boardSize: 5,
    initialStones: [
      // White surrounds; Black is the threatened stone the user is rescuing.
      { row: 1, col: 2, color: Color.White },
      { row: 2, col: 1, color: Color.White },
      { row: 2, col: 3, color: Color.White },
      { row: 3, col: 1, color: Color.White },
      { row: 2, col: 2, color: Color.Black },
    ],
    userPlays: Color.Black,
    highlight: [{ row: 3, col: 2 }],
    // First move — must connect to the threatened black stone and keep at
    // least one liberty (don't suicide). White will then chase, and the
    // secondTurn validator demands the actual escape.
    validate: ({ board, point }) => {
      const threatened: Point = { row: 2, col: 2 };
      if (board.grid[pointToIndex(threatened, board.size)] !== Color.Black) return 'retry';
      const group = board.getGroup(point);
      if (group.length === 0) return 'retry';
      const sameGroup = group.some((s) => s.row === threatened.row && s.col === threatened.col);
      return sameGroup && board.countLiberties(group) >= 1 ? 'success' : 'retry';
    },
    interimSuccessMessage: 'Saved!',
    interimSuccessExplanation: "But watch — White isn't done with you yet.",
    successMessage: 'You really escaped!',
    successExplanation: 'When your group is in danger, keep adding stones to give it more breathing room.',
    retryMessage: 'Almost! Add a stone right next to the trapped black stone.',
    afterSuccess: {
      color: Color.White,
      point: { row: 4, col: 2 },
      delayMs: 2500,
      followUpMessage: 'Your move saved the group, but White is chasing! Extend your group again to find more breathing room.',
    },
    secondTurn: {
      validate: ({ board, point }) => {
        const group = board.getGroup(point);
        if (group.length === 0) return 'retry';
        const sameGroup = group.some((s) => s.row === 2 && s.col === 2);
        return sameGroup && board.countLiberties(group) >= 2 ? 'success' : 'retry';
      },
      retryMessage: 'Try again — your group still needs more breathing space.',
    },
  },

  // ---------------------------------------------------------------------------
  // Lesson 5 — First Battle (live game vs the friendliest bot, on a 5x5 board)
  // ---------------------------------------------------------------------------
  {
    id: 'first-battle',
    kind: 'game',
    title: 'First Battle',
    instruction: 'Time to play your first real game! 5x5 against a friendly bot.',
    gameConfig: { boardSize: 5, opponentRank: '30k' },
  },
];
