import { Avatar, PLAYER_AVATARS, type PlayerAvatarType } from './Avatar';

interface AvatarPickerProps {
  selected: PlayerAvatarType;
  onSelect: (type: PlayerAvatarType) => void;
}

export function AvatarPicker({ selected, onSelect }: AvatarPickerProps) {
  return (
    <div className="avatar-picker">
      {PLAYER_AVATARS.map((a) => (
        <button
          key={a.type}
          className={`avatar-picker-option ${selected === a.type ? 'selected' : ''}`}
          onClick={() => onSelect(a.type)}
        >
          <Avatar type={a.type} size={48} active={selected === a.type} />
          <span className="avatar-picker-name">{a.name}</span>
        </button>
      ))}
    </div>
  );
}
