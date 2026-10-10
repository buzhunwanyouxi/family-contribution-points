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
  },
});