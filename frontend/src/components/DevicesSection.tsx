import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import {
  formatPairingCode,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  type PairingCode,
} from '../api/sync';
import { useSyncStore } from '../store/syncStore';

/**
 * Profile → Devices (feature 32). Links this device to a player record so
 * rank, lessons and replays follow the player between devices.
 *
 * Not linked: "Add a device" (turns sync on, then shows a code) and "Link
 * this device" (type a code from the other device). Linked: the last sync
 * time, "Add a device" and "Unlink this device".
 *
 * Confirmations are the inline two-tap used elsewhere on this page:
 * window.confirm silently does nothing in WKWebView.
 */

type Panel = 'none' | 'code' | 'link';

function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) return "That code didn't work. Ask for a new one.";
  if (e instanceof ApiError && e.status === 429) return 'Too many tries. Wait a little, then try again.';
  return "Couldn't connect. Try again in a minute.";
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function whenText(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `at ${timeOf(ms)}`;
  return `on ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeOf(ms)}`;
}

function expiryText(expiresAt: string): string {
  const ms = Date.parse(expiresAt);
  return Number.isNaN(ms) ? 'It works for 10 minutes.' : `Use it before ${timeOf(ms)}.`;
}

export function DevicesSection() {
  const linked = useSyncStore((s) => s.deviceToken !== null);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const syncing = useSyncStore((s) => s.syncing);
  const addDevice = useSyncStore((s) => s.addDevice);
  const link = useSyncStore((s) => s.link);
  const unlink = useSyncStore((s) => s.unlink);

  const [panel, setPanel] = useState<Panel>('none');
  const [code, setCode] = useState<PairingCode | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkArmed, setLinkArmed] = useState(false);
  const [unlinkArmed, setUnlinkArmed] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleAdd = () =>
    run(async () => {
      const pc = await addDevice();
      if (!mounted.current) return;
      setCode(pc);
      setPanel('code');
    });

  const handleOpenLink = () => {
    setPanel('link');
    setDraft('');
    setLinkArmed(false);
    setError(null);
  };

  const handleLink = () => {
    if (normalizePairingCode(draft).length !== PAIRING_CODE_LENGTH) {
      setError(`Type all ${PAIRING_CODE_LENGTH} letters and numbers.`);
      return;
    }
    if (!linkArmed) {
      setLinkArmed(true);
      return;
    }
    setLinkArmed(false);
    void run(async () => {
      await link(draft);
      if (!mounted.current) return;
      setPanel('none');
      setDraft('');
    });
  };

  const handleUnlink = () => {
    if (!unlinkArmed) {
      setUnlinkArmed(true);
      return;
    }
    setUnlinkArmed(false);
    void run(async () => {
      await unlink();
      if (!mounted.current) return;
      setPanel('none');
      setCode(null);
    });
  };

  const closePanel = () => {
    setPanel('none');
    setLinkArmed(false);
    setError(null);
  };

  return (
    <section className="profile-section profile-devices">
      <div className="profile-section-eyebrow">Devices</div>

      {linked ? (
        <p className="profile-devices-text" aria-live="polite">
          This device is linked.{' '}
          {syncing ? 'Syncing…' : lastSyncAt ? `Last synced ${whenText(lastSyncAt)}.` : 'Not synced yet.'}
        </p>
      ) : (
        <p className="profile-devices-text">
          Play on another iPad or computer too? Link them, and your rank, lessons and games go with you.
        </p>
      )}

      <div className="profile-devices-row">
        <button className="profile-devices-btn" onClick={() => void handleAdd()} disabled={busy}>
          Add a device
        </button>
        {linked ? (
          <button
            className={'profile-devices-btn' + (unlinkArmed ? ' profile-devices-btn-armed' : '')}
            onClick={handleUnlink}
            onBlur={() => setUnlinkArmed(false)}
            disabled={busy}
          >
            {unlinkArmed ? 'Tap again to unlink' : 'Unlink this device'}
          </button>
        ) : (
          <button className="profile-devices-btn" onClick={handleOpenLink} disabled={busy}>
            Link this device
          </button>
        )}
      </div>

      {linked && unlinkArmed && (
        <p className="profile-devices-note">Your rank, lessons and games stay on this device.</p>
      )}

      {panel === 'code' && code && (
        <div className="profile-devices-panel">
          <p className="profile-devices-text">
            On your other device, open Profile, tap “Link this device” and type this code:
          </p>
          <div className="profile-devices-code" aria-label={`Code ${code.code.split('').join(' ')}`}>
            {formatPairingCode(code.code)}
          </div>
          <p className="profile-devices-note">{expiryText(code.expires_at)}</p>
          <div className="profile-devices-row">
            <button className="profile-devices-btn" onClick={closePanel}>
              Done
            </button>
          </div>
        </div>
      )}

      {panel === 'link' && !linked && (
        <div className="profile-devices-panel">
          <label className="profile-devices-text" htmlFor="profile-devices-code-input">
            Type the code from your other device:
          </label>
          <input
            id="profile-devices-code-input"
            className="profile-devices-input"
            type="text"
            value={draft}
            placeholder="ABCD 2345"
            maxLength={16}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value.toUpperCase());
              setLinkArmed(false);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLink();
            }}
          />
          <p className="profile-devices-warning">
            Linking replaces the rank on this device with your rank from the other device. Your lessons and games are kept.
          </p>
          <div className="profile-devices-row">
            <button
              className={'profile-devices-btn' + (linkArmed ? ' profile-devices-btn-armed' : '')}
              onClick={handleLink}
              disabled={busy}
            >
              {linkArmed ? 'Yes, replace my rank' : 'Link'}
            </button>
            <button className="profile-devices-btn profile-devices-btn-quiet" onClick={closePanel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="profile-devices-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
