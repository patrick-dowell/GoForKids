import { useEffect, useState } from 'react';
import './ScoringInProgressModal.css';

/** Delay before the escape hatch appears. Normal scoring resolves in a few
 *  seconds; this only surfaces when something is genuinely stuck, so a kid
 *  isn't tempted to bail out of a healthy (and soon-to-finish) scoring pass. */
const ESCAPE_AFTER_MS = 8000;

interface ScoringInProgressModalProps {
  /** Navigate home (App's goHome — also aborts the in-flight scoring request). */
  onGoHome: () => void;
}

/** Shown after the second consecutive pass while the backend runs KataGo's
 *  ownership analysis to identify dead stones. Suppresses the placeholder
 *  local-territory score (which doesn't account for dead stones) until the
 *  real final score arrives. Auto-dismissed by the gameStore when
 *  scoringInProgress flips back to false.
 *
 *  This overlay is the one full-screen blocker that could trap the user (it's
 *  not dismissible, and a hung backend used to leave it up forever). It now
 *  reveals a "Go home" escape after a short delay so it can't trap anyone — the
 *  20s request timeout in api/client.ts also self-clears it as a backstop. */
export function ScoringInProgressModal({ onGoHome }: ScoringInProgressModalProps) {
  const [showEscape, setShowEscape] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowEscape(true), ESCAPE_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="scoring-overlay" role="dialog" aria-live="polite" aria-busy="true">
      <div className="scoring-card">
        <div className="scoring-spinner" aria-hidden="true" />
        <div className="scoring-title">Calculating the final score</div>
        <div className="scoring-sub">Please wait — the AI is counting captures and dead stones.</div>
        {showEscape && (
          <button className="scoring-escape" onClick={onGoHome}>
            Taking too long? Go home
          </button>
        )}
      </div>
    </div>
  );
}
