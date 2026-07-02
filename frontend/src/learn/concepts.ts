/**
 * Concept registry — the single source of truth for the learning engine
 * (feature plan 29). Lessons, puzzles, the glossary, and the in-game "Play of
 * the Game" teacher (fp 28) all read concepts from here by `id`.
 *
 * Philosophy (Patrick, 2026-06-16): the glossary IS the canonical concept set.
 * CORE concepts are the must-knows to get into a game (one lesson each);
 * EXTENDED concepts are taught in-context as they come up in real play. Every
 * concept has a 5-second kid-simple answer (`short`) up front; depth (lesson,
 * puzzles, "see it in your game") is optional and layered below.
 *
 * Example positions reuse the lesson position shape ({ size, stones }) so the
 * DiagramBoard renders them the same way lessons render mini-boards.
 *
 * NOTE: `short` copy is first-draft — written kid-simple but pending Patrick's
 * voice pass (he has the target user asleep down the hall). Positions marked
 * `// TODO verify` need a careful authoring/playtest check before trusting.
 */
import { Color, type Point } from '../engine/types';

export type ConceptTier = 'core' | 'extended';

/** A tiny static position rendered on a glossary page (DiagramBoard). */
export interface DiagramPosition {
  size: number;
  stones: Array<{ row: number; col: number; color: Color }>;
  /** Intersections to glow — the liberties, the eyes, the territory, etc. */
  highlight?: Point[];
}

export interface Concept {
  /** Stable id, e.g. 'atari'. Referenced by lessons, detectors, puzzles. */
  id: string;
  /** Display name, e.g. 'Atari'. */
  name: string;
  tier: ConceptTier;
  /** The 5-second answer — one or two kid-simple sentences. Shown first. */
  short: string;
  /** A small illustrative diagram. null ⇒ not yet authored/verified. */
  example?: DiagramPosition | null;
  /** Additional captioned diagrams shown below `example` — for concepts a
   *  single picture can't carry (real vs false eyes, a group's shared
   *  liberties vs a corner stone's two). Keep to 2-3, kid-length captions. */
  examples?: Array<DiagramPosition & { caption: string }>;
  /** Related concept ids (Wikipedia-style cross-links). */
  related?: string[];
  /** Lessons that teach this concept (wired as lessons are retrofitted). */
  lessonIds?: string[];
  /** Label for the lesson-header link to this concept. Defaults to
   *  "What is {name}?" when unset — override where that reads awkwardly. */
  linkPrompt?: string;
}

const B = Color.Black;
const W = Color.White;

/* ------------------------------------------------------------------------- *
 * CORE — the on-ramp. Must-knows to play a game; one lesson each.
 * ------------------------------------------------------------------------- */

