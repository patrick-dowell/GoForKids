import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { formatPairingCode, type AdminDevice, type AdminPlayer, type PairingCode } from '../api/sync';
import {
  boardRanks,
  canRemoveDevice,
  deviceLineText,
  installedOnText,
  canSignOutPlayer,
  codeExpiryOptions,
  daysLeftText,
  defaultCodeExpiry,
  expiryLabel,
  isAllowedCodeExpiry,
  isThisDevice,
  type SelfIds,
} from '../profile/admin';
import { randomHandle, renderName, type Handle } from '../profile/names';
import { ADMIN_LABEL_MAX, useAdminLabels } from '../store/adminLabels';
import { useAdminStore } from '../store/adminStore';
import { useSyncStore } from '../store/syncStore';

/**
 * Profile → Admin (feature 32, revision 3). Shown below Devices only when
 * the latest sync pass said this device's profile is an admin; a 403 from
 * any admin route hides it (the sync store clears the flag) and never signs
 * the device out.
 *
 * One row per profile: the admin's label (typed here, kept on this device
 * only), the generated name, the rank per board, the devices, the replay
 * count, and the days left when the profile has no device. Per row, "Code
 * for this player" (the code a device types on "I already play on another
 * device") and "Sign out this player's devices" (one inline confirm, like
 * Log out: window.confirm does nothing in WKWebView); "Remove" beside each
 * device. Neither is offered for this device, nor the first for this
 * device's own profile. "New player" makes a profile with a generated name.
 */

type Panel =
  | { kind: 'none' }
  | { kind: 'new'; handle: Handle }
  | { kind: 'code'; playerId: string; choice: number; options: Date[]; code: PairingCode | null }
  | { kind: 'sign-out'; playerId: string };


const PASSED = 'That time has passed. Pick a later one.';
const REFUSED_TIME = "The server didn't accept that time. Pick an earlier one.";

/** Why an action failed. A 422 on a code is about its expiry: it has passed
 *  only when it is no longer ahead of this device's clock; otherwise the
 *  server found it too far ahead (this clock runs fast). */
function actionError(e: unknown, expiry?: Date): string {
  if (e instanceof ApiError && e.status === 404) return 'That player or device is gone. The list is up to date now.';
  if (e instanceof ApiError && e.status === 422) {
    return expiry && expiry.getTime() > Date.now() ? REFUSED_TIME : PASSED;
  }
  if (e instanceof ApiError && e.status === 409) return 'This device signs out with Log out, above.';
  // New player drew eight taken names in a row (revision 6): not a connection problem.
  if (e instanceof Error && e.message.includes('every name tried was taken')) return 'Every name it tried was taken. Try New player again.';
  return "Couldn't connect. Try again in a minute.";
}

