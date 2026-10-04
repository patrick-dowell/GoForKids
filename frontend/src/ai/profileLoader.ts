/**
 * Bot rank profile loader — TypeScript port of backend/app/ai/profile_loader.py.
 *
 * Profiles are YAML in data/profiles/, imported at build time via
 * @rollup/plugin-yaml. Single source of truth: the same files Render's Python
 * backend reads at runtime ship inside the iPad's frontend bundle. Edit
 * `data/profiles/b28.yaml` once, both platforms pick it up on next build.
 *
 * Lookup semantics match the Python: get_profile(rank, size) falls back to
 * 19x19's profile for that rank if the size has no explicit override; falls
 * back further to 19x19/15k as a last resort.
 *
 * The iPad currently uses b28 because that's the network bundled in the
 * CoreML model file. (Render uses b20 — see DEVJOURNAL Session 12 for why.)
 *
 * A second, smaller table, `data/profiles/b28_human.yaml`, holds the rungs
 * that play on the human SL path on the device (getHumanProfile). Same file
 * shape, its own lookup: exact (rank, size) only, no fallback, because a rank
 * without a human rung plays from b28.yaml as it always has.
 */

import b28Yaml from '../../../data/profiles/b28.yaml';
import b28HumanYaml from '../../../data/profiles/b28_human.yaml';

/** Profile knobs read by moveSelector.ts. Mirrors the Python validator's
 *  REQUIRED_KEYS + OPTIONAL_KEYS. Optional fields use `?` so callers must
 *  treat them as possibly undefined and apply their own defaults. */
export interface RankProfile {
  // Required — moveSelector.ts reads these without defaults.
  max_point_loss: number;
  mistake_freq: number;
  policy_weight: number;
  randomness: number;
  random_move_chance: number;
  local_bias: number;
  first_line_chance: number;
  visits: number;
  min_candidates: number;
  opening_moves: number;

  // Optional — moveSelector.ts reads these with defaults.
  pass_threshold?: number;
  clarity_prior?: number;
  clarity_score_gap?: number;
  local_bias_in_opening?: boolean;
  /** When true, the local-bias branch plays a KataGo candidate near the
   *  anchor (myopic-but-real move) instead of a random legal point nearby.
   *  §3 9×9 retune, 2026-07-04. */
  local_bias_from_candidates?: boolean;
  /** Sigma (in points) of gaussian noise added to each candidate's scoreLead
   *  before an argmax pick. When > 0 this REPLACES the mistake_freq weighting
   *  and also noises the myopic local pick. §3 iter 2, 2026-07-04. */
  score_noise?: number;
  /** Fraction of moves the bot actually READS (full machinery). The rest are
   *  played on shape intuition: prior-sampled with `policy_temp` over the
   *  wideRootNoise-widened pool. §3 out-of-pool mechanism, 2026-07-05. */
  reading_rate?: number;
  /** Sampling temperature for no-reading moves (default 1.0). */
  policy_temp?: number;
  /** Attention lapse λ: fraction of sampling weight blended to uniform over
   *  the pool — makes the sampler MISS high-prior vital points, which
   *  temperature cannot do. Sampler v2, 2026-07-05. */
  sample_lapse?: number;
  /** Max points below the pool's best a sampled move may be. Kills the
   *  sharp-position coin-flip collapses; big blunders stay the job of
   *  random_move_chance. Sampler v2, 2026-07-05. */
  sample_loss_cap?: number;
  /** Min points below the pool's best a sampled move MUST be — unread moves
   *  are mildly imperfect BY CONSTRUCTION, never accidentally perfect. The
   *  b28 policy is dan-level on 9×9, so prior-sampling lands on the top
   *  move ~half the time without this; that free perfection was the floor
   *  every weakening attempt hit. Sampler v3 (S50, 2026-07-06). */
  sample_min_loss?: number;
  /** After a READ (engine-guided) move, force this many following moves
   *  onto the sampled path — a weak player doesn't produce several great
   *  moves in a row (Patrick's streak observation, S50). */
  read_cooldown?: number;
  /** KataGo wideRootNoise override for move-selection analyses — widens the
   *  candidate pool with real (scored) weaker moves. */
  wide_root_noise?: number;
  save_atari_chance?: number;
  capture_chance?: number;
  use_katago?: boolean;

  /** Human SL path knobs (backend move_selector._select_with_human_net; the
   *  TypeScript port is humanNetSelector.ts). On the device they are read
   *  from b28_human.yaml's rungs (getHumanProfile).
   *  `human_sl_profile` names the human net's rank profile, e.g. 'rank_20k';
   *  the rest tune that path and are read with the Python's defaults. */
  human_sl_profile?: string;
  human_tilt?: number;
  human_tilt_from?: number;
  human_cand_min?: number;
  human_cand_max?: number;
  human_score_visits?: number;
  human_pass_margin?: number;
  human_small_gain?: number;
  human_confirm_visits?: number;
  human_confirm_margin?: number;
  human_loss_cap?: number;
}

