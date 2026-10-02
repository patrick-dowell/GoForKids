import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  cardView,
  formatFriendCode,
  personLines,
  resultDate,
  SEND_TEXT,
  type CardView,
  type SendOutcome,
} from '../profile/friends';
import { useFriendsStore } from '../store/friendsStore';
import { Avatar } from './Avatar';

/**
 * Profile → Friends (feature 32, revision 4). Shown after Devices and before
 * Admin, only on a device that is logged in.
 *
 * Your friend code (two groups of four) with "New code" after one confirm;
 * "Add a friend" (one field: spaces, a hyphen and either case are fine);
 * the requests sent to you, each with Accept and Decline; your friends,
 * each opening their card (name, avatar, rank per board, games, recent
 * results with board, win or loss and the date), with "Remove friend"
 * after one confirm. Confirms are inline, as elsewhere on this page:
 * window.confirm does nothing in WKWebView.
 *
 * Everything shown about another player is read through profile/friends.ts:
 * a generated name, an avatar from the app's set, ranks, counts, results.
 * Nothing another player typed can reach this screen.
 *
 * Refreshes when the Profile page opens and after each action; no polling.
 */

type Where = 'code' | 'requests' | 'friends';

const CONNECT = "Couldn't connect. Try again in a minute.";

function errorText(e: unknown, notThere: string): string {
  return e instanceof ApiError && e.status === 404 ? notThere : CONNECT;
}

