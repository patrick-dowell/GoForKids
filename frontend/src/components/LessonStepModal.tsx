import { useLearnStore } from '../store/learnStore';
import { LESSONS } from '../learn/lessons';
import './LessonStepModal.css';

interface LessonStepModalProps {
  /** Called when the user finishes the very last lesson and clicks Finish. */
  onFinish: () => void;
}

/**
 * Modal that appears whenever a lesson step is completed (status 'animating'
 * or 'success'). Shows the celebration text + a Continue (or Finish) button.
 * Replaces the previous in-page celebration block + auto-advance — every step
 * is now explicitly user-driven.
 */
export function LessonStepModal({ onFinish }: LessonStepModalProps) {
  const lessonIndex = useLearnStore((s) => s.lessonIndex);
  const status = useLearnStore((s) => s.status);
  const feedback = useLearnStore((s) => s.feedback);
  const quizFeedback = useLearnStore((s) => s.quizFeedback);
  const quizCorrect = useLearnStore((s) => s.quizCorrect);
  const partFeedback = useLearnStore((s) => s.partFeedback);
  const partIndex = useLearnStore((s) => s.partIndex);
  const next = useLearnStore((s) => s.next);
  const skipAfterSuccess = useLearnStore((s) => s.skipAfterSuccess);
  const advanceQuiz = useLearnStore((s) => s.advanceQuiz);
  const retryQuiz = useLearnStore((s) => s.retryQuiz);
  const advancePart = useLearnStore((s) => s.advancePart);
  const exploreAgain = useLearnStore((s) => s.exploreAgain);
  const focusLessons = useLearnStore((s) => s.focusLessons);
  const afterSuccessRun = useLearnStore((s) => s._afterSuccessRun);

  const lesson = LESSONS[lessonIndex];
  const isLast = lessonIndex >= LESSONS.length - 1;
  // In a glossary-launched focused set, the last lesson of the SET ends with
  // "Done" (it returns to the glossary, not the curriculum). `next()` already
  // routes the return — only the button label changes.
  const isFocusLast = !!focusLessons && lessonIndex === focusLessons[focusLessons.length - 1];
  if (!lesson || lesson.kind === 'game') return null;

  // Puzzle-series: per-part success modal between sub-puzzles. Uses the
  // green correct-style card from the quiz feedback variants.
  if (partFeedback) {
    return (
      <div className="lesson-step-overlay" role="dialog" aria-modal="true">
        <div className="lesson-step-card lesson-step-card-quiz lesson-step-card-correct">
          <div className="lesson-step-quiz-icon" aria-hidden>✓</div>
          <h2 className="lesson-step-headline">{partFeedback.successMessage}</h2>
          {partFeedback.successExplanation && (
            <p className="lesson-step-explanation">{partFeedback.successExplanation}</p>
          )}
          <button className="lesson-step-btn" onClick={advancePart}>
            Next puzzle →
          </button>
        </div>
      </div>
    );
  }

  // Quiz: per-question feedback modal. Correct → advance; wrong → the hint
  // plus "Try again" on the SAME question (fp 03 §D — the 7yo playtest kid
  // was told "look again" by the failMessage while the only button marched
  // him forward; wrong answers must never dead-end).
  if (quizFeedback) {
    return (
      <div className="lesson-step-overlay" role="dialog" aria-modal="true">
        <div className={'lesson-step-card lesson-step-card-quiz' + (quizFeedback.correct ? ' lesson-step-card-correct' : ' lesson-step-card-wrong')}>
          <div className="lesson-step-quiz-icon" aria-hidden>
            {quizFeedback.correct ? '✓' : '✗'}
          </div>
          <h2 className="lesson-step-headline">
            {quizFeedback.correct ? 'Correct!' : 'Not quite'}
          </h2>
          <p className="lesson-step-explanation">{quizFeedback.message}</p>
          {quizFeedback.correct ? (
            <button className="lesson-step-btn" onClick={advanceQuiz}>
              {quizFeedback.isLastQuestion ? 'See results →' : 'Next question →'}
            </button>
          ) : (
            <button className="lesson-step-btn" onClick={retryQuiz}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  // During a puzzle-series PLAYOUT (a background capture sequence), status is
  // 'animating' with no partFeedback and no pending afterSuccess — show nothing
  // so the sequence finishes before the "Next puzzle" button appears. (An
  // afterSuccess part is ALSO 'animating' but DOES need its Continue modal, so
  // only suppress when there's no `_afterSuccessRun` queued.)
  if (lesson.kind === 'puzzle-series' && status === 'animating' && !afterSuccessRun) return null;

  const open = status === 'success' || status === 'animating';
  if (!open) return null;

  // Quiz lessons only render the modal for per-question feedback (handled
  // above via quizFeedback) or the final success summary. The 'animating'
  // state during a killMove demo has no modal — the player just watches the
  // capture play out, then the quizFeedback modal pops in after the delay.
  if (lesson.kind === 'quiz' && status !== 'success') return null;

  // Quiz lessons reach 'success' status after the LAST question's feedback is
  // dismissed — show a results-flavored summary modal.
  if (lesson.kind === 'quiz' && status === 'success') {
    const total = lesson.questions?.length ?? 0;
    return (
      <div className="lesson-step-overlay" role="dialog" aria-modal="true">
        <div className="lesson-step-card">
          <h2 className="lesson-step-headline">{lesson.successMessage}</h2>
          {lesson.successExplanation && (
            <p className="lesson-step-explanation">{lesson.successExplanation}</p>
          )}
          {/* With retries, every question ends answered — the score counts
              first-try corrects, and the phrasing says so when it matters. */}
          <p className="lesson-step-quiz-score">
            {quizCorrect >= total ? (
              <>You got <strong>{total}</strong> of <strong>{total}</strong> right!</>
            ) : (
              <>You got <strong>{quizCorrect}</strong> of <strong>{total}</strong> on the first try — and figured out the rest!</>
            )}
          </p>
          {lesson.quizSummary && (
            <p className="lesson-step-finale">{lesson.quizSummary}</p>
          )}
          <button className="lesson-step-btn" onClick={isFocusLast ? next : isLast ? onFinish : next}>
            {isFocusLast ? 'Done' : isLast ? 'Finish' : 'Continue →'}
          </button>
        </div>
      </div>
    );
  }

  // Animating phase = first user move just landed but the auto-placement
  // (white's turn / bot's chase) hasn't fired yet. Show interim text and
  // a Continue button that triggers the auto-placement.
  const isInterim = status === 'animating';
  // Puzzle-series: the CURRENT PART's interim copy wins over the lesson's
  // (e.g. snapback's "The bait is set…" between the throw-in and the bite).
  const activePart = lesson.kind === 'puzzle-series' ? lesson.parts?.[partIndex] : undefined;
  const headline = isInterim
    ? (activePart?.interimSuccessMessage ?? lesson.interimSuccessMessage ?? lesson.successMessage)
    : lesson.successMessage;
  // Advanced puzzle-series: the final modal leads with the LAST PART's
  // concrete payoff ("You gave up one stone and took five back…") and keeps
  // the lesson-level moral as the finale line below — previously the part-2
  // success copy was authored but never shown (finishPart jumps straight to
  // the lesson-level modal on the last part).
  const lastPartPayoff =
    !isInterim && lesson.advanced && lesson.kind === 'puzzle-series'
      ? lesson.parts?.[partIndex]?.successExplanation
      : undefined;
  const explanation = isInterim
    ? (activePart?.interimSuccessExplanation ?? lesson.interimSuccessExplanation ?? lesson.successExplanation)
    : (lastPartPayoff ?? lesson.successExplanation);

  const buttonLabel = isInterim ? 'Continue →' : isFocusLast ? 'Done' : (isLast ? 'Finish' : 'Continue →');

  const onClick = () => {
    if (isInterim) {
      skipAfterSuccess();
    } else if (isFocusLast) {
      // Focused set (glossary or advanced menu): next() routes the return.
      // Must beat the isLast check — an advanced lesson at the END of the
      // LESSONS array is still a focus set, not "finish to home".
      next();
    } else if (isLast) {
      onFinish();
    } else {
      next();
    }
  };

  const showExplore = lesson.exploreAfterSuccess && status === 'success';

  return (
    <div className="lesson-step-overlay" role="dialog" aria-modal="true">
      <div className="lesson-step-card">
        <h2 className="lesson-step-headline">{headline}</h2>
        {explanation && <p className="lesson-step-explanation">{explanation}</p>}
        {lastPartPayoff && lesson.successExplanation && (
          <p className="lesson-step-finale">{lesson.successExplanation}</p>
        )}
        {feedback && status === 'success' && (
          <p className="lesson-step-finale">{feedback}</p>
        )}
        <div className="lesson-step-buttons">
          {showExplore && (
            <button className="lesson-step-btn lesson-step-btn-secondary" onClick={exploreAgain}>
              Try another move
            </button>
          )}
          <button className="lesson-step-btn" onClick={onClick}>
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
