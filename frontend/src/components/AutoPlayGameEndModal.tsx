import { useGameStore } from '../store/gameStore';
import { useAutoPlayStore } from '../store/autoPlayStore';
import { Color } from '../engine/types';
import { WINS_TO_PROMOTE, nextRung } from '../autoplay/matchmaker';
import './AutoPlayGameEndModal.css';


interface AutoPlayGameEndModalProps {
  /** Called when the player taps "Next match" — App returns to AutoPlayView. */
  onNextMatch: () => void;
  /** Called when the player taps "Home" — App returns to the home page. */
  onHome: () => void;
}

/**
 * Post-game modal for auto-play matches. Sits over the finished board with
 * a result line + wins-counter update + Next match / Home actions. The
 * RankUpOverlay (when applicable) renders on top of this via z-index.
 *
 * Gated by `autoplayContext` so it doesn't fire for Custom Match or
 * lesson games (which have their own end-of-game UI).
 */
export function AutoPlayGameEndModal({ onNextMatch, onHome }: AutoPlayGameEndModalProps) {
  const autoplayContext = useGameStore((s) => s.autoplayContext);
  const phase = useGameStore((s) => s.phase);
  const result = useGameStore((s) => s.result);
  const playerColor = useGameStore((s) => s.playerColor);
  const showRankUp = useAutoPlayStore((s) => s.showRankUp);
  const rungState = useAutoPlayStore((s) => s.rungState);
  // Compute derived outside the selector to avoid React's getSnapshot warning.
  const atWall = rungState.winsAtCurrentRung >= WINS_TO_PROMOTE;

  if (!autoplayContext || phase !== 'finished' || !result) return null;
  // Stay hidden while the rank-up overlay is sitting on top — the spec wants
  // the player to dismiss that first, then see the result summary underneath.
  if (showRankUp) return null;

  const userWon = result.winner === playerColor;
  const margin = Math.abs(result.blackScore - result.whiteScore);
  const isResignation = result.blackScore === 0 && result.whiteScore === 0;
  const winnerName = result.winner === Color.Black ? 'Black' : 'White';

  const winsRemaining = Math.max(0, WINS_TO_PROMOTE - rungState.winsAtCurrentRung);
  const next = nextRung(rungState.currentRung);

  const progressLine = (() => {
    if (atWall) {
      return `You've earned promotion — but the ${next ?? 'next'} bot is still being calibrated.`;
    }
    if (winsRemaining === 0) {
      return `Promoted to ${rungState.currentRung}.`;
    }
    if (winsRemaining === WINS_TO_PROMOTE) {
      return `Win ${WINS_TO_PROMOTE} games at ${rungState.currentRung} to promote.`;
    }
    return `${rungState.winsAtCurrentRung} of ${WINS_TO_PROMOTE} wins toward promotion.`;
  })();

  return (
    <div className="autoplay-end-overlay" role="dialog" aria-modal="true">
      <div className={'autoplay-end-card ' + (userWon ? 'autoplay-end-win' : 'autoplay-end-loss')}>
        <div className="autoplay-end-icon" aria-hidden>{userWon ? '🏆' : '🤖'}</div>
        <h2 className="autoplay-end-title">
          {userWon ? 'You won!' : 'The bot won this one'}
        </h2>

        <p className="autoplay-end-margin">
          {isResignation
            ? `${winnerName} won by resignation.`
            : `${winnerName} won by ${margin.toFixed(margin % 1 === 0 ? 0 : 1)} points.`
          }
        </p>

        <div className="autoplay-end-progress">
          <div className="autoplay-end-progress-bar">
            {Array.from({ length: WINS_TO_PROMOTE }).map((_, i) => (
              <div
                key={i}
                className={'autoplay-end-progress-seg' + (i < rungState.winsAtCurrentRung ? ' autoplay-end-progress-seg-filled' : '')}
              />
            ))}
          </div>
          <div className="autoplay-end-progress-label">{progressLine}</div>
        </div>

        <div className="autoplay-end-actions">
          <button className="autoplay-end-btn autoplay-end-btn-secondary" onClick={onHome}>
            Home
          </button>
          <button className="autoplay-end-btn autoplay-end-btn-primary" onClick={onNextMatch}>
            Next match →
          </button>
        </div>
      </div>
    </div>
  );
}
