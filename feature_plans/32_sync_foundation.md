# 32 — Sync foundation (a player record on the server)

**Status:** 🚧 In progress
**Priority:** High
**Unblocks:** multi-device profiles, friends by friend code, a gated web client, play between devices by code

## What

A player record on the server with no account. A device that turns sync on
gets a secret token; a second device joins the same record with a short
pairing code. After that every linked device reads and writes the one
record, so rank, lessons and the replay library follow the player.

A player who never turns sync on has nothing on the server. The app
behaves exactly as it does today for them.

## Decisions (settled before the build)

- **No account.** No email, no password. A record plus one token per device.
- **Sync at Play.** Pull before a ranked game starts, push when it ends.
  Online and offline play both count toward rank.
- **A revision counter decides which side is newer.** Never a device clock.
- **No chooser.** A device that could not push keeps its ranked results in a
  queue and re-applies them on top of the server's state at the next sync.
- **The library keeps the newest 100 games** and drops the oldest, on the
  device and on the server.
- **The display name stays on the device.** It is free text, so it never
  enters the record. Settings stay per device. The bot's diagnostic log
  (`selectorLog`) stays out of synced replays.

## Not in this slice

The web gate and invite codes · a server-set cookie · a recovery code ·
proof that a create request comes from the app · friends and handles · a
grown-up gate on the link screens · the privacy text · any deploy.

---

## The contract

All routes live under `/api/sync`. A linked device authenticates with
`Authorization: Bearer <device_token>`. The server stores only a SHA-256
of each token. A missing, unknown or revoked token answers **401**.

### State document

The synced state is one JSON object. The server treats its contents as
opaque but enforces the top-level keys and the size.

```json
{
  "schema": 1,
  "ladder": { "byBoardSize": { "9x9": { "...": "PersistedSlot" } }, "undoBank": 3 },
  "lessons": ["lesson-id", "..."],
  "avatar": "blackhole",
  "avatarPicked": true
}
```

- `ladder` is the persisted payload of `goforkids.autoplay.v1`, unchanged.
- `lessons` is the persisted array of `goforkids-learn-progress`.
- Allowed top-level keys: `schema`, `ladder`, `lessons`, `avatar`,
  `avatarPicked`. Any other key answers **422** (this is what keeps a
  display name out of the record).
- Maximum size 512 KB as JSON, else **413**.

### Routes

| Method and path | Auth | Request | Success | Errors |
|---|---|---|---|---|
| `POST /players` | none | `{ "state": State }` | **201** `{ "player_id", "device_token", "rev": 1, "state" }` | 413, 422, **429** over the per-address rate limit |
| `POST /pairing-codes` | token | — | **201** `{ "code", "expires_at" }` | 401 |
| `POST /pairing-codes/redeem` | none | `{ "code" }` | **200** `{ "player_id", "device_token", "rev", "state" }` | **404** for unknown, expired and used alike; 429 |
| `GET /state` | token | — | **200** `{ "rev", "state" }` | 401 |
| `PUT /state` | token | `{ "base_rev", "state" }` | **200** `{ "rev" }` where `rev = base_rev + 1` | **409** `{ "rev", "state" }` with the server's copy when `base_rev` is not current; 401, 413, 422 |
| `GET /games` | token | — | **200** `{ "games": [{ "id", "date" }] }` newest first | 401 |
| `GET /games/{id}` | token | — | **200** `{ "id", "date", "payload" }` | 401, 404 |
| `PUT /games/{id}` | token | `{ "date", "payload" }` | **200** `{ "kept": true }`, or `false` when the game fell past the cap | 401, 413 over 1 MB, 422 without `payload.sgf` |
| `DELETE /games/{id}` | token | — | **204**, also when the game is already gone | 401 |
| `DELETE /devices/current` | token | — | **204**, and the token stops working | 401 |

Rules the server enforces:

- **Pairing codes** are 8 characters of the share-code alphabet
  (`23456789ACDEFGHJKMNPQRTVWXY`), valid for 10 minutes, usable once.
  Minting a new code cancels the player's earlier unused codes. Lookup
  normalises case and surrounding space.
