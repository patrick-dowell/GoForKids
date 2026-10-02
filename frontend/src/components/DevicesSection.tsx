import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { formatPairingCode, type PairingCode } from '../api/sync';
import { useLibraryStore } from '../store/libraryStore';
import { useSyncStore } from '../store/syncStore';
import { logOutConfirmText, unsavedGameCount } from './logOutCopy';

/**
 * Profile → Devices (feature 32, revision 2). Every player has a profile;
 * this section connects more devices to it and logs this one out.
 *
 * "Add a device" shows a ten-minute code the other device types on its
 * first-run screen ("I already play on another device"). If the profile
 * hasn't been created yet, it is created first.
 *
 * "Log out" saves everything online first and only then clears this device.
 * The confirm is the inline two-step used elsewhere on this page:
 * window.confirm silently does nothing in WKWebView.
 */

type Panel = 'none' | 'code' | 'logout';

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

function addDeviceError(e: unknown): string {
  if (e instanceof ApiError && e.status === 429) return 'Too many tries. Wait a little, then try again.';
  return "Couldn't connect. Try again in a minute.";
}

export function DevicesSection() {
  const loggedIn = useSyncStore((s) => s.deviceToken !== null);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const syncing = useSyncStore((s) => s.syncing);
  const addDevice = useSyncStore((s) => s.addDevice);
  const logOut = useSyncStore((s) => s.logOut);
  const refusedGameIds = useSyncStore((s) => s.refusedGameIds);
  const games = useLibraryStore((s) => s.games);
  const unsavedGames = unsavedGameCount(
    refusedGameIds,
    games.map((g) => g.id),
  );

  const [panel, setPanel] = useState<Panel>('none');
  const [code, setCode] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleAdd = async () => {
    setBusy(true);
    setError(null);
    try {
      const pc = await addDevice();
      if (!mounted.current) return;
      setCode(pc);
      setPanel('code');
    } catch (e) {
      if (mounted.current) setError(addDeviceError(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleLogOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await logOut();
      // Success unmounts this page: the app shows the first-run choice.
    } catch {
      if (mounted.current) {
        setError("Couldn't save everything online, so nothing changed. Try again when you're connected.");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const closePanel = () => {
    setPanel('none');
    setError(null);
  };

  const status = loggedIn
    ? syncing
      ? 'Your progress is saved online. Syncing…'
      : `Your progress is saved online.${lastSyncAt ? ` Last synced ${whenText(lastSyncAt)}.` : ''}`
    : "Your progress isn't saved online yet. It will be next time this device is connected.";

  return (
    <section className="profile-section profile-devices">
      <div className="profile-section-eyebrow">Devices</div>
      <p className="profile-devices-text" aria-live="polite">
        {status}
      </p>

      <div className="profile-devices-row">
        <button className="profile-devices-btn" onClick={() => void handleAdd()} disabled={busy}>
          Add a device
        </button>
        {loggedIn && (
          <button
            className="profile-devices-btn profile-devices-btn-quiet"
            onClick={() => {
              setPanel('logout');
              setError(null);
            }}
            disabled={busy}
          >
            Log out
          </button>
        )}
      </div>

      {panel === 'code' && code && (
        <div className="profile-devices-panel">
          <p className="profile-devices-text">
            On your other device, open GoForKids, tap “I already play on another device” and type this code:
          </p>
          <div className="profile-devices-code" aria-label={`Code ${code.code.split('').join(' ')}`}>
            {formatPairingCode(code.code)}
          </div>
          <p className="profile-devices-note">{expiryText(code.expires_at)}</p>
          <p className="profile-devices-note">If that device already has a player, log out there first.</p>
          <div className="profile-devices-row">
            <button className="profile-devices-btn" onClick={closePanel}>
              Done
            </button>
          </div>
        </div>
      )}

      {panel === 'logout' && loggedIn && (
        <div className="profile-devices-panel">
          <p className="profile-devices-warning">{logOutConfirmText(unsavedGames)}</p>
          <div className="profile-devices-row">
            <button
              className="profile-devices-btn profile-devices-btn-armed"
              onClick={() => void handleLogOut()}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Yes, log out'}
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
