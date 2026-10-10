import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // the PWA talks to the api through the same origin in production
      '/api': 'http://localhost:3000',
    },
    watch: {
      // Windows: editors (and some agents) create short-lived `*.tmpdir` folders next to the
      // file they edit. Watching those crashes the dev server with EBUSY and kills the process
      // mid-edit -- which is exactly what happened to lane C on 2026-10-10. Ignore them.
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/node_modules/**', '**/dist/**'],
    },
  },
});