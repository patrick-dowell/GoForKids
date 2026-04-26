# Introduction to Go Sequence (Kids Onboarding)

## Product Spec for Claude Code

---

# Overview

Build a polished, kid-friendly onboarding flow that teaches a brand-new player enough Go to enjoy their first games.

Tone:

- Fun

- Encouraging

- Fast-paced

- Visual

- Never intimidating

Goal:

By the end of onboarding, a player should:

- Understand how stones are placed

- Understand capturing

- Understand basic survival

- Understand territory/scoring

- Feel excited to play more

- Unlock 5x5 and 9x9 play

---

# Core Design Philosophy

Teach through interaction, not explanation.

Every lesson should be:

- 30 to 90 seconds

- Tactile

- Rewarding

- One idea only

Avoid long text walls.

Use positive language:

- Great move!

- Nice save!

- Big capture!

- You did it!

Never say:

- Wrong

- Failed

- Bad move

Instead:

- Try again!

- Almost!

- Want a hint?

---

# User Flow

## Sequence Order

1. Drop Your First Stone

2. Trap One Stone

3. Big Capture

4. Save Your Team

5. Who Gets Trapped?

6. First Battle (5x5)

7. Safe Eyes

8. Alive or Gone?

9. Count Your Land

10. Big Board Time (9x9)

---

# Shared UI Requirements

## Board

Use existing board renderer.

Need support for:

- 5x5 board

- Highlight legal moves

- Ghost preview on hover/tap

## Lesson Overlay

Top text area:

- Lesson title

- One sentence instruction

Bottom area:

- Continue button

- Hint button

- Mascot text bubble optional

## Feedback

Correct move:

- Stone pulse animation

- Pleasant sound

- Success text

Incorrect move:

- Gentle shake

- Soft sound

- Retry text

## Hint Mode

Highlight correct intersection with glow pulse.

---

# Mascot (Optional but recommended)

Sensei Fox

Short lines:

- Nice move!

- Save your stones!

- Look for breathing room!

- Amazing capture!

---

# Terminology Strategy

Use kid-friendly language first.

Initial terms:

- Breathing spaces

Later introduce:

- Liberties

Use both after lesson 5.

---

# LESSON DETAILS

---

# Lesson 1: Drop Your First Stone

## Goal

Teach stone placement.

## Board

Empty 5x5 board.

## Steps

1. Highlight center point.

2. User taps point.

3. Black stone appears.

4. Show message:

   "Stones stay where you place them."

5. Highlight another point.

6. White stone appears automatically.

7. Show:

   "Players take turns."

## Completion

Reward stars + confetti burst.

---

# Lesson 2: Trap One Stone

## Goal

Teach capture by removing last liberty.

## Board Setup

White stone with one breathing space left.

Example:

. B .

B W B

. . .

## Prompt

"Fill the last breathing space!"

## Success

User places black stone.

White stone disappears.

Text:

"Captured!"

---

# Lesson 3: Big Capture

## Goal

Teach connected stones share breathing spaces.

## Board Setup

Two connected white stones almost surrounded.

## Prompt

"Capture both stones!"

## Success

Both stones removed.

Text:

"Connected stones fall together!"

---

# Lesson 4: Save Your Team

## Goal

Teach extending or connecting to escape.

## Board Setup

White stone in danger with one liberty.

Black threatening.

## Prompt

"Save White!"

## Acceptable Moves

- Extend to open liberty

OR

- Connect to friendly stone

## Success

Show:

"You escaped!"

---

# Lesson 5: Who Gets Trapped?

## Goal

Introduce capture races.

## Board Setup

Two groups both low on liberties.

Simple obvious reading puzzle.

## Prompt

"Black plays first. Can Black win?"

## Success

After correct move:

"Sometimes the faster capture wins."

Introduce term:

"This is called a capture race."

---

# Lesson 6: First Battle (5x5)

## Goal

First real game.

## Opponent

Very weak beginner bot.

Behavior:

- legal random-ish moves

- occasional captures

- not too punishing

## Rules Simplified

- No komi shown

- No advanced scoring details

- End when board mostly full or both pass

## Coaching During Game

Show subtle hints:

- White stone has one breathing space!

- Try to connect your stones.

- Nice capture!

## End Screen

Win or lose:

"You played your first Go game!"

Reward:

Unlock Eyes Lessons

---

# Lesson 7: Safe Eyes

## Goal

Teach why some groups live.

## Board Setup

One surrounded black group with two eyes.

## Prompt

"Can White capture Black?"

User tries.

No legal capture.

Explain:

"Two eyes means safe."

Use visual animation showing two internal spaces.

---

# Lesson 8: Alive or Gone?

## Goal

Basic life/death recognition.

## Puzzle Format

Show 3 mini boards:

1. Group with two eyes

2. Group with one eye

3. Surrounded dead group

User taps:

- Safe

or

- Gone

## Success

Quick streak-style lesson.

---

# Lesson 9: Count Your Land

## Goal

Teach territory/scoring.

## Board Setup

Finished 5x5 position with clear territories.

## Prompt

"Count Black's spaces."

Then:

"Count White's spaces."

## UI

Empty points inside territory glow.

## Explain

"At the end, your surrounded empty spaces count as points."

Keep simple.

Ignore advanced dead stone disputes.

---

# Lesson 10: Big Board Time (9x9)

## Goal

Transition to real play.

## Intro Screen

"You are ready for the bigger board!"

## Opponent Choices

- Friendly Bot (30k)

- Coach Bot

- Human Pass-and-Play

## During First 9x9

Optional tips:

- Corners are strong.

- Connect your stones.

- Look for captures.

## End Reward

Unlock ranked ladder.

---

# Reward System

## Stars

Each lesson gives 1–3 stars.

Criteria:

- First try

- Fast solve

- No hint used

## XP

Each lesson grants XP.

## Unlocks

After Lesson 6:

- 5x5 Free Play

After Lesson 10:

- 9x9 Ladder

- Bot ranks

---

# Technical Build Notes

Need reusable lesson engine

---

# Architecture Requirement

All lessons should be defined via JSON or TypeScript config objects.

Do not hardcode each lesson screen separately.

Need reusable support for:

* title
* instruction
* board state
* legal moves
* success triggers
* hints
* follow-up text
* reward values

---

# Progress Persistence

Need to save:

* current lesson
* stars earned
* completed lessons
* onboarding completed yes/no
* unlocked modes

---

# Existing Systems Already Built

The app already has:

* Go board renderer
* Rules engine
* Bots from 30k to 3k
* 5x5 / 9x9 / 13x13 / 19x19 support
* Study mode
* Analysis mode

Build onboarding on top of these systems.

