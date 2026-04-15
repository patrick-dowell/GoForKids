import { Avatar, BOT_AVATARS, PLAYER_AVATARS } from './Avatar';
import './HomePage.css';

interface HomePageProps {
  onNewGame: () => void;
  onLibrary: () => void;
}

const BOTS = Object.entries(BOT_AVATARS); // Show all bots

export function HomePage({ onNewGame, onLibrary }: HomePageProps) {
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

        {/* Main actions */}
        <div className="home-actions">
          <button onClick={onNewGame} className="home-btn home-btn-primary">
            <span className="home-btn-icon">▶</span>
            Play
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
              <div key={rank} className="home-bot-preview">
                <Avatar type={info.type} size={44} />
                <span className="home-bot-name">{info.name}</span>
                <span className="home-bot-rank">{rank}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
