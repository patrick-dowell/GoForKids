import { create } from 'zustand';
import { ApiError } from '../api/client';
import {
  normalizePairingCode,
  syncApi,
  type PairingCode,
  type RemoteGameEntry,
  type RemoteState,
  type SyncStateDoc,
} from '../api/sync';
import {
  onRankedResult,
  reapplyRankedResults,
  useAutoPlayStore,
  type RankedResult,
} from './autoPlayStore';
import { useLearnStore } from './learnStore';
import { LIBRARY_CAP, useLibraryStore, type SavedGame } from './libraryStore';
import { useProfileStore } from './profileStore';

/**
 * Sync (feature 32): one player record on the server, shared by every device
 * that links to it. No account — a device token, and a pairing code to bring
 * a second device in. See feature_plans/32_sync_foundation.md.
 *
 * A device that is not linked makes no sync request at all: every trigger
 * below returns before touching the network or storage.
 *
 * The record holds the ladder, finished lessons and the avatar (the state
 * document), plus the replay library. A revision counter decides which side
 * is newer. Ranked results this device could not push wait in a queue and
 * are re-applied, in order, on top of the server's ladder at the next pass.
 */

const STORAGE_KEY = 'goforkids.sync.v1';

/** How long Play on a ranked game waits for a pass before starting anyway. */
export const PLAY_SYNC_TIMEOUT_MS = 2000;

/** How many times a pass rebases and re-pushes after a 409. */
export const MAX_CONFLICT_RETRIES = 3;

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
};

interface SyncState extends PersistedSync {
  /** A pass is running (UI hint only). */
  syncing: boolean;

