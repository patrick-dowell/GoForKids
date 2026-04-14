## Overview

Yes — you can absolutely use KataGo as the base engine and build a **rank-aware training system** on top of it. This approach combines:

- **KataGo** → strong evaluation + candidate move generation
- **Rank model** → selects moves based on human-like mistakes at a given level

This is the most promising path toward creating a bot that feels like a real 20k → 1d opponent.

---

## Why KataGo Works as a Foundation

KataGo already provides:

- Accurate evaluation of positions
- Multiple candidate moves with scores
- Policy (likelihood of moves)
- Point-loss estimates vs optimal play

This makes it ideal for:

> “Generate strong candidate moves → choose one according to a rank model”
> 

---

## Prior Work / Signals This Is Viable

### GoNN (by KataGo author)

https://github.com/lightvector/GoNN

- Included **player rank + server** as input
- Predicted move choices at different ranks
- Demonstrated:
    - 19k players choose very different moves than 1d or 9d

👉 Key takeaway:

> Rank-conditioned move prediction is already proven possible
> 

---

## High-Level Architecture

### 1. Base Engine (KataGo)

- Generates:
    - Top candidate moves
    - Point loss for each move
    - Policy probabilities

---

### 2. Rank Model Layer

Determines which move to play based on:

- Target rank (e.g. 15k, 10k, 5k)
- Move “obviousness”
- Mistake distribution

Instead of:

> Always playing best move
> 

You get:

> Playing like a human of that rank
> 

---

### 3. Move Selection Process

1. Get candidate moves from KataGo
2. Evaluate:
    - point loss
    - policy probability
    - tactical features
3. Sample move based on:
    - rank-specific mistake distribution
    - contextual difficulty

---

## Do You Need Real Game Data?

### Short Answer:

- ❌ Not strictly required
- ✅ Strongly recommended if you want realism

---

### Why Data Matters

Without real games:

- You get a “weakened AI”
- But not a **human-like player**

With real games:

- You can model:
    - mistake frequency
    - mistake size
    - mistake types

👉 This is the difference between:

- “weaker engine”
- vs
- “realistic 10k player”

---

## Available Datasets

### 1. OGS (Online Go Server)

- ~56 million games (updated through 2025)
- Includes:
    - rank labels
    - SGF format
- Ranks adjusted to match displayed ratings

✅ Best modern dataset

✅ Broad rank coverage

---

### 2. Fox Go Server Dataset

- ~21 million games
- Covers wide rank range
- Explicitly useful for:
    - human-style AI training

✅ High volume

⚠️ Rank calibration differs from OGS

---

### 3. KGS Archives

- Historical dataset
- Rank information available
- Less standardized / fragmented

🟡 Still useful, but secondary

---

## Key Challenge: Rank Differences Across Servers

- OGS 5k ≠ Fox 5k ≠ KGS 5k
- Ratings are not globally standardized

### Solution:

Use:

- **rank + server as input**
- or normalize ratings across datasets

👉 This matches the approach used in GoNN

---

## Core Insight

What you are building is:

> A **rank-conditioned move selection model**
> 

NOT:

> A weaker version of KataGo
> 

---

## Recommended Approach

### Phase 1 (No Training)

- Use heuristics:
    - point-loss distributions
    - policy filtering
    - randomness tuned by rank

---

### Phase 2 (Data-Driven)

- Train model on OGS dataset:
    - Input: board position + rank
    - Output: move distribution

---

### Phase 3 (Hybrid System)

- KataGo generates candidate moves
- Rank model:
    - filters and samples moves
    - ensures human-like behavior

---

## What This Solves

Current systems fail because they:

- weaken AI artificially
- produce unnatural mistakes

Your approach:

- models **how humans actually play**
- creates:
    - realistic opponents
    - meaningful progression

---

## Final Summary

- ✅ Use KataGo as the base engine
- ✅ Add a rank-aware move selection layer
- ✅ Use real game data for calibration
- ✅ Start with OGS, optionally add Fox

---

## Next Step Ideas

- Define mistake distributions by rank
- Build “obviousness” heuristics
- Prototype move sampling system
- Train rank-conditioned model

---

## Big Picture

You are effectively designing:

> A **human-like Go AI ladder (20k → 1d)**
> 

This is a real gap in the ecosystem—and a very strong direction.