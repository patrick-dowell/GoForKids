import { useEffect, useRef } from 'react';
import {
  CONCEPTS,
  CORE_CONCEPTS,
  EXTENDED_CONCEPTS,
  getConcept,
  LESSONS_FOR_CONCEPT,
  type Concept,
} from '../learn/concepts';
import { LESSONS } from '../learn/lessons';
import { useGlossaryStore } from '../store/glossaryStore';
import { useLearnStore } from '../store/learnStore';
import { DiagramBoard } from './DiagramBoard';
import './GlossaryView.css';

/**
 * The glossary overlay (fp 29). Mounted once at the App top level; shows
 * whenever `glossaryStore.isOpen`. Two modes: the browsable index, or a single
 * concept page. Concept pages lead with the 5-second answer + diagram, then
 * offer optional depth below — glanceable by default, deep on demand, never
 * forced.
 */
export function GlossaryView() {
  const isOpen = useGlossaryStore((s) => s.isOpen);
  const openId = useGlossaryStore((s) => s.openId);
  const close = useGlossaryStore((s) => s.close);

  if (!isOpen) return null;

  const concept = openId ? getConcept(openId) : null;

  return (
    <div className="glossary-overlay" role="dialog" aria-modal="true" onClick={close}>
      <div className="glossary-panel" onClick={(e) => e.stopPropagation()}>
        <button className="glossary-close" onClick={close} aria-label="Close glossary">
          ×
        </button>
        {concept ? <ConceptPage concept={concept} /> : <GlossaryIndex />}
      </div>
    </div>
  );
}

function GlossaryIndex() {
  const goTo = useGlossaryStore((s) => s.goTo);
  return (
    <div className="glossary-index">
      <h1 className="glossary-title">Go Glossary</h1>
      <p className="glossary-subtitle">Tap anything to learn what it means. No rush — it's here when you want it.</p>

      <h2 className="glossary-section-head">The basics</h2>
      <div className="glossary-grid">
        {CORE_CONCEPTS.map((c) => (
          <button key={c.id} className="glossary-card" onClick={() => goTo(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      <h2 className="glossary-section-head">Going deeper</h2>
      <div className="glossary-grid">
        {EXTENDED_CONCEPTS.map((c) => (
          <button key={c.id} className="glossary-card glossary-card-extended" onClick={() => goTo(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConceptPage({ concept }: { concept: Concept }) {
  const goTo = useGlossaryStore((s) => s.goTo);
  const close = useGlossaryStore((s) => s.close);

  // Sequential navigation (Patrick, 2026-07-02): flip through concepts like
  // pages — prev/next buttons, swipe left/right, arrow keys — instead of
  // bouncing back to the index every time. Order = the index order
  // (basics first, then going-deeper); no wrap at the ends.
  const conceptIdx = CONCEPTS.findIndex((c) => c.id === concept.id);
  const prevConcept = conceptIdx > 0 ? CONCEPTS[conceptIdx - 1] : null;
  const nextConcept =
    conceptIdx >= 0 && conceptIdx < CONCEPTS.length - 1 ? CONCEPTS[conceptIdx + 1] : null;

  const pageRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Horizontal must clearly dominate so vertical panel-scrolling never
    // accidentally flips the page.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && nextConcept) goTo(nextConcept.id);
    else if (dx > 0 && prevConcept) goTo(prevConcept.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && nextConcept) goTo(nextConcept.id);
      else if (e.key === 'ArrowLeft' && prevConcept) goTo(prevConcept.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concept.id]);

  // New concept → start reading from the top (the panel is the scroller).
  useEffect(() => {
    pageRef.current?.closest('.glossary-panel')?.scrollTo({ top: 0 });
  }, [concept.id]);

  // Optional depth: if lessons teach this concept, offer them (pull, not push).
  // Launches them as a focused set that returns here when finished.
  const lessonIndices = (LESSONS_FOR_CONCEPT[concept.id] ?? [])
    .map((id) => LESSONS.findIndex((l) => l.id === id))
    .filter((i) => i >= 0);
  const hasLesson = lessonIndices.length > 0;
  const doLesson = () => {
    if (!hasLesson) return;
    close();
    useLearnStore.getState().startConceptLessons(lessonIndices, concept.id);
  };

  return (
    <div className="glossary-concept" ref={pageRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button className="glossary-back" onClick={() => goTo(null)}>
        ← All concepts
      </button>

      {/* The 5-second answer, up front. */}
      <h1 className="glossary-concept-name">{concept.name}</h1>
      <p className="glossary-concept-short">{concept.short}</p>

      {concept.example && (
        <div className="glossary-diagram-wrap">
          <DiagramBoard
            size={concept.example.size}
            stones={concept.example.stones}
            highlight={concept.example.highlight}
            px={200}
          />
        </div>
      )}

      {/* Additional captioned diagrams — for concepts one picture can't carry
          (real vs false eyes, a group's shared liberties vs a corner stone). */}
      {concept.examples?.map((ex, i) => (
        <div key={i} className="glossary-diagram-wrap glossary-diagram-captioned">
          <DiagramBoard size={ex.size} stones={ex.stones} highlight={ex.highlight} px={200} />
          <p className="glossary-diagram-caption">{ex.caption}</p>
        </div>
      ))}

      {/* Optional depth, below the fold of attention. */}
      {hasLesson && (
        <button className="glossary-lesson-btn" onClick={doLesson}>
          📘 {lessonIndices.length > 1 ? 'Do the lessons' : 'Do the lesson'}
        </button>
      )}

      {concept.related && concept.related.length > 0 && (
        <div className="glossary-related">
          <span className="glossary-related-label">See also</span>
          <div className="glossary-related-chips">
            {concept.related.map((rid) => {
              const r = getConcept(rid);
              if (!r) return null;
              return (
                <button key={rid} className="glossary-chip" onClick={() => goTo(rid)}>
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Page-flip navigation: prev bottom-left, next bottom-right (swipe and
          arrow keys do the same). */}
      <div className="glossary-nav">
        {prevConcept ? (
          <button className="glossary-nav-btn" onClick={() => goTo(prevConcept.id)}>
            ← {prevConcept.name}
          </button>
        ) : (
          <span />
        )}
        <span className="glossary-nav-count">
          {conceptIdx + 1} / {CONCEPTS.length}
        </span>
        {nextConcept ? (
          <button className="glossary-nav-btn glossary-nav-next" onClick={() => goTo(nextConcept.id)}>
            {nextConcept.name} →
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
