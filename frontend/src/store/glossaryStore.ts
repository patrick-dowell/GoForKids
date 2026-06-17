import { create } from 'zustand';

/**
 * Tiny store driving the glossary overlay (fp 29). Lets `ConceptLink` open the
 * glossary to a specific concept from ANYWHERE in the app without prop-drilling
 * — App mounts `<GlossaryView />` once at the top level and it reacts to this.
 *
 * `openId` is the concept currently shown; null with `isOpen` true shows the
 * browsable index; `isOpen` false hides the overlay entirely.
 */
interface GlossaryState {
  isOpen: boolean;
  /** The concept id being viewed, or null for the index. */
  openId: string | null;
  /** Open straight to a concept's page. */
  openConcept: (id: string) => void;
  /** Open the browsable concept index. */
  openIndex: () => void;
  /** Navigate within the open glossary (concept ↔ concept, or back to index). */
  goTo: (id: string | null) => void;
  close: () => void;
}

export const useGlossaryStore = create<GlossaryState>((set) => ({
  isOpen: false,
  openId: null,
  openConcept: (id: string) => set({ isOpen: true, openId: id }),
  openIndex: () => set({ isOpen: true, openId: null }),
  goTo: (id: string | null) => set({ openId: id }),
  close: () => set({ isOpen: false, openId: null }),
}));
