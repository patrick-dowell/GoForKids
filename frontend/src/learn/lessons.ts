import { Color, type Point, pointToIndex, MoveResult } from '../engine/types';
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

/** Lesson types:
 *  - 'puzzle'        : hand-built one-board puzzle with stone placement
 *  - 'game'          : launches a real game vs the bot (kind:'game' lessons)
 *  - 'quiz'          : sequential multiple-choice questions over a series of mini-boards
 *  - 'puzzle-series' : sequential one-move puzzles, each with its own mini-board
 */
export type LessonKind = 'puzzle' | 'game' | 'quiz' | 'puzzle-series';

/** One sub-puzzle in a kind:'puzzle-series' lesson. Each part is a one-move
 *  puzzle with its own mini-board, validator, and success copy. Optional
 *  afterSuccess plays the opponent's response to the user's move (e.g. to
 *  demonstrate that an attack failed because the defender lives). */
export interface PuzzlePart {
  /** Top-of-board prompt for this part. */
  prompt: string;
  boardSize: number;
  initialStones: Array<{ row: number; col: number; color: Color }>;
  /** Color the user plays in this part. */
  userPlays: Color;
  highlight?: Point[];
  defaultShowHint?: boolean;
  validate: (args: { board: Board; point: Point; capturedCount: number }) => LessonVerdict;
  /** Optional illegal-move success path (e.g. demonstrating suicide in a 2-eye shape). */
  validateIllegal?: (args: { point: Point; result: MoveResult }) => LessonVerdict;
  successMessage: string;
  successExplanation?: string;
  retryMessage: string;
  /** Auto-placement after the user's correct move — used to demonstrate
   *  the opponent's reply (e.g. defender splitting the eye-space). */
  afterSuccess?: AfterSuccess;
  /** Override for `afterSuccess.point` — receives the user's just-played move
   *  and returns the auto-placement point. Lets the defender's response
   *  adapt to where the user attacked (e.g. Two Eyes Part 3). */
  responseFor?: (userMove: Point) => Point;
  /** Optional sequence of moves played in the BACKGROUND after the user's
   *  successful move (and after the part's success modal has popped up).
   *  Plays on the board so the player can watch the capture sequence
   *  resolve while reading the modal. Each move's `delayMs` is relative to
   *  the previous move's completion. Cancelled if the player advances. */
  playoutAfter?: Array<{
    color: Color;
    point: Point;
    delayMs: number;
  }>;
  /** Trigger for the "two-eyes safe" triumphant sound effect.
   *   - 'success'        : fire right after the user's correct move (e.g.
   *                        Two Eyes Part 1: player's vital point makes 2 eyes).
   *   - 'after-response' : fire after `afterSuccess` plays out (e.g. Two
   *                        Eyes Part 3: white's reply forms the 2 eyes). */
  triumphSound?: 'success' | 'after-response';
  /** Override of the celebration text shown during the brief 'animating'
   *  phase between the user's move and the auto-placement. Defaults to
   *  successMessage / successExplanation. */
  interimSuccessMessage?: string;
  interimSuccessExplanation?: string;
  /** Highlight points to show AFTER the auto-placement fires — used to
   *  visually mark eye-regions (or other key cells) once the demo resolves.
   *  Falls back to `highlight` if not set. */
  successHighlight?: Point[];
}

