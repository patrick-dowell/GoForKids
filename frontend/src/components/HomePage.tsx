import { Avatar, BOT_AVATARS } from './Avatar';
import { useAutoPlayStore } from '../store/autoPlayStore';
import { STARTING_RUNG, type BoardSize } from '../autoplay/matchmaker';
import './HomePage.css';

interface HomePageProps {
  onAutoPlay: () => void;
  onCustomMatch: () => void;
  onLibrary: () => void;
  onLearn: () => void;
  onProfile: (boardSize?: BoardSize) => void;
  onShowPrivacy?: () => void;
}

const BOTS = Object.entries(BOT_AVATARS); // Show all bots

export function HomePage({ onAutoPlay, onCustomMatch, onLibrary, onLearn, onProfile, onShowPrivacy }: HomePageProps) {
  // Each ladder's rank is read independently of which board is "active" — the
  // active board's rung lives on `rungState`, the other's on its `slots` entry.
  const rank9 = useAutoPlayStore((s) =>
    s.boardSize === 9 ? s.rungState.currentRung : (s.slots['9x9']?.rungState.currentRung ?? STARTING_RUNG),
  );
  const rank19 = useAutoPlayStore((s) =>
    s.boardSize === 19 ? s.rungState.currentRung : (s.slots['19x19']?.rungState.currentRung ?? STARTING_RUNG),
  );

  return (
    <div className="home-page">
      {/* Cosmic background with floating stones */}
      <div className="home-backdrop">
        <div className="home-stars" />
        <div className="home-stone home-stone-black" />
        <div className="home-stone home-stone-white" />
        <div className="home-stone home-stone-black-2" />
        <div className="home-stone home-stone-white-2" />
      </div>

      <div className="home-content">
        {/* Title */}
        <div className="home-title-block">
          <h1 className="home-title">GoForKids</h1>
          <p className="home-tagline">Learn Go. Play the universe.</p>
        </div>

        {/* Per-ladder rank chips — each opens that ladder's Profile (feature 23/24). */}
        <div className="home-rank-chips">
          <button
            type="button"
            className="home-rank-chip"
            onClick={() => onProfile(9)}
            aria-label={`Open 9×9 profile. Current 9×9 rank: ${rank9}`}
          >
            <span className="home-rank-chip-label">9×9</span>
            <span className="home-rank-chip-rank">{rank9}</span>
          </button>
          <button
            type="button"
            className="home-rank-chip"
            onClick={() => onProfile(19)}
            aria-label={`Open 19×19 profile. Current 19×19 rank: ${rank19}`}
          >
            <span className="home-rank-chip-label">19×19</span>
            <span className="home-rank-chip-rank">{rank19}</span>
          </button>
        </div>

        {/* Main actions */}
        <div className="home-actions">
          <button onClick={onLearn} className="home-btn home-btn-learn">
            <span className="home-btn-icon">✨</span>
            Learn to Play
          </button>
          <button onClick={onAutoPlay} className="home-btn home-btn-primary">
            <span className="home-btn-icon">▶</span>
            Play
          </button>
          <button onClick={onCustomMatch} className="home-btn home-btn-secondary">
            <span className="home-btn-icon">⚙</span>
            Custom Match
          </button>
          <button onClick={onLibrary} className="home-btn home-btn-secondary">
            <span className="home-btn-icon">📚</span>
            Library
          </button>
          <button onClick={() => onProfile()} className="home-btn home-btn-secondary">
            <span className="home-btn-icon">👤</span>
            Profile
          </button>
        </div>

        {/* Bot roster preview */}
        <div className="home-bots">
          <p className="home-bots-label">Choose your opponent</p>
          <div className="home-bots-row">
            {BOTS.map(([rank, info]) => (
              <div
                key={rank}
                className={`home-bot-preview${info.validated ? '' : ' home-bot-preview-locked'}`}
                title={info.validated ? '' : 'Coming soon — not yet calibrated'}
              >
                <Avatar type={info.type} size={44} />
                <span className="home-bot-name">{info.name}</span>
                <span className="home-bot-rank">{rank}</span>
                {!info.validated && <span className="home-bot-badge">Soon</span>}
              </div>
            ))}
          </div>
        </div>

        {onShowPrivacy && (
          <button className="home-privacy-link" onClick={onShowPrivacy}>
            Privacy & terms
          </button>
        )}
      </div>
    </div>
  );
}
