import { useState } from 'react';
import { Avatar, PLAYER_AVATARS, type PlayerAvatarType } from './Avatar';
import { useProfileStore } from '../store/profileStore';

interface ChooseAvatarScreenProps {
  /** Back-out escape — never trap the player (see the S26 menu-trap fix). */
  onExit: () => void;
}

/**
 * One-time "choose your character" screen shown as the first step of
 * Learn to Play. Most players never find the avatar picker buried in the
 * Profile page, so the first lesson entry doubles as character select.
 *
 * Gated by profileStore.avatarPicked: confirming here (or ever touching the
 * Profile picker) sets the flag and this screen never appears again.
 * Reuses the reward overlay's starfield look — picking your character
 * should feel like a moment, not a settings form.
 */
export function ChooseAvatarScreen({ onExit }: ChooseAvatarScreenProps) {
  const currentAvatar = useProfileStore((s) => s.avatar);
  const setAvatar = useProfileStore((s) => s.setAvatar);
  const [selected, setSelected] = useState<PlayerAvatarType>(currentAvatar);

  return (
    <div className="learn-view">
      <div className="learn-reward-overlay">
        <div className="learn-reward-stars" />
        <button className="learn-back-btn choose-avatar-back" onClick={onExit} aria-label="Back to home">
          ← Home
        </button>
        <div className="learn-reward-content choose-avatar-content">
          <h1 className="learn-reward-title">Choose your character!</h1>
          <p className="learn-reward-sub">
            This is you on your Go adventure. You can change it any time on your Profile page.
          </p>
          <div className="choose-avatar-grid">
            {PLAYER_AVATARS.map((a) => (
              <button
                key={a.type}
                className={'choose-avatar-option' + (selected === a.type ? ' choose-avatar-option-selected' : '')}
                onClick={() => setSelected(a.type)}
              >
                <Avatar type={a.type} size={84} active={selected === a.type} />
                <span className="choose-avatar-name">{a.name}</span>
              </button>
            ))}
          </div>
          <button className="learn-reward-btn" onClick={() => setAvatar(selected)}>
            That's me! →
          </button>
        </div>
      </div>
    </div>
  );
}
