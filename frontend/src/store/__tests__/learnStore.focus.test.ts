import { describe, it, expect, beforeEach } from 'vitest';
import { useLearnStore } from '../learnStore';
import { useGlossaryStore } from '../glossaryStore';

/**
 * Focused glossary lessons (the "Do the lesson" button): play a concept's
 * lesson(s), then RETURN to the glossary concept page — instead of marching on
 * through the whole curriculum (Patrick's playtest fix, 2026-06-17).
 */
describe('learnStore — focused glossary lessons', () => {
  beforeEach(() => {
    useLearnStore.getState().exit();
    useGlossaryStore.getState().close();
  });

  it('advances within the focus set, then returns to the concept glossary page', () => {
    useLearnStore.getState().startConceptLessons([1, 2], 'capture');
    expect(useLearnStore.getState().active).toBe(true);
    expect(useLearnStore.getState().lessonIndex).toBe(1);

    useLearnStore.getState().next();
    expect(useLearnStore.getState().lessonIndex).toBe(2); // advanced WITHIN the set
    expect(useLearnStore.getState().active).toBe(true);

    useLearnStore.getState().next();
    // Set exhausted → exit the lesson view and reopen the glossary to 'capture'.
    expect(useLearnStore.getState().active).toBe(false);
    expect(useLearnStore.getState().focusLessons).toBeNull();
    expect(useGlossaryStore.getState().isOpen).toBe(true);
    expect(useGlossaryStore.getState().openId).toBe('capture');
  });

  it('a single-lesson concept returns after one lesson', () => {
    useLearnStore.getState().startConceptLessons([3], 'atari');
    expect(useLearnStore.getState().lessonIndex).toBe(3);

    useLearnStore.getState().next();
    expect(useLearnStore.getState().active).toBe(false);
    expect(useGlossaryStore.getState().openId).toBe('atari');
  });

  it('does not touch the normal curriculum: next() still does lessonIndex+1', () => {
    useLearnStore.getState().startLesson(0);
    useLearnStore.setState({ active: true, focusLessons: null, focusConcept: null });
    useLearnStore.getState().next();
    expect(useLearnStore.getState().lessonIndex).toBe(1);
    expect(useLearnStore.getState().focusLessons).toBeNull();
  });

  it('exit() clears focus state', () => {
    useLearnStore.getState().startConceptLessons([1, 2], 'capture');
    useLearnStore.getState().exit();
    expect(useLearnStore.getState().focusLessons).toBeNull();
    expect(useLearnStore.getState().focusConcept).toBeNull();
  });
});