const CORE: Concept[] = [
  {
    id: 'placing-stones',
    name: 'Placing Stones',
    tier: 'core',
    linkPrompt: 'How to Place Stones',
    short: "Black and White take turns putting one stone on the line crossings. Black goes first.",
    related: ['liberties', 'capture'],
    example: {
      size: 5,
      stones: [
        { row: 2, col: 1, color: B },
        { row: 1, col: 2, color: W },
        { row: 3, col: 2, color: B },
      ],
    },
  },
  {
    id: 'liberties',
    name: 'Liberties',
    tier: 'core',
    short: "A stone's liberties are the empty points right next to it. Stones need liberties to stay on the board.",
    related: ['capture', 'atari', 'groups'],
    example: {
      size: 5,
      stones: [{ row: 2, col: 2, color: B }],
      highlight: [
        { row: 1, col: 2 },
        { row: 3, col: 2 },
        { row: 2, col: 1 },
        { row: 2, col: 3 },
      ],
    },
    // fp 03 §A (learn-to-play-go comparison, 2026-06-27): the GROUP case is
    // what actually builds intuition — a lone stone's 4 liberties undersells
    // the idea. Plus the edge/corner gotcha.
    examples: [
      {
        caption: 'A GROUP shares its liberties. These three stones breathe together — 8 spaces!',
        size: 5,
        stones: [
          { row: 2, col: 1, color: B },
          { row: 2, col: 2, color: B },
          { row: 2, col: 3, color: B },
        ],
        highlight: [
          { row: 1, col: 1 },
          { row: 1, col: 2 },
          { row: 1, col: 3 },
          { row: 3, col: 1 },
          { row: 3, col: 2 },
          { row: 3, col: 3 },
          { row: 2, col: 0 },
          { row: 2, col: 4 },
        ],
      },
      {
        caption: 'Careful near the edge — a corner stone has only 2 liberties. Easier to catch!',
        size: 5,
        stones: [{ row: 0, col: 0, color: B }],
        highlight: [
          { row: 0, col: 1 },
          { row: 1, col: 0 },
        ],
      },
    ],
  },
  {
    id: 'capture',
    name: 'Capture',
    tier: 'core',
    linkPrompt: 'How to Capture Stones',
    short: "When a stone or group has no liberties left, it's captured and taken off the board.",
    related: ['liberties', 'atari', 'groups'],
    example: {
      // White stone with every liberty filled by Black → captured.
      size: 5,
      stones: [
        { row: 2, col: 2, color: W },
        { row: 1, col: 2, color: B },
        { row: 3, col: 2, color: B },
        { row: 2, col: 1, color: B },
        { row: 2, col: 3, color: B },
      ],
      highlight: [{ row: 2, col: 2 }],
    },
  },
  {
    id: 'atari',
    name: 'Atari',
    tier: 'core',
    short: "Atari means just one liberty is left — one more move captures it. Like 'check' in chess.",
    related: ['capture', 'liberties'],
    example: {
      // White has one liberty left (highlighted) — Black plays it to capture.
      size: 5,
      stones: [
        { row: 2, col: 2, color: W },
        { row: 1, col: 2, color: B },
        { row: 3, col: 2, color: B },
        { row: 2, col: 1, color: B },
      ],
      highlight: [{ row: 2, col: 3 }],
    },
  },
  {
    id: 'groups',
    name: 'Groups',
    tier: 'core',
    linkPrompt: 'What are Groups?',
    short: "Stones of the same color that touch along the lines join into one group, and a group shares all its liberties. Connected stones are stronger.",
    related: ['liberties', 'capture', 'two-eyes'],
    example: {
      size: 5,
      stones: [
        { row: 2, col: 1, color: B },
        { row: 2, col: 2, color: B },
        { row: 2, col: 3, color: B },
      ],
    },
  },
  {
    id: 'two-eyes',
    name: 'Two Eyes = Life',
    tier: 'core',
    linkPrompt: 'Two Eyes = Safe?',
    short: "An eye is an empty point your group surrounds. A group with TWO separate eyes can never be captured — it's alive forever.",
    related: ['groups', 'capture', 'life-and-death'],
    example: {
      // Black group on the left edge with two separate eyes at (0,0) and (2,0).
      size: 5,
      stones: [
        { row: 0, col: 1, color: B },
        { row: 1, col: 0, color: B },
        { row: 1, col: 1, color: B },
        { row: 2, col: 1, color: B },
        { row: 3, col: 0, color: B },
        { row: 3, col: 1, color: B },
      ],
      highlight: [
        { row: 0, col: 0 },
        { row: 2, col: 0 },
      ],
    },
  },
  {
    id: 'suicide-rule',
    name: 'Self-Capture',
    tier: 'core',
    short: "You can't place a stone where it would have no breathing spaces left — unless it captures something first. A move that would only capture your own stone isn't allowed.",
    related: ['liberties', 'capture', 'ko-rule'],
    example: {
      // Black may not play the highlighted point — it would have no liberties
      // and captures nothing.
      size: 5,
      stones: [
        { row: 0, col: 1, color: W },
        { row: 2, col: 1, color: W },
        { row: 1, col: 0, color: W },
        { row: 1, col: 2, color: W },
      ],
      highlight: [{ row: 1, col: 1 }],
    },
  },
  {
    id: 'ko-rule',
    name: 'The Ko Rule',
    tier: 'core',
    short: "After a capture, you can't immediately take back to make the exact same board again. Play somewhere else first. This stops endless back-and-forth.",
    related: ['capture', 'ko-fights'],
    // Ko is dynamic, so the diagram pairs with the interactive lesson (the
    // ko-lesson position, engine-verified): Black captures at the glow, and
    // White must wait a turn before taking back.
    example: {
      size: 5,
      stones: [
        { row: 1, col: 1, color: B },
        { row: 3, col: 1, color: B },
        { row: 2, col: 0, color: B },
        { row: 2, col: 1, color: W },
        { row: 1, col: 2, color: W },
        { row: 3, col: 2, color: W },
        { row: 2, col: 3, color: W },
      ],
      highlight: [{ row: 2, col: 2 }],
    },
  },
  {
    id: 'territory-count',
    name: 'Territory',
    tier: 'core',
    short: "Territory is the empty points your stones surround. You count them to see how much area you control.",
    related: ['who-wins', 'groups', 'endgame'],
    example: {
      // Black wall (col 1) surrounds column 0 — 5 points of territory.
      size: 5,
      stones: [
        { row: 0, col: 1, color: B },
        { row: 1, col: 1, color: B },
        { row: 2, col: 1, color: B },
        { row: 3, col: 1, color: B },
        { row: 4, col: 1, color: B },
      ],
      highlight: [
        { row: 0, col: 0 },
        { row: 1, col: 0 },
        { row: 2, col: 0 },
        { row: 3, col: 0 },
        { row: 4, col: 0 },
      ],
    },
  },
  {
    id: 'who-wins',
    name: 'Who Wins',
    tier: 'core',
    short: "At the end, your score is your territory plus the stones you captured (White also adds komi). The higher score wins.",
    related: ['territory-count', 'endgame'],
    example: {
      // Black holds the left (col 0), White holds the right (col 4).
      size: 5,
      stones: [
        { row: 0, col: 1, color: B },
        { row: 1, col: 1, color: B },
        { row: 2, col: 1, color: B },
        { row: 3, col: 1, color: B },
        { row: 4, col: 1, color: B },
        { row: 0, col: 3, color: W },
        { row: 1, col: 3, color: W },
        { row: 2, col: 3, color: W },
        { row: 3, col: 3, color: W },
        { row: 4, col: 3, color: W },
      ],
    },
  },
];

