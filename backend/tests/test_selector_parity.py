"""Selector parity, the Python side: every case in data/selector_parity/ still
gets the move it was recorded with, consuming exactly the recorded engine
answers and random draws (selector_parity_harness says how they are fed).

The TypeScript side (frontend/src/ai/__tests__/selectorParity.test.ts) replays
the same cases. The two selectors are meant to stay equal: change one, port the
other, regenerate (data/selector_parity/generate.py), both suites green. A red
case here means the Python's behaviour changed since the cases were recorded.
"""

import asyncio
import functools
import logging
from collections import Counter

import pytest

import app.ai.move_selector as ms
from tests.selector_parity_harness import (
    Answers, Feed, fast_position_keys, load_cases, run_human, run_standard,
)


@functools.lru_cache(maxsize=None)
def _load(name: str) -> tuple:
    return tuple(load_cases(name))


def _cases(name: str) -> list[dict]:
    return list(_load(name))


@pytest.fixture(scope="module")
def loop():
    lp = asyncio.new_event_loop()
    with fast_position_keys():
        yield lp
    lp.close()


@pytest.fixture(autouse=True)
def quiet():
    logging.disable(logging.CRITICAL)
    yield
    logging.disable(logging.NOTSET)


def _report(bad: list[str], total: int) -> str:
    return f"{len(bad)} of {total} cases changed:\n" + "\n".join(bad[:15])


def test_standard_selector_matches_recorded_cases(loop):
    cases = _cases("standard")
    bad = []
    for case in cases:
        u, g = Feed(case["u"]), Feed(case["g"])
        answers = Answers(case["answers"])
        pick = run_standard(ms, case, u, g, answers, loop)
        problems = []
        if pick != case["pick"]:
            problems.append(f"picked {pick}, recorded {case['pick']}")
        if u.used != len(u.values) or u.overrun:
            problems.append(f"uniforms used {u.used + u.overrun} of {len(u.values)}")
        if g.used != len(g.values) or g.overrun:
            problems.append(f"normals used {g.used + g.overrun} of {len(g.values)}")
        if answers.errors or answers.used != len(answers.items):
            problems.append(f"answers used {answers.used} of {len(answers.items)} {answers.errors[:1]}")
        if problems:
            bad.append(f"{case['id']} ({case['size']}x{case['size']} {case['rung']} {case['color']}): "
                       + "; ".join(problems))
    assert not bad, _report(bad, len(cases))


def test_human_selector_matches_recorded_cases(loop):
    cases = _cases("human")
    bad = []
    for case in cases:
        u = Feed(case["u"])
        answers = Answers(case["answers"])
        handled, pick = run_human(ms, case, u, answers, loop)
        problems = []
        if (handled, pick) != (case["handled"], case["pick"]):
            problems.append(f"got {(handled, pick)}, recorded {(case['handled'], case['pick'])}")
        if u.used != len(u.values) or u.overrun:
            problems.append(f"uniforms used {u.used + u.overrun} of {len(u.values)}")
        if answers.errors or answers.used != len(answers.items):
            problems.append(f"answers used {answers.used} of {len(answers.items)} {answers.errors[:1]}")
        if problems:
            bad.append(f"{case['id']} ({case['rung']} {case['variant']} {case['color']}): "
                       + "; ".join(problems))
    assert not bad, _report(bad, len(cases))


def test_cases_cover_what_they_must():
    """A regeneration that drops a rung, a colour or a route fails here."""
    import yaml
    from tests.selector_parity_harness import PARITY_DIR

    root = PARITY_DIR.parents[1]
    std, hum = _cases("standard"), _cases("human")
    assert len(std) + len(hum) >= 5000

    b28 = yaml.safe_load((root / "data/profiles/b28.yaml").read_text())["profiles"]
    have = Counter((c["size"], c["rung"], c["color"]) for c in std)
    for size in (9, 13, 19):
        for rung in b28[f"{size}x{size}"]:
            for color in "BW":
                assert have[(size, rung, color)] >= 10, (size, rung, color)
    traces = Counter(t for c in std for t in c["trace"])
    for t in ("border-closed", "top-pass", "no-candidates"):
        assert traces[t] >= 10, t
    assert sum(c["opponent_passed"] for c in std) >= 100
    assert sum(c["pick"] is None for c in std) >= 50
    assert sum(len(c["g"]) > 0 for c in std) >= 20  # score_noise's normals

    human = yaml.safe_load((root / "data/profiles/b28_human.yaml").read_text())["profiles"]["9x9"]
    have = Counter((c["rung"], c["color"]) for c in hum)
    for rung in human:
        for color in "BW":
            assert have[(rung, color)] >= 10, (rung, color)
    tilts = Counter(str(c["profile"].get("human_tilt")) for c in hum)
    for t in ("0.0", "Infinity", "-Infinity", "-4.0", "4.0"):
        assert tilts[t] >= 50, t
    assert sum(c["opponent_passed"] for c in hum) >= 100
    assert sum(c["pick"] is None for c in hum) >= 50  # passes
    assert sum(c["scenario"] == "split" and c["pick"] is not None
               and any(a["kind"] == "score" for a in c["answers"]) for c in hum) >= 50
