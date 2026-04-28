import { Avatar, type AvatarType } from './Avatar';
import { Color } from '../engine/types';

interface PlayerCardProps {
  name: string;
  avatarType: AvatarType;
  stoneColor: Color;
  captures: number;       // Stones this player captured (enemy prisoners)
  komi?: number;          // Compensation points awarded (only White; 0 for Black)
  isActive: boolean;      // Is it this player's turn?
  isThinking?: boolean;   // AI thinking indicator
  isTop?: boolean;        // Position: top = opponent, bottom = player
}

export function PlayerCard({
  name,
  avatarType,
  stoneColor,
  captures,
  komi = 0,
  isActive,
  isThinking = false,
  isTop = false,
}: PlayerCardProps) {
  const prisonerColor = stoneColor === Color.Black ? 'white' : 'black';
  const maxVisible = 50; // 10 per row × 5 rows
  const visibleCount = Math.min(captures, maxVisible);
  const hasOverflow = captures > maxVisible;

  // Komi is awarded only to White, in points. Render whole points as enemy
  // (black) prisoner stones so it reads as "points already in the bank,"
  // and the fractional half (typically 0.5) as a half-stone — kids who can't
  // yet read decimals can still see "six and a half stones."
  const wholeKomi = Math.floor(komi);
  const hasHalf = komi - wholeKomi >= 0.5;
  const komiLabel = Number.isInteger(komi) ? `${komi}` : `${komi.toFixed(1)}`;

  return (
    <div className={`player-card player-card-${stoneColor === Color.White ? 'white' : 'black'} ${isActive ? 'player-card-active' : ''} ${isTop ? 'player-card-top' : 'player-card-bottom'}`}>
      <div className="player-card-header">
        <Avatar type={avatarType} size={56} active={isActive} thinking={isThinking} />
        <div className="player-card-info">
          <div className="player-card-name">{name}</div>
          <div className="player-card-status">
            {isThinking ? 'Thinking...' : isActive ? 'Playing' : ''}
          </div>
        </div>
      </div>

      {komi > 0 && (
        <div className="komi-tray" title="Komi: bonus points awarded to White for going second">
          <div className="prisoner-label">
            Komi
            <span className="prisoner-count">{komiLabel}</span>
          </div>
          <div className="prisoner-stones">
            {Array.from({ length: wholeKomi }, (_, i) => (
              <div key={`k${i}`} className={`prisoner-stone prisoner-stone-${prisonerColor}`} />
            ))}
            {hasHalf && (
              <div className={`prisoner-stone prisoner-stone-${prisonerColor} prisoner-stone-half`} />
            )}
          </div>
        </div>
      )}

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
