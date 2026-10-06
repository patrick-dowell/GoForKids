import { useState } from 'react';
import { useSettingsStore, type Density } from '../store/settingsStore';
import { useHumanBotsAvailability, useOnlineBotsOnly, type HumanBotsAvailability } from '../store/capabilitiesStore';
import { CLOUD_LOCKED_NOTE, tapCloudBotRow } from './cloudBotRow';
import { HUMAN_BOTS_NOTE } from './humanBotsRow';
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
  const cloudBot = useSettingsStore((s) => s.cloudBot);
  const setCloudBot = useSettingsStore((s) => s.setCloudBot);
  const humanBots = useSettingsStore((s) => s.humanBots);
  const setHumanBots = useSettingsStore((s) => s.setHumanBots);
  const humanBotsAvailability = useHumanBotsAvailability();
  // The web, or a device whose engine is too slow: online bots only. The row
  // shows on and stays on; the stored choice underneath is left alone.
  const cloudLocked = useOnlineBotsOnly();
  const [lockNote, setLockNote] = useState(false);

  const options: ThemeId[] = ['cosmic', 'classic'];
  const densityOptions: { value: Density; label: string; desc: string }[] = [
    { value: 'full', label: 'Full',  desc: 'Cosmic celebrations, full sound' },
    { value: 'zen',  label: 'Zen',   desc: 'Quieter visuals, softer audio' },
  ];

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog settings-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Settings</h2>
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>

        <div className="dialog-field settings-theme">
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

        {/* The rows right of the theme cards on a phone held sideways
            (App.css, .settings-toggles); elsewhere this wrapper is
            display: contents and the rows sit in the dialog's column. */}
        <div className="settings-toggles">
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

          {/* Cloud bot: routes bot moves to the Render backend even when the
              native bridge exists — for older iPads where on-device KataGo is
              unplayably slow. An adult flips this per-device; needs internet.
              Locked on where the device cannot play its own bots: a tap then
              only shows why. */}
          <CloudBotRow
            checked={cloudLocked || cloudBot}
            locked={cloudLocked}
            noteShown={cloudLocked && lockNote}
            onToggle={(v) => tapCloudBotRow(cloudLocked, v, { setCloudBot, showNote: () => setLockNote(true) })}
          />

          {/* Human-style bots: on any device with the bridge, from the first
              moment (the answer can take half a minute on a version's first
              launch); it opens once the engine reports the human SL net and
              the device may play its own bots. A rank with a rung in
              b28_human.yaml then plays on the human path; "Bot plays online"
              still wins. Never on the web. */}
          {humanBotsAvailability !== 'none' && (
            <HumanBotsRow availability={humanBotsAvailability} checked={humanBots} onToggle={setHumanBots} />
          )}
        </div>
      </div>
    </div>
  );
}

/** The "Bot plays online" row. Locked, it stays checked: a tap calls
 *  onToggle (which shows the note) and React keeps the box as it was. */
export function CloudBotRow({
  checked,
  locked,
  noteShown,
  onToggle,
}: {
  checked: boolean;
  locked: boolean;
  noteShown: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className={`dialog-field settings-cloud-bot${locked ? ' locked' : ''}`}>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        {' '}Bot plays online
      </label>
      {noteShown && <p className="settings-note">{CLOUD_LOCKED_NOTE}</p>}
    </div>
  );
}

/** The "Human-style bots" row: open when the device has the human model,
 *  else greyed with a line saying why (the stored choice shows while the
 *  bots start; off once the answer says they cannot play here). */
export function HumanBotsRow({
  availability,
  checked,
  onToggle,
}: {
  availability: HumanBotsAvailability;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  const open = availability === 'ready';
  const note = HUMAN_BOTS_NOTE[availability];
  return (
    <div className="dialog-field settings-human-bots">
      <label>
        <input
          type="checkbox"
          disabled={!open}
          checked={(open || availability === 'starting') && checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {' '}Human-style bots
      </label>
      {note && <p className="settings-note">{note}</p>}
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
