import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import {
  feedLines,
  friendStatuses,
  gameLines,
  onlineLines,
  ranksText,
  type FriendStatus,
  type GameLine,
} from '../profile/friendsFeed';
import { FriendReplayUnreadable, useFriendsStore, useFriendsWatch } from '../store/friendsStore';
import { Avatar } from './Avatar';
import './FriendsSection.css';

/**
 * Profile → Friends (feature 32, revisions 4 and 5). Shown after Devices and
 * before Admin, only on a device that is logged in.
 *
 * Revision 5 puts a feed first: who is online now, then what friends did
 * lately in sentences a child reads ("Swift Raven beat the 12k bot on 9×9",
 * "Quiet Volcano was promoted to 9k on 9×9"), newest first. Then, as before:
 * your friend code (two groups of four) with "New code" after one confirm;
 * "Add a friend"; the requests sent to you, each with Accept and Decline;
 * your friends, each with an online dot and their ranks, opening their card
 * (name, avatar, rank per board, games, recent results, and now their recent
 * games, each opening in the replay viewer), with "Remove friend" after one
 * confirm. Confirms are inline, as elsewhere on this page: window.confirm
 * does nothing in WKWebView.
 *
 * Everything shown about another player is read through profile/friends.ts
 * and profile/friendsFeed.ts: a generated name, an avatar from the app's set,
 * ranks, counts, results. Nothing another player typed can reach this screen.
 *
 * Refreshes when it opens, after each action, from the Refresh button, every
 * 30 seconds while it is open, and when the app comes back to the screen.
 *
 * Revision 8: a result in the feed whose game the friend has synced is a
 * button that opens it, as a game on the card does. A friend's game opens
 * playing; its Close comes back here (App), with `reopenCard`, the card
 * that was open, open again and scrolled to.
 */

type Where = 'code' | 'requests' | 'friends' | 'games' | 'feed';

const CONNECT = "Couldn't connect. Try again in a minute.";
const NOT_A_FRIEND = "That player isn't your friend any more.";
/** Feed lines shown before "Show more". */
const FEED_SHOWN = 8;

function errorText(e: unknown, notThere: string): string {
  return e instanceof ApiError && e.status === 404 ? notThere : CONNECT;
}

interface FriendsSectionProps {
  /** Back from one of a friend's games: the friend whose card was open. */
  reopenCard?: string | null;
}

