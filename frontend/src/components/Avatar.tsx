/**
 * Avatars for players and AI bots.
 * Lower-rung bots are CSS-drawn (gradients, shadows, shapes); the top three
 * bots (Ember/Storm/Void) and the four kid player avatars use art made by
 * Patrick + Roland (frontend/public/avatars/, sources in art/avatar-sources/).
 */

import './Avatar.css';

export type BotAvatarType = 'seedling' | 'sprout' | 'pebble' | 'stream' | 'boulder' | 'ember' | 'storm' | 'void';
export type PlayerAvatarType = 'blackhole' | 'nova' | 'nebula' | 'tide' | 'eclipse' | 'prism' | 'comet';
export type AvatarType = BotAvatarType | PlayerAvatarType;

export const BOT_AVATARS: Record<string, { type: BotAvatarType; name: string; validated: boolean }> = {
  '30k': { type: 'seedling', name: 'Seedling', validated: true },
  '18k': { type: 'sprout', name: 'Sprout', validated: true },
  '15k': { type: 'pebble', name: 'Pebble', validated: true },
  '12k': { type: 'stream', name: 'Stream', validated: true },
  '9k':  { type: 'boulder', name: 'Boulder', validated: true },
  '6k':  { type: 'ember', name: 'Ember', validated: true },
  '3k':  { type: 'storm', name: 'Storm', validated: true },
  '1d':  { type: 'void', name: 'Void', validated: true },
};

export const PLAYER_AVATARS: { type: PlayerAvatarType; name: string }[] = [
  { type: 'tide', name: 'Tide' },
  { type: 'eclipse', name: 'Eclipse' },
  { type: 'prism', name: 'Prism' },
  { type: 'comet', name: 'Comet' },
  { type: 'blackhole', name: 'Black Hole' },
  { type: 'nova', name: 'Nova' },
  { type: 'nebula', name: 'Nebula' },
];

/**
 * Image-art avatars (base URL respected for the WKWebView bundle).
 * Types absent here fall back to the CSS-drawn avatar.
 */
const AVATAR_IMAGES: Partial<Record<AvatarType, string>> = {
  tide: 'avatars/kid-tide.jpg',
  eclipse: 'avatars/kid-eclipse.jpg',
  prism: 'avatars/kid-prism.jpg',
  comet: 'avatars/kid-comet.jpg',
  ember: 'avatars/bot-ember.jpg',
  storm: 'avatars/bot-storm.jpg',
  void: 'avatars/bot-void.jpg',
};

interface AvatarProps {
  type: AvatarType;
  size?: number;
  active?: boolean;
  thinking?: boolean;
}

export function Avatar({ type, size = 72, active = false, thinking = false }: AvatarProps) {
  const image = AVATAR_IMAGES[type];
  return (
    <div
      className={`avatar avatar-${type} ${active ? 'avatar-active' : ''} ${thinking ? 'avatar-thinking' : ''}`}
      style={{ width: size, height: size }}
    >
      <div className="avatar-inner">
        {image ? (
          <img className="avatar-image" src={`${import.meta.env.BASE_URL}${image}`} alt="" draggable={false} />
        ) : (
          <div className="avatar-symbol" />
        )}
      </div>
    </div>
  );
}
