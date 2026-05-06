import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // KaTeX is huge (~250KB) and only needed when math is rendered.
          katex: ['katex'],
          // Markdown stack — split out so the main bundle stays small and
          // the markdown chunk caches independently across deploys.
          markdown: ['marked', 'dompurify', 'remend'],
          // React + ReactDOM rarely change; pin to their own vendor chunk.
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
});