const REQUIRED_KEYS = [
  'max_point_loss',
  'mistake_freq',
  'policy_weight',
  'randomness',
  'random_move_chance',
  'local_bias',
  'first_line_chance',
  'visits',
  'min_candidates',
  'opening_moves',
] as const;

const SUPPORTED_SIZES = [5, 9, 13, 19] as const;
const FALLBACK_RANK = '15k';

type SizedTable = Record<string, RankProfile>;
type ProfileTable = Record<number, SizedTable>;

interface YamlShape {
  profiles: Record<string, Record<string, Record<string, unknown>>>;
}

/** "19x19" -> 19. Throws if malformed or non-square. */
function parseSizeKey(key: string): number {
  if (!key.includes('x')) {
    throw new Error(`board-size key '${key}' must look like '19x19'`);
  }
  const [a, b] = key.split('x', 2);
  if (a !== b) {
    throw new Error(`board-size key '${key}' must be square (NxN)`);
  }
  const size = parseInt(a, 10);
  if (Number.isNaN(size)) {
    throw new Error(`board-size key '${key}' must be numeric`);
  }
  return size;
}

/** Validates a single profile dict. Mirrors the Python _validate_profile. */
function validateProfile(where: string, raw: Record<string, unknown>): RankProfile {
  for (const k of REQUIRED_KEYS) {
    if (!(k in raw)) {
      throw new Error(`profile ${where} missing required key '${k}'`);
    }
    const v = raw[k];
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new Error(`profile ${where}.${k} must be a number, got ${typeof v}`);
    }
  }
  // Optional keys are passed through as-is — moveSelector.ts checks types
  // at the use site (with `??` defaults), so we don't need to enforce here.
  return raw as unknown as RankProfile;
}

/** A rung of the human set: the human path needs the human net's profile. */
export type HumanRankProfile = RankProfile & { human_sl_profile: string };

/** `requireFallback`: the standard table must carry 19x19/15k (getProfile's
 *  last resort); the human set has no fallback and need not. */
function load(yaml: unknown, requireFallback = true): ProfileTable {
  if (typeof yaml !== 'object' || yaml === null || !('profiles' in yaml)) {
    throw new Error("YAML must have a top-level 'profiles' key");
  }
  const shape = yaml as YamlShape;
  if (typeof shape.profiles !== 'object' || shape.profiles === null) {
    throw new Error("'profiles' must be a mapping");
  }

  const out: ProfileTable = {};
  for (const [sizeKey, ranks] of Object.entries(shape.profiles)) {
    const size = parseSizeKey(sizeKey);
    if (!(SUPPORTED_SIZES as readonly number[]).includes(size)) {
      throw new Error(
        `unsupported board size ${size}x${size} (allowed: ${SUPPORTED_SIZES.join(', ')})`,
      );
    }
    if (typeof ranks !== 'object' || ranks === null) {
      throw new Error(`profiles.${sizeKey} must be a mapping of rank -> profile`);
    }
    const sized: SizedTable = {};
    for (const [rank, profile] of Object.entries(ranks)) {
      sized[rank] = validateProfile(`${size}x${size}/${rank}`, profile);
    }
    out[size] = sized;
  }

  if (requireFallback && (!(19 in out) || !(FALLBACK_RANK in out[19]))) {
    throw new Error(`19x19/${FALLBACK_RANK} profile is required as the universal fallback`);
  }
  return out;
}

/** The human set: the standard checks, and every rung names its human net
 *  profile (a rung without one could not play on the human path). */
export function loadHumanTable(yaml: unknown): Record<number, Record<string, HumanRankProfile>> {
  const table = load(yaml, false);
  for (const [size, ranks] of Object.entries(table)) {
    for (const [rank, profile] of Object.entries(ranks)) {
      const name = profile.human_sl_profile;
      if (typeof name !== 'string' || name === '') {
        throw new Error(`human profile ${size}x${size}/${rank} must name its human_sl_profile`);
      }
    }
  }
  return table as Record<number, Record<string, HumanRankProfile>>;
}

const TABLE: ProfileTable = load(b28Yaml);
const HUMAN_TABLE = loadHumanTable(b28HumanYaml);

/**
 * Look up the bot tuning profile for a rank and board size. Falls back to
 * the 19x19 profile for the same rank if no size-specific override exists;
 * falls back further to 19x19/15k. Matches the Python `get_profile()`.
 */
export function getProfile(rank: string, size: number = 19): RankProfile {
  const sized = TABLE[size];
  if (sized && rank in sized) return sized[rank];
  const big = TABLE[19] ?? {};
  if (rank in big) return big[rank];
  return big[FALLBACK_RANK];
}

/**
 * The human-set rung for this rank and board size (b28_human.yaml), or
 * undefined when the human set has none. Exact match only: unlike
 * getProfile there is no fallback to another size or rank.
 */
export function getHumanProfile(rank: string, size: number): HumanRankProfile | undefined {
  const sized = HUMAN_TABLE[size];
  return sized && Object.prototype.hasOwnProperty.call(sized, rank) ? sized[rank] : undefined;
}