export function FriendsSection({ reopenCard = null }: FriendsSectionProps) {
  const code = useFriendsStore((s) => s.code);
  const rawFriends = useFriendsStore((s) => s.friends);
  const rawIncoming = useFriendsStore((s) => s.incoming);
  const feed = useFriendsStore((s) => s.feed);
  const cardFor = useFriendsStore((s) => s.cardFor);
  const card = useFriendsStore((s) => s.card);
  const cardGames = useFriendsStore((s) => s.cardGames);
  const cardGamesFailed = useFriendsStore((s) => s.cardGamesFailed);
  const loading = useFriendsStore((s) => s.loading);
  const loadFailed = useFriendsStore((s) => s.loadFailed);

  const friends = rawFriends ? personLines(rawFriends) : null;
  const incoming = rawIncoming ? personLines(rawIncoming) : [];
  const statuses = friendStatuses(feed);

  const [askNewCode, setAskNewCode] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [typed, setTyped] = useState('');
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The game on its way to the viewer: "games:<id>" from the card,
   *  "feed:<line key>" from the feed. */
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<{ where: Where; text: string } | null>(null);

  useEffect(() => {
    const store = useFriendsStore.getState();
    if (!reopenCard) {
      // The section opened: start from the list, freshly loaded.
      store.closeCard();
    } else if (store.cardFor !== reopenCard || !store.card) {
      // Back from a friend's game, and their card was closed meanwhile (a
      // refresh that no longer lists them, a log out): open it again.
      void run('friends', () => useFriendsStore.getState().openCard(reopenCard), NOT_A_FRIEND);
    }
    // Otherwise the card is as it was when the game opened.
    void store.refresh();
    // Once, on opening: `reopenCard` is where this visit started from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from a friend's game: the card they came from in view, once its
  // row is there. The page's own scroll container moves, never the body.
  const reopenedRow = useRef<HTMLLIElement | null>(null);
  const scrollPending = useRef(!!reopenCard);
  useLayoutEffect(() => {
    const row = reopenedRow.current;
    const scroller = row?.closest('.friends-page-scroll');
    if (!scrollPending.current || !row || !scroller) return;
    scrollPending.current = false;
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
  });
  // Every 30 seconds while open, and when the app comes back to the screen.
  useFriendsWatch(['code', 'list', 'feed']);

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

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await useFriendsStore.getState().refresh();
    } finally {
      setRefreshing(false);
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
    void run('friends', () => useFriendsStore.getState().openCard(playerId), NOT_A_FRIEND);
  };

  const confirmRemove = (playerId: string) =>
    run('friends', async () => {
      // The card closes with the friend; the next card opens unarmed.
      await useFriendsStore.getState().remove(playerId);
    });

  /** Open one of a friend's games in the replay viewer (the Library's
   *  viewer: this page gives way to it, and its Close comes back here),
   *  from their card (`games`) or a line of the feed (`feed`). A failure is
   *  said beside where it was tapped. */
  const watchGame = async (where: 'games' | 'feed', playerId: string, gameId: string, key: string) => {
    setBusy(true);
    setOpening(`${where}:${key}`);
    setError(null);
    try {
      await useFriendsStore.getState().openGame(playerId, gameId);
    } catch (e) {
      if (e instanceof FriendReplayUnreadable) {
        setError({ where, text: "That game can't be shown." });
      } else if (e instanceof ApiError && e.status === 404) {
        // Still friends: the game is gone. Otherwise the section has caught
        // up: the friend's card closed and their lines left the feed.
        const s = useFriendsStore.getState();
        const stillFriends =
          where === 'games' ? s.cardFor === playerId : !!s.friends?.some((f) => f?.player_id === playerId);
        setError(
          stillFriends
            ? { where, text: "That game isn't there any more." }
            : { where: where === 'games' ? 'friends' : 'feed', text: NOT_A_FRIEND },
        );
      } else {
        setError({ where, text: CONNECT });
      }
    } finally {
      setOpening(null);
      setBusy(false);
    }
  };

  const openingIn = (where: 'games' | 'feed') =>
    opening?.startsWith(`${where}:`) ? opening.slice(where.length + 1) : null;

  const errorLine = (where: Where) =>
    error && error.where === where ? (
      <p className="profile-devices-error" role="alert">
        {error.text}
      </p>
    ) : null;

  return (
    <section className="profile-section profile-friends">
      <div className="profile-friends-head">
        <div className="profile-section-eyebrow">Friends</div>
        <button
          className="profile-devices-btn profile-devices-btn-quiet profile-friends-refresh"
          onClick={() => void refreshNow()}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <FeedBlock
        feed={feed}
        loading={loading}
        busy={busy}
        opening={openingIn('feed')}
        error={errorLine('feed')}
        onWatch={(playerId, gameId, key) => void watchGame('feed', playerId, gameId, key)}
      />

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
              const status = statuses.get(f.playerId);
              return (
                <li
                  key={f.playerId}
                  className="profile-friends-friend"
                  data-player-id={f.playerId}
                  ref={f.playerId === reopenCard ? reopenedRow : undefined}
                >
                  <button className="profile-friends-person" onClick={() => toggleCard(f.playerId)} aria-expanded={open}>
                    <AvatarWithDot avatar={f.avatar} size={44} active={!!status?.active} />
                    <span className="profile-friends-who">
                      <span className="profile-friends-name">{f.name}</span>
                      <FriendStatusLine status={status} />
                    </span>
                    <span className="profile-friends-chevron" aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                  </button>
                  {open && (
                    <FriendCardPanel
                      view={card ? cardView(card) : null}
                      games={cardGames === null ? null : gameLines(cardGames)}
                      gamesFailed={cardGamesFailed}
                      opening={openingIn('games')}
                      gamesError={errorLine('games')}
                      askRemove={askRemove}
                      busy={busy}
                      onWatch={(gameId) => void watchGame('games', f.playerId, gameId, gameId)}
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

/** An avatar, with a green dot when that friend is online now. */
function AvatarWithDot({ avatar, size, active }: { avatar: CardView['avatar']; size: number; active: boolean }) {
  return (
    <span className="profile-friends-avatar">
      <Avatar type={avatar} size={size} />
      {active && <span className="profile-friends-dot" role="img" aria-label="Online now" />}
    </span>
  );
}

/** Under a friend's name in the list: online now, and their ranks. */
function FriendStatusLine({ status }: { status: FriendStatus | undefined }) {
  if (!status || (!status.active && status.ranks.length === 0)) return null;
  return (
    <span className="profile-friends-status">
      {status.active && <span className="profile-friends-online">Online now</span>}
      {status.active && status.ranks.length > 0 && ' · '}
      {status.ranks.length > 0 && ranksText(status.ranks)}
    </span>
  );
}

interface FeedBlockProps {
  feed: unknown;
  loading: boolean;
  busy: boolean;
  /** The key of the line whose game is on its way to the viewer, if any. */
  opening: string | null;
  error: ReactNode;
  onWatch: (playerId: string, gameId: string, key: string) => void;
}

/** The feed: who is online now, then what friends did lately. A result
 *  whose game the friend has synced opens it (revision 8). */
function FeedBlock({ feed, loading, busy, opening, error, onWatch }: FeedBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const online = onlineLines(feed);
  const lines = feedLines(feed);
  const shown = showAll ? lines : lines.slice(0, FEED_SHOWN);
  const hasFriends = !!feed && Array.isArray((feed as { friends?: unknown }).friends) && (feed as { friends: unknown[] }).friends.length > 0;

  return (
    <div className="profile-friends-block profile-friends-feed">
      <div className="profile-friends-label">What your friends are up to</div>
      {feed === null ? (
        <p className="profile-friends-feed-empty">{loading ? 'Loading…' : ''}</p>
      ) : online.length === 0 && lines.length === 0 ? (
        <p className="profile-friends-feed-empty">
          {hasFriends
            ? "Your friends haven't played any ranked games yet."
            : "When you have friends, you'll see their games here."}
        </p>
      ) : (
        <ul className="profile-friends-feed-list">
          {online.map((o) => (
            <li key={`online-${o.playerId}`} className="profile-friends-feed-item profile-friends-feed-online" data-player-id={o.playerId}>
              <AvatarWithDot avatar={o.avatar} size={36} active />
              <span className="profile-friends-feed-text">{o.text}</span>
            </li>
          ))}
          {shown.map((l) => {
            const gameId = l.gameId;
            const line = (
              <>
                <AvatarWithDot avatar={l.avatar} size={36} active={l.active} />
                <span className="profile-friends-feed-text">{l.text}</span>
                <span className="profile-friends-feed-when">{opening === l.key ? 'Opening…' : l.when}</span>
              </>
            );
            return (
              <li
                key={l.key}
                className={
                  'profile-friends-feed-item' +
                  (l.good ? ' profile-friends-feed-good' : '') +
                  (gameId ? ' profile-friends-feed-game' : '')
                }
                data-player-id={l.playerId}
              >
                {gameId ? (
                  <button
                    className="profile-friends-feed-watch"
                    onClick={() => onWatch(l.playerId, gameId, l.key)}
                    disabled={busy}
                    aria-label={`Watch: ${l.text}, ${l.when}`}
                  >
                    {line}
                    <span className="profile-friends-game-play" aria-hidden="true">
                      ▶
                    </span>
                  </button>
                ) : (
                  line
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error}
      {lines.length > FEED_SHOWN && (
        <button className="profile-devices-btn profile-devices-btn-quiet profile-friends-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

interface FriendCardPanelProps {
  view: CardView | null;
  games: GameLine[] | null;
  gamesFailed: boolean;
  /** The id of the game on its way to the viewer, if any. */
  opening: string | null;
  gamesError: ReactNode;
  askRemove: boolean;
  busy: boolean;
  onWatch: (gameId: string) => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
  onClose: () => void;
}

function FriendCardPanel({
  view,
  games,
  gamesFailed,
  opening,
  gamesError,
  askRemove,
  busy,
  onWatch,
  onAskRemove,
  onCancelRemove,
  onRemove,
  onClose,
}: FriendCardPanelProps) {
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

      <div className="profile-friends-label">Recent games</div>
      {games === null ? (
        <p className="profile-admin-muted profile-friends-games-note">
          {gamesFailed ? "Couldn't load their games." : 'Loading games…'}
        </p>
      ) : games.length === 0 ? (
        <p className="profile-admin-muted profile-friends-games-note">No saved games yet.</p>
      ) : (
        <ul className="profile-friends-games">
          {games.map((g) => (
            <li key={g.id}>
              <button
                className={'profile-friends-game' + (g.outcome === 'win' ? ' profile-friends-game-win' : '')}
                onClick={() => onWatch(g.id)}
                disabled={busy}
                aria-label={`Watch: ${g.text}, ${g.when}`}
              >
                <span className="profile-friends-game-text">{g.text}</span>
                <span className="profile-friends-game-when">{opening === g.id ? 'Opening…' : g.when}</span>
                <span className="profile-friends-game-play" aria-hidden="true">
                  ▶
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {gamesError}

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
