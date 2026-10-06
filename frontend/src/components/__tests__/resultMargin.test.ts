/**
 * Every place a finished game prints its margin: the end cards and the
 * compact end panels of a custom game, a ranked (auto-play) game and a
 * lesson game. A margin of exactly 1 is "1 point" ("1 pt" in a panel);
 * every other margin, the half points included, stays plural.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

vi.mock('../../audio/SoundManager', () => ({
  playPlaceSound: vi.fn(),
  playCaptureSound: vi.fn(),
  playPassSound: vi.fn(),
  playGameEndSound: vi.fn(),
  playTwoEyesSound: vi.fn(),
  resumeAudio: vi.fn(),
}));

import { useGameStore } from '../../store/gameStore';
import { Color } from '../../engine/types';
import { GameEndModal, GameEndPanel } from '../GameEndModal';
import { AutoPlayGameEndModal, AutoPlayGameEndPanel } from '../AutoPlayGameEndModal';
import { LessonGameEndModal, LessonGameEndPanel } from '../LessonGameEndModal';

type Kind = 'custom' | 'ranked' | 'lesson';

/** Server rendering reads a store's initial state, so the state a card
 *  shows is written there too. */
function seed(patch: Partial<ReturnType<typeof useGameStore.getState>>) {
  Object.assign(useGameStore.getInitialState(), patch);
  useGameStore.setState(patch);
}

/** A finished game Black won by `margin` (0: by resignation), the player Black. */
function finish(kind: Kind, margin: number) {
  const resigned = margin === 0;
  seed({
    phase: 'finished',
    gameId: 'abcd1234',
    gameMode: 'ai',
    playerColor: Color.Black,
    lessonContext: kind === 'lesson',
    autoplayContext: kind === 'ranked',
    gameEndDismissed: false,
    lessonGameEndDismissed: false,
    result: {
      winner: Color.Black,
      blackScore: resigned ? 0 : 20 + margin,
      whiteScore: resigned ? 0 : 20,
      blackTerritory: resigned ? 0 : 18 + margin,
      whiteTerritory: resigned ? 0 : 12,
      blackCaptures: resigned ? 0 : 2,
      whiteCaptures: resigned ? 0 : 1,
      komi: resigned ? 0 : 7,
    },
  });
}

const noop = () => {};
const text = (c: FunctionComponent<never>, props: object = {}) =>
  renderToStaticMarkup(createElement(c as FunctionComponent<object>, props)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const cards: Array<[Kind, string, () => string]> = [
  ['custom', 'end card', () => text(GameEndModal, { onQuit: noop })],
  ['custom', 'end panel', () => text(GameEndPanel)],
  ['ranked', 'end card', () => text(AutoPlayGameEndModal, { onNextMatch: noop, onHome: noop })],
  ['ranked', 'end panel', () => text(AutoPlayGameEndPanel)],
  ['lesson', 'end card', () => text(LessonGameEndModal, { onMoveOn: noop })],
  ['lesson', 'end panel', () => text(LessonGameEndPanel)],
];

beforeEach(() => {
  seed({ result: null, phase: 'playing' });
});

describe('the margin a finished game prints', () => {
  for (const [kind, where, render] of cards) {
    const short = where === 'end panel';
    it(`${kind} ${where}: a margin of 1 is singular`, () => {
      finish(kind, 1);
      const html = render();
      expect(html).toContain(short ? 'by 1 pt ' : '1 point');
      expect(html).not.toMatch(/\b1 (points|pts)\b/);
    });

    it(`${kind} ${where}: whole and half-point margins stay plural`, () => {
      for (const [margin, shown] of [[1.5, '1.5'], [0.5, '0.5'], [8, '8'], [2, '2']] as const) {
        finish(kind, margin);
        expect(render()).toContain(short ? `by ${shown} pts` : `${shown} points`);
      }
    });

    it(`${kind} ${where}: a resignation names no margin`, () => {
      finish(kind, 0);
      const html = render();
      expect(html).toMatch(/resignation/);
      expect(html).not.toMatch(/\b(points?|pts?)\b/);
    });
  }

  it('the custom end card says the margin in a sentence', () => {
    finish('custom', 1);
    expect(text(GameEndModal, { onQuit: noop })).toContain('Final margin: 1 point ');
  });

  it('the ranked end card names the winner', () => {
    finish('ranked', 1);
    expect(text(AutoPlayGameEndModal, { onNextMatch: noop, onHome: noop })).toContain('Black won by 1 point ');
  });

  it('the lesson end card, won and lost', () => {
    finish('lesson', 1);
    expect(text(LessonGameEndModal, { onMoveOn: noop })).toContain('You won by 1 point. Nice game!');
    seed({ playerColor: Color.White });
    expect(text(LessonGameEndModal, { onMoveOn: noop })).toContain('The bot won by 1 point — try again!');
  });
});