/** One question in a kind:'quiz' lesson. Each question has its own mini-board. */
export interface QuizQuestion {
  /** Top-of-board prompt for this question. */
  prompt: string;
  /** Mini-board the question is asked on. */
  boardSize: number;
  initialStones: Array<{ row: number; col: number; color: Color }>;
  /** Optional intersections to glow (used by lesson 9 to mark territory). */
  highlight?: Point[];
  /** Two-to-four answer choices. Exactly one should be marked correct. */
  answers: { label: string; correct: boolean }[];
  /** Shown in the feedback modal when the player picks the correct answer. */
  successMessage: string;
  /** Shown in the feedback modal when the player picks a wrong answer.
   *  Lesson still advances — quizzes are a streak, not a fail-state. */
  failMessage?: string;
  /** Optional demonstration move played automatically when the player picks
   *  the correct answer. Used by Safe or Gone's "Gone" questions to show
   *  the actual capture (stone placement + capture sound) before the
   *  success modal pops up. The move is played as Black; it must result in
   *  at least one capture for the demonstration to fire. */
  killMove?: Point;
  /** When true, plays the triumphant "two-eyes safe" sound effect on a
   *  correct answer. Used by Safe or Gone's two-eye Safe question. */
  triumphSound?: boolean;
}

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
  /** Big headline shown above the Mission/UI bullets on the pre-game card.
   *  Defaults to "First Battle Time!" for the first-battle lesson. */
  preGameHeadline?: string;
  /** Optional sentence shown under the headline for context. */
  preGameSubline?: string;
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
  /** Called when the user attempts an *illegal* move (suicide / occupied / ko).
   *  Lets a lesson treat illegal moves as the lesson's success condition —
   *  used by Safe Eyes to demonstrate that filling an eye is impossible. */
  validateIllegal?: (args: { point: Point; result: MoveResult }) => LessonVerdict;
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
  /** Quiz lessons only: ordered list of questions. */
  questions?: QuizQuestion[];
  /** Quiz lessons only: optional summary line shown in the final completion
   *  modal (e.g. "Black wins by 5 points!"). Defaults to the per-question
   *  count if omitted. */
  quizSummary?: string;
  /** Puzzle-series lessons only: ordered list of one-move sub-puzzles. */
  parts?: PuzzlePart[];
  /** When true, the success modal shows a "Try another move" button alongside
   *  Continue. The lesson stays complete; the board is reset so the player can
   *  explore alternate moves. Useful for `validateIllegal` lessons where
   *  multiple equivalent moves (e.g. either eye) reveal the same rule. */
  exploreAfterSuccess?: boolean;
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
    title: 'Capture One Stone',
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
    gameConfig: {
      boardSize: 5,
      opponentRank: '30k',
      preGameHeadline: 'First Battle Time!',
    },
  },

  // ---------------------------------------------------------------------------
  // Lesson 6 — Capture Race (9x9 semeai, multi-step)
  // Two interlocked center groups, each with exactly 2 liberties; corner walls
  // (4+ libs each) frame the fight without participating.
  //     . . . . . . . . .
  //     . . . . . . . . .
  //     . . . . . . . . .
  //     . . . W W B B . .   <- top wall
  //     . . . . B W . . .   <- Black B {(4,4),(5,4)} libs (4,3)(5,3)
  //     . . . . B W . . .   <- White {(4,5),(5,5)} libs (4,6)(5,6)
  //     . . . W W B B . .   <- bottom wall
  //     . . . . . . . . .
  //     . . . . . . . . .
  // Black to move. Path: take one of white's libs (4,6) or (5,6), White
  // auto-plays (4,3) reducing Black to 1 lib, then Black plays the remaining
  // white liberty to capture both white stones before being captured back.
  // ---------------------------------------------------------------------------
  {
    id: 'capture-race-9x9',
    title: 'Capture Race',
    instruction: "Both groups have only 2 breathing spaces left — take one of White's away!",
    boardSize: 9,
    initialStones: [
      // Black — top wall, center column, bottom wall
      { row: 3, col: 5, color: Color.Black },
      { row: 3, col: 6, color: Color.Black },
      { row: 4, col: 4, color: Color.Black },
      { row: 5, col: 4, color: Color.Black },
      { row: 6, col: 5, color: Color.Black },
      { row: 6, col: 6, color: Color.Black },
      // White — top wall, center column, bottom wall
      { row: 3, col: 3, color: Color.White },
      { row: 3, col: 4, color: Color.White },
      { row: 4, col: 5, color: Color.White },
      { row: 5, col: 5, color: Color.White },
      { row: 6, col: 3, color: Color.White },
      { row: 6, col: 4, color: Color.White },
    ],
    userPlays: Color.Black,
    highlight: [{ row: 4, col: 6 }, { row: 5, col: 6 }],
    // Step 1: Black must remove one of White's two breathing spaces.
    validate: ({ point }) => {
      const targets = [{ row: 4, col: 6 }, { row: 5, col: 6 }];
      return targets.some((t) => t.row === point.row && t.col === point.col) ? 'success' : 'retry';
    },
    interimSuccessMessage: 'One down!',
    interimSuccessExplanation: "White is down to one breathing space — but it's White's turn next.",
    successMessage: 'You won the race!',
    successExplanation: "Two groups, both running out of room. Whoever fills the other's last spot first wins. Players call this a capture race.",
    retryMessage: "Almost! Look for a spot that takes one of White's breathing spaces away.",
    afterSuccess: {
      color: Color.White,
      point: { row: 4, col: 3 },
      delayMs: 2500,
      followUpMessage: 'White is racing back — now your group is down to one breathing space too. Capture White before White captures you!',
    },
    secondTurn: {
      // Step 2: capture White's group by playing its remaining liberty.
      validate: ({ capturedCount }) => (capturedCount >= 1 ? 'success' : 'retry'),
      retryMessage: "Find White's last breathing space — that's the capture.",
    },
  },

  // ---------------------------------------------------------------------------
  // Lesson 7 — One Eye Isn't Enough (9x9 capture by filling the last liberty)
  // White ring fully surrounded by black, single empty interior at (4,4) —
  // that's white's ONLY liberty. Black plays the eye = white captured.
  // Sets up the contrast for lesson 8 (same shape with two eyes = uncapturable).
  //     . . . . . . . . .
  //     . . . . . . . . .
  //     . . B B B B B . .
  //     . . B W W W B . .
  //     . . B W . W B . .   <- (4,4) is white's last liberty
  //     . . B W W W B . .
  //     . . B B B B B . .
  //     . . . . . . . . .
  //     . . . . . . . . .
  // ---------------------------------------------------------------------------
  {
    id: 'capture-the-eye',
    title: "One Eye Isn't Enough",
    instruction: "White has only one empty spot left — fill it to capture the whole group!",
    boardSize: 9,
    initialStones: [
      // Black surround
      { row: 2, col: 2, color: Color.Black },
      { row: 2, col: 3, color: Color.Black },
      { row: 2, col: 4, color: Color.Black },
      { row: 2, col: 5, color: Color.Black },
      { row: 2, col: 6, color: Color.Black },
      { row: 3, col: 2, color: Color.Black },
      { row: 3, col: 6, color: Color.Black },
      { row: 4, col: 2, color: Color.Black },
      { row: 4, col: 6, color: Color.Black },
      { row: 5, col: 2, color: Color.Black },
      { row: 5, col: 6, color: Color.Black },
      { row: 6, col: 2, color: Color.Black },
      { row: 6, col: 3, color: Color.Black },
      { row: 6, col: 4, color: Color.Black },
      { row: 6, col: 5, color: Color.Black },
      { row: 6, col: 6, color: Color.Black },
      // White ring with single eye at (4,4)
      { row: 3, col: 3, color: Color.White },
      { row: 3, col: 4, color: Color.White },
      { row: 3, col: 5, color: Color.White },
      { row: 4, col: 3, color: Color.White },
      { row: 4, col: 5, color: Color.White },
      { row: 5, col: 3, color: Color.White },
      { row: 5, col: 4, color: Color.White },
      { row: 5, col: 5, color: Color.White },
    ],
    userPlays: Color.Black,
    highlight: [{ row: 4, col: 4 }],
    defaultShowHint: true,
    validate: ({ capturedCount }) => (capturedCount >= 1 ? 'success' : 'retry'),
    successMessage: 'Whole group gone!',
    successExplanation: "White had only one empty spot left — its last breathing space. Fill it and the entire group disappears.",
    retryMessage: "Click the empty spot inside the white ring.",
  },

  // ---------------------------------------------------------------------------
  // Lesson 8 — Two Eyes = Forever Safe (9x9 uncapturable shape)
  // Same setup as lesson 7 but now white has a wider shape with TWO eyes at
  // (4,3) and (4,5). Filling one eye doesn't capture — the OTHER eye is still
  // a liberty — so the black play is suicide and the engine refuses it.
  // We catch the suicide attempt via validateIllegal as the lesson's success.
  //     . . . . . . . . .
  //     . . . . . . . . .
  //     . B B B B B B B .
  //     . B W W W W W B .
  //     . B W . W . W B .   <- eyes at (4,3) and (4,5)
  //     . B W W W W W B .
  //     . B B B B B B B .
  //     . . . . . . . . .
  //     . . . . . . . . .
  // ---------------------------------------------------------------------------
  {
    id: 'two-eyes-uncapturable',
    title: 'Two Eyes = Forever Safe',
    instruction: "Now White has TWO empty spots inside. Try to capture — click in either one!",
    boardSize: 9,
    initialStones: [
      // Black surround
      { row: 2, col: 1, color: Color.Black },
      { row: 2, col: 2, color: Color.Black },
      { row: 2, col: 3, color: Color.Black },
      { row: 2, col: 4, color: Color.Black },
      { row: 2, col: 5, color: Color.Black },
      { row: 2, col: 6, color: Color.Black },
      { row: 2, col: 7, color: Color.Black },
      { row: 3, col: 1, color: Color.Black },
      { row: 3, col: 7, color: Color.Black },
      { row: 4, col: 1, color: Color.Black },
      { row: 4, col: 7, color: Color.Black },
      { row: 5, col: 1, color: Color.Black },
      { row: 5, col: 7, color: Color.Black },
      { row: 6, col: 1, color: Color.Black },
      { row: 6, col: 2, color: Color.Black },
      { row: 6, col: 3, color: Color.Black },
      { row: 6, col: 4, color: Color.Black },
      { row: 6, col: 5, color: Color.Black },
      { row: 6, col: 6, color: Color.Black },
      { row: 6, col: 7, color: Color.Black },
      // White rabbity-six with eyes at (4,3) and (4,5)
      { row: 3, col: 2, color: Color.White },
      { row: 3, col: 3, color: Color.White },
      { row: 3, col: 4, color: Color.White },
      { row: 3, col: 5, color: Color.White },
      { row: 3, col: 6, color: Color.White },
      { row: 4, col: 2, color: Color.White },
      { row: 4, col: 4, color: Color.White },
      { row: 4, col: 6, color: Color.White },
      { row: 5, col: 2, color: Color.White },
      { row: 5, col: 3, color: Color.White },
      { row: 5, col: 4, color: Color.White },
      { row: 5, col: 5, color: Color.White },
      { row: 5, col: 6, color: Color.White },
    ],
    userPlays: Color.Black,
    highlight: [{ row: 4, col: 3 }, { row: 4, col: 5 }],
    defaultShowHint: true,
    // Any LEGAL move is wrong (filling an eye is suicide, handled below).
    validate: () => 'retry',
    validateIllegal: ({ point, result }) => {
      if (result !== MoveResult.Suicide) return 'retry';
      const eyes = [{ row: 4, col: 3 }, { row: 4, col: 5 }];
      return eyes.some((e) => e.row === point.row && e.col === point.col) ? 'success' : 'retry';
    },
    successMessage: "You can't! Two eyes = forever safe.",
    successExplanation: "Filling one eye doesn't capture White — the OTHER eye is still a breathing space. So your stone has no breathing room and instantly disappears. Two eyes means the group can NEVER be captured.",
    retryMessage: "Try clicking inside one of White's empty spots — see what happens!",
    exploreAfterSuccess: true,
  },

  // ---------------------------------------------------------------------------
  // Lesson 9 — Alive or Gone? (3-question life/death quiz)
  // Three small white shapes. Player taps Safe / Gone for each. Two eyes =
  // safe, anything less = gone. Reinforces the concept from lessons 7 + 8.
  // ---------------------------------------------------------------------------
  {
    id: 'safe-or-gone',
    kind: 'quiz',
    title: 'Safe or Gone?',
    instruction: 'Look at the white group. Two eyes means safe. Anything less means gone!',
    successMessage: 'Eye-spotter!',
    successExplanation: "Two eyes = the group lives forever. One eye or none = the opponent can capture it. That's the heart of life and death in Go.",
    questions: [
      // Q1 — two-eye safe shape, fully walled in by black on the south.
      // White is enclosed on three sides by the board edge + south by black.
      {
        prompt: 'Is this white group SAFE or GONE?',
        boardSize: 5,
        initialStones: [
          { row: 0, col: 0, color: Color.White },
          { row: 0, col: 1, color: Color.White },
          { row: 0, col: 2, color: Color.White },
          { row: 0, col: 3, color: Color.White },
          { row: 0, col: 4, color: Color.White },
          { row: 1, col: 0, color: Color.White },
          { row: 1, col: 2, color: Color.White },
          { row: 1, col: 4, color: Color.White },
          { row: 2, col: 0, color: Color.White },
          { row: 2, col: 1, color: Color.White },
          { row: 2, col: 2, color: Color.White },
          { row: 2, col: 3, color: Color.White },
          { row: 2, col: 4, color: Color.White },
          // Black wall along board row 2 (engine row 3) — fully encloses White.
          { row: 3, col: 0, color: Color.Black },
          { row: 3, col: 1, color: Color.Black },
          { row: 3, col: 2, color: Color.Black },
          { row: 3, col: 3, color: Color.Black },
          { row: 3, col: 4, color: Color.Black },
        ],
        answers: [
          { label: 'Safe', correct: true },
          { label: 'Gone', correct: false },
        ],
        successMessage: 'Yes — two eyes means safe forever!',
        failMessage: 'Look again — there are TWO empty spots fully inside the group. That makes it safe.',
        triumphSound: true,
      },
      // Q2 — single-eye small ring (Gone), fully surrounded by black so the
      // ring's only liberty is the central eye.
      {
        prompt: 'Is this white group SAFE or GONE?',
        boardSize: 5,
        initialStones: [
          { row: 1, col: 1, color: Color.White },
          { row: 1, col: 2, color: Color.White },
          { row: 1, col: 3, color: Color.White },
          { row: 2, col: 1, color: Color.White },
          { row: 2, col: 3, color: Color.White },
          { row: 3, col: 1, color: Color.White },
          { row: 3, col: 2, color: Color.White },
          { row: 3, col: 3, color: Color.White },
          // Black surround
          { row: 0, col: 1, color: Color.Black },
          { row: 0, col: 2, color: Color.Black },
          { row: 0, col: 3, color: Color.Black },
          { row: 1, col: 0, color: Color.Black },
          { row: 1, col: 4, color: Color.Black },
          { row: 2, col: 0, color: Color.Black },
          { row: 2, col: 4, color: Color.Black },
          { row: 3, col: 0, color: Color.Black },
          { row: 3, col: 4, color: Color.Black },
          { row: 4, col: 1, color: Color.Black },
          { row: 4, col: 2, color: Color.Black },
          { row: 4, col: 3, color: Color.Black },
        ],
        answers: [
          { label: 'Safe', correct: false },
          { label: 'Gone', correct: true },
        ],
        successMessage: "Right! Only ONE eye — opponent can surround and capture.",
        failMessage: "Look again — there's only ONE empty spot inside. One eye isn't enough.",
        // Black plays the eye (the ring's only liberty) → captures all 8 white stones.
        killMove: { row: 2, col: 2 },
      },
      // Q3 — small T-shape with no eye potential (Gone). Surrounded by black
      // except for one remaining liberty at (1,3) — group is in atari and has
      // no eye-making space, so it's doomed regardless.
      {
        prompt: 'Is this white group SAFE or GONE?',
        boardSize: 5,
        initialStones: [
          { row: 1, col: 2, color: Color.White },
          { row: 2, col: 1, color: Color.White },
          { row: 2, col: 2, color: Color.White },
          { row: 3, col: 2, color: Color.White },
          // Black surround — leaves (1,3) as White's only liberty.
          { row: 0, col: 2, color: Color.Black },
          { row: 1, col: 1, color: Color.Black },
          { row: 2, col: 0, color: Color.Black },
          { row: 2, col: 3, color: Color.Black },
          { row: 3, col: 1, color: Color.Black },
          { row: 3, col: 3, color: Color.Black },
          { row: 4, col: 2, color: Color.Black },
        ],
        answers: [
          { label: 'Safe', correct: false },
          { label: 'Gone', correct: true },
        ],
        successMessage: 'Yep — no eyes at all. This shape is doomed.',
        failMessage: "Nope — there are no enclosed empty spots. Without eyes, the group can't survive.",
        // Black plays the only remaining liberty (1,3) → captures all 4 white stones.
        killMove: { row: 1, col: 3 },
      },
    ],
    retryMessage: 'Try a different answer!',
  },

  // ---------------------------------------------------------------------------
  // Lesson 10 — Two Eyes (3-part puzzle series)
  // Three sub-puzzles on the same theme. All on 9x9.
  //   Part 1: Make Life — White ring with 1x3 internal eye-space, Black
  //     surround. Player plays White at the vital point E4, splitting the
  //     internal into two real eyes.
  //   Part 2: Take Life — same board, player plays Black at the vital point
  //     instead, denying White the chance to make two eyes.
  //   Part 3: Too Big to Kill — White ring with 1x4 internal eye-space.
  //     Player attacks at C4 (5,3); White auto-responds at D4 (5,4),
  //     capturing the attacking stone and locking in two real eyes.
  // ---------------------------------------------------------------------------
  {
    id: 'two-eyes-puzzles',
    kind: 'puzzle-series',
    title: 'Two Eyes',
    instruction: 'Three quick puzzles about making and breaking two eyes.',
    successMessage: 'Two-eye master!',
    successExplanation: 'A group with two true eyes can never be captured. Without two eyes, the right move from either side decides life or death.',
    parts: [
      // Part 1 — Make Life. Player as Black plays vital point to make 2 eyes
      // in their own (black) group. White surrounds. Vital point at E7 (3,4).
      {
        prompt: "You're Black. Play the move that gives this group two eyes!",
        boardSize: 9,
        userPlays: Color.Black,
        initialStones: [
          // Black ring (5-wide rectangle) with 1x3 internal at (3,3)(3,4)(3,5)
          { row: 2, col: 2, color: Color.Black },
          { row: 2, col: 3, color: Color.Black },
          { row: 2, col: 4, color: Color.Black },
          { row: 2, col: 5, color: Color.Black },
          { row: 2, col: 6, color: Color.Black },
          { row: 3, col: 2, color: Color.Black },
          { row: 3, col: 6, color: Color.Black },
          { row: 4, col: 2, color: Color.Black },
          { row: 4, col: 3, color: Color.Black },
          { row: 4, col: 4, color: Color.Black },
          { row: 4, col: 5, color: Color.Black },
          { row: 4, col: 6, color: Color.Black },
          // White surround
          { row: 1, col: 2, color: Color.White },
          { row: 1, col: 3, color: Color.White },
          { row: 1, col: 4, color: Color.White },
          { row: 1, col: 5, color: Color.White },
          { row: 1, col: 6, color: Color.White },
          { row: 2, col: 1, color: Color.White },
          { row: 2, col: 7, color: Color.White },
          { row: 3, col: 1, color: Color.White },
          { row: 3, col: 7, color: Color.White },
          { row: 4, col: 1, color: Color.White },
          { row: 4, col: 7, color: Color.White },
          { row: 5, col: 2, color: Color.White },
          { row: 5, col: 3, color: Color.White },
          { row: 5, col: 4, color: Color.White },
          { row: 5, col: 5, color: Color.White },
          { row: 5, col: 6, color: Color.White },
        ],
        highlight: [{ row: 3, col: 4 }],
        defaultShowHint: true,
        validate: ({ point }) =>
          (point.row === 3 && point.col === 4) ? 'success' : 'retry',
        successMessage: 'Two eyes locked in!',
        successExplanation: "Splitting the inside into two separate empty spots makes two true eyes. Your group lives forever now.",
        retryMessage: "Look for the spot in the very middle of your empty space — splitting it makes two eyes.",
        triumphSound: 'success',
      },
      // Part 2 — Take Life. Mirror of Part 1's geometry (5-wide ring, 1x3
      // internal) but with WHITE ring and BLACK surround. Player still Black,
      // takes the vital point to deny White the chance to make two eyes.
      {
        prompt: "Now this is a WHITE group. Take the vital point to stop them from making two eyes!",
        boardSize: 9,
        userPlays: Color.Black,
        initialStones: [
          // White ring (5-wide rectangle) with 1x3 internal at (3,3)(3,4)(3,5)
          { row: 2, col: 2, color: Color.White },
          { row: 2, col: 3, color: Color.White },
          { row: 2, col: 4, color: Color.White },
          { row: 2, col: 5, color: Color.White },
          { row: 2, col: 6, color: Color.White },
          { row: 3, col: 2, color: Color.White },
          { row: 3, col: 6, color: Color.White },
          { row: 4, col: 2, color: Color.White },
          { row: 4, col: 3, color: Color.White },
          { row: 4, col: 4, color: Color.White },
          { row: 4, col: 5, color: Color.White },
          { row: 4, col: 6, color: Color.White },
          // Black surround
          { row: 1, col: 2, color: Color.Black },
          { row: 1, col: 3, color: Color.Black },
          { row: 1, col: 4, color: Color.Black },
          { row: 1, col: 5, color: Color.Black },
          { row: 1, col: 6, color: Color.Black },
          { row: 2, col: 1, color: Color.Black },
          { row: 2, col: 7, color: Color.Black },
          { row: 3, col: 1, color: Color.Black },
          { row: 3, col: 7, color: Color.Black },
          { row: 4, col: 1, color: Color.Black },
          { row: 4, col: 7, color: Color.Black },
          { row: 5, col: 2, color: Color.Black },
          { row: 5, col: 3, color: Color.Black },
          { row: 5, col: 4, color: Color.Black },
          { row: 5, col: 5, color: Color.Black },
          { row: 5, col: 6, color: Color.Black },
        ],
        highlight: [{ row: 3, col: 4 }],
        defaultShowHint: true,
        validate: ({ point }) =>
          (point.row === 3 && point.col === 4) ? 'success' : 'retry',
        successMessage: 'Vital point taken!',
        successExplanation: "With the middle spot blocked, White can't split the inside into two eyes. The whole group is dead.",
        retryMessage: "Same vital point as before — the middle of White's empty space.",
        // Play out the capture sequence in the background while the player
        // reads the modal: White makes a desperate extension, then Black
        // closes the door and removes the whole group.
        playoutAfter: [
          { color: Color.White, point: { row: 3, col: 3 }, delayMs: 900 },
          { color: Color.Black, point: { row: 3, col: 5 }, delayMs: 900 },
        ],
      },
      // Part 3 — Too Big to Kill. White ring with 1x4 internal at row 3.
      // Player can attack any of the 4 empty spots; White auto-responds with
      // an inner cell chosen via responseFor (opposite parity to user's col)
      // so that the defender always has space for two eye-regions. After the
      // exchange the post-success highlight points at the two outer empties
      // (3,3) and (3,6), which are the eye-regions in every attack scenario.
      {
        prompt: "Now try to kill THIS group. Attack any of the empty spots inside!",
        boardSize: 9,
        userPlays: Color.Black,
        initialStones: [
          // White ring with 1x4 internal at (3,3)(3,4)(3,5)(3,6)
          { row: 2, col: 2, color: Color.White },
          { row: 2, col: 3, color: Color.White },
          { row: 2, col: 4, color: Color.White },
          { row: 2, col: 5, color: Color.White },
          { row: 2, col: 6, color: Color.White },
          { row: 2, col: 7, color: Color.White },
          { row: 3, col: 2, color: Color.White },
          { row: 3, col: 7, color: Color.White },
          { row: 4, col: 2, color: Color.White },
          { row: 4, col: 3, color: Color.White },
          { row: 4, col: 4, color: Color.White },
          { row: 4, col: 5, color: Color.White },
          { row: 4, col: 6, color: Color.White },
          { row: 4, col: 7, color: Color.White },
          // Black surround
          { row: 1, col: 1, color: Color.Black },
          { row: 1, col: 2, color: Color.Black },
          { row: 1, col: 3, color: Color.Black },
          { row: 1, col: 4, color: Color.Black },
          { row: 1, col: 5, color: Color.Black },
          { row: 1, col: 6, color: Color.Black },
          { row: 1, col: 7, color: Color.Black },
          { row: 1, col: 8, color: Color.Black },
          { row: 2, col: 1, color: Color.Black },
          { row: 2, col: 8, color: Color.Black },
          { row: 3, col: 1, color: Color.Black },
          { row: 3, col: 8, color: Color.Black },
          { row: 4, col: 1, color: Color.Black },
          { row: 4, col: 8, color: Color.Black },
          { row: 5, col: 1, color: Color.Black },
          { row: 5, col: 2, color: Color.Black },
          { row: 5, col: 3, color: Color.Black },
          { row: 5, col: 4, color: Color.Black },
          { row: 5, col: 5, color: Color.Black },
          { row: 5, col: 6, color: Color.Black },
          { row: 5, col: 7, color: Color.Black },
          { row: 5, col: 8, color: Color.Black },
        ],
        // No highlight — the player has to find an attack on their own.
        defaultShowHint: false,
        validate: ({ point }) => {
          const targets = [3, 4, 5, 6];
          return point.row === 3 && targets.includes(point.col) ? 'success' : 'retry';
        },
        interimSuccessMessage: 'Attack played!',
        interimSuccessExplanation: "Watch what White does next.",
        successMessage: "Couldn't kill it!",
        successExplanation: "Four empty spots inside gives White enough room to split into two eye-regions, no matter where you attacked. Big groups like this can't be killed.",
        retryMessage: "Click any of the empty spots inside the white group.",
        afterSuccess: {
          color: Color.White,
          // point is overridden by responseFor below — but we still need a
          // sensible fallback for type-safety. (5,4 wouldn't work post-shift,
          // pick (3,4) which is one of the inner cells.)
          point: { row: 3, col: 4 },
          delayMs: 2500,
          followUpMessage: "White splits the inside — and now there's room for two separate eye-regions.",
        },
        // White plays the inner cell of opposite parity to the user's column.
        // Attack at col 3 (odd) → response col 4. Attack col 4 → col 5.
        // Attack col 5 (odd) → col 4. Attack col 6 → col 5.
        // This keeps the response legal (never collides with user's stone)
        // and consistently leaves (3,3) and (3,6) as the two eye-regions.
        responseFor: (userMove) => ({
          row: 3,
          col: userMove.col % 2 === 1 ? 4 : 5,
        }),
        // The two outer empties — (3,3) and (3,6) — are always the
        // eye-regions after the exchange, regardless of where Black attacked.
        successHighlight: [
          { row: 3, col: 3 },
          { row: 3, col: 6 },
        ],
        triumphSound: 'after-response',
      },
    ],
    retryMessage: 'Try the highlighted spot.',
  },

  // ---------------------------------------------------------------------------
  // Lesson 11 — Count Your Land (2-question territory quiz)
  // A finished 5x5 position with a clean horizontal split. Black walls row 2,
  // White walls row 3. Each side's territory is highlighted in turn so the
  // player can count by sight.
  //   . . . . .   <- 5 spots: black territory (row 0)
  //   . . . . .   <- 5 spots: black territory (row 1)
  //   B B B B B
  //   W W W W W
  //   . . . . .   <- 5 spots: white territory (row 4)
  // Black surrounds 10 empty points, White surrounds 5. Black wins by 5.
  // ---------------------------------------------------------------------------
  {
    id: 'count-your-land',
    kind: 'quiz',
    title: 'Count Your Land',
    instruction: 'At the end, your surrounded empty spots count as points. Count them up!',
    successMessage: 'Black wins by 5 points!',
    successExplanation: 'Black surrounded 10 empty spots; White surrounded 5. The bigger your area, the more points you score.',
    questions: [
      // Q1 — count black's territory (10 spots).
      {
        prompt: "How many spots does Black surround?",
        boardSize: 5,
        initialStones: [
          { row: 2, col: 0, color: Color.Black },
          { row: 2, col: 1, color: Color.Black },
          { row: 2, col: 2, color: Color.Black },
          { row: 2, col: 3, color: Color.Black },
          { row: 2, col: 4, color: Color.Black },
          { row: 3, col: 0, color: Color.White },
          { row: 3, col: 1, color: Color.White },
          { row: 3, col: 2, color: Color.White },
          { row: 3, col: 3, color: Color.White },
          { row: 3, col: 4, color: Color.White },
        ],
        // All ten empty spots above the black wall.
        highlight: [
          { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 },
          { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 },
        ],
        answers: [
          { label: '5', correct: false },
          { label: '10', correct: true },
          { label: '15', correct: false },
        ],
        successMessage: 'Black has 10 spots!',
        failMessage: 'Count again — the glowing spots above the black wall are all Black\u2019s. There are 10.',
      },
      // Q2 — count white's territory (5 spots).
      {
        prompt: "How many spots does White surround?",
        boardSize: 5,
        initialStones: [
          { row: 2, col: 0, color: Color.Black },
          { row: 2, col: 1, color: Color.Black },
          { row: 2, col: 2, color: Color.Black },
          { row: 2, col: 3, color: Color.Black },
          { row: 2, col: 4, color: Color.Black },
          { row: 3, col: 0, color: Color.White },
          { row: 3, col: 1, color: Color.White },
          { row: 3, col: 2, color: Color.White },
          { row: 3, col: 3, color: Color.White },
          { row: 3, col: 4, color: Color.White },
        ],
        highlight: [
          { row: 4, col: 0 }, { row: 4, col: 1 }, { row: 4, col: 2 }, { row: 4, col: 3 }, { row: 4, col: 4 },
        ],
        answers: [
          { label: '3', correct: false },
          { label: '5', correct: true },
          { label: '7', correct: false },
        ],
        successMessage: 'White has 5 spots!',
        failMessage: 'Count again — the glowing spots below the white wall are White\u2019s. There are 5.',
      },
    ],
    quizSummary: '10 (Black) − 5 (White) = Black wins by 5!',
    retryMessage: 'Try a different answer!',
  },

  // ---------------------------------------------------------------------------
  // Lesson 12 — Big Board Time (live 9x9 game vs the friendliest bot)
  // The "graduation" game. Same opponent (30k Seedling), same Black-vs-White
  // setup, just a bigger board. We reuse the existing pre-game card with
  // 9x9-flavored copy.
  // ---------------------------------------------------------------------------
  {
    id: 'big-board-time',
    kind: 'game',
    title: 'Big Board Time',
    instruction: "You're ready for the bigger 9×9 board. Same rules — just more room to play!",
    gameConfig: {
      boardSize: 9,
      opponentRank: '30k',
      preGameHeadline: 'Big Board Time!',
      preGameSubline: 'Same rules, bigger battlefield. Aim for the corners — they\'re easiest to live in.',
    },
  },
];
