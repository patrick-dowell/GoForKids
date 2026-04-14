/**
 * CSS-drawn avatars for players and AI bots.
 * No image files — pure CSS gradients, shadows, and shapes.
 * Each bot rank gets a progressively more imposing presence.
 */

import './Avatar.css';

export type BotAvatarType = 'pebble' | 'stream' | 'boulder' | 'ember' | 'storm' | 'void';
export type PlayerAvatarType = 'blackhole' | 'nova' | 'nebula';
export type AvatarType = BotAvatarType | PlayerAvatarType;

export const BOT_AVATARS: Record<string, { type: BotAvatarType; name: string }> = {
  '15k': { type: 'pebble', name: 'Pebble' },
  '12k': { type: 'stream', name: 'Stream' },
  '10k': { type: 'boulder', name: 'Boulder' },
  '8k': { type: 'ember', name: 'Ember' },
  '5k': { type: 'storm', name: 'Storm' },
  '3k': { type: 'void', name: 'Void' },
};

export const PLAYER_AVATARS: { type: PlayerAvatarType; name: string }[] = [
  { type: 'blackhole', name: 'Black Hole' },
  { type: 'nova', name: 'Nova' },
  { type: 'nebula', name: 'Nebula' },
];

interface AvatarProps {
  type: AvatarType;
  size?: number;
  active?: boolean;
  thinking?: boolean;
}

export function Avatar({ type, size = 72, active = false, thinking = false }: AvatarProps) {
  return (
    <div
      className={`avatar avatar-${type} ${active ? 'avatar-active' : ''} ${thinking ? 'avatar-thinking' : ''}`}
      style={{ width: size, height: size }}
    >
      <div className="avatar-inner">
        <div className="avatar-symbol" />
      </div>
    </div>
  );
}
