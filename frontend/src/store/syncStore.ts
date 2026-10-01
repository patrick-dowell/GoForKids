import { create } from 'zustand';
import { ApiError } from '../api/client';
import {
  normalizePairingCode,
  syncApi,
  type DeviceGrant,
  type PairingCode,
  type RemoteGameEntry,
  type RemoteState,
  type SyncStateDoc,
} from '../api/sync';
import { isHandle, randomHandle } from '../profile/names';
import {
  onBeforeRankedResult,
  onRankedResult,
  reapplyRankedResults,
  useAutoPlayStore,
  type RankedResult,
} from './autoPlayStore';
import { useLearnStore } from './learnStore';
import { LIBRARY_CAP, useLibraryStore, type SavedGame } from './libraryStore';
import { useProfileStore } from './profileStore';

/**
 * Sync (feature 32, revision 2): every player has a profile — a record on
 * the server holding rank, lessons, avatar, generated name and replays. No
 * account: a device token, and a pairing code to log another device in. See
 * feature_plans/32_sync_foundation.md.
 *
 * At start-up the app is in one of three cases (`startSync`):
 *   1. logged in (a token is stored) — run a pass;
 *   2. an existing player without a profile — create one, silently, from
 *      what the device holds, and introduce the generated name once;
 *   3. a new install — show the first-run choice: New player, or log in.
 * Creating never blocks play: a failed create is retried at every app open
 * and every sync trigger until it lands.
 *
 * A revision counter decides which side is newer. Ranked results this device
 * could not push wait in a queue and are re-applied, in order, on top of the
 * server's ladder at the next pass.
 */

const STORAGE_KEY = 'goforkids.sync.v1';

/** How long Play on a ranked game waits for a pass before starting anyway. */
export const PLAY_SYNC_TIMEOUT_MS = 2000;

/** How many times a pass rebases and re-pushes after a 409. */
export const MAX_CONFLICT_RETRIES = 3;

/** Why a profile is waiting to be created: made from progress this device
 *  already had, or chosen as "New player" at first run. */
export type PendingCreate = 'existing' | 'new';

/** Shown on the first-run choice after a 401 cleared this device. */
export type FirstRunNotice = 'logged-out';

export type StartupCase = 'logged-in' | 'pending' | 'existing' | 'first-run';

interface PersistedSync {
  playerId: string | null;
  deviceToken: string | null;
  /** The server revision this device's state was last level with. */
  baseRev: number;
  /** Local state has changed since the last push. */
  dirty: boolean;
  /** Ranked results applied here but not yet in a pushed state. */
  pendingResults: RankedResult[];
  /** Replays this device has sent, or fetched, that the server holds. */
  syncedGameIds: string[];
  /** Synced replays deleted here whose server copy is still to delete. */
  pendingGameDeletes: string[];
  /** Epoch ms of the last pass that left this device level with the server. */
  lastSyncAt: number | null;
  /** A profile still to be created (no token yet). */
  pendingCreate: PendingCreate | null;
  /** The one-time card introducing the generated name is due. */
  showIntro: boolean;
  /** Replays the server refused (413 / 422): never sent again. */
  refusedGameIds: string[];
}

const EMPTY: PersistedSync = {
  playerId: null,
  deviceToken: null,
  baseRev: 0,
  dirty: false,
  pendingResults: [],
  syncedGameIds: [],
  pendingGameDeletes: [],
  lastSyncAt: null,
  pendingCreate: null,
  showIntro: false,
  refusedGameIds: [],
};

interface SyncState extends PersistedSync {
  /** A pass is running (UI hint only). */
  syncing: boolean;
  /** Show the first-run choice (New player / log in) before anything else. */
  firstRun: boolean;
  /** One line on the first-run choice saying why it is back. */
  firstRunNotice: FirstRunNotice | null;