export function FriendsSection() {
  const code = useFriendsStore((s) => s.code);
  const rawFriends = useFriendsStore((s) => s.friends);
  const rawIncoming = useFriendsStore((s) => s.incoming);
  const cardFor = useFriendsStore((s) => s.cardFor);
  const card = useFriendsStore((s) => s.card);
  const loading = useFriendsStore((s) => s.loading);
  const loadFailed = useFriendsStore((s) => s.loadFailed);

  const friends = rawFriends ? personLines(rawFriends) : null;
  const incoming = rawIncoming ? personLines(rawIncoming) : [];

  const [askNewCode, setAskNewCode] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [typed, setTyped] = useState('');
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ where: Where; text: string } | null>(null);

  useEffect(() => {
    // The Profile page opened: start from the list, freshly loaded.
    useFriendsStore.getState().closeCard();
    void useFriendsStore.getState().refresh();
  }, []);

  /** Run an action; on failure say why beside the part it came from. */
  const run = async (where: Where, fn: () => Promise<void>, notThere = CONNECT) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ where, text: errorText(e, notThere) });
    } finally {
      setBusy(false);
    }
  };

  const confirmNewCode = () =>
    run('code', async () => {
      await useFriendsStore.getState().newCode();
      setAskNewCode(false);
    });

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOutcome(null);
    const result = await useFriendsStore.getState().send(typed);
    setOutcome(result);
    if (result === 'sent') setTyped('');
    setBusy(false);
  };

  const toggleCard = (playerId: string) => {
    setAskRemove(false);
    if (cardFor === playerId) {
      useFriendsStore.getState().closeCard();
      return;
    }
    void run('friends', () => useFriendsStore.getState().openCard(playerId), "That player isn't your friend any more.");
  };

  const confirmRemove = (playerId: string) =>
    run('friends', async () => {
      // The card closes with the friend; the next card opens unarmed.
      await useFriendsStore.getState().remove(playerId);
    });

  const errorLine = (where: Where) =>
    error && error.where === where ? (
      <p className="profile-devices-error" role="alert">
        {error.text}
      </p>
    ) : null;

  return (
    <section className="profile-section profile-friends">
      <div className="profile-section-eyebrow">Friends</div>

      <div className="profile-friends-block">
        <div className="profile-friends-label">Your friend code</div>
        <div className="profile-friends-code-row">
          <div
            className="profile-devices-code profile-friends-code"
            aria-label={code ? `Friend code ${code.split('').join(' ')}` : undefined}
          >
            {code ? formatFriendCode(code) : '···· ····'}
          </div>
          <button
            className="profile-devices-btn profile-devices-btn-quiet"
            onClick={() => {
              setAskNewCode(true);
              setError(null);
            }}
            disabled={busy || !code}
          >
            New code
          </button>
        </div>
        <p className="profile-devices-note">Give it to a friend so they can add you.</p>
        {askNewCode && (
          <div className="profile-devices-panel profile-friends-newcode">
            <p className="profile-devices-warning">
              Make a new code? Your old code will stop working, so nobody can add you with it. Your friends and
              requests stay.
            </p>
            <div className="profile-devices-row">
              <button
                className="profile-devices-btn profile-devices-btn-armed"
                onClick={() => void confirmNewCode()}
                disabled={busy}
              >
                {busy ? 'Making…' : 'Yes, new code'}
              </button>
              <button
                className="profile-devices-btn profile-devices-btn-quiet"
                onClick={() => setAskNewCode(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {errorLine('code')}
      </div>

      <form className="profile-friends-block profile-friends-add" onSubmit={(e) => void send(e)}>
        <label className="profile-friends-label" htmlFor="profile-friends-input">
          Add a friend
        </label>
        <div className="profile-friends-add-row">
          <input
            id="profile-friends-input"
            className="profile-friends-input"
            type="text"
            value={typed}
            maxLength={24}
            placeholder="Their friend code"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => {
              setTyped(e.target.value);
              setOutcome(null);
            }}
          />
          <button type="submit" className="profile-devices-btn" disabled={busy || typed.trim() === ''}>
            Send
          </button>
        </div>
        {outcome && (
          <p
            className={
              'profile-friends-outcome ' + (outcome === 'sent' ? 'profile-friends-outcome-ok' : 'profile-friends-outcome-no')
            }
            role="status"
          >
            {SEND_TEXT[outcome]}
          </p>
        )}
      </form>

      {incoming.length > 0 && (
        <div className="profile-friends-block">
          <div className="profile-friends-label">Requests</div>
          <ul className="profile-friends-list">
            {incoming.map((p) => (
              <li key={p.playerId} className="profile-friends-request" data-player-id={p.playerId}>
                <Avatar type={p.avatar} size={44} />
                <span className="profile-friends-name">{p.name}</span>
                <span className="profile-friends-actions">
                  <button
                    className="profile-devices-btn profile-devices-btn-armed"
                    onClick={() =>
                      void run('requests', () => useFriendsStore.getState().accept(p.playerId), "That request isn't there any more.")
                    }
                    disabled={busy}
                  >
                    Accept
                  </button>
                  <button
                    className="profile-devices-btn profile-devices-btn-quiet"
                    onClick={() =>
                      void run('requests', () => useFriendsStore.getState().decline(p.playerId), "That request isn't there any more.")
                    }
                    disabled={busy}
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Outside the block: a request that is gone takes the block with it. */}
      {errorLine('requests')}

      <div className="profile-friends-block">
        <div className="profile-friends-label">Friends</div>
        {friends === null ? (
          <p className="profile-friends-empty">{loading ? 'Loading…' : ''}</p>
        ) : friends.length === 0 ? (
          <p className="profile-friends-empty">No friends yet. Give a friend your code, or add theirs.</p>
        ) : (
          <ul className="profile-friends-list">
            {friends.map((f) => {
              const open = cardFor === f.playerId;
              return (
                <li key={f.playerId} className="profile-friends-friend" data-player-id={f.playerId}>
                  <button className="profile-friends-person" onClick={() => toggleCard(f.playerId)} aria-expanded={open}>
                    <Avatar type={f.avatar} size={44} />
                    <span className="profile-friends-name">{f.name}</span>
                    <span className="profile-friends-chevron" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                  </button>
                  {open && (
                    <FriendCardPanel
                      view={card ? cardView(card) : null}
                      askRemove={askRemove}
                      busy={busy}
                      onAskRemove={() => setAskRemove(true)}
                      onCancelRemove={() => setAskRemove(false)}
                      onRemove={() => void confirmRemove(f.playerId)}
                      onClose={() => toggleCard(f.playerId)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {errorLine('friends')}
      </div>

      {loadFailed && (
        <p className="profile-devices-error">Couldn't load your friends. They'll show next time you're connected.</p>
      )}
    </section>
  );
}

interface FriendCardPanelProps {
  view: CardView | null;
  askRemove: boolean;
  busy: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
  onClose: () => void;
}

function FriendCardPanel({ view, askRemove, busy, onAskRemove, onCancelRemove, onRemove, onClose }: FriendCardPanelProps) {
  if (!view) {
    return (
      <div className="profile-devices-panel profile-friends-card">
        <p className="profile-devices-text">Loading…</p>
      </div>
    );
  }
  return (
    <div className="profile-devices-panel profile-friends-card">
      <div className="profile-friends-card-head">
        <Avatar type={view.avatar} size={64} />
        <div className="profile-friends-card-title">
          <div className="profile-friends-card-name">{view.name}</div>
          <div className="profile-admin-muted profile-friends-card-games">
            {view.games} ranked {view.games === 1 ? 'game' : 'games'}
          </div>
        </div>
      </div>

      <div className="profile-admin-ranks profile-friends-card-ranks">
        {view.ranks.length === 0 ? (
          <span className="profile-admin-muted">No ranked games yet</span>
        ) : (
          view.ranks.map((r) => (
            <span key={r.board} className="profile-admin-rank profile-friends-card-rank">
              <span className="profile-admin-board">{r.board}</span> <strong>{r.rank}</strong> · {r.games}{' '}
              {r.games === 1 ? 'game' : 'games'}
            </span>
          ))
        )}
      </div>

      {view.recent.length > 0 && (
        <>
          <div className="profile-friends-label">Recent results</div>
          <ul className="profile-friends-results">
            {view.recent.map((r, i) => (
              <li key={`${r.ts}-${i}`} className="profile-friends-result">
                <span className="profile-friends-result-board">{r.board}</span>
                <span
                  className={
                    'profile-friends-result-chip ' + (r.result === 'win' ? 'profile-recent-chip-win' : 'profile-recent-chip-loss')
                  }
                >
                  {r.result === 'win' ? 'Win' : 'Loss'}
                </span>
                <span className="profile-friends-result-date">{resultDate(r.ts)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {askRemove ? (
        <>
          <p className="profile-devices-warning">
            Remove {view.name} from your friends? You can add each other again later with a code.
          </p>
          <div className="profile-devices-row">
            <button className="profile-devices-btn profile-devices-btn-armed" onClick={onRemove} disabled={busy}>
              {busy ? 'Removing…' : 'Yes, remove'}
            </button>
            <button className="profile-devices-btn profile-devices-btn-quiet" onClick={onCancelRemove} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="profile-devices-row">
          <button className="profile-devices-btn profile-devices-btn-quiet" onClick={onAskRemove} disabled={busy}>
            Remove friend
          </button>
          <button className="profile-devices-btn profile-devices-btn-quiet" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
