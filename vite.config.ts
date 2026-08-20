/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Honor PORT for harnesses (preview tool, CI) that assign ports via env.
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    // happy-dom is fast and covers what the lib tests need (DOM, WebCrypto
    // delegated to Node).
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