export function AdminSection() {
  const players = useAdminStore((s) => s.players);
  const lastSeenSince = useAdminStore((s) => s.lastSeenSince);
  const loading = useAdminStore((s) => s.loading);
  const loadFailed = useAdminStore((s) => s.loadFailed);
  const labels = useAdminLabels((s) => s.labels);
  const setLabel = useAdminLabels((s) => s.setLabel);
  const playerId = useSyncStore((s) => s.playerId);
  const deviceId = useSyncStore((s) => s.deviceId);
  const self: SelfIds = { playerId, deviceId };

  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ playerId: string | null; text: string } | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    void useAdminStore.getState().refresh();
  }, []);

  const open = (next: Panel) => {
    setPanel(next);
    setError(null);
  };

  /** Run an action; on failure say why beside the row it came from. */
  const act = async (rowId: string | null, fn: () => Promise<void>, expiry?: Date) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ playerId: rowId, text: actionError(e, expiry) });
      if (e instanceof ApiError && e.status === 404) void useAdminStore.getState().refresh();
    } finally {
      setBusy(false);
    }
  };

  const openCode = (id: string) => {
    const now = new Date();
    const options = codeExpiryOptions(now);
    const def = defaultCodeExpiry(now).getTime();
    // The default is always among the options.
    open({ kind: 'code', playerId: id, options, choice: options.findIndex((d) => d.getTime() === def), code: null });
  };

  const mint = (p: Extract<Panel, { kind: 'code' }>) => {
    // The dialog stayed open past the time picked: offer fresh times.
    if (!isAllowedCodeExpiry(p.options[p.choice], new Date())) {
      openCode(p.playerId);
      setError({ playerId: p.playerId, text: PASSED });
      return;
    }
    const expiry = p.options[p.choice];
    return act(
      p.playerId,
      async () => {
        const code = await useAdminStore.getState().mintCode(p.playerId, expiry);
        setPanel({ ...p, code });
      },
      expiry,
    );
  };

  const signOut = (id: string) =>
    act(id, async () => {
      await useAdminStore.getState().signOutPlayer(id);
      setPanel({ kind: 'none' });
    });

  const remove = (id: string, device: AdminDevice) =>
    act(id, async () => {
      await useAdminStore.getState().removeDevice(device.device_id);
    });

  const createNew = (handle: Handle) =>
    act(null, async () => {
      const id = await useAdminStore.getState().createPlayer(handle);
      setCreated(id);
      setPanel({ kind: 'none' });
    });

  const rowError = (id: string | null) =>
    error && error.playerId === id ? (
      <p className="profile-devices-error" role="alert">
        {error.text}
      </p>
    ) : null;

  return (
    <section className="profile-section profile-admin">
      <div className="profile-section-eyebrow">Admin</div>
      <p className="profile-devices-text">
        Every player's profile. Labels stay on this device and are never sent anywhere.
      </p>

      <div className="profile-devices-row">
        <button
          className="profile-devices-btn"
          onClick={() => open({ kind: 'new', handle: randomHandle() })}
          disabled={busy}
        >
          New player
        </button>
        <button
          className="profile-devices-btn profile-devices-btn-quiet"
          onClick={() => void useAdminStore.getState().refresh()}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {panel.kind === 'new' && (
        <div className="profile-devices-panel profile-admin-new">
          <p className="profile-devices-text">The new player's name is</p>
          <div className="profile-admin-new-name" aria-live="polite">
            {renderName(panel.handle)}
          </div>
          <div className="profile-devices-row">
            <button
              className="profile-devices-btn"
              onClick={() => setPanel({ kind: 'new', handle: randomHandle(panel.handle) })}
              disabled={busy}
            >
              Shuffle
            </button>
            <button className="profile-devices-btn profile-devices-btn-armed" onClick={() => void createNew(panel.handle)} disabled={busy}>
              {busy ? 'Creating…' : 'Create player'}
            </button>
            <button className="profile-devices-btn profile-devices-btn-quiet" onClick={() => open({ kind: 'none' })} disabled={busy}>
              Cancel
            </button>
          </div>
          {rowError(null)}
        </div>
      )}

      {loadFailed && <p className="profile-devices-error">Couldn't load the list. Try Refresh when you're connected.</p>}

      {players && (
        <ul className="profile-admin-list">
          {players.map((p) => (
            <AdminRow
              key={p.player_id}
              player={p}
              self={self}
              lastSeenSince={lastSeenSince}
              label={labels[p.player_id] ?? ''}
              onLabel={(text) => setLabel(p.player_id, text)}
              isNew={created === p.player_id}
              busy={busy}
              panel={panel}
              onCode={() => openCode(p.player_id)}
              onPickExpiry={(choice) => panel.kind === 'code' && setPanel({ ...panel, choice })}
              onMint={() => panel.kind === 'code' && void mint(panel)}
              onAskSignOut={() => open({ kind: 'sign-out', playerId: p.player_id })}
              onSignOut={() => void signOut(p.player_id)}
              onRemove={(d) => void remove(p.player_id, d)}
              onClose={() => open({ kind: 'none' })}
              error={rowError(p.player_id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface AdminRowProps {
  player: AdminPlayer;
  self: SelfIds;
  lastSeenSince: string | null;
  label: string;
  onLabel: (text: string) => void;
  isNew: boolean;
  busy: boolean;
  panel: Panel;
  onCode: () => void;
  onPickExpiry: (choice: number) => void;
  onMint: () => void;
  onAskSignOut: () => void;
  onSignOut: () => void;
  onRemove: (device: AdminDevice) => void;
  onClose: () => void;
  error: ReactNode;
}

function AdminRow({
  player,
  self,
  lastSeenSince,
  label,
  onLabel,
  isNew,
  busy,
  panel,
  onCode,
  onPickExpiry,
  onMint,
  onAskSignOut,
  onSignOut,
  onRemove,
  onClose,
  error,
}: AdminRowProps) {
  const name = renderName(player.handle) || 'No name';
  const ranks = boardRanks(player.boards);
  const mine = panel.kind !== 'none' && panel.kind !== 'new' && panel.playerId === player.player_id;
  const now = new Date();

  return (
    <li className={'profile-admin-row' + (isNew ? ' profile-admin-row-new' : '')} data-player-id={player.player_id}>
      <input
        className="profile-admin-label"
        type="text"
        value={label}
        maxLength={ADMIN_LABEL_MAX}
        placeholder="Add a label (kept on this device)"
        aria-label={`Label for ${name}`}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => onLabel(e.target.value)}
      />
      <div className="profile-admin-name">{name}</div>

      <div className="profile-admin-ranks">
        {ranks.length === 0 ? (
          <span className="profile-admin-muted">No ranked games yet</span>
        ) : (
          ranks.map((r) => (
            <span key={r.board} className="profile-admin-rank">
              <span className="profile-admin-board">{r.board}</span> <strong>{r.rank}</strong> · {r.games}{' '}
              {r.games === 1 ? 'game' : 'games'}
            </span>
          ))
        )}
      </div>

      <div className="profile-admin-muted">
        {player.replays} {player.replays === 1 ? 'replay' : 'replays'}
      </div>

      {player.devices.length === 0 ? (
        <div className="profile-admin-nodevice">
          No device{player.days_left !== null ? ` · ${daysLeftText(player.days_left)}` : ''}
        </div>
      ) : (
        <ul className="profile-admin-devices">
          <li className="profile-admin-device-count">{installedOnText(player.devices.length)}</li>
          {player.devices.map((d) => (
            <li key={d.device_id} className="profile-admin-device">
              <span className="profile-admin-device-text">
                {isThisDevice(d, self) && <strong>This device · </strong>}
                {deviceLineText(d, lastSeenSince)}
              </span>
              {canRemoveDevice(d, self) && (
                <button className="profile-admin-small-btn" onClick={() => onRemove(d)} disabled={busy}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="profile-devices-row">
        <button className="profile-devices-btn" onClick={onCode} disabled={busy}>
          Code for this player
        </button>
        {canSignOutPlayer(player, self) && (
          <button className="profile-devices-btn profile-devices-btn-quiet" onClick={onAskSignOut} disabled={busy}>
            Sign out this player's devices
          </button>
        )}
      </div>

      {mine && panel.kind === 'code' && (
        <div className="profile-devices-panel profile-admin-code">
          {panel.code ? (
            <>
              <p className="profile-devices-text">
                On the device, tap “I already play on another device” and type this code:
              </p>
              <div className="profile-devices-code" aria-label={`Code ${panel.code.code.split('').join(' ')}`}>
                {formatPairingCode(panel.code.code)}
              </div>
              <p className="profile-devices-note">
                Use it before {expiryLabel(new Date(panel.code.expires_at), now)}. It works once.
              </p>
            </>
          ) : (
            <>
              <label className="profile-devices-text" htmlFor={`admin-expiry-${player.player_id}`}>
                The code works until
              </label>
              <select
                id={`admin-expiry-${player.player_id}`}
                className="profile-admin-select"
                value={panel.choice}
                onChange={(e) => onPickExpiry(Number(e.target.value))}
                disabled={busy}
              >
                {panel.options.map((d, i) => (
                  <option key={d.getTime()} value={i}>
                    {expiryLabel(d, now)}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="profile-devices-row">
            {!panel.code && (
              <button className="profile-devices-btn profile-devices-btn-armed" onClick={onMint} disabled={busy}>
                {busy ? 'Making…' : 'Make code'}
              </button>
            )}
            <button className="profile-devices-btn profile-devices-btn-quiet" onClick={onClose} disabled={busy}>
              {panel.code ? 'Done' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {mine && panel.kind === 'sign-out' && (
        <div className="profile-devices-panel">
          <p className="profile-devices-warning">
            Sign out {player.devices.length === 1 ? 'the 1 device' : `all ${player.devices.length} devices`} on{' '}
            {label.trim() || name}? Each goes back to its first screen. Games played there and not yet saved online
            are lost. The profile stays, and a code gets a device back onto it.
          </p>
          <div className="profile-devices-row">
            <button className="profile-devices-btn profile-devices-btn-armed" onClick={onSignOut} disabled={busy}>
              {busy ? 'Signing out…' : 'Yes, sign out'}
            </button>
            <button className="profile-devices-btn profile-devices-btn-quiet" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error}
    </li>
  );
}
