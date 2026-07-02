import { describe, it, expect, beforeEach, vi } from 'vitest';

// answerQuiz touches the audio layer (resumeAudio + effect sounds); node has
// no AudioContext, so stub the whole SoundManager.
vi.mock('../../audio/SoundManager', () => ({
  resumeAudio: () => {},
  playPlaceSound: () => {},
  playCaptureSound: () => {},
  playTwoEyesSound: () => {},
}));

import { useLearnStore } from '../learnStore';
import { LESSONS } from '../../learn/lessons';

/**
 * Quiz wrong-answer retry (fp 03 §D, from the 7yo playtest 2026-06-27):
 * a wrong answer must re-open the SAME question with the hint applied —
 * never dead-end into "Next question". Scoring counts first-try corrects
 * only, so a retried-into-correct question doesn't inflate the tally.
 */

// Resolve the first quiz lesson + its answer indices at runtime so the test
// survives curriculum reordering.
const quizIndex = LESSONS.findIndex((l) => l.kind === 'quiz' && !!l.questions?.length);
const quiz = LESSONS[quizIndex];
const q0 = quiz.questions![0];
const correctIdx = q0.answers.findIndex((a) => a.correct);
const wrongIdx = q0.answers.findIndex((a) => !a.correct);

describe('learnStore — quiz wrong-answer retry', () => {
  beforeEach(() => {
    useLearnStore.getState().exit();
    useLearnStore.getState().start();
    useLearnStore.getState().startLesson(quizIndex);
  });

  it('found a quiz lesson with both a correct and a wrong answer', () => {
    expect(quizIndex).toBeGreaterThanOrEqual(0);
    expect(correctIdx).toBeGreaterThanOrEqual(0);
    expect(wrongIdx).toBeGreaterThanOrEqual(0);
  });

  it('wrong answer surfaces feedback but stays on the same question', () => {
    useLearnStore.getState().answerQuiz(wrongIdx);
    const s = useLearnStore.getState();
    expect(s.quizFeedback?.correct).toBe(false);
    expect(s.quizIndex).toBe(0);
    expect(s.quizCorrect).toBe(0);
    expect(s.quizMissedCurrent).toBe(true);
  });

  it('retryQuiz re-opens the same question, ready to answer again', () => {
    useLearnStore.getState().answerQuiz(wrongIdx);
    useLearnStore.getState().retryQuiz();
    const s = useLearnStore.getState();
    expect(s.quizFeedback).toBeNull();
    expect(s.quizIndex).toBe(0);
    expect(s.status).toBe('awaiting'); // answers accepted again
  });

  it('retried-into-correct does not score; question then advances normally', () => {
    useLearnStore.getState().answerQuiz(wrongIdx);
    useLearnStore.getState().retryQuiz();
    useLearnStore.getState().answerQuiz(correctIdx);
    const s = useLearnStore.getState();
    expect(s.quizFeedback?.correct).toBe(true); // advance button now available
    expect(s.quizCorrect).toBe(0); // first-try only

    // killMove questions detour through an 'animating' timeout before the
    // feedback modal; only advance immediately when feedback is already up.
    if (s.quizFeedback) {
      useLearnStore.getState().advanceQuiz();
      if (quiz.questions!.length > 1) {
        const after = useLearnStore.getState();
        expect(after.quizIndex).toBe(1);
        expect(after.quizMissedCurrent).toBe(false); // reset for the next question
      }
    }
  });

  it('first-try correct still scores', () => {
    useLearnStore.getState().answerQuiz(correctIdx);
    // killMove demos defer the score bump into a timeout; only assert the
    // synchronous path (non-killMove questions score immediately).
    if (!q0.killMove) {
      expect(useLearnStore.getState().quizCorrect).toBe(1);
    }
  });
});
