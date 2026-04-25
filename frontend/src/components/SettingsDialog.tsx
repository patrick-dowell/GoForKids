import { useSettingsStore, type Density } from '../store/settingsStore';
import { THEMES, type ThemeId } from '../theme/themes';

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const themeId = useSettingsStore((s) => s.themeId);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const density = useSettingsStore((s) => s.density);
  const setDensity = useSettingsStore((s) => s.setDensity);
  const showScoreGraph = useSettingsStore((s) => s.showScoreGraph);
  const setShowScoreGraph = useSettingsStore((s) => s.setShowScoreGraph);

  const options: ThemeId[] = ['cosmic', 'classic'];
  const densityOptions: { value: Density; label: string; desc: string }[] = [
    { value: 'full', label: 'Full',  desc: 'Cosmic celebrations, full sound' },
    { value: 'zen',  label: 'Zen',   desc: 'Quieter visuals, softer audio' },
  ];

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        style={{ width: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Settings</h2>
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>

        <div className="dialog-field">
          <label>Board Theme</label>
          <div className="theme-picker">
            {options.map((id) => {
              const theme = THEMES[id];
              const selected = id === themeId;
              return (
                <button
                  key={id}
                  className={`theme-card${selected ? ' selected' : ''}`}
                  onClick={() => setTheme(id)}
                >
                  <ThemePreview id={id} />
                  <div className="theme-card-name">{theme.name}</div>
                  <div className="theme-card-desc">{theme.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="dialog-field">
          <label>Animation & sound density</label>
          <div className="mode-picker">
            {densityOptions.map((opt) => (
              <button
                key={opt.value}
                className={`mode-btn ${density === opt.value ? 'selected' : ''}`}
                onClick={() => setDensity(opt.value)}
                title={opt.desc}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog-field">
          <label>
            <input
              type="checkbox"
              checked={showScoreGraph}
              onChange={(e) => setShowScoreGraph(e.target.checked)}
            />
            {' '}Show score graph during play
          </label>
        </div>
      </div>
    </div>
  );
}

function ThemePreview({ id }: { id: ThemeId }) {
  // Small inline SVG preview — 3x3 grid with two stones, themed colors.
  if (id === 'cosmic') {
    return (
      <svg viewBox="0 0 100 100" className="theme-preview" aria-hidden>
        <rect width="100" height="100" rx="6" fill="#0d1117" />
        <rect x="10" y="10" width="80" height="80" rx="4" fill="rgba(50,38,20,0.9)" />
        <g stroke="rgba(140,115,65,0.7)" strokeWidth="1">
          <line x1="25" y1="25" x2="75" y2="25" />
          <line x1="25" y1="50" x2="75" y2="50" />
          <line x1="25" y1="75" x2="75" y2="75" />
          <line x1="25" y1="25" x2="25" y2="75" />
          <line x1="50" y1="25" x2="50" y2="75" />
          <line x1="75" y1="25" x2="75" y2="75" />
        </g>
        <circle cx="50" cy="50" r="3" fill="rgba(180,150,80,0.9)" />
        <circle cx="25" cy="25" r="10" fill="#2a2a48" stroke="rgba(100,100,150,0.7)" />
        <circle cx="75" cy="75" r="10" fill="#e0e0f0" stroke="rgba(160,160,190,0.6)" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" className="theme-preview" aria-hidden>
      <rect width="100" height="100" rx="6" fill="#2a1f14" />
      <rect x="10" y="10" width="80" height="80" rx="2" fill="#e4b870" />
      <g stroke="rgba(40,25,10,0.9)" strokeWidth="1">
        <line x1="25" y1="25" x2="75" y2="25" />
        <line x1="25" y1="50" x2="75" y2="50" />
        <line x1="25" y1="75" x2="75" y2="75" />
        <line x1="25" y1="25" x2="25" y2="75" />
        <line x1="50" y1="25" x2="50" y2="75" />
        <line x1="75" y1="25" x2="75" y2="75" />
      </g>
      <circle cx="50" cy="50" r="3" fill="rgba(25,15,5,0.95)" />
      <circle cx="25" cy="25" r="10" fill="#0f0f0f" />
      <circle cx="75" cy="75" r="10" fill="#f2ecdc" stroke="rgba(120,100,70,0.4)" />
    </svg>
  );
}
