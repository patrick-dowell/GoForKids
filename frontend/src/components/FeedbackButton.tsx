import { useGameStore } from '../store/gameStore';
import './FeedbackButton.css';

/**
 * Floating "Send feedback" button. Opens VITE_FEEDBACK_URL with current
 * gameId and rank prefilled in the body. Set VITE_FEEDBACK_URL to a mailto:
 * or a GitHub issue URL with placeholders {gameId} / {context}, e.g.
 *   mailto:you@example.com?subject=GoForKids%20feedback&body={context}
 *   https://github.com/you/repo/issues/new?title=Feedback&body={context}
 *
 * When unset (local dev), the button doesn't render.
 */
export function FeedbackButton() {
  const gameId = useGameStore((s) => s.gameId);
  const targetRank = useGameStore((s) => s.targetRank);

  const template = import.meta.env.VITE_FEEDBACK_URL;
  if (!template) return null;

  function handleClick() {
    const lines = [
      'What happened (one or two sentences):',
      '',
      '',
      '— Context —',
      `Game ID: ${gameId ?? '(none)'}`,
      `Rank: ${targetRank}`,
      `Page: ${window.location.href}`,
    ];
    const context = encodeURIComponent(lines.join('\n'));
    const url = template!.replace('{context}', context).replace('{gameId}', gameId ?? '');
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <button className="feedback-button" onClick={handleClick} aria-label="Send feedback">
      💬 Feedback
    </button>
  );
}
