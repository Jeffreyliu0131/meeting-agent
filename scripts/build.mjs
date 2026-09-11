import { build } from 'esbuild';
await build({
  entryPoints: {
    main: 'src/desktop/main.ts',
    preload: 'src/desktop/preload.ts',
    worker: 'src/service/worker.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'node:sqlite'],
  sourcemap: true,
});
