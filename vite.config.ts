import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { sveltePhosphorOptimize } from 'phosphor-svelte/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.PUBLIC_BACKEND_URL || 'http://localhost:2999';

  return {
    plugins: [sveltekit(), sveltePhosphorOptimize()],
    ssr: {
      noExternal: ['@tanstack/svelte-query']
    },
    server: {
      port: 5173,
      strictPort: false,
      // Proxy /api/* al backend Audiorr en dev — evita CORS del browser.
      // En prod el frontend va detrás del mismo dominio (Docker/reverse proxy).
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true
        }
      }
    }
  };
});
