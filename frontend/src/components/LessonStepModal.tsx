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
  const next = useLearnStore((s) => s.next);
  const skipAfterSuccess = useLearnStore((s) => s.skipAfterSuccess);

  const lesson = LESSONS[lessonIndex];
  const isLast = lessonIndex >= LESSONS.length - 1;
  const open = status === 'success' || status === 'animating';
  if (!open || !lesson || lesson.kind === 'game') return null;

  // Animating phase = first user move just landed but the auto-placement
  // (white's turn / bot's chase) hasn't fired yet. Show interim text and
  // a Continue button that triggers the auto-placement.
  const isInterim = status === 'animating';
  const headline = isInterim
    ? (lesson.interimSuccessMessage ?? lesson.successMessage)
    : lesson.successMessage;
  const explanation = isInterim
    ? (lesson.interimSuccessExplanation ?? lesson.successExplanation)
    : lesson.successExplanation;

  const buttonLabel = isInterim ? 'Continue →' : (isLast ? 'Finish' : 'Continue →');

  const onClick = () => {
    if (isInterim) {
      skipAfterSuccess();
    } else if (isLast) {
      onFinish();
    } else {
      next();
    }
  };

  return (
    <div className="lesson-step-overlay" role="dialog" aria-modal="true">
      <div className="lesson-step-card">
        <h2 className="lesson-step-headline">{headline}</h2>
        {explanation && <p className="lesson-step-explanation">{explanation}</p>}
        {feedback && status === 'success' && (
          <p className="lesson-step-finale">{feedback}</p>
        )}
        <button className="lesson-step-btn" onClick={onClick}>
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