  loadFromStorage: () => void;
  /** Run a pass now (or join the one queued behind the running pass). */
  sync: () => Promise<void>;
  /** Mint a pairing code for another device, turning sync on first if this
   *  device is not linked yet. */
  addDevice: () => Promise<PairingCode>;
  /** Join the record a pairing code points to. This device's ladder is
   *  replaced by the record's; lessons are unioned; replays are merged. */
  link: (code: string) => Promise<void>;
  /** Revoke this device's token. Local rank, lessons and replays stay. */
  unlink: () => Promise<void>;
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
/** The avatar was changed here since the last push. A pass that finds the
 *  server ahead keeps it instead of taking the server's. */
let avatarEdited = false;
let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;
/** The store's pass scheduler, set when the store is created. */
let passRunner: () => Promise<void> = () => Promise.resolve();

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
    if (typeof p.deviceToken !== 'string' || !p.deviceToken) return { ...EMPTY };
    return {
      playerId: typeof p.playerId === 'string' ? p.playerId : null,
      deviceToken: p.deviceToken,
      baseRev: typeof p.baseRev === 'number' ? p.baseRev : 0,
      dirty: p.dirty === true,
      pendingResults: Array.isArray(p.pendingResults) ? p.pendingResults.filter(isRankedResult) : [],
      syncedGameIds: stringArray(p.syncedGameIds),
      pendingGameDeletes: stringArray(p.pendingGameDeletes),
      lastSyncAt: typeof p.lastSyncAt === 'number' ? p.lastSyncAt : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/* ------------------------------------------------------------------------- *
 * The state document.
 * ------------------------------------------------------------------------- */

/** This device's state document. Built key by key so nothing else (the
 *  display name above all, or settings) can ride along. */
export function buildLocalDoc(): SyncStateDoc {
  const profile = useProfileStore.getState();
  return {
    schema: 1,
    ladder: useAutoPlayStore.getState().exportLadder(),
    lessons: [...useLearnStore.getState().completed],
    avatar: profile.avatar,
    avatarPicked: profile.avatarPicked,
  };
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

/* ------------------------------------------------------------------------- *
 * The store.
 * ------------------------------------------------------------------------- */

export const useSyncStore = create<SyncState>((set, get) => {
  /** Set persisted fields and write them through. */
  const update = (patch: Partial<PersistedSync>) => {
    set(patch);
    persist(get());
  };

  const linkedWith = (token: string) => get().deviceToken === token;

  /** Take the server's copy: its ladder with this device's queued results
   *  re-applied in order, its avatar (unless changed here since the last
   *  push), and the union of lessons. */
  const adoptRemote = (remote: RemoteState) => {
    const queue = get().pendingResults;
    const { ladder, applied } = reapplyRankedResults(remote.state.ladder, queue);
    asRemote(() => {
      useAutoPlayStore.getState().adoptLadder(ladder);
      if (!avatarEdited && typeof remote.state.avatar === 'string') {
        useProfileStore.getState().adoptAvatar(remote.state.avatar, remote.state.avatarPicked === true);
      }
      useLearnStore.getState().addCompleted(stringArray(remote.state.lessons));
    });
    // A queued result the server already held (an earlier push whose reply
    // was lost) is done; the rest wait for this pass's push to land.
    const appliedTs = new Set(applied.map((r) => r.ts));
    update({ baseRev: remote.rev, pendingResults: queue.filter((r) => appliedTs.has(r.ts)) });
  };

  type PushOutcome = { kind: 'ok' } | { kind: 'conflict'; remote: RemoteState } | { kind: 'unlinked' };

  const push = async (token: string): Promise<PushOutcome> => {
    const doc = buildLocalDoc();
    const pushed = new Set(get().pendingResults.map((r) => r.ts));
    const gen = generation;
    const res = await syncApi.putState(token, get().baseRev, doc);
    if (!linkedWith(token)) return { kind: 'unlinked' };
    if (!res.ok) return { kind: 'conflict', remote: { rev: res.rev, state: res.state } };
    update({
      baseRev: res.rev,
      pendingResults: get().pendingResults.filter((r) => !pushed.has(r.ts)),
      dirty: generation !== gen,
      lastSyncAt: Date.now(),
    });
    if (useProfileStore.getState().avatar === doc.avatar) avatarEdited = false;
    return { kind: 'ok' };
  };

  /** Steps 1–4 of a pass. Returns false when the device was unlinked
   *  mid-pass (stop quietly). */
  const syncState = async (token: string): Promise<boolean> => {
    let remote = checkRemote(await syncApi.getState(token));
    if (!linkedWith(token)) return false;
    let retries = 0;
    for (;;) {
      if (remote.rev !== get().baseRev) {
        // Server ahead (or reset): rebase onto it, then push if that left
        // anything the server lacks.
        adoptRemote(remote);
        if (sameDoc(buildLocalDoc(), remote.state)) {
          update({ dirty: false, lastSyncAt: Date.now() });
          return true;
        }
        update({ dirty: true });
      } else {
        // Level. Lessons only ever grow, so take any the server has.
        asRemote(() => useLearnStore.getState().addCompleted(stringArray(remote.state.lessons)));
        if (!get().dirty) {
          update({ lastSyncAt: Date.now() });
          return true;
        }
      }
      const out = await push(token);
      if (out.kind === 'unlinked') return false;
      if (out.kind === 'ok') return true;
      // 409: the server moved since we read it. Rebase onto its copy and
      // try again, a bounded number of times; the queue stays intact.
      if (retries >= MAX_CONFLICT_RETRIES) return true;
      retries++;
      remote = checkRemote(out.remote);
    }
  };

  /** Step 5 of a pass: send local replays the server lacks, fetch the ones
   *  this device lacks, drop the ones sent before that the server no longer
   *  lists; keep the newest LIBRARY_CAP of the union. */
  const syncGames = async (token: string): Promise<void> => {
    for (const id of [...get().pendingGameDeletes]) {
      await syncApi.deleteGame(token, id);
      if (!linkedWith(token)) return;
      update({
        pendingGameDeletes: get().pendingGameDeletes.filter((x) => x !== id),
        syncedGameIds: get().syncedGameIds.filter((x) => x !== id),
      });
    }

    const listed = await syncApi.listGames(token);
    if (!linkedWith(token)) return;
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

    const notKept = new Set<string>();
    for (const game of local.filter((g) => top.has(g.id) && !remoteIds.has(g.id))) {
      let kept: boolean;
      try {
        kept = await syncApi.putGame(token, game);
      } catch (e) {
        // The server refuses this one replay (too big, or an id/date it
        // won't take): it stays local-only and doesn't hold up the rest.
        if (e instanceof ApiError && (e.status === 413 || e.status === 422)) continue;
        throw e;
      }
      if (!linkedWith(token)) return;
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
        if (!linkedWith(token)) return;
        const game = toSavedGame(res?.payload, entry);
        if (game) fetched.push(game);
      } catch (e) {
        // Deleted on another device since the list was read: skip it.
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
    }

    if (fetched.length === 0 && notKept.size === 0) return;
    asRemote(() => {
      const byId = new Map<string, SavedGame>();
      for (const g of [...useLibraryStore.getState().games, ...fetched]) {
        if (!byId.has(g.id) && !notKept.has(g.id)) byId.set(g.id, g);
      }
      const merged = [...byId.values()].sort(newestFirst).slice(0, LIBRARY_CAP);
      useLibraryStore.getState().replaceGames(merged);
    });
    const kept = new Set(useLibraryStore.getState().games.map((g) => g.id));
    update({
      syncedGameIds: uniq([...get().syncedGameIds, ...fetched.map((g) => g.id)]).filter((id) => kept.has(id)),
    });
  };

  const runPass = async (): Promise<void> => {
    const token = get().deviceToken;
    if (!token) return;
    set({ syncing: true });
    try {
      if (!(await syncState(token))) return;
      await syncGames(token);
    } catch (e) {
      // Silent by design: never blocks play, never surfaces to the player.
      // The queue and the dirty flag are untouched, so the next pass retries.
      console.warn('[sync] pass failed:', e);
    } finally {
      set({ syncing: false });
    }
  };

  const requestPass = (): Promise<void> => {
    if (!get().deviceToken) return Promise.resolve();
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

  const turnOn = async (): Promise<void> => {
    const doc = buildLocalDoc();
    const grant = await syncApi.createPlayer(doc);
    if (get().deviceToken) return;
    update({
      ...EMPTY,
      playerId: grant.player_id,
      deviceToken: grant.device_token,
      baseRev: grant.rev,
      // Anything that changed while the request was out still needs a push.
      dirty: !sameDoc(buildLocalDoc(), doc),
      lastSyncAt: Date.now(),
    });
    generation++;
    avatarEdited = false;
    // Sends every local replay.
    void requestPass();
  };

  return {
    ...EMPTY,
    syncing: false,

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

    addDevice: async () => {
      if (!get().deviceToken) await turnOn();
      const token = get().deviceToken;
      if (!token) throw new Error('sync: not linked');
      return syncApi.mintPairingCode(token);
    },

    link: async (code: string) => {
      if (get().deviceToken) throw new Error('sync: already linked');
      const grant = await syncApi.redeemPairingCode(normalizePairingCode(code));
      if (!grant || typeof grant.device_token !== 'string' || typeof grant.rev !== 'number' || !isStateDoc(grant.state)) {
        throw new Error('sync: malformed link response');
      }
      const record = grant.state;
      const localPicked = useProfileStore.getState().avatarPicked;
      // The record's avatar wins, unless the record never had one picked
      // and this device did.
      const keepLocalAvatar = localPicked && record.avatarPicked !== true;
      asRemote(() => {
        useAutoPlayStore.getState().adoptLadder(record.ladder);
        if (!keepLocalAvatar && typeof record.avatar === 'string') {
          useProfileStore.getState().adoptAvatar(record.avatar, record.avatarPicked === true);
        }
        useLearnStore.getState().addCompleted(stringArray(record.lessons));
      });
      update({
        ...EMPTY,
        playerId: grant.player_id,
        deviceToken: grant.device_token,
        baseRev: grant.rev,
        // Push only if the union (or a kept avatar) changed anything.
        dirty: !sameDoc(buildLocalDoc(), record),
        lastSyncAt: Date.now(),
      });
      generation++;
      avatarEdited = keepLocalAvatar;
      // Pushes if dirty, then sends this device's replays and fetches the
      // record's.
      void requestPass();
    },

    unlink: async () => {
      const token = get().deviceToken;
      if (!token) return;
      try {
        await syncApi.revokeDevice(token);
      } catch (e) {
        // 401: the token is already dead, which is what we wanted.
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      }
      avatarEdited = false;
      update({ ...EMPTY });
    },
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
 * Triggers.
 * ------------------------------------------------------------------------- */

function isLinked(): boolean {
  return useSyncStore.getState().deviceToken !== null;
}

/** True when this device is linked to a record. */
export function isSyncLinked(): boolean {
  return isLinked();
}

function markDirty() {
  generation++;
  if (!useSyncStore.getState().dirty) {
    useSyncStore.setState({ dirty: true });
    persist(useSyncStore.getState());
  }
}

/** Start a pass (no-op when not linked). Concurrent calls share passes. */
export function requestSync(): Promise<void> {
  if (!isLinked()) return Promise.resolve();
  return passRunner();
}

/** Resolves once no pass is running or queued. */
export function syncIdle(): Promise<void> {
  return queued ?? running ?? Promise.resolve();
}

/** App open: load the link, then (if linked) run a pass. Call after the
 *  other stores have loaded from storage. */
export function startSync(): Promise<void> {
  useSyncStore.getState().loadFromStorage();
  return requestSync();
}

/**
 * Play on a ranked game: pull before it starts, bounded. Resolves when the
 * pass finishes or after `timeoutMs`, whichever comes first; the game starts
 * either way. Not linked ⇒ resolves at once without a request.
 */
export function syncBeforePlay(timeoutMs = PLAY_SYNC_TIMEOUT_MS): Promise<void> {
  if (!isLinked()) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([requestSync(), timeout]).finally(() => clearTimeout(timer));
}

// A finished ranked game: queue it until a push carries it, then sync.
onRankedResult((r) => {
  if (!isLinked()) return;
  const s = useSyncStore.getState();
  useSyncStore.setState({ pendingResults: [...s.pendingResults, r] });
  markDirty();
  persist(useSyncStore.getState());
  void requestSync();
});

// Any other ladder change (derank, reset, an undo spent) is pushed by the
// next pass. A board switch that only snapshots the slot it leaves is not a
// change.
useAutoPlayStore.subscribe((s, prev) => {
  if (applyingRemote > 0 || !isLinked()) return;
  if (s.slots === prev.slots && s.undoBank === prev.undoBank) return;
  if (stableJson({ b: s.slots, u: s.undoBank }) === stableJson({ b: prev.slots, u: prev.undoBank })) return;
  markDirty();
});

// A lesson finished. Lessons only grow in the record, so a local wipe (the
// Learn screen's fresh start) is not pushed.
useLearnStore.subscribe((s, prev) => {
  if (applyingRemote > 0 || !isLinked() || s.completed === prev.completed) return;
  if (![...s.completed].some((id) => !prev.completed.has(id))) return;
  markDirty();
  void requestSync();
});

// The avatar changed. (The display name is not watched: it never syncs.)
useProfileStore.subscribe((s, prev) => {
  if (applyingRemote > 0 || !isLinked()) return;
  if (s.avatar === prev.avatar && s.avatarPicked === prev.avatarPicked) return;
  avatarEdited = true;
  markDirty();
  void requestSync();
});

// A replay was saved or deleted. A deleted game the server holds is queued
// for deletion there.
useLibraryStore.subscribe((s, prev) => {
  if (applyingRemote > 0 || !isLinked() || s.games === prev.games) return;
  const now = new Set(s.games.map((g) => g.id));
  const before = new Set(prev.games.map((g) => g.id));
  const removed = [...before].filter((id) => !now.has(id));
  const added = [...now].some((id) => !before.has(id));
  if (removed.length === 0 && !added) return;
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
  void requestSync();
});

// Dev convenience, like the other stores: poke at sync from the console.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __syncStore: typeof useSyncStore }).__syncStore = useSyncStore;
}