/* ------------------------------------------------------------------------- *
 * EXTENDED — taught in-context (fp 28). Glossary stubs that grow over time;
 * example positions + lessons + puzzles get authored as each is built out.
 * ------------------------------------------------------------------------- */

const EXTENDED: Concept[] = [
  {
    id: 'ladders',
    name: 'Ladders',
    tier: 'extended',
    short: "A ladder is a chase: you keep putting a stone in atari, step by step, until it runs into the edge and dies — unless something on its path saves it.",
    related: ['atari', 'capture', 'nets'],
    // Mid-chase snapshot from the ladder lesson: White's chain crawls along
    // Black's wall; the glow is the last breathing space at the edge.
    example: {
      size: 7,
      stones: [
        { row: 1, col: 2, color: B },
        { row: 1, col: 3, color: B },
        { row: 1, col: 4, color: B },
        { row: 1, col: 5, color: B },
        { row: 1, col: 6, color: B },
        { row: 2, col: 1, color: B },
        { row: 3, col: 2, color: B },
        { row: 3, col: 3, color: B },
        { row: 3, col: 4, color: B },
        { row: 3, col: 5, color: B },
        { row: 2, col: 2, color: W },
        { row: 2, col: 3, color: W },
        { row: 2, col: 4, color: W },
        { row: 2, col: 5, color: W },
      ],
      highlight: [{ row: 2, col: 6 }],
    },
  },
  {
    id: 'nets',
    name: 'Nets',
    tier: 'extended',
    short: "A net (geta) traps a stone loosely from a distance instead of chasing it, so it can't escape even by running.",
    related: ['ladders', 'capture'],
    // The net-lesson position: the glowing stone is the net move — it never
    // touches White, but every escape runs out of breathing spaces.
    example: {
      size: 7,
      stones: [
        { row: 1, col: 2, color: B },
        { row: 1, col: 3, color: B },
        { row: 2, col: 1, color: B },
        { row: 2, col: 0, color: B },
        { row: 3, col: 3, color: B },
        { row: 2, col: 2, color: W },
      ],
      highlight: [{ row: 3, col: 3 }],
    },
  },
  {
    id: 'life-and-death',
    name: 'Life & Death',
    tier: 'extended',
    short: "Whether a group can make two eyes (live) or be stopped from making them (die). The heart of Go fighting.",
    related: ['two-eyes', 'capture-races', 'shape'],
  },
  {
    id: 'snapback',
    name: 'Snapback',
    tier: 'extended',
    short: "Let a stone be captured, then capture a bigger group right back. A tiny sacrifice for a big gain.",
    related: ['capture', 'atari'],
    // The snapback-lesson position: Black sacrifices at the glow; when White
    // captures it, White's whole group is left with one breathing space.
    example: {
      size: 5,
      stones: [
        { row: 0, col: 2, color: W },
        { row: 1, col: 0, color: W },
        { row: 1, col: 1, color: W },
        { row: 1, col: 2, color: W },
        { row: 0, col: 3, color: B },
        { row: 1, col: 3, color: B },
        { row: 2, col: 0, color: B },
        { row: 2, col: 1, color: B },
        { row: 2, col: 2, color: B },
      ],
      highlight: [{ row: 0, col: 1 }],
    },
  },
  {
    id: 'false-eyes',
    name: 'False Eyes',
    tier: 'extended',
    linkPrompt: 'Real eye or fake?',
    short: "A false eye LOOKS like an eye, but enemy stones poke its corners. Sooner or later you'll have to fill it — so it doesn't count toward the two eyes a group needs.",
    related: ['two-eyes', 'life-and-death'],
    // fp 03 §A: THE classic kid trap ("I have two eyes!" — one is false and
    // the group dies). Real-vs-false side by side.
    examples: [
      {
        caption: 'A REAL eye: Black owns every point around it AND the corners. Safe.',
        size: 5,
        stones: [
          { row: 0, col: 1, color: B },
          { row: 1, col: 0, color: B },
          { row: 1, col: 1, color: B },
          { row: 2, col: 1, color: B },
          { row: 3, col: 0, color: B },
          { row: 3, col: 1, color: B },
        ],
        highlight: [
          { row: 0, col: 0 },
          { row: 2, col: 0 },
        ],
      },
      {
        caption: "A FALSE eye: White pokes the corners. Black will eventually have to fill this point — it's not a real eye.",
        size: 5,
        stones: [
          { row: 0, col: 1, color: B },
          { row: 1, col: 0, color: B },
          { row: 1, col: 2, color: B },
          { row: 2, col: 1, color: B },
          { row: 0, col: 2, color: W },
          { row: 2, col: 2, color: W },
        ],
        highlight: [{ row: 1, col: 1 }],
      },
    ],
  },
  {
    id: 'capture-races',
    name: 'Capture Races',
    tier: 'extended',
    linkPrompt: 'What are Capture Races?',
    short: "A capture race (semeai) is two groups racing to fill each other's liberties. Whoever runs out first dies.",
    related: ['liberties', 'life-and-death'],
  },
  {
    id: 'ko-fights',
    name: 'Ko Fights',
    tier: 'extended',
    short: "The back-and-forth battle over a ko, using threats elsewhere on the board to win the right to take it back.",
    related: ['ko-rule'],
  },
  {
    id: 'sente-gote',
    name: 'Sente & Gote',
    tier: 'extended',
    short: "Sente is a move your opponent must answer, so you keep the lead. Gote is when you have to answer. Keeping sente is powerful.",
    related: ['endgame', 'shape'],
  },
  {
    id: 'shape',
    name: 'Shape',
    tier: 'extended',
    short: "Good shape means stones that work efficiently together — strong and flexible. Bad shape is clumsy and easy to attack.",
    related: ['life-and-death', 'sente-gote'],
  },
  {
    id: 'endgame',
    name: 'Endgame',
    tier: 'extended',
    short: "The endgame (yose) is the last stage, settling borders. Small-looking moves decide close games.",
    related: ['territory-count', 'sente-gote'],
  },
  {
    id: 'joseki',
    name: 'Joseki',
    tier: 'extended',
    short: "Well-known corner sequences that give both sides a fair result. Patterns worth understanding, not memorizing blindly.",
    related: ['shape', 'midgame'],
  },
  {
    id: 'midgame',
    name: 'Midgame',
    tier: 'extended',
    short: "The big fight after the opening — attacking, defending, building, and invading across the whole board.",
    related: ['shape', 'capture-races'],
  },
  {
    id: 'komi',
    name: 'Komi',
    tier: 'extended',
    short: "Black plays first, which is a small head start. To keep things fair, White gets some bonus points at the end — that's komi (often 6.5 or 7.5). The .5 also means games can't end in a tie.",
    related: ['handicap', 'who-wins', 'territory-count'],
    // Komi is a number added to the score — no single position shows it well.
    example: null,
  },
  {
    id: 'handicap',
    name: 'Handicap',
    tier: 'extended',
    short: "When one player is stronger, the weaker player places a few stones before the game starts. These head-start stones — the handicap — turn an uneven game into a fair fight.",
    related: ['komi', 'placing-stones'],
    example: {
      // Two black handicap stones already on the board's star points (9×9).
      size: 9,
      stones: [
        { row: 2, col: 2, color: B },
        { row: 6, col: 6, color: B },
      ],
      highlight: [
        { row: 2, col: 2 },
        { row: 6, col: 6 },
      ],
    },
  },
];

