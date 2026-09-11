import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    rollupOptions: { input: { main: 'index.html', capture: 'capture.html' } },
  },
});
