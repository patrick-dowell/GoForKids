/// <reference types="vite/client" />

/** Build timestamp injected by vite.config.ts `define` — logged in every
 *  game's selector-log start header to expose stale-bundle builds. */
declare const __BUILD_TS__: string;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BETA_PASSWORD?: string;
  readonly VITE_FEEDBACK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
