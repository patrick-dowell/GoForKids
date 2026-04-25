import { useState, useEffect } from 'react';
import { useGameStore, MAX_HANDICAP_BY_SIZE, type GameMode } from '../store/gameStore';
import { Color } from '../engine/types';
import { AvatarPicker } from './AvatarPicker';
import { Avatar, BOT_AVATARS, type PlayerAvatarType } from './Avatar';

interface NewGameDialogProps {
  onClose: () => void;
}

type RankOption = {
  value: string;
  label: string;
  validated: boolean;
  /** Board sizes this bot has a tuned profile for. Other sizes are disabled in the picker. */
  sizes: number[];
};

// Small boards only expose 30k / 15k / 6k (the calibrated tiers).
// Other ranks are 19x19-only — they'd technically run via the 19x19 fallback,
// but the rank labels would be misleading on smaller boards.
const ALL_SIZES = [9, 13, 19];
const NINETEEN_ONLY = [19];

const RANK_OPTIONS: RankOption[] = [
  { value: '30k', label: '30 kyu — Seedling', validated: true,  sizes: ALL_SIZES },
  { value: '18k', label: '18 kyu — Sprout',   validated: true,  sizes: NINETEEN_ONLY },
  { value: '15k', label: '15 kyu — Pebble',   validated: true,  sizes: ALL_SIZES },
  { value: '12k', label: '12 kyu — Stream',   validated: true,  sizes: NINETEEN_ONLY },
  { value: '9k',  label: '9 kyu — Boulder',   validated: true,  sizes: NINETEEN_ONLY },
  { value: '6k',  label: '6 kyu — Ember',     validated: true,  sizes: ALL_SIZES },
  { value: '3k',  label: '3 kyu — Storm',     validated: false, sizes: NINETEEN_ONLY },
  { value: '1d',  label: '1 dan — Void',      validated: false, sizes: NINETEEN_ONLY },
];

function isRankAvailable(opt: RankOption, size: number): boolean {
  return opt.validated && opt.sizes.includes(size);
}

function rankOption(opt: RankOption, size: number) {
  const sizeOK = opt.sizes.includes(size);
  const disabled = !opt.validated || !sizeOK;
  let suffix = '';
  if (!opt.validated) suffix = ' — coming soon';
  else if (!sizeOK) suffix = ` — ${size}×${size} not tuned`;
  return (
    <option key={opt.value} value={opt.value} disabled={disabled}>
      {opt.label}{suffix}
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

const BOARD_SIZE_OPTIONS = [
  { value: 9,  label: '9×9',  description: 'Quickest games — best for new players' },
  { value: 13, label: '13×13', description: 'Mid-size — short but full of strategy' },
  { value: 19, label: '19×19', description: 'Standard — full Go board' },
];

function getSavedBoardSize(): number {
  try {
    const saved = parseInt(localStorage.getItem('goforkids_board_size') || '', 10);
    if (saved === 9 || saved === 13 || saved === 19) return saved;
  } catch {}
  return 19;
}

export function NewGameDialog({ onClose }: NewGameDialogProps) {
  const [gameMode, setGameMode] = useState<GameMode>('ai');
  const [playerColor, setPlayerColor] = useState<Color>(Color.Black);
  const [targetRank, setTargetRank] = useState('30k');
  const [handicap, setHandicap] = useState(0);
  const [isRanked, setIsRanked] = useState(false);
  const [playerAvatar, setPlayerAvatar] = useState<PlayerAvatarType>(getSavedAvatar());
  const [boardSize, setBoardSize] = useState<number>(getSavedBoardSize());
  const maxHandicap = MAX_HANDICAP_BY_SIZE[boardSize] ?? 9;
  // Bot vs bot ranks
  const [blackRank, setBlackRank] = useState('18k');
  const [whiteRank, setWhiteRank] = useState('15k');

  // Re-clamp handicap and snap selected ranks when the user switches board size.
  useEffect(() => {
    if (handicap > maxHandicap) setHandicap(maxHandicap);
    const fallback = (rank: string): string => {
      const opt = RANK_OPTIONS.find((o) => o.value === rank);
      if (opt && isRankAvailable(opt, boardSize)) return rank;
      const next = RANK_OPTIONS.find((o) => isRankAvailable(o, boardSize));
      return next ? next.value : rank;
    };
    setTargetRank((r) => fallback(r));
    setBlackRank((r) => fallback(r));
    setWhiteRank((r) => fallback(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardSize]);

  const newGame = useGameStore((s) => s.newGame);
  const botInfo = BOT_AVATARS[gameMode === 'botvsbot' ? whiteRank : targetRank] || BOT_AVATARS['15k'];

  const handleStart = () => {
    localStorage.setItem('goforkids_avatar', playerAvatar);
    localStorage.setItem('goforkids_board_size', String(boardSize));
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
      boardSize,
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

        {/* Board size */}
        <div className="dialog-field">
          <label>Board size</label>
          <div className="mode-picker">
            {BOARD_SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`mode-btn ${boardSize === opt.value ? 'selected' : ''}`}
                onClick={() => setBoardSize(opt.value)}
                title={opt.description}
              >
                {opt.label}
              </button>
            ))}
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
                {RANK_OPTIONS.map((opt) => rankOption(opt, boardSize))}
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
                  {RANK_OPTIONS.map((opt) => rankOption(opt, boardSize))}
                </select>
              </div>
            </div>
            <div className="dialog-field">
              <label>White Bot</label>
              <div className="opponent-preview">
                <Avatar type={(BOT_AVATARS[whiteRank] || BOT_AVATARS['15k']).type} size={40} />
                <select value={whiteRank} onChange={(e) => setWhiteRank(e.target.value)}>
                  {RANK_OPTIONS.map((opt) => rankOption(opt, boardSize))}
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
            max={maxHandicap}
            value={handicap}
            onChange={(e) => setHandicap(parseInt(e.target.value))}
            className="handicap-slider"
          />
          <div className="handicap-labels">
            <span>Even</span>
            <span>{maxHandicap}</span>
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
