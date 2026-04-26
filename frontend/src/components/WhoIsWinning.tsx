import { useGameStore } from '../store/gameStore';
import { Color } from '../engine/types';
import './WhoIsWinning.css';

/**
 * Kid-friendly score readout for the lesson 5 first-game flow. No chart, no
 * point counts — just "Black is ahead" / "White is ahead" with a horizontal
 * bar that leans toward the leader. Mirrors the same scoreHistory the regular
 * ScoreGraph reads, so the source of truth stays the same.
 */
export function WhoIsWinning() {
  const history = useGameStore((s) => s.scoreHistory);
  const playerColor = useGameStore((s) => s.playerColor);

  // Pre-game / not enough samples — show neutral state.
  const lead = history.length > 0 ? history[history.length - 1].lead : 0;
  const youArePlaying = playerColor === Color.Black ? 'black' : 'white';

  // Map the lead to a 0..1 fill for each side. Bigger leads saturate the bar
  // but a small lead shouldn't look like a blowout — soft easing.
  const SCALE = 8; // 8 points = bar fully one side
  const blackShare = 0.5 + 0.5 * Math.tanh(lead / SCALE);
  const whiteShare = 1 - blackShare;
  const blackPct = (blackShare * 100).toFixed(1);
  const whitePct = (whiteShare * 100).toFixed(1);

  // Headline — frames the lead from the player's perspective, since that's
  // what kids care about ("am I winning?").
  let headline: string;
  let headlineColor: 'black' | 'white' | 'even';
  const youAhead = (youArePlaying === 'black' && lead > 0.5) || (youArePlaying === 'white' && lead < -0.5);
  const botAhead = (youArePlaying === 'black' && lead < -0.5) || (youArePlaying === 'white' && lead > 0.5);
  if (youAhead) {
    headline = "You're winning!";
    headlineColor = youArePlaying;
  } else if (botAhead) {
    headline = 'Bot is winning';
    headlineColor = youArePlaying === 'black' ? 'white' : 'black';
  } else {
    headline = "It's even — keep going!";
    headlineColor = 'even';
  }

  return (
    <div className="who-winning">
      <div className="who-winning-label">Who's winning</div>
      <div className={`who-winning-headline who-winning-headline-${headlineColor}`}>
        {headline}
      </div>
      <div className="who-winning-bar" aria-hidden>
        <div className="who-winning-bar-black" style={{ width: `${blackPct}%` }} />
        <div className="who-winning-bar-white" style={{ width: `${whitePct}%` }} />
      </div>
      <div className="who-winning-legend">
        <span className="who-winning-side"><span className="stone-icon black" /> Black</span>
        <span className="who-winning-side"><span className="stone-icon white" /> White</span>
      </div>
    </div>
  );
}
