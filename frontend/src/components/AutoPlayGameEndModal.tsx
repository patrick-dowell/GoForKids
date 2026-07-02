import { useGameStore } from '../store/gameStore';
import { useAutoPlayStore, UNDO_BANK_MAX } from '../store/autoPlayStore';
import { Color } from '../engine/types';
import { winsToPromote, lossSetbackActive, nextRung } from '../autoplay/matchmaker';
import { useGameReviewStore } from '../store/gameReviewStore';
import { EndHeroAvatar, ScoreSide } from './GameEndModal';
import './AutoPlayGameEndModal.css';
// Pulls in the shared lesson-end-* close button, scoreboard, and panel styles.
import './LessonGameEndModal.css';


interface AutoPlayGameEndModalProps {
  /** Called when the player taps "Next match" — App returns to AutoPlayView. */
  onNextMatch: () => void;
  /** Called when the player taps "Home" — App returns to the home page. */
  onHome: () => void;
}

/**
 * Post-game modal for auto-play matches. Sits over the finished board with
 * a result line + score breakdown + wins-counter update + Next match / Home
 * actions. The RankUpOverlay (when applicable) renders on top of this via
 * z-index.
 *
 * Dismissible (× / overlay click / Close) so the player can see the final
 * board. After dismissal, AutoPlayGameEndPanel surfaces a "See results"
 * pill in the side panel for reopening.
 *
 * Gated by `autoplayContext` so it doesn't fire for Custom Match or
 * lesson games (which have their own end-of-game UI).
 */
