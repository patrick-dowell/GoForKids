import { Avatar, BOT_AVATARS } from './Avatar';
import { useAutoPlayStore } from '../store/autoPlayStore';
import './HomePage.css';

interface HomePageProps {
  onAutoPlay: () => void;
  onCustomMatch: () => void;
  onLibrary: () => void;
  onLearn: () => void;
  onShowPrivacy?: () => void;
}

const BOTS = Object.entries(BOT_AVATARS); // Show all bots

export function HomePage({ onAutoPlay, onCustomMatch, onLibrary, onLearn, onShowPrivacy }: HomePageProps) {
  const currentRung = useAutoPlayStore((s) => s.rungState.currentRung);

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

        {/* Rank chip — tap target reserved for the Profile page (feature 23). */}
        <div className="home-rank-chip" aria-label={`Current 19×19 rank: ${currentRung}`}>
          <span className="home-rank-chip-label">19×19</span>
          <span className="home-rank-chip-rank">{currentRung}</span>
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
