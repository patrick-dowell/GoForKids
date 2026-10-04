"""
KataGo process manager.
Communicates with KataGo via its Analysis Engine JSON API (stdin/stdout).
"""

from __future__ import annotations
import asyncio
import json
import logging
import subprocess
import os
from typing import Optional
from dataclasses import dataclass, replace

logger = logging.getLogger(__name__)

BOARD_SIZE = 19  # Default; analyze() takes size per-call.

# Default paths for brew-installed KataGo on macOS
_BREW_SHARE = "/opt/homebrew/share/katago"
_DEFAULT_MODEL = os.path.join(_BREW_SHARE, "g170e-b20c256x2-s5303129600-d1228401921.bin.gz")
_DEFAULT_CONFIG = os.path.join(_BREW_SHARE, "configs/analysis_example.cfg")


@dataclass
class KataGoConfig:
    executable: str = "katago"
    model: str = ""
    config: str = ""
    num_threads: int = 4
    max_visits: int = 100
    # Optional human SL network (KataGo's rank-conditioned model of human
    # play), loaded beside the main model with -human-model. Empty = not
    # loaded. It costs nothing on queries that don't name a profile.
    human_model: str = ""


@dataclass
class MoveCandidate:
    """A candidate move from KataGo analysis."""
    move: tuple[int, int]  # (row, col), (-1,-1) for pass
    visits: int
    winrate: float
    score_lead: float
    prior: float
    pv: list[str]
    order: int


@dataclass
class PositionAnalysis:
    """Full analysis of a board position."""
    root_visits: int
    winrate: float
    score_lead: float
    candidates: list[MoveCandidate]
    ownership: Optional[list[float]] = None  # 361 floats: -1 (white) to +1 (black)
    # Raw policy for every point plus pass (row-major from the top-left,
    # pass last; illegal moves are negative). Present only when the query
    # asked for it (include_policy). human_policy additionally needs the
    # human SL model loaded and a humanSLProfile in override_settings.
    policy: Optional[list[float]] = None
    human_policy: Optional[list[float]] = None


def point_to_gtp(row: int, col: int, size: int = BOARD_SIZE) -> str:
    """Convert (row, col) to GTP coordinate like 'D4'."""
    letters = "ABCDEFGHJKLMNOPQRST"
    return f"{letters[col]}{size - row}"


def gtp_to_point(gtp: str, size: int = BOARD_SIZE) -> tuple[int, int]:
    """Convert GTP coordinate like 'D4' to (row, col)."""
    if gtp.lower() == "pass":
        return (-1, -1)
    letters = "ABCDEFGHJKLMNOPQRST"
    col = letters.index(gtp[0].upper())
    row = size - int(gtp[1:])
    return (row, col)


