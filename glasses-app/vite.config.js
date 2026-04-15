import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5174,
  },
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2015',
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/app.js',
        // No code splitting
        manualChunks: undefined,
      },
    },
    // Inline all CSS
    cssCodeSplit: false,
  },
});
