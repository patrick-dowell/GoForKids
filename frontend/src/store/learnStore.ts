import { create } from 'zustand';
import { Board } from '../engine/Board';
import { Color, MoveResult, type Point } from '../engine/types';
import { LESSONS } from '../learn/lessons';
import { playPlaceSound, playCaptureSound, resumeAudio } from '../audio/SoundManager';

const STORAGE_KEY = 'goforkids-learn-progress';

/**
 * Lesson state machine:
 *   awaiting  - waiting for the user to place a stone
 *   animating - user got it right, the auto-follow-up move is mid-delay
 *   success   - lesson complete, "Continue" available
 *   retry     - user made a legal but wrong move; gentle nudge shown
 */
export type LessonStatus = 'awaiting' | 'animating' | 'success' | 'retry';

interface LearnState {
  /** True when the lesson view is mounted/active. Drives GoBoard's source switch. */
  active: boolean;
  lessonIndex: number;
  status: LessonStatus;
  /** Top-of-board prompt (lesson instruction or current narration). */
  message: string;
  /** Below-board feedback ("Captured!", "Almost!"). Null = no feedback yet. */
  feedback: string | null;
  /** When true, the highlight glow is shown on the board. */
  showHint: boolean;
  /** Mutable working board for the current lesson. */
  board: Board | null;
  boardSize: number;
  grid: number[];
  /** Most-recent move on this board, for the placement halo / animation cue. */
  lastMove: Point | null;
  /** Stones captured by the most recent move (for the capture animation). */
  lastCaptures: Point[];
  /** Color of the stone placed at lastMove (needed by the placement animation). */
  lastMoveColor: Color;
  /** Bumps every time *any* lesson stone is placed (user or auto). Animation effect listens to this. */
  moveSeq: number;
  /** Bumps when the user makes a correct lesson move. Triggers the success ring overlay. */
  successSeq: number;
  /** Bumps when the user clicks an occupied intersection. Triggers the "denied" flash. */
  deniedSeq: number;
  /** Point of the most-recent denied click — read by the denied animation. */
  lastDeniedPoint: Point | null;
  /** True when waiting on the user's second move in a `secondTurn` lesson. */
  awaitingSecondMove: boolean;
  /** Lesson IDs the user has finished (persisted to localStorage). */
  completed: Set<string>;
  /** True when the post-puzzle reward overlay should cover the lesson view. */
  showReward: boolean;

  start: () => void;
  exit: () => void;
  startLesson: (index: number) => void;
  tryMove: (point: Point) => void;
  toggleHint: () => void;
  next: () => void;
  retry: () => void;
  dismissReward: () => void;
  /** Mark a lesson complete from outside the lesson loop (e.g. App.tsx when the
   *  game-kind lesson kicks off the real game). Persists + updates the dot. */
  markComplete: (id: string) => void;
  /** During an `afterSuccess` wait, fire the auto-placement immediately so
   *  Continue feels responsive instead of forcing the user to wait out the timer. */
  skipAfterSuccess: () => void;
  /** Internal: handle for the pending auto-place timer (null when nothing pending). */
  _afterSuccessTimer: ReturnType<typeof setTimeout> | null;
  /** Internal: zero-arg fn that runs the auto-placement immediately. Set when a
   *  timer is queued; cleared once it runs (either via the timer or skip). */
  _afterSuccessRun: (() => void) | null;
}

function loadCompleted(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore corrupt storage
  }
  return new Set();
}

function saveCompleted(s: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    // ignore
  }
}

function buildLessonBoard(index: number): Board {
  const lesson = LESSONS[index];
  const size = lesson.boardSize ?? 5;
  const board = new Board(size);
  for (const s of lesson.initialStones ?? []) {
    board.grid[s.row * size + s.col] = s.color;
  }
  return board;
}

/**
 * The first batch of puzzle lessons — completing all of these unlocks the
 * Cosmic Board reward and transitions the player to their first real game.
 */
const PUZZLE_LESSON_IDS = LESSONS.filter((l) => l.kind !== 'game').map((l) => l.id);
function allPuzzlesComplete(completed: Set<string>): boolean {
  return PUZZLE_LESSON_IDS.every((id) => completed.has(id));
}

