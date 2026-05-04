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
 */

import b28Yaml from '../../../data/profiles/b28.yaml';

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
  save_atari_chance?: number;
  capture_chance?: number;
  use_katago?: boolean;
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

function load(yaml: unknown): ProfileTable {
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

  if (!(19 in out) || !(FALLBACK_RANK in out[19])) {
    throw new Error(`19x19/${FALLBACK_RANK} profile is required as the universal fallback`);
  }
  return out;
}

const TABLE: ProfileTable = load(b28Yaml);

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
