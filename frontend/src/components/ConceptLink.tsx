import { getConcept } from '../learn/concepts';
import { useGlossaryStore } from '../store/glossaryStore';
import './ConceptLink.css';

interface ConceptLinkProps {
  /** Concept id from the registry, e.g. 'atari'. */
  id: string;
  /** Link text. Defaults to the concept's display name. */
  children?: React.ReactNode;
}

/**
 * Wraps a concept term anywhere in the app (lessons, the Play-of-the-Game
 * review, tooltips, glossary cross-refs) and opens that concept's glossary
 * page on tap (fp 29). Pull, not push — it's an offer to understand, never a
 * forced detour.
 *
 * If `id` isn't a real concept, renders plain text (and warns in dev) rather
 * than a dead link.
 */
export function ConceptLink({ id, children }: ConceptLinkProps) {
  const openConcept = useGlossaryStore((s) => s.openConcept);
  const concept = getConcept(id);

  if (!concept) {
    if (import.meta.env.DEV) console.warn(`[ConceptLink] unknown concept id "${id}"`);
    return <span>{children}</span>;
  }

  return (
    <button
      type="button"
      className="concept-link"
      onClick={() => openConcept(id)}
      aria-label={`What is ${concept.name}?`}
    >
      {children ?? concept.name}
    </button>
  );
}
