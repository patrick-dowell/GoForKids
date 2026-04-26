import { useGameStore } from '../store/gameStore';
import './BotPassedModal.css';

/**
 * Modal that pops up when the bot passes mid-game. Newcomers don't know what
 * a pass means, so we explain it and offer the two real choices: keep playing
 * (more territory) or pass back (end the game and score it).
 */
export function BotPassedModal() {
  const open = useGameStore((s) => s.botJustPassed);
  const phase = useGameStore((s) => s.phase);
  const dismiss = useGameStore((s) => s.dismissBotPassed);
  const pass = useGameStore((s) => s.pass);

  // Only meaningful while the game is still on. If two passes already ended
  // the game, the regular game-over UI takes over.
  if (!open || phase !== 'playing') return null;

  return (
    <div className="bot-passed-overlay" role="dialog" aria-modal="true">
      <div className="bot-passed-card">
        <div className="bot-passed-icon" aria-hidden>🤖</div>
        <h2 className="bot-passed-title">The bot passed!</h2>
        <p className="bot-passed-body">
          That means the bot thinks the game is over. You can keep playing
          if there are still good moves, or pass to end the game and see
          who won.
        </p>
        <div className="bot-passed-actions">
          <button className="bot-passed-btn bot-passed-btn-secondary" onClick={dismiss}>
            Keep playing
          </button>
          <button
            className="bot-passed-btn bot-passed-btn-primary"
            onClick={() => { dismiss(); pass(); }}
          >
            Pass &amp; end game
          </button>
        </div>
      </div>
    </div>
  );
}
