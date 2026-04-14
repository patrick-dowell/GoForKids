"""
Claude API integration for study mode narrative explanations.

Takes structured analysis data from KataGo and generates
plain-language explanations calibrated to the player's rank
and reading level.
"""

from __future__ import annotations
import os
import logging
from typing import Optional

import anthropic

from app.study.analyzer import MoveEval

logger = logging.getLogger(__name__)

# Tone profiles by rank
TONE_PROFILES = {
    "beginner": {  # 20k-10k
        "reading_level": "age 8-10",
        "vocabulary": "simple, concrete, no Go jargon",
        "sentence_length": "short (8-12 words)",
        "examples": "use comparisons to everyday things",
    },
    "intermediate": {  # 10k-5k
        "reading_level": "age 12-14",
        "vocabulary": "basic Go terms (atari, liberty, territory, influence)",
        "sentence_length": "moderate (10-18 words)",
        "examples": "use Go concepts directly",
    },
    "advanced": {  # 5k-1d
        "reading_level": "adult",
        "vocabulary": "full Go vocabulary (sente, gote, aji, thickness, etc.)",
        "sentence_length": "natural length",
        "examples": "precise Go analysis",
    },
}


def _get_tone(rank: str) -> dict:
    """Get the tone profile for a player rank."""
    rank = rank.strip().lower()
    if rank.endswith("k"):
        kyu = int(rank[:-1])
        if kyu >= 10:
            return TONE_PROFILES["beginner"]
        elif kyu >= 5:
            return TONE_PROFILES["intermediate"]
    return TONE_PROFILES["advanced"]


def _build_prompt(
    move_eval: MoveEval,
    player_rank: str,
    game_context: str = "",
) -> str:
    """Build the Claude prompt for a single move explanation."""
    tone = _get_tone(player_rank)

    direction = "lost" if move_eval.score_delta < 0 else "gained"
    delta = abs(move_eval.score_delta)

    prompt = f"""You are a Go teacher explaining a move to a student ranked {player_rank}.

TONE REQUIREMENTS:
- Reading level: {tone["reading_level"]}
- Vocabulary: {tone["vocabulary"]}
- Sentence length: {tone["sentence_length"]}
- Style: {tone["examples"]}
- Be encouraging, not judgmental. Frame mistakes as learning opportunities.
- Keep the explanation to 2-3 sentences maximum.

MOVE DATA:
- Move {move_eval.move_number}: {"Black" if move_eval.color == "black" else "White"} played at row {move_eval.point[0]}, col {move_eval.point[1]}
- Score change: {direction} {delta:.1f} points
- Mistake type: {move_eval.mistake_type or "good move"}
- Winrate change: {move_eval.winrate_before:.0%} → {move_eval.winrate_after:.0%}
{f"- Better move was available at row {move_eval.best_move[0]}, col {move_eval.best_move[1]}" if move_eval.best_move and move_eval.mistake_type else ""}

{game_context}

Write a brief, encouraging explanation of this move. If it was a mistake, explain what went wrong and what would have been better. If it was a good move, celebrate it briefly."""

    return prompt


async def generate_explanation(
    move_eval: MoveEval,
    player_rank: str,
    game_context: str = "",
) -> Optional[str]:
    """
    Generate a plain-language explanation for a move using Claude API.
    Returns None if the API key is not configured.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.info("ANTHROPIC_API_KEY not set, skipping narrative generation")
        return _fallback_explanation(move_eval)

    try:
        client = anthropic.Anthropic(api_key=api_key)
        prompt = _build_prompt(move_eval, player_rank, game_context)

        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )

        return message.content[0].text.strip()

    except Exception as e:
        logger.error(f"Claude API error: {e}")
        return _fallback_explanation(move_eval)


async def generate_game_summary(
    evaluations: list[MoveEval],
    player_rank: str,
    result: Optional[dict] = None,
) -> Optional[str]:
    """Generate a brief summary of the entire game."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    # Build summary data
    mistakes = [e for e in evaluations if e.mistake_type]
    critical = [e for e in evaluations if e.is_critical]
    blunders = [e for e in evaluations if e.mistake_type == "blunder"]

    tone = _get_tone(player_rank)

    prompt = f"""You are a Go teacher giving a brief post-game summary to a student ranked {player_rank}.

TONE: {tone["reading_level"]}, {tone["vocabulary"]}, encouraging.

GAME STATS:
- Total moves: {len(evaluations)}
- Mistakes: {len(mistakes)} ({len(blunders)} blunders)
- Critical moments: {len(critical)}
- Result: {result.get("winner", "unknown") if result else "unknown"} wins

Write 2-3 sentences summarizing the game. Highlight one thing the player did well and one thing to work on. Be encouraging."""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text.strip()
    except Exception as e:
        logger.error(f"Claude API summary error: {e}")
        return None


def _fallback_explanation(move_eval: MoveEval) -> str:
    """Simple template-based explanation when Claude API is not available."""
    if not move_eval.mistake_type:
        return "Good move! This keeps the game balanced."

    delta = abs(move_eval.score_delta)

    if move_eval.mistake_type == "blunder":
        return f"This move lost about {delta:.0f} points. There was a much better option available. Let's look at what happened."
    elif move_eval.mistake_type == "mistake":
        return f"This move cost about {delta:.0f} points. A different move would have been stronger here."
    else:
        return f"A small inaccuracy here, losing about {delta:.1f} points. Close to the best move though!"
