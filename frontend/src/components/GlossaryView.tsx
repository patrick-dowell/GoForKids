import {
  CORE_CONCEPTS,
  EXTENDED_CONCEPTS,
  getConcept,
  firstLessonForConcept,
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

  // Optional depth: if a lesson teaches this concept, offer it (pull, not push).
  const lessonId = firstLessonForConcept(concept.id);
  const lessonIndex = lessonId ? LESSONS.findIndex((l) => l.id === lessonId) : -1;
  const doLesson = () => {
    if (lessonIndex < 0) return;
    close();
    useLearnStore.getState().resumeAt(lessonIndex);
  };

  return (
    <div className="glossary-concept">
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

      {/* Optional depth, below the fold of attention. */}
      {lessonIndex >= 0 && (
        <button className="glossary-lesson-btn" onClick={doLesson}>
          📘 Do the lesson
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
    </div>
  );
}
