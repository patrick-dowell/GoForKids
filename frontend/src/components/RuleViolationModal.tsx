import { useGameStore } from '../store/gameStore';
import './BotPassedModal.css';

/**
 * Modal that pops up when a player's move is rejected by a *rule* — ko or
 * suicide. New players see the move just "didn't work" with no explanation,
 * so we explain what happened in kid-friendly terms and offer a single
 * "Got it" dismiss. Occupied moves stay silent (intuitive).
 */
export function RuleViolationModal() {
  const violation = useGameStore((s) => s.ruleViolation);
  const dismiss = useGameStore((s) => s.dismissRuleViolation);

  if (!violation) return null;

  const title = violation === 'ko' ? "That's a ko move!" : "That's a suicide move!";
  const icon = violation === 'ko' ? '🔁' : '💨';
  const body = violation === 'ko'
    ? "You can't take a stone back right away if it would put the board exactly the way it was. We call this the ko rule — it stops the same capture from happening over and over forever. Try a different spot first, then you can come back to this one."
    : "A stone needs at least one empty neighbor (a 'breathing space') to stay on the board. If you place a stone where it would have zero, it gets captured immediately — so the game doesn't let you put it there. Look for a spot with space next to it, or a move that captures the surrounding stones first.";

  return (
    <div className="bot-passed-overlay" role="dialog" aria-modal="true">
      <div className="bot-passed-card">
        <div className="bot-passed-icon" aria-hidden>{icon}</div>
        <h2 className="bot-passed-title">{title}</h2>
        <p className="bot-passed-body">{body}</p>
        <div className="bot-passed-actions">
          <button
            className="bot-passed-btn bot-passed-btn-primary"
            onClick={dismiss}
            style={{ flex: 1 }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
