import { GoBoard } from '../board/GoBoard';
import { useLearnStore } from '../store/learnStore';
import { LESSONS, type GameConfig } from '../learn/lessons';
import { LessonStepModal } from './LessonStepModal';
import './LearnView.css';

interface LearnViewProps {
  onExit: () => void;
  /** Called when the player advances into a `kind: 'game'` lesson — App
   *  starts a real game with the given config and exits the lesson view. */
  onStartGameLesson: (config: GameConfig, lessonId: string) => void;
}

export function LearnView({ onExit, onStartGameLesson }: LearnViewProps) {
  const lessonIndex = useLearnStore((s) => s.lessonIndex);
  const status = useLearnStore((s) => s.status);
  const message = useLearnStore((s) => s.message);
  const feedback = useLearnStore((s) => s.feedback);
  const showHint = useLearnStore((s) => s.showHint);
  const completed = useLearnStore((s) => s.completed);
  const showReward = useLearnStore((s) => s.showReward);
  const toggleHint = useLearnStore((s) => s.toggleHint);
  const retry = useLearnStore((s) => s.retry);
  const startLesson = useLearnStore((s) => s.startLesson);
  const exit = useLearnStore((s) => s.exit);
  const dismissReward = useLearnStore((s) => s.dismissReward);

  const lesson = LESSONS[lessonIndex];
  const isGameLesson = lesson.kind === 'game';

  const handleExit = () => {
    exit();
    onExit();
  };

  const handleStartGame = () => {
    if (!lesson.gameConfig) return;
    onStartGameLesson(lesson.gameConfig, lesson.id);
  };

  // Reward overlay — fires once after all puzzles are done, before the first game.
  if (showReward) {
    return (
      <div className="learn-view">
        <div className="learn-reward-overlay">
          <div className="learn-reward-stars" />
          <div className="learn-reward-content">
            <div className="learn-reward-badge">★</div>
            <h1 className="learn-reward-title">Cosmic Board Unlocked!</h1>
            <p className="learn-reward-sub">
              You finished the basics. The full cosmic board is yours — time for your first real game.
            </p>
            <button className="learn-reward-btn" onClick={dismissReward}>
              Start First Game →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Game-kind lesson — no puzzle board. Just a "ready to play" card.
  if (isGameLesson) {
    return (
      <div className="learn-view">
        <header className="learn-header">
          <button className="learn-back-btn" onClick={handleExit} aria-label="Back to home">
            ← Home
          </button>
          <div className="learn-header-title" key={`title-${lessonIndex}`}>
            <div className="learn-header-eyebrow">Lesson {lessonIndex + 1} of {LESSONS.length}</div>
            <h1 className="learn-header-lesson">{lesson.title}</h1>
          </div>
          <div className="learn-progress">
            {LESSONS.map((l, i) => (
              <button
                key={l.id}
                className={
                  'learn-progress-dot' +
                  (i === lessonIndex ? ' learn-progress-dot-current' : '') +
                  (completed.has(l.id) ? ' learn-progress-dot-done' : '')
                }
                onClick={() => startLesson(i)}
                title={l.title}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </header>
        <main className="learn-main learn-main-game">
          <div className="learn-game-card">
            <h2 className="learn-game-title">
              {lesson.gameConfig?.preGameHeadline ?? 'Game Time!'}
            </h2>
            {lesson.gameConfig?.preGameSubline && (
              <p className="learn-game-subline">{lesson.gameConfig.preGameSubline}</p>
            )}

            <div className="learn-game-section">
              <h3 className="learn-game-section-title">Mission</h3>
              <ul className="learn-game-bullets">
                <li><span className="learn-game-bullet-icon">⚫</span><span>Trap enemy stones</span></li>
                <li><span className="learn-game-bullet-icon">⚪</span><span>Protect your team</span></li>
                <li><span className="learn-game-bullet-icon">⭐</span><span>Finish ahead</span></li>
              </ul>
            </div>

            <div className="learn-game-section">
              <h3 className="learn-game-section-title">What stuff means</h3>
              <ul className="learn-game-bullets">
                <li><span className="learn-game-bullet-icon">📈</span><span>Bar = who's winning</span></li>
                <li><span className="learn-game-bullet-icon">🤖</span><span>Bot passes = "I'm done!"</span></li>
                <li><span className="learn-game-bullet-icon">🏁</span><span>Both pass = game over</span></li>
              </ul>
            </div>

            <button className="learn-game-btn" onClick={handleStartGame}>
              Let's Go!
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="learn-view">
      <header className="learn-header">
        <button className="learn-back-btn" onClick={handleExit} aria-label="Back to home">
          ← Home
        </button>
        <div className="learn-header-title" key={`title-${lessonIndex}`}>
          <div className="learn-header-eyebrow">Lesson {lessonIndex + 1} of {LESSONS.length}</div>
          <h1 className="learn-header-lesson">{lesson.title}</h1>
        </div>
        <div className="learn-progress">
          {LESSONS.map((l, i) => (
            <button
              key={l.id}
              className={
                'learn-progress-dot' +
                (i === lessonIndex ? ' learn-progress-dot-current' : '') +
                (completed.has(l.id) ? ' learn-progress-dot-done' : '')
              }
              onClick={() => startLesson(i)}
              title={l.title}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </header>

      <main className="learn-main">
        <div className="learn-prompt">
          <p className="learn-instruction" key={`${lessonIndex}-${message}`}>
            {message}
          </p>
        </div>

        <div className="learn-board-wrap">
          <div className="learn-board-square">
            <GoBoard />
          </div>
        </div>

        <div className="learn-footer">
          {/* In-page feedback below the board only covers the awaiting/retry
              cases. The success + animating celebration moved into a modal so
              it's high-contrast and gates progression on an explicit Continue. */}
          {status === 'retry' ? (
            <div className="learn-feedback learn-feedback-retry">{feedback}</div>
          ) : feedback ? (
            <div className="learn-feedback learn-feedback-retry" key={`warn-${feedback}`}>
              {feedback}
            </div>
          ) : (status === 'awaiting' && (
            <div className="learn-feedback">
              <span className="learn-feedback-placeholder">
                <span className="stone-icon black" />
                Your turn — you play Black.
              </span>
            </div>
          ))}

          <div className="learn-actions">
            {status === 'awaiting' && !lesson.defaultShowHint && (
              <button className="btn btn-secondary" onClick={toggleHint}>
                {showHint ? 'Hide hint' : 'Show hint'}
              </button>
            )}
            {status === 'retry' && (
              <button className="btn btn-secondary" onClick={retry}>
                Reset puzzle
              </button>
            )}
          </div>
        </div>
      </main>

      <LessonStepModal onFinish={handleExit} />
    </div>
  );
}
