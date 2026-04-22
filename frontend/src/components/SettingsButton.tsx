import { useState } from 'react';
import { SettingsDialog } from './SettingsDialog';

export function SettingsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="settings-gear"
        onClick={() => setOpen(true)}
        aria-label="Settings"
        title="Settings"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path
            fill="currentColor"
            d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7.43-2.5c.04-.33.07-.66.07-1s-.03-.67-.07-1l2.11-1.65a.5.5 0 00.12-.64l-2-3.46a.5.5 0 00-.6-.22l-2.49 1a7.16 7.16 0 00-1.73-1l-.38-2.65A.5.5 0 0014 2h-4a.5.5 0 00-.5.42L9.12 5.07a7.16 7.16 0 00-1.73 1l-2.49-1a.5.5 0 00-.6.22l-2 3.46a.5.5 0 00.12.64L4.53 11c-.04.33-.07.66-.07 1s.03.67.07 1l-2.11 1.65a.5.5 0 00-.12.64l2 3.46c.14.22.4.31.6.22l2.49-1c.53.4 1.1.74 1.73 1l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.63-.26 1.2-.6 1.73-1l2.49 1c.2.09.46 0 .6-.22l2-3.46a.5.5 0 00-.12-.64L19.43 13z"
          />
        </svg>
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}
