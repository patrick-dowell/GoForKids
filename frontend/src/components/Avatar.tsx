/**
 * CSS-drawn avatars for players and AI bots.
 * No image files — pure CSS gradients, shadows, and shapes.
 * Each bot rank gets a progressively more imposing presence.
 */

import './Avatar.css';

export type BotAvatarType = 'seedling' | 'sprout' | 'pebble' | 'stream' | 'boulder' | 'ember' | 'storm' | 'void';
export type PlayerAvatarType = 'blackhole' | 'nova' | 'nebula';
export type AvatarType = BotAvatarType | PlayerAvatarType;

export const BOT_AVATARS: Record<string, { type: BotAvatarType; name: string; validated: boolean }> = {
  '30k': { type: 'seedling', name: 'Seedling', validated: true },
  '18k': { type: 'sprout', name: 'Sprout', validated: true },
  '15k': { type: 'pebble', name: 'Pebble', validated: true },
  '12k': { type: 'stream', name: 'Stream', validated: true },
  '9k':  { type: 'boulder', name: 'Boulder', validated: true },
  '6k':  { type: 'ember', name: 'Ember', validated: false },
  '3k':  { type: 'storm', name: 'Storm', validated: false },
  '1d':  { type: 'void', name: 'Void', validated: false },
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
