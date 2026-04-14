import { Avatar, type AvatarType } from './Avatar';
import { Color } from '../engine/types';

interface PlayerCardProps {
  name: string;
  avatarType: AvatarType;
  stoneColor: Color;
  captures: number;       // Stones this player captured (enemy prisoners)
  isActive: boolean;      // Is it this player's turn?
  isThinking?: boolean;   // AI thinking indicator
  isTop?: boolean;        // Position: top = opponent, bottom = player
}

export function PlayerCard({
  name,
  avatarType,
  stoneColor,
  captures,
  isActive,
  isThinking = false,
  isTop = false,
}: PlayerCardProps) {
  const prisonerColor = stoneColor === Color.Black ? 'white' : 'black';
  const maxVisible = 50; // 10 per row × 5 rows
  const visibleCount = Math.min(captures, maxVisible);
  const hasOverflow = captures > maxVisible;

  return (
    <div className={`player-card ${isActive ? 'player-card-active' : ''} ${isTop ? 'player-card-top' : 'player-card-bottom'}`}>
      <div className="player-card-header">
        <Avatar type={avatarType} size={56} active={isActive} thinking={isThinking} />
        <div className="player-card-info">
          <div className="player-card-name">{name}</div>
          <div className="player-card-status">
            {isThinking ? 'Thinking...' : isActive ? 'Playing' : ''}
          </div>
        </div>
      </div>

      <div className="prisoner-tray">
        <div className="prisoner-label">
          Captures
          {captures > 0 && <span className="prisoner-count">{captures}</span>}
        </div>
        <div className="prisoner-stones">
          {Array.from({ length: visibleCount }, (_, i) => (
            <div
              key={i}
              className={`prisoner-stone prisoner-stone-${prisonerColor}`}
              style={{
                animationDelay: `${i * 0.05}s`,
              }}
            />
          ))}
          {hasOverflow && (
            <div className="prisoner-overflow">+{captures - maxVisible} more</div>
          )}
          {captures === 0 && (
            <div className="prisoner-empty">No captures yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
