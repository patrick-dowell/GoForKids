import { useGameStore } from '../store/gameStore';
import { BOT_TROUBLE_BODY, BOT_TROUBLE_TITLE, LEAVE, TRY_AGAIN } from './botsAwayCopy';
import './BotPassedModal.css';

/** Covers the board while a game waits on a bot that did not answer
 *  (gameStore botTrouble): the game could not start, a move did not come,
 *  or Finish Game stopped. Nothing on the board changes until the child
 *  chooses: try again, or leave for home. */
export function BotTroubleCard({ onLeave }: { onLeave: () => void }) {
  const trouble = useGameStore((s) => s.botTrouble);
  const retry = useGameStore((s) => s.retryBot);
  if (!trouble) return null;
  return <BotTroubleView onRetry={retry} onLeave={onLeave} />;
}

export function BotTroubleView({ onRetry, onLeave }: { onRetry: () => void; onLeave: () => void }) {
  return (
    <div className="bot-passed-overlay bot-trouble" role="alertdialog" aria-modal="true" aria-labelledby="bot-trouble-title">
      <div className="bot-passed-card">
        <div className="bot-passed-icon" aria-hidden>🤖</div>
        <h2 id="bot-trouble-title" className="bot-passed-title">{BOT_TROUBLE_TITLE}</h2>
        <p className="bot-passed-body">{BOT_TROUBLE_BODY}</p>
        <div className="bot-passed-actions">
          <button className="bot-passed-btn bot-passed-btn-secondary" onClick={onLeave}>
            {LEAVE}
          </button>
          <button className="bot-passed-btn bot-passed-btn-primary" onClick={onRetry}>
            {TRY_AGAIN}
          </button>
        </div>
      </div>
    </div>
  );
}
