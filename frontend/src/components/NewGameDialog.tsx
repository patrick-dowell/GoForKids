import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { Color } from '../engine/types';
import { AvatarPicker } from './AvatarPicker';
import { Avatar, BOT_AVATARS, type PlayerAvatarType } from './Avatar';

interface NewGameDialogProps {
  onClose: () => void;
}

const RANK_OPTIONS = [
  { value: '15k', label: '15 kyu — Pebble' },
  { value: '12k', label: '12 kyu — Stream' },
  { value: '10k', label: '10 kyu — Boulder' },
  { value: '8k', label: '8 kyu — Ember' },
  { value: '5k', label: '5 kyu — Storm' },
  { value: '3k', label: '3 kyu — Void' },
];

function getSavedAvatar(): PlayerAvatarType {
  try {
    const saved = localStorage.getItem('goforkids_avatar');
    if (saved === 'stargazer' || saved === 'nova' || saved === 'nebula') return saved;
  } catch {}
  return 'stargazer';
}

export function NewGameDialog({ onClose }: NewGameDialogProps) {
  const [playerColor, setPlayerColor] = useState<Color>(Color.Black);
  const [targetRank, setTargetRank] = useState('15k');
  const [isRanked, setIsRanked] = useState(false);
  const [vsAI, setVsAI] = useState(true);
  const [playerAvatar, setPlayerAvatar] = useState<PlayerAvatarType>(getSavedAvatar());
  const newGame = useGameStore((s) => s.newGame);

  const botInfo = BOT_AVATARS[targetRank] || BOT_AVATARS['15k'];

  const handleStart = () => {
    localStorage.setItem('goforkids_avatar', playerAvatar);
    newGame({
      playerColor,
      targetRank,
      isRanked,
      useBackend: vsAI,
      playerAvatar,
    });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog" style={{ width: 400 }}>
        <h2>New Game</h2>

        <div className="dialog-field">
          <label>Your Avatar</label>
          <AvatarPicker selected={playerAvatar} onSelect={setPlayerAvatar} />
        </div>

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

        <div className="dialog-field">
          <label>Opponent</label>
          <div className="opponent-preview">
            <Avatar type={botInfo.type} size={40} />
            <select
              value={targetRank}
              onChange={(e) => setTargetRank(e.target.value)}
            >
              {RANK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="dialog-field">
          <label>
            <input
              type="checkbox"
              checked={vsAI}
              onChange={(e) => setVsAI(e.target.checked)}
            />
            Play vs AI (requires backend)
          </label>
        </div>

        <div className="dialog-field">
          <label>
            <input
              type="checkbox"
              checked={isRanked}
              onChange={(e) => setIsRanked(e.target.checked)}
            />
            Ranked game
          </label>
        </div>

        <div className="dialog-actions">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={handleStart} className="btn btn-primary">
            Start Game
          </button>
        </div>
      </div>
    </div>
  );
}