export const useLearnStore = create<LearnState>((set, get) => ({
  active: false,
  lessonIndex: 0,
  status: 'awaiting',
  message: '',
  feedback: null,
  showHint: false,
  board: null,
  boardSize: 5,
  grid: [],
  lastMove: null,
  lastCaptures: [],
  lastMoveColor: Color.Empty,
  moveSeq: 0,
  successSeq: 0,
  deniedSeq: 0,
  lastDeniedPoint: null,
  awaitingSecondMove: false,
  completed: loadCompleted(),
  showReward: false,
  _afterSuccessTimer: null,
  _afterSuccessRun: null,

  start: () => {
    // Testing mode (no user accounts yet): always start fresh, so every play
    // through gets the full sequence — including the Cosmic Board unlock at
    // the end of lesson 4. Wipe the persisted progress.
    saveCompleted(new Set());
    set({ active: true, completed: new Set(), showReward: false });
    get().startLesson(0);
  },

  exit: () => {
    set({ active: false });
  },

  startLesson: (index: number) => {
    if (index < 0 || index >= LESSONS.length) return;
    // Cancel any pending auto-place timer so it doesn't fire on the new lesson.
    const { _afterSuccessTimer } = get();
    if (_afterSuccessTimer !== null) clearTimeout(_afterSuccessTimer);
    const lesson = LESSONS[index];

    // Game lessons don't have a puzzle board — the player will play a real
    // game launched by the App. Just stash the lesson index + instruction.
    if (lesson.kind === 'game') {
      set({
        lessonIndex: index,
        status: 'awaiting',
        message: lesson.instruction,
        feedback: null,
        showHint: false,
        board: null,
        grid: [],
        lastMove: null,
        lastCaptures: [],
        lastMoveColor: Color.Empty,
        awaitingSecondMove: false,
        _afterSuccessTimer: null,
        _afterSuccessRun: null,
      });
      return;
    }

    const board = buildLessonBoard(index);
    set({
      lessonIndex: index,
      status: 'awaiting',
      message: lesson.instruction,
      feedback: null,
      showHint: !!lesson.defaultShowHint,
      board,
      boardSize: board.size,
      grid: [...board.grid],
      lastMove: null,
      lastCaptures: [],
      lastMoveColor: Color.Empty,
      awaitingSecondMove: false,
      _afterSuccessTimer: null,
      _afterSuccessRun: null,
    });
  },

  tryMove: (point: Point) => {
    resumeAudio();
    const { board, status, awaitingSecondMove } = get();
    if (!board) return;
    // Allow clicks during awaiting OR retry (so a denied click doesn't lock the board).
    if (status !== 'awaiting' && status !== 'retry') return;
    const lesson = LESSONS[get().lessonIndex];
    if (lesson.kind === 'game' || !lesson.userPlays) return;

    // tryPlay mutates — work on a clone, commit only on success.
    const tentative = board.clone();
    const { result, captures } = tentative.tryPlay(lesson.userPlays, point);

    if (result !== MoveResult.Ok) {
      // Illegal move (occupied / suicide / ko). Flash a "denied" cue and show
      // a soft warning, but leave status untouched — this isn't a puzzle-fail
      // worth showing the Reset button for. The user can just click elsewhere.
      const isOccupied = result === MoveResult.Occupied;
      set({
        feedback: isOccupied
          ? "Stones can't be moved — pick an empty spot!"
          : 'Try a different spot!',
        deniedSeq: get().deniedSeq + 1,
        lastDeniedPoint: point,
      });
      return;
    }

    // Pick the validator for this move. On the second user-turn we use the
    // secondTurn's validator if provided, otherwise fall back to "any legal".
    const isSecond = awaitingSecondMove;
    const activeValidate = isSecond
      ? (lesson.secondTurn?.validate ?? (() => 'success' as LessonVerdict))
      : (lesson.validate ?? (() => 'success' as LessonVerdict));
    const activeRetryMessage = isSecond
      ? (lesson.secondTurn?.retryMessage ?? lesson.retryMessage ?? 'Try again!')
      : (lesson.retryMessage ?? 'Try again!');

    const verdict = activeValidate({ board: tentative, point, capturedCount: captures.length });

    if (verdict !== 'success') {
      // Legal but wrong puzzle answer — reset to the lesson's starting position.
      const reset = buildLessonBoard(get().lessonIndex);
      set({
        board: reset,
        grid: [...reset.grid],
        lastMove: null,
        lastCaptures: [],
        lastMoveColor: Color.Empty,
        status: 'retry',
        feedback: activeRetryMessage,
        awaitingSecondMove: false,
      });
      return;
    }

    // Success — commit the move.
    playPlaceSound(point.row, point.col);
    if (captures.length > 0) {
      setTimeout(() => playCaptureSound(captures.length), 100);
    }
    const isLastLesson = get().lessonIndex >= LESSONS.length - 1;
    const completed = new Set(get().completed);
    completed.add(lesson.id);
    saveCompleted(completed);

    // Branch A: this is the SECOND user move of a `secondTurn` lesson.
    // The first user move + auto-placement already happened; this one ends the lesson.
    if (awaitingSecondMove) {
      set({
        board: tentative,
        grid: [...tentative.grid],
        lastMove: point,
        lastCaptures: captures,
        lastMoveColor: lesson.userPlays,
        moveSeq: get().moveSeq + 1,
        successSeq: get().successSeq + 1,
        status: 'success',
        feedback: isLastLesson ? "You've finished the intro!" : null,
        showHint: false,
        awaitingSecondMove: false,
        completed,
      });
      return;
    }

    // Branch B': lesson has a secondTurn but NO auto-placement (Lesson 4).
    // Apply the user's first move and immediately ask for the rescue follow-up.
    if (lesson.secondTurn && !lesson.afterSuccess) {
      set({
        board: tentative,
        grid: [...tentative.grid],
        lastMove: point,
        lastCaptures: captures,
        lastMoveColor: lesson.userPlays,
        moveSeq: get().moveSeq + 1,
        // Don't bump successSeq yet — celebration waits for the second move.
        status: 'awaiting',
        message: lesson.secondTurn.instruction ?? get().message,
        feedback: null,
        showHint: false,
        awaitingSecondMove: true,
        completed,
      });
      return;
    }

    // Branch B: lesson has an `afterSuccess` auto-placement queued.
    if (lesson.afterSuccess) {
      // Apply user's move; queue the auto-placement after a short pause.
      set({
        board: tentative,
        grid: [...tentative.grid],
        lastMove: point,
        lastCaptures: captures,
        lastMoveColor: lesson.userPlays,
        moveSeq: get().moveSeq + 1,
        // No successSeq bump yet — celebration waits for the FINAL user move
        // when the lesson has a secondTurn. Otherwise the auto-place itself
        // is the climax and we'll bump after it lands.
        status: 'animating',
        feedback: null,
        showHint: false,
        completed,
      });
      const after = lesson.afterSuccess;
      const lessonIdxAtStart = get().lessonIndex;
      const runAutoPlace = () => {
        // Bail if the user navigated away or already triggered this.
        const cur = get();
        if (!cur.active || cur.lessonIndex !== lessonIdxAtStart || cur.status !== 'animating') return;
        const nextBoard = cur.board!.clone();
        nextBoard.tryPlay(after.color, after.point);
        playPlaceSound(after.point.row, after.point.col);

        if (lesson.secondTurn) {
          set({
            board: nextBoard,
            grid: [...nextBoard.grid],
            lastMove: after.point,
            lastCaptures: [],
            lastMoveColor: after.color,
            moveSeq: get().moveSeq + 1,
            status: 'awaiting',
            message: after.followUpMessage,
            feedback: null,
            awaitingSecondMove: true,
            _afterSuccessTimer: null,
            _afterSuccessRun: null,
          });
        } else {
          set({
            board: nextBoard,
            grid: [...nextBoard.grid],
            lastMove: after.point,
            lastCaptures: [],
            lastMoveColor: after.color,
            moveSeq: get().moveSeq + 1,
            successSeq: get().successSeq + 1,
            status: 'success',
            message: after.followUpMessage,
            feedback: isLastLesson ? "You've finished the intro!" : null,
            _afterSuccessTimer: null,
            _afterSuccessRun: null,
          });
        }
      };
      // Step modal is now in charge — its Continue button will call
      // skipAfterSuccess() to fire the auto-placement. No timer.
      set({ _afterSuccessTimer: null, _afterSuccessRun: runAutoPlace });
      return;
    }

    // Branch C: ordinary puzzle lesson — user's move is the final move.
    set({
      board: tentative,
      grid: [...tentative.grid],
      lastMove: point,
      lastCaptures: captures,
      lastMoveColor: lesson.userPlays,
      moveSeq: get().moveSeq + 1,
      successSeq: get().successSeq + 1,
      status: 'success',
      feedback: isLastLesson ? "You've finished the intro!" : null,
      showHint: false,
      completed,
    });
  },

  toggleHint: () => set((s) => ({ showHint: !s.showHint })),

  next: () => {
    const idx = get().lessonIndex + 1;
    if (idx >= LESSONS.length) {
      set({ active: false });
      return;
    }
    // Right before the first game lesson, fire the reward overlay if the user
    // just finished the puzzle batch (and hasn't already seen it this session).
    const nextLesson = LESSONS[idx];
    if (nextLesson.kind === 'game' && allPuzzlesComplete(get().completed) && !get().showReward) {
      set({ showReward: true });
      return;
    }
    get().startLesson(idx);
  },

  retry: () => {
    get().startLesson(get().lessonIndex);
  },

  dismissReward: () => {
    set({ showReward: false });
    // Continue into whatever lesson is next after the current one.
    const idx = get().lessonIndex + 1;
    if (idx < LESSONS.length) get().startLesson(idx);
    else set({ active: false });
  },

  markComplete: (id: string) => {
    if (get().completed.has(id)) return;
    const completed = new Set(get().completed);
    completed.add(id);
    saveCompleted(completed);
    set({ completed });
  },

  skipAfterSuccess: () => {
    const { _afterSuccessTimer, _afterSuccessRun } = get();
    if (_afterSuccessTimer !== null) clearTimeout(_afterSuccessTimer);
    if (_afterSuccessRun) _afterSuccessRun();
  },
}));
