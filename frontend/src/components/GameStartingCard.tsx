import './ScoringInProgressModal.css';

/** Covers the board while a new game waits at cold start for the device to
 *  say where its bots play (gameStore startingGame, at most 10 s). The board
 *  underneath is the last one, so nothing may be tapped. Shares the scoring
 *  card's look. */
export function GameStartingCard() {
  return (
    <div className="scoring-overlay game-starting" role="dialog" aria-live="polite" aria-busy="true">
      <div className="scoring-card">
        <div className="scoring-spinner" aria-hidden="true" />
        <div className="scoring-title">Getting your game ready</div>
      </div>
    </div>
  );
}
