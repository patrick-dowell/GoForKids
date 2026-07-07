import { useAutoPlayStore } from '../store/autoPlayStore';
import './RankUpOverlay.css';

/**
 * Rank-up celebration overlay. Fires once after a game-result win pushes
 * `winsAtCurrentRung` to the rung-specific `winsToPromote` threshold and the next rung is validated.
 * Sticky until tap — sits over the `AutoPlayGameEndModal` so the player
 * sees the new rank announced before the result summary.
 */
export function RankUpOverlay() {
  const showRankUp = useAutoPlayStore((s) => s.showRankUp);
  const pendingFromRung = useAutoPlayStore((s) => s.pendingFromRung);
  const currentRung = useAutoPlayStore((s) => s.rungState.currentRung);
  const dismiss = useAutoPlayStore((s) => s.dismissRankUp);

  if (!showRankUp || !pendingFromRung) return null;

  return (
    <div className="rankup-overlay" role="dialog" aria-modal="true">
      <div className="rankup-stars" />
      <div className="rankup-content">
        <div className="rankup-badge">★</div>
        <div className="rankup-eyebrow">Rank up!</div>
        <h1 className="rankup-title">You're now {currentRung}</h1>
        <div className="rankup-transition">
          <span className="rankup-rung-from">{pendingFromRung}</span>
          <span className="rankup-arrow">→</span>
          <span className="rankup-rung-to">{currentRung}</span>
        </div>
        <p className="rankup-sub">
          Congratulations on your wins — onward to a tougher opponent.
        </p>
        <button className="rankup-btn" onClick={dismiss}>
          Continue
        </button>
      </div>
    </div>
  );
}