  loadFromStorage: () => void;
  /** Run a pass now (or join the one queued behind the running pass).
   *  Resolves true when the pass completed: state level, replays reconciled. */
  sync: () => Promise<boolean>;
  /** First run → "New player": keep the chosen name, create the profile in
   *  the background, and carry on into the app. */
  startNewPlayer: () => void;
  /** First run → "I already play on another device": redeem the code and
   *  take the account whole — rank, lessons, avatar, name, replays. Nothing
   *  local is merged in. Throws (changing nothing) when it can't. */
  logIn: (code: string) => Promise<void>;
  /** Mint a pairing code that logs another device into this profile,
   *  creating the profile first if it doesn't exist yet. */
  addDevice: () => Promise<PairingCode>;
  /** Push everything, revoke this device's token, clear the player's data
   *  here (settings stay) and go back to the first-run choice. Throws, and
   *  changes nothing, when the pass or the revoke can't complete. */
  logOut: () => Promise<void>;
  /** The name card has been seen. */
  dismissIntro: () => void;
}

/* ------------------------------------------------------------------------- *
 * Module state (not persisted).
 * ------------------------------------------------------------------------- */

/** >0 while sync itself writes to the other stores, so their subscriptions
 *  below don't mistake the write for a local change. */
let applyingRemote = 0;
/** Bumped on every local change; a push compares it to tell whether
 *  something changed while the request was in flight. */
let generation = 0;
/** The avatar / name was changed here since the last push. A pass that finds
 *  the server ahead keeps it instead of taking the server's. */
let avatarEdited = false;
let handleEdited = false;
let running: Promise<boolean> | null = null;
let queued: Promise<boolean> | null = null;
/** A ranked game is being played: a pass that finds the server ahead holds
 *  what it brought instead of changing the rank mid-game. */
let rankedGameActive = false;
let heldRemote: RemoteState | null = null;
/** Set when the store is created. */
let passRunner: () => Promise<boolean> = () => Promise.resolve(false);
let holdRelease: () => void = () => {};

function asRemote(fn: () => void): void {
  applyingRemote++;
  try {
    fn();
  } finally {
    applyingRemote--;
  }
}

/* ------------------------------------------------------------------------- *
 * Persistence.
 * ------------------------------------------------------------------------- */

function pickPersisted(s: PersistedSync): PersistedSync {
  return {
    playerId: s.playerId,
    deviceToken: s.deviceToken,
    baseRev: s.baseRev,
    dirty: s.dirty,
    pendingResults: s.pendingResults,
    syncedGameIds: s.syncedGameIds,
    pendingGameDeletes: s.pendingGameDeletes,
    lastSyncAt: s.lastSyncAt,
    pendingCreate: s.pendingCreate,
    showIntro: s.showIntro,
    refusedGameIds: s.refusedGameIds,
  };
}

function persist(s: PersistedSync) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pickPersisted(s)));
  } catch (e) {
    console.warn('Failed to save sync state:', e);
  }
}

