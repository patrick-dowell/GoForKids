import { LESSONS, ADVANCED_LESSONS } from '../learn/lessons';
import { getConcept } from '../learn/concepts';
import { useLearnStore } from '../store/learnStore';

interface AdvancedLessonsMenuProps {
  /** Back-out escape — never trap the player. */
  onExit: () => void;
}

/**
 * The advanced-lessons menu (fp 03 §B): surfaced when the regular curriculum
 * finishes, and the home base the advanced lessons return to. One card per
 * advanced lesson (ko, ladders, nets, snapback), each showing its concept's
 * 5-second answer and a done-checkmark once completed this session.
 */
export function AdvancedLessonsMenu({ onExit }: AdvancedLessonsMenuProps) {
  const completed = useLearnStore((s) => s.completed);
  const startAdvancedLesson = useLearnStore((s) => s.startAdvancedLesson);

  return (
    <div className="learn-view">
      <div className="learn-reward-overlay">
        <div className="learn-reward-stars" />
        <button className="learn-back-btn choose-avatar-back" onClick={onExit} aria-label="Back to home">
          ← Home
        </button>
        <div className="learn-reward-content advanced-menu-content">
          <h1 className="learn-reward-title">Advanced Lessons</h1>
          <p className="learn-reward-sub">
            You know the rules — now learn the tricks. Play them in any order.
          </p>
          <div className="advanced-menu-grid">
            {ADVANCED_LESSONS.map((lesson) => {
              const idx = LESSONS.findIndex((l) => l.id === lesson.id);
              const concept = lesson.conceptId ? getConcept(lesson.conceptId) : null;
              const done = completed.has(lesson.id);
              return (
                <button
                  key={lesson.id}
                  className={'advanced-menu-card' + (done ? ' advanced-menu-card-done' : '')}
                  onClick={() => startAdvancedLesson(idx)}
                >
                  <span className="advanced-menu-card-title">
                    {done ? '✓ ' : ''}
                    {lesson.title}
                  </span>
                  {concept && <span className="advanced-menu-card-blurb">{concept.short}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