- **Revision.** `PUT /state` succeeds only when `base_rev` equals the
  stored revision, and the compare and the write are one transaction.
- **Replay cap.** After every `PUT /games/{id}` the server keeps that
  player's newest 100 by `date` (ISO 8601 string, ties broken by id) and
  deletes the rest. A second `PUT` of the same id replaces the first.
- **`selectorLog`** is removed from a replay payload before it is stored.
- **Rate limits**, in memory: `POST /players` 10 an hour,
  `POST /pairing-codes/redeem` 20 an hour, per client address. The key is
  the client address as seen through `SYNC_TRUSTED_PROXY_HOPS` trusted
  proxies: 0 (the default, no trusted proxy) ignores `X-Forwarded-For`
  and uses the socket peer; N uses the Nth `X-Forwarded-For` entry from
  the right, or the socket peer when the header is shorter. The value
  must be set for the host's proxy before a deploy. The clock is
  injectable so tests do not sleep.
- One player's token never reads or writes another player's rows.

### Storage

SQLite through `aiosqlite`, in the file named by `GOFORKIDS_SYNC_DB`,
falling back to `GOFORKIDS_DB` and then `goforkids.db` (the pattern
`app/uploads/storage.py` uses). Four tables, all prefixed `sync_`:
players (id, rev, state, timestamps), devices (token hash, player id),
games (player id, game id, date, payload; primary key on the pair),
pairing codes (code, player id, expiry, used flag). The legacy `players`
and `games` tables are left alone.

---

## The client

A device that is not linked makes no sync request and writes no sync key
other than its own empty state.

**Local state**, persisted under `goforkids.sync.v1`: `playerId`,
`deviceToken`, `baseRev`, `dirty`, `pendingResults`, `syncedGameIds`,
`pendingGameDeletes`, `lastSyncAt`.

**Turning sync on** (first device): `POST /players` with the device's
current state, then send every local replay.

**Linking** (a joining device): redeem the code, adopt the record's ladder
and avatar, union the lessons, push if the union changed anything, then
send the device's own replays. The screen says plainly that this device's
rank will be replaced by the linked profile's rank, and asks first.

**A sync pass:**

1. `GET /state`.
2. If the server's revision equals `baseRev`: push when `dirty`.
3. If the server's revision is ahead: adopt its ladder, re-apply each
   queued result in order through the same code path a finished ranked
   game uses (`applyResult`, `updateRating`, the history entry, promotion
   events, the undo refill), union the lessons, then push.
4. On **409** take the state in the response and repeat step 3, at most
   three times.
5. Then reconcile replays: send local games that were never sent, fetch
   games the device lacks, and drop local games that were sent before and
   are no longer on the server's list.

**When a pass runs:** on app open; when the player presses Play on a
ranked game (bounded by a 2 second timeout, after which the game starts
regardless); after a ranked result is recorded; after a lesson is
finished; after the avatar changes; after a replay is saved or deleted.
A failed pass is silent and leaves the queue intact.

**Known limit:** a voluntary derank, a ladder reset or an undo spent
offline is kept only when the server has not moved in the meantime. When
it has, the server's ladder plus the queued results wins.

**Screens:** the Profile page gains a Devices section. Not linked: "Add a
device" and "Link this device". Linked: the last sync time, "Add a
device" (shows the code and its expiry) and "Unlink this device", which
revokes the token and keeps the local data.

## Verification

- Backend: `pytest` covers each route, the 409 path, the cap, a redeemed
  and an expired code, token isolation between two players, the key
  allowlist and both rate limits.
- Frontend: `npm run build`, `npm test` and `npm run test:layout` pass;
  unit tests cover the unlinked no-op, the rebase of queued results, the
  409 retry and replay reconciliation.
- Together: two browser profiles against a local backend. Play a ranked
  game in one, press Play in the other, and the rank and the replay are
  there.