class KataGoEngine:
    """
    Manages a long-running KataGo analysis engine process.
    Sends JSON queries on stdin, reads JSON responses from stdout.
    """

    def __init__(self, config: KataGoConfig):
        self.config = config
        self.process: Optional[subprocess.Popen] = None
        self._query_id = 0
        self._pending: dict[str, asyncio.Future] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        # Per-query wait ceiling. Sits UNDER the frontend's 20s request
        # timeout: a wait the client has already abandoned is pure zombie
        # load, so fail fast and terminate (see analyze()).
        self._query_timeout = float(os.environ.get("KATAGO_QUERY_TIMEOUT", "15"))

    async def start(self):
        """Start the KataGo analysis process."""
        cmd = [
            self.config.executable,
            "analysis",
            "-model", self.config.model,
            "-config", self.config.config,
        ]
        if self.config.human_model:
            # No default humanSLProfile on purpose: a query gets the human
            # policy only when it names a profile in its override settings,
            # so every other query runs exactly as it did without the model.
            cmd += ["-human-model", self.config.human_model]

        logger.info(f"Starting KataGo: {' '.join(cmd)}")

        # stderr=DEVNULL is critical: KataGo writes verbose search progress
        # to stderr, and with stderr=PIPE we'd need an active reader, otherwise
        # the OS pipe buffer (~64 KB) fills after ~10-20 queries and KataGo
        # blocks on the next write — the analysis hangs and the bot appears
        # to crash mid-game. We don't need stderr in production; if a future
        # diagnostic need arises, redirect to a file or spawn a reader task.
        self.process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",  # text=True alone uses cp1252 on Windows
            bufsize=1,
        )

        # Wait briefly for startup, check it didn't crash
        await asyncio.sleep(0.5)
        if self.process.poll() is not None:
            raise RuntimeError(f"KataGo exited immediately (exit code {self.process.returncode})")

        self._reader_task = asyncio.create_task(self._read_loop())
        logger.info("KataGo started successfully")

    async def stop(self):
        if self.process:
            try:
                self.process.stdin.close()
                self.process.terminate()
                self.process.wait(timeout=5)
            except Exception:
                self.process.kill()
            self.process = None
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None

    async def analyze(
        self,
        board: list[list[int]],
        current_player: str,
        max_visits: Optional[int] = None,
        komi: float = 7.5,
        include_ownership: bool = False,
        size: int = BOARD_SIZE,
        moves: Optional[list[list[str]]] = None,
        initial_stones: Optional[list[list[str]]] = None,
        override_settings: Optional[dict] = None,
        priority: int = 0,
        include_policy: bool = False,
        timeout: Optional[float] = None,
    ) -> PositionAnalysis:
        """Analyze a board position. Returns candidate moves with evaluations.

        Without `moves`, the position goes over as a bare stone layout —
        KataGo then has no history, can't see ko/superko bans, and will
        happily suggest the recapture our engine rejects (the web half of
        the 888P9NXK ko-pass bug; the iPad bridge got real history in June).
        Move-selection callers should pass `moves` (the real game sequence,
        e.g. `[["B","Q16"], ["W","pass"], …]`) plus `initial_stones` for
        handicap setup. Evaluation-only callers (score lead, ownership) can
        keep the bare layout — a missed ko ban doesn't move those estimates.
        """
        if not self.process or self.process.poll() is not None:
            raise RuntimeError("KataGo not running")

        query_id = f"q{self._query_id}"
        self._query_id += 1

        if moves is None:
            # Legacy: bare stone layout from the 2D board, no history.
            setup: list[list[str]] = []
            for row in range(size):
                for col in range(size):
                    if board[row][col] == 1:
                        setup.append(["B", point_to_gtp(row, col, size)])
                    elif board[row][col] == 2:
                        setup.append(["W", point_to_gtp(row, col, size)])
            move_list: list[list[str]] = []
            # With no moves, initialPlayer is what tells KataGo whose turn it is.
            initial_player = current_player
        else:
            setup = initial_stones or []
            move_list = moves
            # With explicit moves (each carries its color), initialPlayer means
            # "who plays move 0" — derive it from the list, not the caller.
            initial_player = move_list[0][0] if move_list else current_player

        query = {
            "id": query_id,
            "rules": "japanese",
            "komi": komi,
            "boardXSize": size,
            "boardYSize": size,
            "initialStones": setup,
            "moves": move_list,
            "initialPlayer": initial_player,
            "maxVisits": max_visits or self.config.max_visits,
            "analyzeTurns": [len(move_list)],
            "includeOwnership": include_ownership,
            # Higher runs first. Live-game moves pass 10, end-of-game scoring
            # passes -10, so a burst of scoring queries can never delay the
            # moves of games still being played (the 2026-07-15 saturation
            # stall's trigger, reproduced by tools/loadtest.py 2026-09-01).
            "priority": priority,
        }
        if override_settings:
            # Per-query search overrides, e.g. {"wideRootNoise": 0.6} — spreads
            # root visits across many more moves so the candidate list becomes
            # a wide policy sample (§3 out-of-pool mechanism, 2026-07-05).
            # Only move-selection callers set this; settle/score analyses stay
            # honest.
            query["overrideSettings"] = override_settings
        if include_policy:
            # Raw policy over the whole board. With the human SL model loaded
            # and {"humanSLProfile": ...} in override_settings the response
            # also carries humanPolicy: how players of that rank move here.
            query["includePolicy"] = True

        async with self._lock:
            future = asyncio.get_event_loop().create_future()
            self._pending[query_id] = future
            self.process.stdin.write(json.dumps(query) + "\n")
            self.process.stdin.flush()

        try:
            result = await asyncio.wait_for(future, timeout=timeout or self._query_timeout)
        except asyncio.TimeoutError:
            # Giving up on the wait must also stop KataGo's computation:
            # a cancelled future leaves the query grinding server-side, and
            # that zombie load is what held the engine wedged in the
            # 2026-07-15 saturation stall (verified by load test 2026-09-01
            # — every abandoned 200-visit scoring query kept a lane busy).
            self._pending.pop(query_id, None)
            try:
                async with self._lock:
                    self.process.stdin.write(
                        json.dumps(
                            {
                                "id": f"terminate-{query_id}",
                                "action": "terminate",
                                "terminateId": query_id,
                            }
                        )
                        + "\n"
                    )
                    self.process.stdin.flush()
            except Exception:
                logger.warning(f"terminate write failed for {query_id}")
            raise
        return self._parse_response(result, size)

    async def _read_loop(self):
        """Background task: read JSON responses from KataGo stdout."""
        try:
            loop = asyncio.get_event_loop()
            while self.process and self.process.stdout:
                line = await loop.run_in_executor(
                    None, self.process.stdout.readline
                )
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    response = json.loads(line)
                    qid = response.get("id")
                    if qid and qid in self._pending:
                        if not self._pending[qid].done():
                            self._pending[qid].set_result(response)
                        del self._pending[qid]
                except json.JSONDecodeError:
                    continue
        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.error(f"KataGo reader error: {e}")
        # The process closed its stdout (it exited) or the reader broke: nothing
        # will ever answer the queries still waiting, so fail them now instead
        # of leaving each to run out its timeout.
        for qid, future in list(self._pending.items()):
            if not future.done():
                future.set_exception(RuntimeError("KataGo exited"))
            self._pending.pop(qid, None)

    def _parse_response(self, response: dict, size: int = BOARD_SIZE) -> PositionAnalysis:
        """Parse the flat KataGo analysis JSON response."""
        # KataGo analysis response has moveInfos and rootInfo at top level
        root_info = response.get("rootInfo", {})
        move_infos = response.get("moveInfos", [])

        candidates = []
        for i, info in enumerate(move_infos):
            move_str = info.get("move", "pass")
            point = gtp_to_point(move_str, size) if move_str.lower() != "pass" else (-1, -1)

            candidates.append(MoveCandidate(
                move=point,
                visits=info.get("visits", 0),
                winrate=info.get("winrate", 0.5),
                score_lead=info.get("scoreLead", 0.0),
                prior=info.get("prior", 0.0),
                pv=info.get("pv", []),
                order=i,
            ))

        # Ownership map: flat list of 361 floats, -1 (white) to +1 (black)
        ownership = response.get("ownership", None)

        return PositionAnalysis(
            root_visits=root_info.get("visits", 0),
            winrate=root_info.get("winrate", 0.5),
            score_lead=root_info.get("scoreLead", 0.0),
            candidates=candidates,
            ownership=ownership,
            policy=response.get("policy"),
            human_policy=response.get("humanPolicy"),
        )

    @property
    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    @property
    def has_human_model(self) -> bool:
        """Whether the human SL model is loaded beside the main model."""
        return bool(self.config.human_model)


