import { create } from 'zustand';
import { Board } from '../engine/Board';
import { Color, MoveResult, type Point } from '../engine/types';
import { LESSONS, type LessonVerdict } from '../learn/lessons';
import { playPlaceSound, playCaptureSound, playTwoEyesSound, resumeAudio } from '../audio/SoundManager';
import { useGlossaryStore } from './glossaryStore';

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
  /** Snapshot of the board taken when we entered second-turn mode (i.e. after
   *  the user's first correct move + any afterSuccess auto-response landed).
   *  A wrong second move resets to *this* board, not the lesson's starting
   *  position — so the player retries just the second step instead of being
   *  thrown back to the beginning of the puzzle (lessons 4 and 6). */
  secondTurnInitialBoard: Board | null;
  /** Lesson IDs the user has finished (persisted to localStorage). */
  completed: Set<string>;
  /** True when the post-puzzle reward overlay should cover the lesson view. */
  showReward: boolean;
  /** Quiz state — only meaningful when LESSONS[lessonIndex].kind === 'quiz'. */
  quizIndex: number;
  quizCorrect: number;
  /** True once the player has missed the CURRENT question. Wrong answers
   *  re-open the same question (fp 03 §D — no dead ends), and only a
   *  first-try correct counts toward quizCorrect. Reset on advance. */
  quizMissedCurrent: boolean;
  /** Set the moment the player picks an answer; cleared when they Continue. */
  quizFeedback: {
    correct: boolean;
    message: string;
    isLastQuestion: boolean;
  } | null;
  /** Puzzle-series state — current sub-puzzle index. */
  partIndex: number;
  /** Set when a sub-puzzle (not the final one) just completed; the modal
   *  surfaces a "Next puzzle →" button that calls advancePart. */
  partFeedback: {
    successMessage: string;
    successExplanation: string | null;
    isLastPart: boolean;
  } | null;
  /** Override highlights shown on the board after a puzzle-series part's
   *  auto-response fires (e.g. pointing at the eye-regions formed in
   *  Part 3 of Two Eyes). When non-null, replaces the part's `highlight`
   *  for the rest of that part. */
  eyeHighlight: Point[] | null;

  /** True when the advanced-lessons menu (fp 03 §B) is showing instead of a
   *  lesson. Surfaced when the regular curriculum finishes, when an advanced
   *  lesson (launched from the menu) completes, or explicitly via
   *  openAdvancedMenu. */
  showAdvancedMenu: boolean;

  /** Non-null when playing a focused lesson set launched from the glossary:
   *  the lesson indices to play in order, and the concept id to return to when
   *  the set finishes (instead of marching on through the curriculum). */
  focusLessons: number[] | null;
  focusConcept: string | null;

  start: () => void;
  /** Re-enter the lesson view at a specific lesson without clearing progress.
   *  Used to continue the curriculum after a game-kind lesson finishes. */
  resumeAt: (index: number) => void;
  /** Launch a focused set of lessons for a concept (from the glossary "Do the
   *  lesson" button). When the last one finishes, return to that concept's
   *  glossary page rather than continuing the curriculum. */
  startConceptLessons: (lessonIndices: number[], conceptId: string) => void;
  /** Show the advanced-lessons menu inside the lesson view. */
  openAdvancedMenu: () => void;
  /** Launch one advanced lesson from the menu; finishing returns to the menu. */
  startAdvancedLesson: (index: number) => void;
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
  /** Quiz: record the player's answer to the current question and surface the
   *  feedback modal. Lesson advances on a separate `advanceQuiz` call. */
  answerQuiz: (answerIndex: number) => void;
  /** Quiz: dismiss the feedback modal and either move to the next question or
   *  complete the lesson if it was the last one. */
  advanceQuiz: () => void;
  /** Quiz: dismiss a wrong-answer modal and re-open the SAME question so the
   *  kid can apply the hint (fp 03 §D — wrong answers must never dead-end). */
  retryQuiz: () => void;
  /** Puzzle-series: dismiss the part-feedback modal and rebuild the board for
   *  the next sub-puzzle. */
  advancePart: () => void;
  /** During an `afterSuccess` wait, fire the auto-placement immediately so
   *  Continue feels responsive instead of forcing the user to wait out the timer. */
  skipAfterSuccess: () => void;
  /** Return to the active lesson from a `success` modal without losing the
   *  completion mark. Resets the board to its starting state so the player
   *  can try alternate moves (used by `exploreAfterSuccess` lessons). */
  exploreAgain: () => void;
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

