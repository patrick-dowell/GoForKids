import './ScoringInProgressModal.css';

/** Shown after the second consecutive pass while the backend runs KataGo's
 *  ownership analysis to identify dead stones. Suppresses the placeholder
 *  local-territory score (which doesn't account for dead stones) until the
 *  real final score arrives. Auto-dismissed by the gameStore when
 *  scoringInProgress flips back to false. */
export function ScoringInProgressModal() {
  return (
    <div className="scoring-overlay" role="dialog" aria-live="polite" aria-busy="true">
      <div className="scoring-card">
        <div className="scoring-spinner" aria-hidden="true" />
        <div className="scoring-title">Calculating the final score</div>
        <div className="scoring-sub">Please wait — the AI is counting captures and dead stones.</div>
      </div>
    </div>
  );
}
