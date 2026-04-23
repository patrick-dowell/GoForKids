import { useState } from 'react';
import { useGameStore, type GameMode } from '../store/gameStore';
import { Color } from '../engine/types';
import { AvatarPicker } from './AvatarPicker';
import { Avatar, BOT_AVATARS, type PlayerAvatarType } from './Avatar';

interface NewGameDialogProps {
  onClose: () => void;
}

const RANK_OPTIONS: { value: string; label: string; validated: boolean }[] = [
  { value: '30k', label: '30 kyu — Seedling', validated: true },
  { value: '18k', label: '18 kyu — Sprout', validated: true },
  { value: '15k', label: '15 kyu — Pebble', validated: true },
  { value: '12k', label: '12 kyu — Stream', validated: true },
  { value: '9k',  label: '9 kyu — Boulder', validated: true },
  { value: '6k',  label: '6 kyu — Ember', validated: true },
  { value: '3k',  label: '3 kyu — Storm', validated: false },
  { value: '1d',  label: '1 dan — Void', validated: false },
];

function rankOption(opt: { value: string; label: string; validated: boolean }) {
  return (
    <option key={opt.value} value={opt.value} disabled={!opt.validated}>
      {opt.label}{opt.validated ? '' : ' — coming soon'}
    </option>
  );
}

function getSavedAvatar(): PlayerAvatarType {
  try {
    const saved = localStorage.getItem('goforkids_avatar');
    if (saved === 'blackhole' || saved === 'nova' || saved === 'nebula') return saved;
  } catch {}
  return 'blackhole';
}

export function NewGameDialog({ onClose }: NewGameDialogProps) {
  const [gameMode, setGameMode] = useState<GameMode>('ai');
  const [playerColor, setPlayerColor] = useState<Color>(Color.Black);
  const [targetRank, setTargetRank] = useState('30k');
  const [handicap, setHandicap] = useState(0);
  const [isRanked, setIsRanked] = useState(false);
  const [playerAvatar, setPlayerAvatar] = useState<PlayerAvatarType>(getSavedAvatar());
  // Bot vs bot ranks
  const [blackRank, setBlackRank] = useState('18k');
  const [whiteRank, setWhiteRank] = useState('15k');

  const newGame = useGameStore((s) => s.newGame);
  const botInfo = BOT_AVATARS[gameMode === 'botvsbot' ? whiteRank : targetRank] || BOT_AVATARS['15k'];

  const handleStart = () => {
    localStorage.setItem('goforkids_avatar', playerAvatar);
    newGame({
      playerColor,
      targetRank: gameMode === 'botvsbot' ? blackRank : targetRank,
      isRanked,
      useBackend: gameMode !== 'local',
      playerAvatar,
      gameMode,
      handicap,
      blackRank: gameMode === 'botvsbot' ? blackRank : undefined,
      whiteRank: gameMode === 'botvsbot' ? whiteRank : undefined,
    });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog" style={{ width: 420 }}>
        <h2>New Game</h2>

        {/* Game Mode */}
        <div className="dialog-field">
          <label>Mode</label>
          <div className="mode-picker">
            <button
              className={`mode-btn ${gameMode === 'ai' ? 'selected' : ''}`}
              onClick={() => setGameMode('ai')}
            >
              Play vs AI
            </button>
            <button
              className={`mode-btn ${gameMode === 'botvsbot' ? 'selected' : ''}`}
              onClick={() => setGameMode('botvsbot')}
            >
              Bot vs Bot
            </button>
            <button
              className={`mode-btn ${gameMode === 'local' ? 'selected' : ''}`}
              onClick={() => setGameMode('local')}
            >
              Local
            </button>
          </div>
        </div>

        {/* Avatar picker — not for bot vs bot */}
        {gameMode !== 'botvsbot' && (
          <div className="dialog-field">
            <label>Your Avatar</label>
            <AvatarPicker selected={playerAvatar} onSelect={setPlayerAvatar} />
          </div>
        )}

        {/* Color picker — not for bot vs bot */}
        {gameMode !== 'botvsbot' && (
          <div className="dialog-field">
            <label>Play as</label>
            <div className="color-picker">
              <button
                className={`color-btn ${playerColor === Color.Black ? 'selected' : ''}`}
                onClick={() => setPlayerColor(Color.Black)}
              >
                <div className="stone-icon black" /> Black
              </button>
              <button
                className={`color-btn ${playerColor === Color.White ? 'selected' : ''}`}
                onClick={() => setPlayerColor(Color.White)}
              >
                <div className="stone-icon white" /> White
              </button>
            </div>
          </div>
        )}

        {/* Opponent rank (AI mode) */}
        {gameMode === 'ai' && (
          <div className="dialog-field">
            <label>Opponent</label>
            <div className="opponent-preview">
              <Avatar type={botInfo.type} size={40} />
              <select value={targetRank} onChange={(e) => setTargetRank(e.target.value)}>
                {RANK_OPTIONS.map(rankOption)}
              </select>
            </div>
          </div>
        )}

        {/* Dual rank selectors (Bot vs Bot mode) */}
        {gameMode === 'botvsbot' && (
          <>
            <div className="dialog-field">
              <label>Black Bot</label>
              <div className="opponent-preview">
                <Avatar type={(BOT_AVATARS[blackRank] || BOT_AVATARS['15k']).type} size={40} />
                <select value={blackRank} onChange={(e) => setBlackRank(e.target.value)}>
                  {RANK_OPTIONS.map(rankOption)}
                </select>
              </div>
            </div>
            <div className="dialog-field">
              <label>White Bot</label>
              <div className="opponent-preview">
                <Avatar type={(BOT_AVATARS[whiteRank] || BOT_AVATARS['15k']).type} size={40} />
                <select value={whiteRank} onChange={(e) => setWhiteRank(e.target.value)}>
                  {RANK_OPTIONS.map(rankOption)}
                </select>
              </div>
            </div>
          </>
        )}

        {/* Handicap stones */}
        <div className="dialog-field">
          <label>Handicap stones: {handicap === 0 ? 'None' : handicap}</label>
          <input
            type="range"
            min={0}
            max={9}
            value={handicap}
            onChange={(e) => setHandicap(parseInt(e.target.value))}
            className="handicap-slider"
          />
          <div className="handicap-labels">
            <span>Even</span>
            <span>9</span>
          </div>
        </div>

        {gameMode === 'ai' && (
          <div className="dialog-field">
            <label>
              <input type="checkbox" checked={isRanked} onChange={(e) => setIsRanked(e.target.checked)} />
              Ranked game
            </label>
          </div>
        )}

        <div className="dialog-actions">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleStart} className="btn btn-primary">
            {gameMode === 'botvsbot' ? 'Watch Game' : 'Start Game'}
          </button>
        </div>
      </div>
    </div>
  );
}
