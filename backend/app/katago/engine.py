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
from dataclasses import dataclass

logger = logging.getLogger(__name__)

BOARD_SIZE = 19

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


def point_to_gtp(row: int, col: int) -> str:
    """Convert (row, col) to GTP coordinate like 'D4'."""
    letters = "ABCDEFGHJKLMNOPQRST"
    return f"{letters[col]}{BOARD_SIZE - row}"


def gtp_to_point(gtp: str) -> tuple[int, int]:
    """Convert GTP coordinate like 'D4' to (row, col)."""
    if gtp.lower() == "pass":
        return (-1, -1)
    letters = "ABCDEFGHJKLMNOPQRST"
    col = letters.index(gtp[0].upper())
    row = BOARD_SIZE - int(gtp[1:])
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

    async def start(self):
        """Start the KataGo analysis process."""
        cmd = [
            self.config.executable,
            "analysis",
            "-model", self.config.model,
            "-config", self.config.config,
        ]

        logger.info(f"Starting KataGo: {' '.join(cmd)}")

        self.process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        # Wait briefly for startup, check it didn't crash
        await asyncio.sleep(0.5)
        if self.process.poll() is not None:
            stderr = self.process.stderr.read() if self.process.stderr else ""
            raise RuntimeError(f"KataGo exited immediately: {stderr[:500]}")

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
    ) -> PositionAnalysis:
        """Analyze a board position. Returns candidate moves with evaluations."""
        if not self.process or self.process.poll() is not None:
            raise RuntimeError("KataGo not running")

        query_id = f"q{self._query_id}"
        self._query_id += 1

        # Build initial stones from 2D board
        initial_stones: list[list[str]] = []
        for row in range(BOARD_SIZE):
            for col in range(BOARD_SIZE):
                if board[row][col] == 1:
                    initial_stones.append(["B", point_to_gtp(row, col)])
                elif board[row][col] == 2:
                    initial_stones.append(["W", point_to_gtp(row, col)])

        query = {
            "id": query_id,
            "rules": "japanese",
            "komi": komi,
            "boardXSize": BOARD_SIZE,
            "boardYSize": BOARD_SIZE,
            "initialStones": initial_stones,
            "moves": [],
            "initialPlayer": current_player,
            "maxVisits": max_visits or self.config.max_visits,
            "analyzeTurns": [0],
            "includeOwnership": include_ownership,
        }

        async with self._lock:
            future = asyncio.get_event_loop().create_future()
            self._pending[query_id] = future
            self.process.stdin.write(json.dumps(query) + "\n")
            self.process.stdin.flush()

        result = await asyncio.wait_for(future, timeout=30.0)
        return self._parse_response(result)

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
            pass
        except Exception as e:
            logger.error(f"KataGo reader error: {e}")

    def _parse_response(self, response: dict) -> PositionAnalysis:
        """Parse the flat KataGo analysis JSON response."""
        # KataGo analysis response has moveInfos and rootInfo at top level
        root_info = response.get("rootInfo", {})
        move_infos = response.get("moveInfos", [])

        candidates = []
        for i, info in enumerate(move_infos):
            move_str = info.get("move", "pass")
            point = gtp_to_point(move_str) if move_str.lower() != "pass" else (-1, -1)

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
        )

    @property
    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None


# Singleton
_engine: Optional[KataGoEngine] = None


async def get_engine() -> Optional[KataGoEngine]:
    """Get or create the KataGo engine singleton."""
    global _engine
    if _engine and _engine.is_running:
        return _engine

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
        logger.warning("KataGo model or config not found, using stub AI")
        return None

    kg_config = KataGoConfig(
        executable=executable,
        model=model,
        config=config,
        num_threads=int(os.environ.get("KATAGO_THREADS", "4")),
        max_visits=int(os.environ.get("KATAGO_VISITS", "100")),
    )

    try:
        _engine = KataGoEngine(kg_config)
        await _engine.start()
        return _engine
    except Exception as e:
        logger.warning(f"KataGo failed to start: {e}. Using stub AI.")
        _engine = None
        return None
