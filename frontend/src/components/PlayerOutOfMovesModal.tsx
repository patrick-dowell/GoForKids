import { useGameStore } from '../store/gameStore';
// Reuses the bot-passed-* CSS classes — same overlay / card / button look
// so the player gets a visually consistent "explainer modal" experience.
import './BotPassedModal.css';

/**
 * Modal that pops up when the player has no legal moves left on their
 * turn (lesson context). Tells the kid the game is effectively over
 * and offers a single Pass & end action that fires the player's pass
 * AND forces the bot's pass on the same tick — so the standard 2-pass
 * scoring path runs and the score modal shows the final tally.
 *
 * Why no Keep-playing / dismiss option: the player literally has no
 * legal moves, so "keep playing" would be a dead-end button. Resign
 * is still reachable from the side panel if they want a different
 * end-of-game path.
 */
export function PlayerOutOfMovesModal() {
  const open = useGameStore((s) => s.playerOutOfMoves);
  const phase = useGameStore((s) => s.phase);
  const passAndEndGame = useGameStore((s) => s.passAndEndGame);

  if (!open || phase !== 'playing') return null;

  return (
    <div className="bot-passed-overlay" role="dialog" aria-modal="true">
      <div className="bot-passed-card">
        <div className="bot-passed-icon" aria-hidden>🏁</div>
        <h2 className="bot-passed-title">No more moves!</h2>
        <p className="bot-passed-body">
          You don't have any legal moves left, so the game is effectively
          over. Tap below to pass and see how you did.
        </p>
        <div className="bot-passed-actions">
          <button
            className="bot-passed-btn bot-passed-btn-primary"
            onClick={passAndEndGame}
          >
            Pass &amp; end game
          </button>
        </div>
      </div>
    </div>
  );
}