# Singleton
_engine: Optional[KataGoEngine] = None


def _strict_katago() -> bool:
    """Whether STRICT_KATAGO=1 is set. In strict mode, missing/broken KataGo
    raises instead of silently falling back to stub AI. Used by the calibration
    harness — a stub-AI bot would silently invalidate every calibration result."""
    return os.environ.get("STRICT_KATAGO", "").lower() in ("1", "true", "yes")


HUMAN_WARMUP_TIMEOUT_S = 45.0


async def _human_model_answers(engine: "KataGoEngine") -> bool:
    """One tiny query that only a working human SL model can answer.

    Run once at start-up. Both networks load before the first answer, hence
    the longer wait; if the process dies while loading, the reader fails the
    query at once."""
    try:
        res = await engine.analyze(
            [[0] * 9 for _ in range(9)], "B", max_visits=1, komi=6.5, size=9, moves=[],
            override_settings={"humanSLProfile": "rank_20k"}, include_policy=True,
            timeout=HUMAN_WARMUP_TIMEOUT_S,
        )
        return bool(res.human_policy)
    except Exception as e:
        logger.warning(f"KataGo human SL warm-up failed: {e!r}")
        return False


async def _start_engine(kg_config: KataGoConfig) -> KataGoEngine:
    """Start KataGo. With a human SL model configured, keep it only if the
    engine starts with it AND it answers; otherwise start without it, so a
    model that cannot load (bad file, a build without human SL support, not
    enough memory) never costs the ordinary bots their engine."""
    if kg_config.human_model:
        engine = KataGoEngine(kg_config)
        try:
            await engine.start()
            if await _human_model_answers(engine):
                return engine
            logger.warning("KataGo human SL model did not answer; starting without it")
        except Exception as e:
            logger.warning(f"KataGo did not start with the human SL model ({e!r}); starting without it")
        await engine.stop()
        kg_config = replace(kg_config, human_model="")
    engine = KataGoEngine(kg_config)
    await engine.start()
    return engine