function isRankedResult(v: unknown): v is RankedResult {
  const r = v as RankedResult;
  return (
    !!r &&
    (r.boardSize === 9 || r.boardSize === 13 || r.boardSize === 19) &&
    (r.result === 'win' || r.result === 'loss') &&
    typeof r.ts === 'number' &&
    typeof r.undosUsed === 'number'
  );
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function parsePersisted(raw: string | null): PersistedSync {
  if (!raw) return { ...EMPTY };
  try {
    const p = JSON.parse(raw) as Partial<PersistedSync>;
    const token = typeof p.deviceToken === 'string' && p.deviceToken ? p.deviceToken : null;
    const pendingCreate =
      !token && (p.pendingCreate === 'existing' || p.pendingCreate === 'new') ? p.pendingCreate : null;
    if (!token && !pendingCreate) return { ...EMPTY };
    return {
      playerId: typeof p.playerId === 'string' ? p.playerId : null,
      deviceToken: token,
      baseRev: typeof p.baseRev === 'number' ? p.baseRev : 0,
      dirty: p.dirty === true,
      pendingResults: Array.isArray(p.pendingResults) ? p.pendingResults.filter(isRankedResult) : [],
      syncedGameIds: stringArray(p.syncedGameIds),
      pendingGameDeletes: stringArray(p.pendingGameDeletes),
      lastSyncAt: typeof p.lastSyncAt === 'number' ? p.lastSyncAt : null,
      pendingCreate,
      showIntro: p.showIntro === true,
      refusedGameIds: stringArray(p.refusedGameIds),
    };
  } catch {
    return { ...EMPTY };
  }
}

/* ------------------------------------------------------------------------- *
 * The state document.
 * ------------------------------------------------------------------------- */

/** This device's state document. Built key by key so nothing else (settings,
 *  or anything typed) can ride along. */
export function buildLocalDoc(): SyncStateDoc {
  const profile = useProfileStore.getState();
  const doc: SyncStateDoc = {
    schema: 1,
    ladder: useAutoPlayStore.getState().exportLadder(),
    lessons: [...useLearnStore.getState().completed],
    avatar: profile.avatar,
    avatarPicked: profile.avatarPicked,
  };
  if (isHandle(profile.handle)) doc.handle = [profile.handle[0], profile.handle[1]];
  return doc;
}

/** JSON with sorted keys, so two copies of one document compare equal
 *  whatever order their keys came back in. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function sameDoc(a: SyncStateDoc, b: SyncStateDoc): boolean {
  const norm = (d: SyncStateDoc) => ({ ...d, lessons: [...stringArray(d.lessons)].sort() });
  return stableJson(norm(a)) === stableJson(norm(b));
}

function isStateDoc(v: unknown): v is SyncStateDoc {
  const d = v as SyncStateDoc;
  return !!d && typeof d === 'object' && !!d.ladder && typeof d.ladder === 'object' && Array.isArray(d.lessons);
}

function checkRemote(r: RemoteState): RemoteState {
  if (!r || typeof r.rev !== 'number' || !isStateDoc(r.state)) {
    throw new Error('sync: malformed state from server');
  }
  return r;
}

function isGrant(g: DeviceGrant): boolean {
  return !!g && typeof g.device_token === 'string' && !!g.device_token && typeof g.rev === 'number' && isStateDoc(g.state);
}

/** Case 2 test: ranked history on any board, a finished lesson, a saved
 *  replay or a deliberately picked avatar. */
export function deviceHoldsProgress(): boolean {
  const auto = useAutoPlayStore.getState();
  const ranked = auto.history.length > 0 || Object.values(auto.slots).some((s) => (s?.history?.length ?? 0) > 0);
  return (
    ranked ||
    useLearnStore.getState().completed.size > 0 ||
    useLibraryStore.getState().games.length > 0 ||
    useProfileStore.getState().avatarPicked
  );
}

/** Give the player a name if they have none. True when one was made. */
function ensureHandle(): boolean {
  if (isHandle(useProfileStore.getState().handle)) return false;
  asRemote(() => useProfileStore.getState().setHandle(randomHandle()));
  return true;
}

/* ------------------------------------------------------------------------- *
 * The store.
 * ------------------------------------------------------------------------- */

type StateOutcome = 'ok' | 'gave-up' | 'held' | 'stopped';

export const useSyncStore = create<SyncState>((set, get) => {
  /** Set persisted fields and write them through. */
  const update = (patch: Partial<PersistedSync>) => {
    set(patch);
    persist(get());
  };

  const linkedWith = (token: string) => get().deviceToken === token;

  /** Take the server's copy: its ladder with this device's queued results
   *  re-applied in order, its avatar and name (unless changed here since the
   *  last push), and the union of lessons. Returns true when that left this
   *  device identical to the server (nothing to push). */
  const adoptRemote = (remote: RemoteState): boolean => {
    const queue = get().pendingResults;
    const { ladder, applied } = reapplyRankedResults(remote.state.ladder, queue);
    asRemote(() => {
      useAutoPlayStore.getState().adoptLadder(ladder);
      useProfileStore.getState().adoptProfile({
        avatar: avatarEdited ? undefined : remote.state.avatar,
        avatarPicked: avatarEdited ? undefined : remote.state.avatarPicked,
        handle: handleEdited ? undefined : remote.state.handle,
      });
      useLearnStore.getState().addCompleted(stringArray(remote.state.lessons));
    });
    // A queued result the server already held (an earlier push whose reply
    // was lost) is done; the rest wait for a push to land.
    const appliedTs = new Set(applied.map((r) => r.ts));
    const same = sameDoc(buildLocalDoc(), remote.state);
    update({ baseRev: remote.rev, pendingResults: queue.filter((r) => appliedTs.has(r.ts)), dirty: !same });
    return same;
  };

  holdRelease = () => {
    rankedGameActive = false;
    const held = heldRemote;
    heldRemote = null;
    if (held && get().deviceToken && held.rev !== get().baseRev) {
      if (adoptRemote(held)) update({ lastSyncAt: Date.now() });
    }
  };

  /** Log this device out locally: every piece of player data and all sync
   *  state go; device settings stay. Back to the first-run choice. */
  const signOutLocally = (notice: FirstRunNotice | null) => {
    asRemote(() => {
      useAutoPlayStore.getState().clearPlayer();
      useLearnStore.getState().replaceCompleted([]);
      useLibraryStore.getState().replaceGames([]);
      useProfileStore.getState().clearPlayer();
    });
    heldRemote = null;
    rankedGameActive = false;
    avatarEdited = false;
    handleEdited = false;
    generation++;
    update({ ...EMPTY });
    set({ firstRun: true, firstRunNotice: notice });
  };

  /** A 401: the server no longer knows this device's token. */
  const handleUnauthorized = (token: string) => {
    if (linkedWith(token)) signOutLocally('logged-out');
  };

  type PushOutcome = { kind: 'ok' } | { kind: 'conflict'; remote: RemoteState } | { kind: 'stopped' };

  const push = async (token: string): Promise<PushOutcome> => {
    const doc = buildLocalDoc();
    const pushed = new Set(get().pendingResults.map((r) => r.ts));
    const gen = generation;
    const res = await syncApi.putState(token, get().baseRev, doc);
    if (!linkedWith(token)) return { kind: 'stopped' };
    if (!res.ok) return { kind: 'conflict', remote: { rev: res.rev, state: res.state } };
    update({
      baseRev: res.rev,
      pendingResults: get().pendingResults.filter((r) => !pushed.has(r.ts)),
      dirty: generation !== gen,
      lastSyncAt: Date.now(),
    });
    const p = useProfileStore.getState();
    if (p.avatar === doc.avatar) avatarEdited = false;
    if (p.handle && doc.handle && p.handle[0] === doc.handle[0] && p.handle[1] === doc.handle[1]) {
      handleEdited = false;
    }
    return { kind: 'ok' };
  };

  /** Steps 1–4 of a pass. */
  const syncState = async (token: string): Promise<StateOutcome> => {
    let remote = checkRemote(await syncApi.getState(token));
    if (!linkedWith(token)) return 'stopped';
    let retries = 0;
    for (;;) {
      if (remote.rev !== get().baseRev) {
        // Server ahead. Mid ranked game, the rank must not move: hold the
        // server's copy until the game ends.
        if (rankedGameActive) {
          heldRemote = remote;
          return 'held';
        }
        // Rebase onto it, then push if that left anything the server lacks.
        if (adoptRemote(remote)) {
          update({ lastSyncAt: Date.now() });
          return 'ok';
        }
      } else {
        // Level. Lessons only ever grow, so take any the server has.
        asRemote(() => useLearnStore.getState().addCompleted(stringArray(remote.state.lessons)));
        if (!get().dirty) {
          update({ lastSyncAt: Date.now() });
          return 'ok';
        }
      }
      const out = await push(token);
      if (out.kind === 'stopped') return 'stopped';
      if (out.kind === 'ok') return 'ok';
      // 409: the server moved since we read it. Rebase onto its copy and
      // try again, a bounded number of times; the queue stays intact.
      if (retries >= MAX_CONFLICT_RETRIES) return 'gave-up';
      retries++;
      remote = checkRemote(out.remote);
    }
  };

  /** Step 5 of a pass: send local replays the server lacks, fetch the ones
   *  this device lacks, drop the ones sent before that the server no longer
   *  lists; keep the newest LIBRARY_CAP of the union. False when stopped. */
  const syncGames = async (token: string): Promise<boolean> => {
    for (const id of [...get().pendingGameDeletes]) {
      await syncApi.deleteGame(token, id);
      if (!linkedWith(token)) return false;
      update({
        pendingGameDeletes: get().pendingGameDeletes.filter((x) => x !== id),
        syncedGameIds: get().syncedGameIds.filter((x) => x !== id),
      });
    }

    const listed = await syncApi.listGames(token);
    if (!linkedWith(token)) return false;
    const deleting = new Set(get().pendingGameDeletes);
    const remote = listed.filter(
      (g): g is RemoteGameEntry => !!g && typeof g.id === 'string' && typeof g.date === 'string' && !deleting.has(g.id),
    );
    const remoteIds = new Set(remote.map((g) => g.id));

    // Drop what was sent before and is gone from the server (deleted on
    // another device, or past the server's cap).
    const synced = new Set(get().syncedGameIds);
    const gone = new Set(
      useLibraryStore.getState().games.filter((g) => synced.has(g.id) && !remoteIds.has(g.id)).map((g) => g.id),
    );
    if (gone.size > 0) {
      asRemote(() =>
        useLibraryStore.getState().replaceGames(useLibraryStore.getState().games.filter((g) => !gone.has(g.id))),
      );
    }
    const local = useLibraryStore.getState().games;
    const localIds = new Set(local.map((g) => g.id));
    update({
      syncedGameIds: uniq([
        ...get().syncedGameIds.filter((id) => !gone.has(id)),
        ...local.filter((g) => remoteIds.has(g.id)).map((g) => g.id),
      ]),
    });

    // Only the newest LIBRARY_CAP of the union are worth moving.
    const union = new Map<string, string>();
    for (const g of local) union.set(g.id, g.date);
    for (const g of remote) if (!union.has(g.id)) union.set(g.id, g.date);
    const top = new Set(
      [...union.entries()]
        .map(([id, date]) => ({ id, date }))
        .sort(newestFirst)
        .slice(0, LIBRARY_CAP)
        .map((g) => g.id),
    );

    const refused = new Set(get().refusedGameIds);
    const notKept = new Set<string>();
    for (const game of local.filter((g) => top.has(g.id) && !remoteIds.has(g.id) && !refused.has(g.id))) {
      let kept: boolean;
      try {
        kept = await syncApi.putGame(token, game);
      } catch (e) {
        // The server refuses this one replay (too big, or an id/date it
        // won't take): remember it so it's never sent again, and go on.
        if (e instanceof ApiError && (e.status === 413 || e.status === 422)) {
          if (!linkedWith(token)) return false;
          update({ refusedGameIds: uniq([...get().refusedGameIds, game.id]) });
          continue;
        }
        throw e;
      }
      if (!linkedWith(token)) return false;
      if (!useLibraryStore.getState().games.some((g) => g.id === game.id)) {
        // Deleted here while it was on its way up: delete it there too.
        update({ pendingGameDeletes: uniq([...get().pendingGameDeletes, game.id]) });
      } else if (kept) {
        update({ syncedGameIds: uniq([...get().syncedGameIds, game.id]) });
      } else {
        notKept.add(game.id);
      }
    }

    const fetched: SavedGame[] = [];
    for (const entry of remote.filter((g) => top.has(g.id) && !localIds.has(g.id))) {
      try {
        const res = await syncApi.getGame(token, entry.id);
        if (!linkedWith(token)) return false;
        const game = toSavedGame(res?.payload, entry);
        if (game) fetched.push(game);
      } catch (e) {
        // Deleted on another device since the list was read: skip it.
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }

    if (fetched.length > 0 || notKept.size > 0) {
      asRemote(() => {
        const byId = new Map<string, SavedGame>();
        for (const g of [...useLibraryStore.getState().games, ...fetched]) {
          if (!byId.has(g.id) && !notKept.has(g.id)) byId.set(g.id, g);
        }
        const merged = [...byId.values()].sort(newestFirst).slice(0, LIBRARY_CAP);
        useLibraryStore.getState().replaceGames(merged);
      });
    }
    const here = new Set(useLibraryStore.getState().games.map((g) => g.id));
    update({
      syncedGameIds: uniq([...get().syncedGameIds, ...fetched.map((g) => g.id)]).filter((id) => here.has(id)),
      refusedGameIds: get().refusedGameIds.filter((id) => here.has(id)),
    });
    return true;
  };

  /** Create the profile this device is waiting for, from what it holds now.
   *  Returns the new token, or null when there was nothing to create. */
  const createProfile = async (): Promise<string | null> => {
    const kind = get().pendingCreate;
    if (!kind || get().deviceToken) return null;
    ensureHandle();
    const doc = buildLocalDoc();
    const grant = await syncApi.createPlayer(doc);
    // Logged in, or out, while the request was out: this create is moot.
    if (get().deviceToken || get().pendingCreate !== kind) return null;
    if (!isGrant(grant)) throw new Error('sync: malformed create response');
    update({
      ...EMPTY,
      playerId: grant.player_id,
      deviceToken: grant.device_token,
      baseRev: grant.rev,
      // Anything that changed while the request was out still needs a push.
      dirty: !sameDoc(buildLocalDoc(), doc),
      lastSyncAt: Date.now(),
      showIntro: kind === 'existing',
    });
    generation++;
    avatarEdited = false;
    handleEdited = false;
    return grant.device_token;
  };

  const runPass = async (): Promise<boolean> => {
    let token = get().deviceToken;
    if (!token && !get().pendingCreate) return false;
    set({ syncing: true });
    try {
      if (!token) {
        token = await createProfile();
        if (!token) return false;
      }
      const outcome = await syncState(token);
      if (outcome === 'stopped') return false;
      const reconciled = await syncGames(token);
      return outcome === 'ok' && reconciled && linkedWith(token);
    } catch (e) {
      if (token && e instanceof ApiError && e.status === 401) {
        handleUnauthorized(token);
        return false;
      }
      // Otherwise silent by design: never blocks play, never surfaces to the
      // player. The queue and the dirty flag are untouched; the next pass
      // (or create) retries.
      console.warn('[sync] pass failed:', e);
      return false;
    } finally {
      set({ syncing: false });
    }
  };

  const requestPass = (): Promise<boolean> => {
    if (!get().deviceToken && !get().pendingCreate) return Promise.resolve(false);
    if (!running) {
      running = runPass().finally(() => {
        running = null;
      });
      return running;
    }
    // A pass is running: join (or create) the single pass queued behind it,
    // so a burst of triggers costs one more pass, never two at once.
    if (!queued) {
      queued = running.then(() => {
        queued = null;
        return requestPass();
      });
    }
    return queued;
  };
  passRunner = requestPass;

  return {
    ...EMPTY,
    syncing: false,
    firstRun: false,
    firstRunNotice: null,

    loadFromStorage: () => {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        raw = null;
      }
      set(parsePersisted(raw));
    },

    sync: () => requestPass(),

    startNewPlayer: () => {
      if (get().deviceToken) return;
      ensureHandle();
      update({ ...EMPTY, pendingCreate: 'new' });
      set({ firstRun: false, firstRunNotice: null });
      void requestPass();
    },

    logIn: async (code: string) => {
      if (get().deviceToken) throw new Error('sync: already logged in');
      const grant = await syncApi.redeemPairingCode(normalizePairingCode(code));
      if (!isGrant(grant)) throw new Error('sync: malformed log-in response');
      if (get().deviceToken) throw new Error('sync: already logged in');
      const record = grant.state;
      // Take the account whole. Nothing this device held is merged in.
      asRemote(() => {
        useAutoPlayStore.getState().adoptLadder(record.ladder);
        useLearnStore.getState().replaceCompleted(stringArray(record.lessons));
        useLibraryStore.getState().replaceGames([]);
        useProfileStore.getState().clearPlayer();
        useProfileStore.getState().adoptProfile({
          avatar: record.avatar,
          avatarPicked: record.avatarPicked === true,
          handle: record.handle,
        });
      });
      // A profile made before names existed gets one now, and pushes it.
      const named = isHandle(record.handle);
      if (!named) ensureHandle();
      heldRemote = null;
      rankedGameActive = false;
      avatarEdited = false;
      handleEdited = !named;
      generation++;
      update({
        ...EMPTY,
        playerId: grant.player_id,
        deviceToken: grant.device_token,
        baseRev: grant.rev,
        dirty: !named,
        lastSyncAt: Date.now(),
      });
      set({ firstRun: false, firstRunNotice: null });
      // Fetches the account's replays.
      void requestPass();
    },

    addDevice: async () => {
      if (!get().deviceToken) {
        if (!get().pendingCreate) throw new Error('sync: no profile');
        await requestPass();
      }
      const token = get().deviceToken;
      if (!token) throw new Error('sync: the profile could not be created');
      try {
        return await syncApi.mintPairingCode(token);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) handleUnauthorized(token);
        throw e;
      }
    },

    logOut: async () => {
      const token = get().deviceToken;
      if (!token) throw new Error('sync: not logged in');
      holdRelease();
      const passed = await requestPass();
      if (!linkedWith(token)) return; // a 401 during the pass already signed out
      const s = get();
      if (!passed || s.dirty || s.pendingResults.length > 0 || s.pendingGameDeletes.length > 0) {
        throw new Error('sync: could not save everything online');
      }
      try {
        await syncApi.revokeDevice(token);
      } catch (e) {
        // 401: the token is already dead, which is where we were going.
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      }
      if (!linkedWith(token)) return;
      signOutLocally(null);
    },

    dismissIntro: () => update({ showIntro: false }),
  };
});

