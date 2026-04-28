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
 *  - 'puzzle' : hand-built one-board puzzle with stone placement
 *  - 'game'   : launches a real game vs the bot (kind:'game' lessons)
 *  - 'quiz'   : sequential multiple-choice questions over a series of mini-boards
 */
export type LessonKind = 'puzzle' | 'game' | 'quiz';

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
    gameConfig: {
      boardSize: 5,
      opponentRank: '30k',
      preGameHeadline: 'First Battle Time!',
    },
  },

  // ---------------------------------------------------------------------------
  // Lesson 6 — Who Gets Trapped? (capture race / semeai)
  // Black at (1,2) and White at (3,2) are BOTH in atari sharing the same
  // liberty at (2,2). Whoever plays (2,2) first captures the other. Black to
  // move — the lesson teaches "play the capture, not the escape; speed wins
  // the race."
  //   . . W . .
  //   . W B W .   <- Black (1,2) atari, only liberty (2,2)
  //   . . . . .   <- (2,2) shared liberty
  //   . B W B .   <- White (3,2) atari, only liberty (2,2)
  //   . . B . .
  // ---------------------------------------------------------------------------
  {
    id: 'who-gets-trapped',
    title: 'Who Gets Trapped?',
    instruction: 'Black goes first — capture the white stone before it captures you!',
    boardSize: 5,
    initialStones: [
      // Black stones (you)
      { row: 1, col: 2, color: Color.Black },
      { row: 3, col: 1, color: Color.Black },
      { row: 3, col: 3, color: Color.Black },
      { row: 4, col: 2, color: Color.Black },
      // White stones
      { row: 0, col: 2, color: Color.White },
      { row: 1, col: 1, color: Color.White },
      { row: 1, col: 3, color: Color.White },
      { row: 3, col: 2, color: Color.White },
    ],
    userPlays: Color.Black,
    highlight: [{ row: 2, col: 2 }],
    validate: ({ capturedCount }) => (capturedCount >= 1 ? 'success' : 'retry'),
    successMessage: 'Capture race won!',
    successExplanation: "When two groups are both about to be captured, whoever plays first wins. Players call this a capture race.",
    retryMessage: "Almost! Look for the spot that captures White before it captures you.",
  },

  // ---------------------------------------------------------------------------
  // Lesson 7 — Safe Eyes
  // Demonstrates that two true eyes make a group uncapturable. White has a
  // "rabbity-six" shape with two eyes at (1,1) and (1,3). Black plays. Any
  // attempt to fill an eye is a suicide move and is rejected by the engine —
  // we treat the suicide attempt as the lesson's success condition via
  // `validateIllegal`. Other empty squares produce a "try the eyes" nudge.
  //   . W W W .
  //   W . W . W   <- empty cells at (1,1) and (1,3) are eyes
  //   W W W W W
  //   . . . . .
  //   . . . . .
  // ---------------------------------------------------------------------------
  {
    id: 'safe-eyes',
    title: 'Safe Eyes',
    instruction: "White has two empty spots inside. Try to capture this group — click in one of them!",
    boardSize: 5,
    initialStones: [
      { row: 0, col: 1, color: Color.White },
      { row: 0, col: 2, color: Color.White },
      { row: 0, col: 3, color: Color.White },
      { row: 1, col: 0, color: Color.White },
      { row: 1, col: 2, color: Color.White },
      { row: 1, col: 4, color: Color.White },
      { row: 2, col: 0, color: Color.White },
      { row: 2, col: 1, color: Color.White },
      { row: 2, col: 2, color: Color.White },
      { row: 2, col: 3, color: Color.White },
      { row: 2, col: 4, color: Color.White },
    ],
    userPlays: Color.Black,
    highlight: [{ row: 1, col: 1 }, { row: 1, col: 3 }],
    defaultShowHint: true,
    // Any LEGAL move is wrong (the eyes themselves are suicide and so are
    // illegal — those are handled by validateIllegal below).
    validate: () => 'retry',
    validateIllegal: ({ point, result }) => {
      if (result !== MoveResult.Suicide) return 'retry';
      const eyes = [{ row: 1, col: 1 }, { row: 1, col: 3 }];
      return eyes.some((e) => e.row === point.row && e.col === point.col) ? 'success' : 'retry';
    },
    successMessage: 'Two eyes — totally safe!',
    successExplanation: "Each empty spot inside is an 'eye'. You can't fill one — your stone would have no breathing room and instantly disappear. Two eyes means White's group can NEVER be captured.",
    retryMessage: "Try clicking inside one of White's empty spots — see what happens!",
  },

  // ---------------------------------------------------------------------------
  // Lesson 8 — Alive or Gone? (3-question life/death quiz)
  // Three small white shapes. Player taps Safe / Gone for each. Two eyes =
  // safe, anything less = gone. Spec: "Quick streak-style lesson."
  // ---------------------------------------------------------------------------
  {
    id: 'alive-or-gone',
    kind: 'quiz',
    title: 'Alive or Gone?',
    instruction: 'Look at the white group. Two eyes means safe. Anything less means gone!',
    successMessage: 'Eye-spotter!',
    successExplanation: "Two eyes = the group lives forever. One eye or none = the opponent can capture it. That's the heart of life and death in Go.",
    questions: [
      // Q1 — two-eye rabbity-six (Safe).
      {
        prompt: 'Is this white group SAFE or GONE?',
        boardSize: 5,
        initialStones: [
          { row: 0, col: 1, color: Color.White },
          { row: 0, col: 2, color: Color.White },
          { row: 0, col: 3, color: Color.White },
          { row: 1, col: 0, color: Color.White },
          { row: 1, col: 2, color: Color.White },
          { row: 1, col: 4, color: Color.White },
          { row: 2, col: 0, color: Color.White },
          { row: 2, col: 1, color: Color.White },
          { row: 2, col: 2, color: Color.White },
          { row: 2, col: 3, color: Color.White },
          { row: 2, col: 4, color: Color.White },
        ],
        answers: [
          { label: 'Safe', correct: true },
          { label: 'Gone', correct: false },
        ],
        successMessage: 'Yes — two eyes means safe forever!',
        failMessage: 'Look again — there are TWO empty spots fully inside the group. That makes it safe.',
      },
      // Q2 — single-eye small ring (Gone).
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
        ],
        answers: [
          { label: 'Safe', correct: false },
          { label: 'Gone', correct: true },
        ],
        successMessage: "Right! Only ONE eye — opponent can surround and capture.",
        failMessage: "Look again — there's only ONE empty spot inside. One eye isn't enough.",
      },
      // Q3 — small T-shape with no eye potential (Gone).
      {
        prompt: 'Is this white group SAFE or GONE?',
        boardSize: 5,
        initialStones: [
          { row: 1, col: 2, color: Color.White },
          { row: 2, col: 1, color: Color.White },
          { row: 2, col: 2, color: Color.White },
          { row: 3, col: 2, color: Color.White },
        ],
        answers: [
          { label: 'Safe', correct: false },
          { label: 'Gone', correct: true },
        ],
        successMessage: 'Yep — no eyes at all. This shape is doomed.',
        failMessage: "Nope — there are no enclosed empty spots. Without eyes, the group can't survive.",
      },
    ],
    retryMessage: 'Try a different answer!',
  },

  // ---------------------------------------------------------------------------
  // Lesson 9 — Count Your Land (2-question territory quiz)
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
  // Lesson 10 — Big Board Time (live 9x9 game vs the friendliest bot)
  // The "graduation" game. Same opponent (30k Seedling), same Black-vs-White
  // setup, just a bigger board. We reuse the existing pre-game card with
  // 9x9-flavored copy.
  // (Lessons 8 and 9 — Alive or Gone? quiz and Count Your Land — are reserved
  // and will be inserted before this one once their mechanics ship.)
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