export function AutoPlayGameEndModal({ onNextMatch, onHome }: AutoPlayGameEndModalProps) {
  const autoplayContext = useGameStore((s) => s.autoplayContext);
  const phase = useGameStore((s) => s.phase);
  const result = useGameStore((s) => s.result);
  const playerColor = useGameStore((s) => s.playerColor);
  const playerAvatar = useGameStore((s) => s.playerAvatar);
  const botAvatar = useGameStore((s) => s.botAvatar);
  const dismissed = useGameStore((s) => s.gameEndDismissed);
  const dismiss = useGameStore((s) => s.dismissGameEnd);
  const showRankUp = useAutoPlayStore((s) => s.showRankUp);
  const rungState = useAutoPlayStore((s) => s.rungState);
  const boardSize = useAutoPlayStore((s) => s.boardSize);
  const pendingFromRung = useAutoPlayStore((s) => s.pendingFromRung);
  const undoBank = useAutoPlayStore((s) => s.undoBank);
  // Compute derived outside the selector to avoid React's getSnapshot warning.
  const atWall = rungState.winsAtCurrentRung >= winsToPromote(rungState.currentRung, boardSize);

  if (!autoplayContext || phase !== 'finished' || !result) return null;
  // Stay hidden while the rank-up overlay is sitting on top — the spec wants
  // the player to dismiss that first, then see the result summary underneath.
  if (showRankUp) return null;
  if (dismissed) return null;

  const userWon = result.winner === playerColor;
  const margin = Math.abs(result.blackScore - result.whiteScore);
  const isResignation = result.blackScore === 0 && result.whiteScore === 0;
  const winnerName = result.winner === Color.Black ? 'Black' : 'White';

  // `pendingFromRung` survives the rank-up dismissal, so when it's non-null
  // we know THIS game's win caused the promotion. Render a celebratory
  // state instead of the usual wins-toward-next-rung text: all three
  // progress segments lit gold, "Congrats on reaching N" copy.
  const justPromoted = pendingFromRung !== null;
  const next = nextRung(rungState.currentRung, boardSize);
  // When this game just caused a promotion, the celebration bar shows the bar
  // the player actually completed — the FROM rung's threshold, fully lit.
  const winsNeeded = winsToPromote(
    justPromoted && pendingFromRung ? pendingFromRung : rungState.currentRung,
    boardSize,
  );
  const filledSegs = justPromoted ? winsNeeded : rungState.winsAtCurrentRung;
  const winsRemaining = Math.max(0, winsNeeded - rungState.winsAtCurrentRung);

  const progressLine = (() => {
    if (justPromoted) {
      return `Congratulations on reaching ${rungState.currentRung}!`;
    }
    if (atWall) {
      return `You've earned promotion — but the ${next ?? 'next'} bot is still being calibrated.`;
    }
    if (winsRemaining === 0) {
      return `Promoted to ${rungState.currentRung}.`;
    }
    if (winsRemaining === winsNeeded) {
      return `Win ${winsNeeded} games at ${rungState.currentRung} to promote.`;
    }
    return `${rungState.winsAtCurrentRung} of ${winsNeeded} wins toward promotion.`;
  })();

  // Feature 25: from 12k up, a loss sets progress back one win. Surface the
  // rule right when it bites so the shrinking bar never feels mysterious.
  const showSetbackNote =
    result.winner !== playerColor && !justPromoted && lossSetbackActive(rungState.currentRung, boardSize);

  return (
    <div className="autoplay-end-overlay" role="dialog" aria-modal="true" onClick={dismiss}>
      <div
        className={'autoplay-end-card ' + (userWon ? 'autoplay-end-win' : 'autoplay-end-loss')}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="lesson-end-close" onClick={dismiss} aria-label="Close — see the board">
          ×
        </button>
        <EndHeroAvatar type={userWon ? playerAvatar : botAvatar} won={userWon} />
        <h2 className="autoplay-end-title">
          {userWon ? 'You won!' : 'The bot won this one'}
        </h2>

        {isResignation ? (
          <p className="autoplay-end-margin">{winnerName} won by resignation.</p>
        ) : (
          <>
            <div className="lesson-end-scoreboard">
              <ScoreSide
                label={playerColor === Color.Black ? 'You' : 'Bot'}
                total={result.blackScore}
                territory={result.blackTerritory}
                captures={result.blackCaptures}
                komi={0}
                accent="black"
                highlight={result.winner === Color.Black}
              />
              <div className="lesson-end-vs">vs</div>
              <ScoreSide
                label={playerColor === Color.White ? 'You' : 'Bot'}
                total={result.whiteScore}
                territory={result.whiteTerritory}
                captures={result.whiteCaptures}
                komi={result.komi}
                accent="white"
                highlight={result.winner === Color.White}
              />
            </div>
            <p className="autoplay-end-margin">
              {winnerName} won by {margin.toFixed(margin % 1 === 0 ? 0 : 1)} points
            </p>
          </>
        )}

        <div className="autoplay-end-progress">
          <div className="autoplay-end-progress-bar">
            {Array.from({ length: winsNeeded }).map((_, i) => (
              <div
                key={i}
                className={'autoplay-end-progress-seg' + (i < filledSegs ? ' autoplay-end-progress-seg-filled' : '')}
              />
            ))}
          </div>
          <div className="autoplay-end-progress-label">{progressLine}</div>
          {showSetbackNote && (
            <div className="autoplay-end-progress-note">
              At {rungState.currentRung}, a loss sets your progress back one win.
            </div>
          )}
          <div className="autoplay-end-progress-note">
            🔄 Undo bank: {undoBank}/{UNDO_BANK_MAX}
            {undoBank < UNDO_BANK_MAX ? ' · +1 earned this game' : ' · full'}
          </div>
        </div>

        <button
          className="autoplay-end-review-btn"
          onClick={() => useGameReviewStore.getState().open()}
        >
          ✨ See your Play of the Game
        </button>

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

/**
 * Compact "See results" pill rendered in the side panel after the player
 * dismisses the auto-play game-end modal — gives them a way back to the
 * full scoreboard + Next match / Home actions without having to navigate
 * away. Mirrors GameEndPanel / LessonGameEndPanel.
 */
export function AutoPlayGameEndPanel() {
  const autoplayContext = useGameStore((s) => s.autoplayContext);
  const phase = useGameStore((s) => s.phase);
  const result = useGameStore((s) => s.result);
  const playerColor = useGameStore((s) => s.playerColor);
  const reopen = useGameStore((s) => s.reopenGameEnd);

  if (!autoplayContext || phase !== 'finished' || !result) return null;

  const userWon = result.winner === playerColor;
  const margin = Math.abs(result.blackScore - result.whiteScore);
  const isResignation = result.blackScore === 0 && result.whiteScore === 0;

  return (
    <div className={'lesson-end-panel ' + (userWon ? 'lesson-end-panel-win' : '')}>
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