/** Build the board for a specific sub-puzzle of a kind:'puzzle-series' lesson. */
function buildPartBoard(lessonIndex: number, partIndex: number): Board | null {
  const lesson = LESSONS[lessonIndex];
  const part = lesson.parts?.[partIndex];
  if (!part) return null;
  const board = new Board(part.boardSize);
  for (const s of part.initialStones) {
    board.grid[s.row * part.boardSize + s.col] = s.color;
  }
  return board;
}

/**
 * The first batch of puzzle lessons (1–4) — completing all of these unlocks
 * the Cosmic Board reward right before the lesson 5 first-battle game.
 * Later puzzles (lessons 6, 7, ...) are NOT in this list because their
 * unlock moments are handled separately.
 */
const FIRST_BATCH_PUZZLE_IDS = [
  'drop-first-stone',
  'trap-one-stone',
  'big-capture',
  'save-your-team',
];
function firstBatchComplete(completed: Set<string>): boolean {
  return FIRST_BATCH_PUZZLE_IDS.every((id) => completed.has(id));
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
  secondTurnInitialBoard: null,
  completed: loadCompleted(),
  showReward: false,
  showAdvancedMenu: false,
  quizIndex: 0,
  quizCorrect: 0,
  quizMissedCurrent: false,
  quizFeedback: null,
  partIndex: 0,
  partFeedback: null,
  eyeHighlight: null,
  focusLessons: null,
  focusConcept: null,
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

  resumeAt: (index: number) => {
    // Re-enter the lesson view at a specific lesson WITHOUT clearing progress
    // — used by the game-end modal's "Next lesson" button so the curriculum
    // continues smoothly after a kind:'game' lesson finishes.
    set({ active: true, showReward: false });
    get().startLesson(index);
  },

  startConceptLessons: (lessonIndices: number[], conceptId: string) => {
    const indices = lessonIndices.filter((i) => i >= 0 && i < LESSONS.length);
    if (indices.length === 0) return;
    set({ active: true, showReward: false, focusLessons: indices, focusConcept: conceptId });
    get().startLesson(indices[0]);
  },

  exit: () => {
    set({ active: false, focusLessons: null, focusConcept: null, showAdvancedMenu: false });
  },

  openAdvancedMenu: () => {
    set({ active: true, showReward: false, showAdvancedMenu: true, focusLessons: null, focusConcept: null });
  },

  startAdvancedLesson: (index: number) => {
    // Focused single-lesson set with NO concept: next() returns to the menu.
    set({ active: true, showReward: false, showAdvancedMenu: false, focusLessons: [index], focusConcept: null });
    get().startLesson(index);
  },

  startLesson: (index: number) => {
    if (index < 0 || index >= LESSONS.length) return;
    set({ showAdvancedMenu: false });
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
      secondTurnInitialBoard: null,
        eyeHighlight: null,
        _afterSuccessTimer: null,
        _afterSuccessRun: null,
      });
      return;
    }

    // Quiz lessons build the board from the first question's stones.
    if (lesson.kind === 'quiz' && lesson.questions && lesson.questions.length > 0) {
      const q = lesson.questions[0];
      const board = new Board(q.boardSize);
      for (const s of q.initialStones) {
        board.grid[s.row * q.boardSize + s.col] = s.color;
      }
      set({
        lessonIndex: index,
        status: 'awaiting',
        message: q.prompt,
        feedback: null,
        showHint: false,
        board,
        boardSize: board.size,
        grid: [...board.grid],
        lastMove: null,
        lastCaptures: [],
        lastMoveColor: Color.Empty,
        awaitingSecondMove: false,
      secondTurnInitialBoard: null,
        quizIndex: 0,
        quizCorrect: 0,
        quizMissedCurrent: false,
        quizFeedback: null,
        eyeHighlight: null,
        _afterSuccessTimer: null,
        _afterSuccessRun: null,
      });
      return;
    }

    // Puzzle-series lessons build the board from the first part's stones.
    if (lesson.kind === 'puzzle-series' && lesson.parts && lesson.parts.length > 0) {
      const part = lesson.parts[0];
      const board = buildPartBoard(index, 0)!;
      set({
        lessonIndex: index,
        status: 'awaiting',
        message: part.prompt,
        feedback: null,
        showHint: !!part.defaultShowHint,
        board,
        boardSize: board.size,
        grid: [...board.grid],
        lastMove: null,
        lastCaptures: [],
        lastMoveColor: Color.Empty,
        awaitingSecondMove: false,
      secondTurnInitialBoard: null,
        partIndex: 0,
        partFeedback: null,
        eyeHighlight: null,
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
      secondTurnInitialBoard: null,
      eyeHighlight: null,
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
    if (lesson.kind === 'game') return;

    // Puzzle-series: each sub-puzzle has its own userPlays + validate, runs
    // independently of the lesson-level fields.
    if (lesson.kind === 'puzzle-series' && lesson.parts && lesson.parts.length > 0) {
      const partIndex = get().partIndex;
      const part = lesson.parts[partIndex];
      if (!part) return;

      const tentative = board.clone();
      const { result, captures } = tentative.tryPlay(part.userPlays as Color.Black | Color.White, point);
      const isLastPart = partIndex >= lesson.parts.length - 1;
      const lessonIdx = get().lessonIndex;

      const finishPart = (finalBoard: Board, lastMovePoint: Point | null, lastMoveCaps: Point[], lastMoveColor: Color) => {
        if (isLastPart) {
          const isLastLesson = lessonIdx >= LESSONS.length - 1;
          const completed = new Set(get().completed);
          completed.add(lesson.id);
          saveCompleted(completed);
          set({
            board: finalBoard,
            grid: [...finalBoard.grid],
            lastMove: lastMovePoint,
            lastCaptures: lastMoveCaps,
            lastMoveColor,
            moveSeq: get().moveSeq + 1,
            successSeq: get().successSeq + 1,
            status: 'success',
            feedback: isLastLesson ? "You've finished the intro!" : null,
            showHint: false,
            completed,
          });
        } else {
          set({
            board: finalBoard,
            grid: [...finalBoard.grid],
            lastMove: lastMovePoint,
            lastCaptures: lastMoveCaps,
            lastMoveColor,
            moveSeq: get().moveSeq + 1,
            successSeq: get().successSeq + 1,
            status: 'awaiting',
            showHint: false,
            partFeedback: {
              successMessage: part.successMessage,
              successExplanation: part.successExplanation ?? null,
              isLastPart: false,
            },
          });
        }
      };

      if (result !== MoveResult.Ok) {
        if (part.validateIllegal) {
          const verdict = part.validateIllegal({ point, result });
          if (verdict === 'success') {
            finishPart(board, null, [], Color.Empty);
            return;
          }
        }
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

      const verdict = part.validate({ board: tentative, point, capturedCount: captures.length });
      if (verdict !== 'success') {
        const reset = buildPartBoard(lessonIdx, partIndex)!;
        set({
          board: reset,
          grid: [...reset.grid],
          lastMove: null,
          lastCaptures: [],
          lastMoveColor: Color.Empty,
          status: 'retry',
          feedback: part.retryMessage,
        });
        return;
      }

      // Success — commit the move (and queue an afterSuccess if defined).
      playPlaceSound(point.row, point.col);
      if (captures.length > 0) {
        setTimeout(() => playCaptureSound(captures.length), 100);
      }
      if (part.triumphSound === 'success') {
        // Slight delay so the place sound and triumph sound don't overlap awkwardly.
        setTimeout(() => playTwoEyesSound(), 250);
      }

      if (part.afterSuccess) {
        // Apply user's move; queue the auto-placement (defender's response).
        set({
          board: tentative,
          grid: [...tentative.grid],
          lastMove: point,
          lastCaptures: captures,
          lastMoveColor: part.userPlays,
          moveSeq: get().moveSeq + 1,
          status: 'animating',
          feedback: null,
          showHint: false,
        });
        const after = part.afterSuccess;
        const partIdxAtStart = partIndex;
        // Compute the response point now (while we still have the user's move
        // in scope) so the closure doesn't have to look it up later.
        const responsePoint = part.responseFor ? part.responseFor(point) : after.point;
        const runAutoPlace = () => {
          const cur = get();
          if (!cur.active || cur.lessonIndex !== lessonIdx || cur.partIndex !== partIdxAtStart || cur.status !== 'animating') return;
          const nextBoard = cur.board!.clone();
          nextBoard.tryPlay(after.color as Color.Black | Color.White, responsePoint);
          playPlaceSound(responsePoint.row, responsePoint.col);
          set({
            message: after.followUpMessage,
            eyeHighlight: part.successHighlight ?? null,
            _afterSuccessTimer: null,
            _afterSuccessRun: null,
          });
          if (part.triumphSound === 'after-response') {
            setTimeout(() => playTwoEyesSound(), 250);
          }
          finishPart(nextBoard, responsePoint, [], after.color);
        };
        set({ _afterSuccessTimer: null, _afterSuccessRun: runAutoPlace });
        return;
      }

      // Background playout: when a part auto-plays a sequence (e.g. the kill
      // that captures the group), HOLD the success modal until the sequence
      // finishes — otherwise the player can tap "Next puzzle" and skip the
      // capture. Commit the user's move in 'animating' (board interaction +
      // modal both suppressed), play the moves, then finishPart at the end.
      if (part.playoutAfter && part.playoutAfter.length > 0) {
        set({
          board: tentative,
          grid: [...tentative.grid],
          lastMove: point,
          lastCaptures: captures,
          lastMoveColor: part.userPlays,
          moveSeq: get().moveSeq + 1,
          status: 'animating',
          feedback: null,
          showHint: false,
          // No afterSuccess in a playout — clear any stale handle so the modal
          // stays suppressed (the guard keys off this).
          _afterSuccessRun: null,
          _afterSuccessTimer: null,
        });
        const moves = part.playoutAfter;
        const partIdxAtStart = partIndex;
        const playMove = (idx: number) => {
          if (idx >= moves.length) {
            // Sequence done — NOW reveal the part-complete modal.
            const cur = get();
            if (!cur.active || cur.lessonIndex !== lessonIdx || cur.partIndex !== partIdxAtStart) return;
            finishPart(cur.board!, cur.lastMove, cur.lastCaptures, cur.lastMoveColor);
            return;
          }
          const move = moves[idx];
          setTimeout(() => {
            const cur = get();
            if (!cur.active || cur.lessonIndex !== lessonIdx || cur.partIndex !== partIdxAtStart || !cur.board) return;
            const nextBoard = cur.board.clone();
            const r = nextBoard.tryPlay(move.color as Color.Black | Color.White, move.point);
            if (r.result !== MoveResult.Ok) {
              playMove(idx + 1);
              return;
            }
            playPlaceSound(move.point.row, move.point.col);
            if (r.captures.length > 0) {
              setTimeout(() => playCaptureSound(r.captures.length), 100);
            }
            set({
              board: nextBoard,
              grid: [...nextBoard.grid],
              lastMove: move.point,
              lastCaptures: r.captures,
              lastMoveColor: move.color,
              moveSeq: get().moveSeq + 1,
            });
            playMove(idx + 1);
          }, move.delayMs);
        };
        playMove(0);
        return;
      }

      finishPart(tentative, point, captures, part.userPlays);
      return;
    }

    if (!lesson.userPlays) return;

    // tryPlay mutates — work on a clone, commit only on success.
    const tentative = board.clone();
    const { result, captures } = tentative.tryPlay(lesson.userPlays, point);

    if (result !== MoveResult.Ok) {
      // Some lessons (e.g. Safe Eyes) treat an illegal move at a particular
      // spot AS the success condition — the player learns by *trying* and
      // discovering the rule. Run the lesson's optional illegal-move
      // validator before falling back to the generic denied-flash treatment.
      if (lesson.validateIllegal) {
        const verdict = lesson.validateIllegal({ point, result });
        if (verdict === 'success') {
          // Surface success WITHOUT placing a stone (none was legal).
          const isLastLesson = get().lessonIndex >= LESSONS.length - 1;
          const completed = new Set(get().completed);
          completed.add(lesson.id);
          saveCompleted(completed);
          set({
            successSeq: get().successSeq + 1,
            status: 'success',
            feedback: isLastLesson ? "You've finished the intro!" : null,
            showHint: false,
            completed,
          });
          return;
        }
      }
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
      // Legal but wrong puzzle answer.
      //   - In second-turn mode (lessons 4, 6: user's first move + auto-
      //     response already landed) we restore the board to the snapshot
      //     captured when we entered second-turn mode. The player retries
      //     just the second move; they don't have to redo the first one.
      //   - In first-move mode we rebuild from the lesson's initial board
      //     (the original behavior).
      const snapshot = get().secondTurnInitialBoard;
      if (isSecond && snapshot) {
        const reset = snapshot.clone();
        set({
          board: reset,
          grid: [...reset.grid],
          lastMove: null,
          lastCaptures: [],
          lastMoveColor: Color.Empty,
          status: 'retry',
          feedback: activeRetryMessage,
          awaitingSecondMove: true,
          // Keep secondTurnInitialBoard intact — next wrong move resets to
          // the same snapshot.
        });
        return;
      }
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
        secondTurnInitialBoard: null,
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
      secondTurnInitialBoard: null,
        completed,
      });
      return;
    }

    // Branch B': lesson has a secondTurn but NO auto-placement.
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
        // Snapshot the board *after* the user's first correct move so a
        // wrong second-move retries from here, not from the lesson start.
        secondTurnInitialBoard: tentative.clone(),
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
        nextBoard.tryPlay(after.color as Color.Black | Color.White, after.point);
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
            // Snapshot the post-auto-response board for second-move retries
            // (lessons 4, 6) — a wrong second move falls back to this state
            // instead of the lesson's starting position.
            secondTurnInitialBoard: nextBoard.clone(),
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
    // Focused (glossary-launched) set: advance within the set, and when it's
    // done return to the concept's glossary page instead of the curriculum.
    const { focusLessons, focusConcept } = get();
    if (focusLessons) {
      const pos = focusLessons.indexOf(get().lessonIndex);
      const nextFocus = pos >= 0 ? focusLessons[pos + 1] : undefined;
      if (nextFocus === undefined) {
        if (focusConcept) {
          // Glossary-launched: return to the concept page.
          set({ active: false, focusLessons: null, focusConcept: null });
          useGlossaryStore.getState().openConcept(focusConcept);
        } else {
          // Menu-launched advanced lesson: back to the advanced menu.
          set({ focusLessons: null, focusConcept: null, showAdvancedMenu: true });
        }
        return;
      }
      get().startLesson(nextFocus);
      return;
    }

    const idx = get().lessonIndex + 1;
    // Curriculum finished (or would march into the advanced block): reveal
    // the advanced-lessons menu instead of exiting / bleeding into it.
    if (idx >= LESSONS.length || LESSONS[idx].advanced) {
      set({ showAdvancedMenu: true });
      return;
    }
    // Reward fires specifically before the first-battle lesson, when the
    // player has finished the basics. Other game lessons (e.g. big-board-time)
    // don't currently have a tied reward overlay.
    const nextLesson = LESSONS[idx];
    if (nextLesson.id === 'first-battle' && firstBatchComplete(get().completed) && !get().showReward) {
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

  advancePart: () => {
    const { partIndex, partFeedback } = get();
    const lesson = LESSONS[get().lessonIndex];
    if (!lesson || lesson.kind !== 'puzzle-series' || !lesson.parts) return;
    if (!partFeedback) return;

    const nextIdx = partIndex + 1;
    const part = lesson.parts[nextIdx];
    if (!part) return;
    const board = buildPartBoard(get().lessonIndex, nextIdx)!;
    set({
      partIndex: nextIdx,
      partFeedback: null,
      eyeHighlight: null,
      status: 'awaiting',
      message: part.prompt,
      feedback: null,
      showHint: !!part.defaultShowHint,
      board,
      boardSize: board.size,
      grid: [...board.grid],
      lastMove: null,
      lastCaptures: [],
      lastMoveColor: Color.Empty,
    });
  },

  exploreAgain: () => {
    const idx = get().lessonIndex;
    const lesson = LESSONS[idx];
    if (!lesson || lesson.kind === 'game' || lesson.kind === 'quiz') return;
    const board = buildLessonBoard(idx);
    set({
      status: 'awaiting',
      feedback: null,
      showHint: !!lesson.defaultShowHint,
      board,
      grid: [...board.grid],
      lastMove: null,
      lastCaptures: [],
      lastMoveColor: Color.Empty,
      awaitingSecondMove: false,
      secondTurnInitialBoard: null,
    });
  },

  answerQuiz: (answerIndex: number) => {
    resumeAudio();
    const { board, quizIndex, quizCorrect, quizMissedCurrent, status } = get();
    const lesson = LESSONS[get().lessonIndex];
    if (!lesson || lesson.kind !== 'quiz' || !lesson.questions) return;
    if (status !== 'awaiting') return;
    const question = lesson.questions[quizIndex];
    if (!question) return;
    const answer = question.answers[answerIndex];
    if (!answer) return;
    const isCorrect = !!answer.correct;
    const isLastQuestion = quizIndex >= lesson.questions.length - 1;

    if (isCorrect && question.triumphSound) {
      playTwoEyesSound();
    }

    // Correct answer + killMove demo: play the killing move on the board
    // (sound + capture animation), then surface the feedback modal after a
    // short delay so the player gets to watch the group disappear.
    if (isCorrect && question.killMove && board) {
      const killPoint = question.killMove;
      const newBoard = board.clone();
      const { result, captures } = newBoard.tryPlay(Color.Black, killPoint);
      if (result === MoveResult.Ok && captures.length > 0) {
        playPlaceSound(killPoint.row, killPoint.col);
        setTimeout(() => playCaptureSound(captures.length), 100);
        set({
          status: 'animating',
          board: newBoard,
          grid: [...newBoard.grid],
          lastMove: killPoint,
          lastCaptures: captures,
          lastMoveColor: Color.Black,
          moveSeq: get().moveSeq + 1,
          // Retried-into-correct doesn't score — quizCorrect is first-try only.
          quizCorrect: quizMissedCurrent ? quizCorrect : quizCorrect + 1,
        });
        setTimeout(() => {
          set({
            status: 'awaiting',
            quizFeedback: {
              correct: true,
              message: question.successMessage,
              isLastQuestion,
            },
          });
        }, 900);
        return;
      }
    }

    set({
      // First-try corrects only — a retried question no longer scores.
      quizCorrect: isCorrect && !quizMissedCurrent ? quizCorrect + 1 : quizCorrect,
      quizMissedCurrent: quizMissedCurrent || !isCorrect,
      quizFeedback: {
        correct: isCorrect,
        message: isCorrect
          ? question.successMessage
          : (question.failMessage ?? 'Not quite — take another look and try again!'),
        isLastQuestion,
      },
    });
  },

  // fp 03 §D (7yo playtest 2026-06-27): a wrong answer used to dead-end into
  // "Next question" — the failMessages say "Look again…" but the UI never let
  // the kid look again. Retry re-opens the SAME question; the board never
  // changed on a wrong answer, so clearing the modal is sufficient.
  retryQuiz: () => {
    if (!get().quizFeedback) return;
    set({ quizFeedback: null });
  },

  advanceQuiz: () => {
    const { quizIndex, quizFeedback } = get();
    const lesson = LESSONS[get().lessonIndex];
    if (!lesson || lesson.kind !== 'quiz' || !lesson.questions) return;
    if (!quizFeedback) return;

    // Last question — mark the lesson complete and surface the final
    // success modal via the existing 'success' status.
    if (quizFeedback.isLastQuestion) {
      const completed = new Set(get().completed);
      completed.add(lesson.id);
      saveCompleted(completed);
      set({
        status: 'success',
        feedback: null,
        quizFeedback: null,
        successSeq: get().successSeq + 1,
        completed,
      });
      return;
    }

    // Otherwise, advance to the next question and rebuild the board.
    const nextIdx = quizIndex + 1;
    const q = lesson.questions[nextIdx];
    const board = new Board(q.boardSize);
    for (const s of q.initialStones) {
      board.grid[s.row * q.boardSize + s.col] = s.color;
    }
    set({
      quizIndex: nextIdx,
      quizFeedback: null,
      quizMissedCurrent: false,
      status: 'awaiting',
      message: q.prompt,
      board,
      boardSize: board.size,
      grid: [...board.grid],
      lastMove: null,
      lastCaptures: [],
      lastMoveColor: Color.Empty,
    });
  },
}));

// Dev-only: expose the live store instance for local QA/debugging via the
// preview tool. A dynamic `import()` from an eval context can resolve to a
// SEPARATE module instance, so reading/driving through it desyncs from the app;
// this hook hands out the exact instance the app renders from.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __learnStore?: typeof useLearnStore }).__learnStore = useLearnStore;
}
