# 32 — Sync foundation (a player record on the server)

**Status:** 🚧 In progress
**Priority:** High
**Unblocks:** multi-device profiles, friends by friend code, a gated web client, play between devices by code

## What

A player record on the server with no account. A device that turns sync on
gets a secret token; a second device joins the same record with a short
pairing code. After that every linked device reads and writes the one
record, so rank, lessons and the replay library follow the player.

**Revision 2 (below) changes who has a record:** every player gets one
at first launch. Where this document's earlier sections and Revision 2
disagree, Revision 2 wins.

## Decisions (settled before the build)

- **No account.** No email, no password. A record plus one token per device.
- **Sync at Play.** Pull before a ranked game starts, push when it ends.
  Online and offline play both count toward rank.
- **A revision counter decides which side is newer.** Never a device clock.
- **No chooser.** A device that could not push keeps its ranked results in a
  queue and re-applies them on top of the server's state at the next sync.
- **The library keeps the newest 100 games** and drops the oldest, on the
  device and on the server.
- **No free-text name.** The app generates the player's name from two
  curated word lists (Revision 2), so nothing a player types reaches the
  server. Settings stay per device. The bot's diagnostic log
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
- **Rate limits**, in memory: `POST /players` 60 an hour,
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

---

## Revision 2 — every player has a profile

Phase 1 ships only when all of this section is built.

### What changes

- **Every player has a record on the server.** It is created at first
  launch, not when a second device is added. "Add a device" only ever
  connects a device to an account that already exists.
- **The name is generated.** The free-text display name is removed
  everywhere. A name is two words, one from each list below, stored and
  sent as two list positions.
- **Logging in takes the account whole.** Nothing a device held before is
  merged into the account it logs into.
- **Logging out clears the device's player data** and returns to the
  first-run choice.

### Contract changes (server)

- The state document gains one allowed top-level key, `handle`: a JSON
  array of exactly two integers, each from 0 to 63. Any other shape
  answers **422**. The key may be absent. The allowlist is now `schema`,
  `ladder`, `lessons`, `avatar`, `avatarPicked`, `handle`.
- `POST /players` is limited to **60 an hour** per client address (was
  10), because a room of devices updates at once behind one address.
- Nothing else in the route table changes.

### Names

Two lists of 64 words. They are append-only: a position never changes
its word. The client renders `handle = [a, n]` as
`ADJECTIVES[a] + " " + NOUNS[n]`. A new name is two uniform random
positions. Names are not unique and do not need to be.

`ADJECTIVES` (positions 0 to 63, in this order):
Cosmic, Quiet, Bright, Swift, Gentle, Clever, Brave, Sunny, Lucky,
Mighty, Curious, Golden, Silver, Starry, Lunar, Solar, Misty, Frosty,
Breezy, Glowing, Sparkling, Shining, Twinkling, Floating, Drifting,
Soaring, Orbiting, Spinning, Dancing, Humming, Patient, Steady, Calm,
Kind, Jolly, Merry, Nimble, Bold, Daring, Sturdy, Wandering, Roaming,
Dreamy, Wise, Speedy, Mellow, Peppy, Zippy, Fuzzy, Velvet, Crystal,
Amber, Emerald, Sapphire, Ruby, Coral, Indigo, Violet, Scarlet, Copper,
Radiant, Electric, Stellar, Astral

`NOUNS` (positions 0 to 63, in this order):
Otter, Comet, Panda, Falcon, Fox, Owl, Turtle, Dolphin, Tiger, Koala,
Heron, Badger, Lynx, Raven, Sparrow, Penguin, Gecko, Dragon, Phoenix,
Griffin, Meteor, Nebula, Galaxy, Planet, Rocket, Satellite, Asteroid,
Quasar, Pulsar, Nova, Moon, Star, Orbit, Voyager, Explorer, Pilot,
Ranger, Captain, Wizard, Knight, Summit, Harbor, Mountain, River,
Forest, Meadow, Canyon, Glacier, Volcano, Thunder, Breeze, Tide,
Beacon, Spark, Lantern, Compass, Kite, Acorn, Maple, Willow, Lotus,
Bamboo, Crane, Whale

Wherever the app showed the display name it shows the generated name.
The text box and its pencil go; a **Shuffle** button on the Profile page
picks a new name. A shared replay sends the rendered name as
`player_name`. The old `displayName` value in local storage is dropped
on load and never sent.