# One start at a time: the boot-time warm-up and the first bot moves can all
# arrive while the networks are still loading. The lock is made under the
# loop that uses it (before Python 3.10 a Lock belongs to the loop it was
# created in, and each test runs a loop of its own).
_engine_lock: Optional[asyncio.Lock] = None
_engine_lock_loop: Optional[asyncio.AbstractEventLoop] = None


def _start_lock() -> asyncio.Lock:
    global _engine_lock, _engine_lock_loop
    loop = asyncio.get_running_loop()
    if _engine_lock is None or _engine_lock_loop is not loop:
        _engine_lock, _engine_lock_loop = asyncio.Lock(), loop
    return _engine_lock


async def get_engine() -> Optional[KataGoEngine]:
    """Get or create the KataGo engine singleton.

    Returns None (and the bot falls back to random-legal-move stub AI) when
    KataGo can't be located or fails to start, UNLESS the STRICT_KATAGO env
    var is set, in which case any failure raises. The strict path is for the
    calibration harness — silently degrading to stub AI made yesterday's
    results meaningless when the b28.bin.gz LFS pointer didn't smudge.
    """
    global _engine
    if _engine and _engine.is_running:
        return _engine

    async with _start_lock():
        if _engine and _engine.is_running:  # started while we waited
            return _engine
        return await _get_engine_locked()


async def _get_engine_locked() -> Optional[KataGoEngine]:
    """get_engine()'s body: resolve the paths and start. Caller holds the lock."""
    global _engine
    strict = _strict_katago()

    # Resolve paths: env vars > brew defaults > bare command
    executable = os.environ.get("KATAGO_PATH", "katago")
    model = os.environ.get("KATAGO_MODEL", "")
    config = os.environ.get("KATAGO_CONFIG", "")

    # Auto-detect brew-installed model/config if not specified
    if not model and os.path.exists(_DEFAULT_MODEL):
        model = _DEFAULT_MODEL
    if not config and os.path.exists(_DEFAULT_CONFIG):
        config = _DEFAULT_CONFIG

    if not model or not config:
        msg = f"KataGo model or config not found (model={model!r} config={config!r})"
        if strict:
            raise RuntimeError(f"{msg} — STRICT_KATAGO=1 set, refusing to fall back to stub AI")
        logger.warning(f"{msg}, using stub AI")
        return None

    # Catch the most common LFS-pointer footgun explicitly: a model file under
    # ~1 KB is never a real KataGo network (real ones are ~80 MB / ~270 MB).
    try:
        size = os.path.getsize(model)
    except OSError:
        size = -1
    if 0 <= size < 1024 * 1024:  # < 1 MB
        msg = (
            f"KataGo model file is implausibly small ({size} bytes): {model!r}. "
            "Likely an unmaterialized git-LFS pointer — run `git lfs pull`."
        )
        if strict:
            raise RuntimeError(f"{msg} — STRICT_KATAGO=1 set, refusing to fall back to stub AI")
        logger.warning(f"{msg}, using stub AI")
        return None

    # Optional human SL model. A missing or truncated file just leaves it
    # unloaded: profiles that ask for it use the standard selector.
    human_model = os.environ.get("KATAGO_HUMAN_MODEL", "")
    if human_model:
        try:
            human_size = os.path.getsize(human_model)
        except OSError:
            human_size = -1
        if human_size < 1024 * 1024:
            logger.warning(
                f"KATAGO_HUMAN_MODEL not usable ({human_model!r}, {human_size} bytes); "
                "human-net profiles use the standard selector"
            )
            human_model = ""

    kg_config = KataGoConfig(
        executable=executable,
        model=model,
        config=config,
        human_model=human_model,
        num_threads=int(os.environ.get("KATAGO_THREADS", "4")),
        max_visits=int(os.environ.get("KATAGO_VISITS", "100")),
    )

    try:
        _engine = await _start_engine(kg_config)
        return _engine
    except Exception as e:
        _engine = None
        if strict:
            raise RuntimeError(f"KataGo failed to start: {e}") from e
        logger.warning(f"KataGo failed to start: {e}. Using stub AI.")
        return None