function uniq(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Newest first, the way the server ranks replays for its cap: `date`
 *  compared as a string (every client writes `toISOString()`), ties broken
 *  by id. */
function newestFirst(a: { id: string; date: string }, b: { id: string; date: string }): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function toSavedGame(payload: unknown, entry: RemoteGameEntry): SavedGame | null {
  const p = payload as SavedGame | null;
  if (!p || typeof p !== 'object' || typeof p.sgf !== 'string') return null;
  return { ...p, id: entry.id, date: typeof p.date === 'string' ? p.date : entry.date };
}

/* ------------------------------------------------------------------------- *
 * Start-up, triggers and the ranked-game hold.
 * ------------------------------------------------------------------------- */

/** Logged in (a token), waiting for a create, or neither (first run). */
function syncMode(): 'logged-in' | 'pending' | null {
  const s = useSyncStore.getState();
  if (s.deviceToken) return 'logged-in';
  if (s.pendingCreate) return 'pending';
  return null;
}

/** True when this device holds a token for a profile. */
export function isLoggedIn(): boolean {
  return syncMode() === 'logged-in';
}

function markDirty() {
  generation++;
  if (!useSyncStore.getState().dirty) {
    useSyncStore.setState({ dirty: true });
    persist(useSyncStore.getState());
  }
}

/** Start a pass (or retry a pending create). Concurrent calls share passes.
 *  On the first-run choice it does nothing. */
export function requestSync(): Promise<boolean> {
  if (!syncMode()) return Promise.resolve(false);
  return passRunner();
}

/** Resolves once no pass is running or queued. */
export function syncIdle(): Promise<unknown> {
  return queued ?? running ?? Promise.resolve();
}

/**
 * App open. Call after the other stores have loaded from storage. Decides,
 * once, which first-launch case this device is in and acts on it.
 */
export function startSync(): StartupCase {
  useSyncStore.getState().loadFromStorage();
  const s = useSyncStore.getState();
  if (s.deviceToken) {
    // A profile made before names existed gets one, pushed by this pass.
    if (ensureHandle()) {
      handleEdited = true;
      markDirty();
    }
    void requestSync();
    return 'logged-in';
  }
  if (s.pendingCreate) {
    void requestSync();
    return 'pending';
  }
  if (deviceHoldsProgress()) {
    ensureHandle();
    useSyncStore.setState({ pendingCreate: 'existing' });
    persist(useSyncStore.getState());
    void requestSync();
    return 'existing';
  }
  useSyncStore.setState({ firstRun: true });
  return 'first-run';
}

/**
 * Play on a ranked game: pull before it starts, bounded. Resolves when the
 * pass finishes or after `timeoutMs`, whichever comes first; the game starts
 * either way. Not logged in ⇒ resolves at once.
 */
export function syncBeforePlay(timeoutMs = PLAY_SYNC_TIMEOUT_MS): Promise<void> {
  if (!isLoggedIn()) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([requestSync().then(() => undefined), timeout]).finally(() => clearTimeout(timer));
}

/** A ranked game has started: until it ends, a pass that finds the server
 *  ahead holds what it brought instead of changing the rank. */
export function beginRankedGame(): void {
  holdRelease();
  rankedGameActive = true;
}

/** The ranked game ended without a result (left for home), or a new one is
 *  about to start: apply anything held back. `recordResult` does this
 *  itself, before the game's result lands on top. */
export function endRankedGame(): void {
  holdRelease();
}

onBeforeRankedResult(() => holdRelease());

// A finished ranked game: queue it until a push carries it, then sync. A
// profile still to be created gets a retry; the result rides in the create.
onRankedResult((r) => {
  const mode = syncMode();
  if (!mode) return;
  if (mode === 'logged-in') {
    const s = useSyncStore.getState();
    useSyncStore.setState({ pendingResults: [...s.pendingResults, r] });
    markDirty();
    persist(useSyncStore.getState());
  }
  void requestSync();
});

// Any other ladder change (derank, reset, an undo spent) is pushed by the
// next pass. A board switch that only snapshots the slot it leaves is not a
// change.
useAutoPlayStore.subscribe((s, prev) => {
  if (applyingRemote > 0 || syncMode() !== 'logged-in') return;
  if (s.slots === prev.slots && s.undoBank === prev.undoBank) return;
  if (stableJson({ b: s.slots, u: s.undoBank }) === stableJson({ b: prev.slots, u: prev.undoBank })) return;
  markDirty();
});

// A lesson finished. Lessons only grow in the record, so a local wipe (the
// Learn screen's fresh start) is not pushed.
useLearnStore.subscribe((s, prev) => {
  const mode = syncMode();
  if (applyingRemote > 0 || !mode || s.completed === prev.completed) return;
  if (![...s.completed].some((id) => !prev.completed.has(id))) return;
  if (mode === 'logged-in') markDirty();
  void requestSync();
});

// The avatar or the name changed.
useProfileStore.subscribe((s, prev) => {
  const mode = syncMode();
  if (applyingRemote > 0 || !mode) return;
  const avatarChanged = s.avatar !== prev.avatar || s.avatarPicked !== prev.avatarPicked;
  const handleChanged = s.handle !== prev.handle;
  if (!avatarChanged && !handleChanged) return;
  if (mode === 'logged-in') {
    if (avatarChanged) avatarEdited = true;
    if (handleChanged) handleEdited = true;
    markDirty();
  }
  void requestSync();
});

// A replay was saved or deleted. A deleted game the server holds is queued
// for deletion there.
useLibraryStore.subscribe((s, prev) => {
  const mode = syncMode();
  if (applyingRemote > 0 || !mode || s.games === prev.games) return;
  const now = new Set(s.games.map((g) => g.id));
  const before = new Set(prev.games.map((g) => g.id));
  const removed = [...before].filter((id) => !now.has(id));
  const added = [...now].some((id) => !before.has(id));
  if (removed.length === 0 && !added) return;
  if (mode === 'logged-in') {
    const st = useSyncStore.getState();
    const synced = new Set(st.syncedGameIds);
    const toDelete = removed.filter((id) => synced.has(id));
    if (toDelete.length > 0) {
      useSyncStore.setState({
        pendingGameDeletes: uniq([...st.pendingGameDeletes, ...toDelete]),
        syncedGameIds: st.syncedGameIds.filter((id) => !toDelete.includes(id)),
      });
      persist(useSyncStore.getState());
    }
  }
  void requestSync();
});

// Dev convenience, like the other stores: poke at sync from the console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __syncStore: typeof useSyncStore }).__syncStore = useSyncStore;
}