### First launch

The app decides once, at start-up, which of three cases it is in.

1. **Logged in** (a device token is stored): run a sync pass, as today.
2. **An existing player without a profile** (no token, and the device
   holds any ranked history, finished lesson, saved replay or a
   deliberately picked avatar): generate a name, create the profile from
   what the device holds, send every local replay, and show one card,
   once: the new name, a Shuffle button, and a line saying progress is
   now saved online. The player is not asked first.
3. **A new install** (no token and none of the above): show the
   first-run choice before anything else: **"New player"** or **"I
   already play on another device"**. New player generates a name (with
   Shuffle), continues into the existing first-run flow, and creates the
   profile. The other choice asks for a code and logs in.

Creating a profile never blocks play. If the request fails (offline, a
429, a 5xx) the app carries on with local data and tries again at the
next app open and at each sync trigger until it succeeds. Results played
in the meantime are part of the state the eventual create sends.

### Log in

Reached from the first-run choice only. Redeem the code, then replace the
device's rank, lessons, avatar and name with the account's and fetch its
replays. Nothing local is merged in. Needs the network.

### Add a device

On the Profile page's Devices section: **"Add a device"** shows a
ten-minute code, in two groups of four, with its expiry. If the profile
has not been created yet, it is created first.

### Log out

On the Profile page's Devices section, after one confirm that names what
will happen. Run a sync pass; only if it succeeds (state pushed, replays
reconciled), revoke this device's token, clear the device's player data
(rank and history on every board, lessons, replays, avatar, name, and
all sync state; device settings stay), and show the first-run choice. If
the pass or the revoke cannot complete, say so and change nothing.

### A token the server refuses

A **401** on any sync request means this device was logged out elsewhere.
Clear the device's player data and sync state and show the first-run
choice, with one line explaining why.

### The four edges from the first review

- A 401 is handled as above (the device no longer shows as connected
  while every request fails).
- A sync pass that finishes after the 2 second cap at Play must not
  change the rank while a ranked game is in progress: hold what it
  brought and apply it when the game ends, before that game's result is
  recorded on top.
- A replay the server refuses with 413 or 422 is remembered and not sent
  again.
- The Play wiring is covered by a test.

### Revision 2.1 — a create that can be repeated safely

A create whose reply is lost must not leave a second profile behind.

- `POST /players` accepts an optional `create_key`: a string of 16 to 64
  characters from `A-Z a-z 0-9 - _`, made up by the device. Any other
  shape answers **422**.
- The first create with a key stores a SHA-256 of it with the new player
  and answers **201** as before.
- A later create with the same key makes no new player. It revokes every
  device token that earlier creates with that key issued, issues a fresh
  one for the same player, and answers **200** with
  `{ "player_id", "device_token", "rev", "state" }`, where `rev` and
  `state` are the player's current ones. The `state` in the repeated
  request is ignored.
- The device makes one key when it first decides to create a profile,
  keeps it in its sync state until a create succeeds, and sends it with
  every attempt. After a 200 it treats the returned `rev` as its base and
  marks its state dirty, so the next pass pushes what the device holds.

### Privacy text

The in-app privacy text says there are no accounts. Rewrite it to say
what is now true, in words a parent can read in a minute: a profile is
created automatically; it holds a random identifier, a generated name,
rank, lessons, the avatar and saved games; no email, no typed name; how
to ask for deletion.

### Verification for Revision 2

- Backend: the `handle` shapes (valid, wrong length, out of range,
  non-integer, absent), and the create limit at 60.
- Frontend: `npm run build`, `npm test`, `npm run test:layout`. Tests for
  each first-launch case, the retry of a failed create, log in replacing
  everything with no merge, log out clearing only after a successful
  pass and refusing offline, the 401 path, the held pass during a ranked
  game, the refused replay, name rendering and Shuffle, and that no
  request body anywhere contains the old display name.
- Together: two browser origins against a local backend.


---

## Revision 3 — admin and retention

Two needs from running a class on shared iPads: a grown-up who runs the
class can see every profile and get a device back onto the right one (a
reset iPad, a child who logged out by mistake), and a profile is never
lost because its last device logged out. Where this section and an
earlier one disagree, this section wins.

### Retention

