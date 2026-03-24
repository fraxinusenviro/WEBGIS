import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // Allow @mapbox/mapbox-gl-draw to work with MapLibre GL JS
      'mapbox-gl': 'maplibre-gl',
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      external: ['assert'],
    },
  },
  optimizeDeps: {
    exclude: ['sql.js'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  assetsInclude: ['**/*.wasm'],
});
