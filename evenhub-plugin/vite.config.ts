import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const appJson = JSON.parse(readFileSync('./app.json', 'utf-8'));

export default defineConfig({
  base: './',
  define: {
    // Stamped at build time so every .ehpk's setup/status screens show
    // exactly which version + when this bundle was packed.
    __APP_VERSION__: JSON.stringify(appJson.version),
    __BUILD_TIME_ISO__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});