/* ------------------------------------------------------------------------- *
 * Registry access.
 * ------------------------------------------------------------------------- */

export const CONCEPTS: ReadonlyArray<Concept> = [...CORE, ...EXTENDED];

export const CORE_CONCEPTS: ReadonlyArray<Concept> = CORE;
export const EXTENDED_CONCEPTS: ReadonlyArray<Concept> = EXTENDED;

const BY_ID: ReadonlyMap<string, Concept> = new Map(CONCEPTS.map((c) => [c.id, c]));

export function getConcept(id: string): Concept | undefined {
  return BY_ID.get(id);
}

/** True when `id` names a real concept — for `ConceptLink` to fail loudly in dev. */
export function isConceptId(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Concept → lesson(s) that teach it. Lesson ids are the `id`s in `lessons.ts`.
 * Kept as a central map (rather than a field on every concept) so the
 * relationship is editable in one place as lessons are reworked. The glossary
 * uses this to offer "do the lesson" on a concept page (fp 29).
 */
// Aligned with each lesson's primary `conceptId` (lessons.ts): a concept's
// "Do the lesson" launches the lessons named after it. Secondary concepts
// (liberties, suicide-rule, who-wins) have no dedicated lesson yet, so their
// pages show no lesson button — they're taught inside the listed lessons.
export const LESSONS_FOR_CONCEPT: Readonly<Record<string, string[]>> = {
  'placing-stones': ['drop-first-stone'],
  capture: ['trap-one-stone'],
  groups: ['big-capture'],
  atari: ['save-your-team'],
  'two-eyes': ['capture-the-eye', 'two-eyes-uncapturable', 'safe-or-gone', 'two-eyes-puzzles'],
  'territory-count': ['count-your-land'],
  'capture-races': ['capture-race-9x9'],
  // Advanced lessons (fp 03 §B) — also surfaced by the advanced-lessons menu.
  'ko-rule': ['ko-lesson'],
  ladders: ['ladder-lesson'],
  nets: ['net-lesson'],
  snapback: ['snapback-lesson'],
};

/** The first lesson id that teaches `conceptId`, or undefined if none. */
export function firstLessonForConcept(conceptId: string): string | undefined {
  return LESSONS_FOR_CONCEPT[conceptId]?.[0];
}
