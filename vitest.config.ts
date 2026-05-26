import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// Pure-logic unit tests live next to the source files as `<name>.test.ts`.
// Node environment is enough — DJMixingService has no DOM dependency. If we
// later add component tests we'll switch to `environment: 'jsdom'` and add
// the @testing-library/svelte dep.
export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
});
