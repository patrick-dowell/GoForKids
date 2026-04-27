import { useGameStore } from '../store/gameStore';
import { Color } from '../engine/types';
import './LessonGameEndModal.css';

interface LessonGameEndModalProps {
  /** Called when the user picks "Move on" — App returns them to the home screen. */
  onMoveOn: () => void;
  /** Called when the user picks "Next lesson" — App exits the game and resumes
   *  the lesson view at the next lesson. Only present when there IS a next lesson. */
  onNextLesson?: () => void;
}

/**
 * Game-over modal shown only for the lesson 5 first-game flow. The regular
 * end-of-game UI in the side panel is fine for experienced players, but kids
 * just finishing their first game need a clear "you won/lost" call-out and
 * two obvious next steps.
 */
export function LessonGameEndModal({ onMoveOn, onNextLesson }: LessonGameEndModalProps) {
  const lessonContext = useGameStore((s) => s.lessonContext);
  const phase = useGameStore((s) => s.phase);
  const result = useGameStore((s) => s.result);
  const playerColor = useGameStore((s) => s.playerColor);
  const replayGame = useGameStore((s) => s.replayGame);
  const dismissed = useGameStore((s) => s.lessonGameEndDismissed);
  const dismiss = useGameStore((s) => s.dismissLessonGameEnd);

  if (!lessonContext || phase !== 'finished' || !result || dismissed) return null;

  const userWon = result.winner === playerColor;
  const margin = Math.abs(result.blackScore - result.whiteScore);
  const isResignation = result.blackScore === 0 && result.whiteScore === 0;
  const winnerName = result.winner === Color.Black ? 'Black' : 'White';

  // Map result to "you" vs "bot" since the kid-friendly modal frames
  // everything from the player's perspective.
  const youAreBlack = playerColor === Color.Black;
  const youScore = youAreBlack ? result.blackScore : result.whiteScore;
  const botScore = youAreBlack ? result.whiteScore : result.blackScore;
  const youTerritory = youAreBlack ? result.blackTerritory : result.whiteTerritory;
  const botTerritory = youAreBlack ? result.whiteTerritory : result.blackTerritory;
  const youCaptures = youAreBlack ? result.blackCaptures : result.whiteCaptures;
  const botCaptures = youAreBlack ? result.whiteCaptures : result.blackCaptures;
  // Komi only applies to whoever is White and only matters if it's nonzero.
  const yourKomi = !youAreBlack ? result.komi : 0;
  const botsKomi = youAreBlack ? result.komi : 0;

  return (
    <div className="lesson-end-overlay" role="dialog" aria-modal="true" onClick={dismiss}>
      <div
        className={'lesson-end-card ' + (userWon ? 'lesson-end-win' : 'lesson-end-loss')}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="lesson-end-close" onClick={dismiss} aria-label="Close — see the board">
          ×
        </button>
        <div className="lesson-end-icon" aria-hidden>{userWon ? '🏆' : '🤖'}</div>
        <h2 className="lesson-end-title">
          {userWon ? 'You won!' : 'The bot won this one'}
        </h2>

        {isResignation ? (
          <p className="lesson-end-body">{winnerName} won by resignation.</p>
        ) : (
          <>
            <p className="lesson-end-rule">
              Each point = an empty spot you surrounded, or a stone you captured.
            </p>
            <div className="lesson-end-scoreboard">
              <ScoreSide
                label="You"
                total={youScore}
                territory={youTerritory}
                captures={youCaptures}
                komi={yourKomi}
                accent={youAreBlack ? 'black' : 'white'}
                highlight={userWon}
              />
              <div className="lesson-end-vs">vs</div>
              <ScoreSide
                label="Bot"
                total={botScore}
                territory={botTerritory}
                captures={botCaptures}
                komi={botsKomi}
                accent={youAreBlack ? 'white' : 'black'}
                highlight={!userWon}
              />
            </div>
            <p className="lesson-end-body">
              {userWon
                ? `You won by ${margin.toFixed(margin % 1 === 0 ? 0 : 1)} points. Nice game!`
                : `The bot won by ${margin.toFixed(margin % 1 === 0 ? 0 : 1)} points — try again!`}
            </p>
          </>
        )}

        <div className="lesson-end-actions">
          <button className="lesson-end-btn lesson-end-btn-secondary" onClick={onMoveOn}>
            Move on
          </button>
          <button className="lesson-end-btn lesson-end-btn-secondary" onClick={replayGame}>
            Play again
          </button>
          {onNextLesson && (
            <button className="lesson-end-btn lesson-end-btn-primary" onClick={onNextLesson}>
              Next lesson →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact panel shown in the right-side game controls once the user has
 * dismissed the full lesson game-end modal. Lets them re-open the explanation
 * without losing context.
 */
export function LessonGameEndPanel() {
  const lessonContext = useGameStore((s) => s.lessonContext);
  const phase = useGameStore((s) => s.phase);
  const result = useGameStore((s) => s.result);
  const playerColor = useGameStore((s) => s.playerColor);
  const reopen = useGameStore((s) => s.reopenLessonGameEnd);

  if (!lessonContext || phase !== 'finished' || !result) return null;

  const userWon = result.winner === playerColor;
  const margin = Math.abs(result.blackScore - result.whiteScore);
  const isResignation = result.blackScore === 0 && result.whiteScore === 0;

  return (
    <div className={'lesson-end-panel ' + (userWon ? 'lesson-end-panel-win' : 'lesson-end-panel-loss')}>
      <div className="lesson-end-panel-icon">{userWon ? '🏆' : '🤖'}</div>
      <div className="lesson-end-panel-text">
        <div className="lesson-end-panel-title">{userWon ? 'You won!' : 'Bot won'}</div>
        <div className="lesson-end-panel-margin">
          {isResignation ? 'by resignation' : `by ${margin.toFixed(margin % 1 === 0 ? 0 : 1)} pts`}
        </div>
      </div>
      <button className="lesson-end-panel-btn" onClick={reopen}>
        See results
      </button>
    </div>
  );
}

interface ScoreSideProps {
  label: string;
  total: number;
  territory: number;
  captures: number;
  komi: number;
  accent: 'black' | 'white';
  highlight: boolean;
}

function ScoreSide({ label, total, territory, captures, komi, accent, highlight }: ScoreSideProps) {
  return (
    <div className={'lesson-end-side' + (highlight ? ' lesson-end-side-winner' : '')}>
      <div className="lesson-end-side-header">
        <span className={'stone-icon ' + accent} />
        <span className="lesson-end-side-label">{label}</span>
      </div>
      <div className="lesson-end-side-total">{total}</div>
      <div className="lesson-end-side-detail">
        <div>
          <span className="lesson-end-side-num">{territory}</span> spots surrounded
        </div>
        <div>
          + <span className="lesson-end-side-num">{captures}</span> captures
        </div>
        {komi > 0 && (
          <div className="lesson-end-side-komi">
            + <span className="lesson-end-side-num">{komi}</span> bonus for going second
          </div>
        )}
      </div>
    </div>
  );
}
