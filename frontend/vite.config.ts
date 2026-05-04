/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import yaml from '@rollup/plugin-yaml'

export default defineConfig({
  // YAML plugin compiles `import x from './foo.yaml'` into a module that
  // exports the parsed object — used by frontend/src/ai/profileLoader.ts
  // to load data/profiles/*.yaml at build time. Listed first so .yaml
  // imports resolve before react()'s JSX pipeline ever sees them.
  plugins: [yaml(), react()],
  server: {
    fs: {
      // Bot rank profile YAMLs live at <repo>/data/profiles/, outside the
      // frontend/ root. profileLoader.ts imports them at build time so the
      // single source of truth is shared across web (Render) and iPad.
      allow: ['..'],
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