- **Logging out never deletes a profile**, not even when the device was
  the profile's last one. Nothing a device does deletes a profile.
- A profile whose last device row goes (a log out, an admin removing
  devices) gets a timestamp, `no_device_since`. A login to it (a redeemed
  code, a repeated create under Revision 2.1) clears the timestamp.
- **A cleanup deletes a profile 30 days after its last device went**, when
  no device has logged in since: the player row with its replays and its
  codes. It deletes only a profile whose `no_device_since` is at least 30
  days old **and** that has no device row, and it re-checks both inside
  the one transaction that deletes, so a login racing the cleanup wins.
  The cleanup runs once at start-up and then every 24 hours while the
  server runs. The clock is injectable so tests do not wait; a profile at
  29 days 23 hours is kept, one at 30 days is deleted.
- A device whose app was deleted without logging out keeps its device row,
  so its profile is kept indefinitely. This is accepted: the rule deletes
  only a profile nobody can reach.
- A profile used only on shared devices that log out after each use has
  no device between uses, so a gap of more than 30 days between uses (a
  long school break) deletes it. That follows the rule as set; whether
  such profiles need a longer clock is left open.
- At start-up, a profile that already has no device row and no timestamp
  gets the start-up time as its timestamp, so existing profiles get the
  full 30 days.
- The in-app privacy text is not changed by this revision.

### Admins

- An admin is a profile whose id is listed in the server setting
  `SYNC_ADMIN_PLAYER_IDS` (comma-separated, spaces ignored). Every device
  logged into such a profile may call the admin routes. Unset or empty
  means there are no admins.
- `GET /state` answers `{ "rev", "state", "admin", "device_id" }`;
  `admin` is `true` only for a device of an admin profile, and
  `device_id` is the requesting device's own id (below). The client shows
  the Admin section only when its latest pass said `true`. A 403 from an
  admin route hides the section and never signs the device out (only a
  401 does that).
- The rule that one player's token never reads or writes another player's
  rows holds everywhere except the admin routes below, for an admin.

### Devices gain an id and a last-seen time

- Every device row gets a random `device_id` (rows from before this
  revision are given one at start-up) and a `last_seen_at`, set when the
  device is created and updated when its token authenticates a request,
  written at most once a minute per device. Rows from before this
  revision show `last_seen_at` as `null` until the device is next seen.
- A token hash is never sent in any response.
- Times in admin replies use the format the server already writes,
  `YYYY-MM-DDTHH:MM:SSZ`. A time the server accepts is ISO 8601 with an
  offset; `Z` counts as one, with or without milliseconds (what
  `Date.prototype.toISOString()` sends). A time with no offset is refused.

### The redeem limit

`POST /pairing-codes/redeem` is limited to **60 an hour** per client
address (was 20), because a class logs in with codes at the start of a
lesson behind one school address. A code is 8 characters of a
27-character alphabet (about 2.8 × 10^11 values) and only a profile's
newest unused code is live, so 60 guesses an hour from one address
leaves guessing a live code out of reach.

### Admin routes

All under `/api/sync/admin`, all with `Authorization: Bearer
<device_token>`. A missing, unknown or revoked token answers **401**; a
valid token whose profile is not an admin answers **403**, on every route
below, before anything else is checked. None of these routes is rate
limited.

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /admin/players` | — | **200** `{ "players": [...] }`, most recently updated first | 401, 403 |
| `POST /admin/players` | `{ "state": State }` | **201** `{ "player_id", "rev": 1 }` | 401, 403, 413, **422** for a state the allowlist refuses, or one without a `handle`, a `ladder` object or a `lessons` array |
| `POST /admin/players/{player_id}/pairing-codes` | `{ "expires_at" }` | **201** `{ "code", "expires_at" }` | 401, 403, 404 unknown player, **422** for an expiry that is not after now, more than 24 hours and one minute after now (the minute is slack for clock skew), or not an ISO 8601 time with an offset |
| `DELETE /admin/devices/{device_id}` | — | **204** | 401, 403, 404 unknown device, **409** when it is the device making the request |
| `DELETE /admin/players/{player_id}/devices` | — | **204**, also when the profile has no device | 401, 403, 404 unknown player, **409** when the profile is the requester's own |

Each entry of `players`:

```json
{
  "player_id": "…",
  "handle": [4, 2],
  "boards": { "9x9": { "rung": "…", "games": 12 } },
  "devices": [{ "device_id": "…", "created_at": "…", "last_seen_at": "…" }],
  "replays": 7,
  "created_at": "…",
  "updated_at": "…",
  "no_device_since": null,
  "days_left": null
}
```

- `handle` is the state's `handle`, or `null` when absent.
- `boards` holds, for each key of the state's `ladder.byBoardSize`, the
  slot's `rungState.currentRung` as stored and the length of its
  `history`; a missing or malformed field gives `"rung": null` or
  `"games": 0`, so one odd state never makes the list fail. The client
  renders the rank the way the Profile page does.
- `days_left` is `null` while the profile has a device; otherwise the whole
  days left before the cleanup deletes it, rounded up, never below 0.
- An admin-created profile has no device, so it gets `no_device_since` at
  creation: unused for 30 days, it is deleted like any other.
- **Codes an admin mints** follow the pairing-code rules (8 characters,
  usable once, lookup normalised, redeemed through the existing
  `POST /pairing-codes/redeem`), except that the expiry is the one the
  admin sets, at most 24 hours ahead. A code a device mints for itself
  keeps its 10 minutes. Minting any code for a profile, by an admin or by
  one of its devices, cancels that profile's earlier unused codes.
- Removing devices revokes their tokens exactly as a log out does; a
  removal that leaves the profile with no device sets `no_device_since`.
  A device cannot be signed out through the admin routes by itself; that
  is what Log out is for. A removed device learns of it by a 401 and
  takes the 401 path (Revision 2), so results it had not pushed are lost,
  where a log out pushes first.

### The client's Admin section

On the Profile page, below Devices, shown only to an admin:

- **The list**, one row per profile: a label, the generated name, the
  rank per board, the devices (each with when it was added and last
  seen), the replay count, and the days left when the profile has no
  device.
- **A label** per profile, typed by the admin to say who the profile
  belongs to. It is stored on this device only, under
  `goforkids.admin.labels.v1`, and is never sent anywhere: no request
  body, URL or header carries it, and a test proves this across every
  admin action and a sync pass. The labels are cleared with the rest of
  the player data on a log out and on a 401, so they never stay on a
  device that leaves the admin profile.
- **"Code for this player"**: the admin picks an expiry time (the default
  is 4:30 pm today in this device's time zone when that is still ahead,
  otherwise one hour from now; nothing past 24 hours is offered), and the
  code is shown in two groups of four with its expiry.
- **"Sign out this player's devices"**, after one confirm, and **"Remove"**
  beside each device. Neither is offered for this device itself (the
  device knows its own `device_id` from `GET /state`), nor is the first
  offered for this device's own profile.
- **"New player"**: a generated name with Shuffle, then the profile is
  created and appears in the list, ready for a code. Its state is the
  fresh document `{ "schema": 1, "ladder": { "byBoardSize": {} },
  "lessons": [], "avatar": "blackhole", "avatarPicked": false,
  "handle": [a, n] }`.
- Getting a device onto a profile uses the existing **"I already play on
  another device"** screen with the code. A device that logs into a
  profile created by an admin starts with a fresh ladder, no lessons and
  the default avatar, under the profile's name.

### Verification for Revision 3

- Backend: retention with an injected clock (log out of the last device
  keeps the profile and sets the timestamp; a login clears it; 29 days 23
  hours kept, 30 days deleted with replays and codes; start-up stamps
  existing device-less profiles; the cleanup runs at start-up); the 401
  and the 403 on every admin route, and no admins when the setting is
  unset; each admin route's success and errors; an expiry past 24 hours,
  in the past and without an offset refused; an admin code redeemed by a
  new device; minting cancelling earlier codes both ways; the 409s; no
  token hash in any response; `admin` and `device_id` in `GET /state`;
  a malformed ladder in the list; the redeem limit at 60.
- Frontend: `npm run build`, `npm test`, `npm run test:layout`. Tests for
  the section hidden from a non-admin and on a 403, the list rendering,
  the label never leaving the device and cleared on log out and on a
  401, the expiry default and the 24-hour bound, the confirm before
  signing out, no sign-out offered for this device, New player, and
  logging into an admin-created profile.
- Together: two browser origins against a local backend with one of them
  made an admin.
