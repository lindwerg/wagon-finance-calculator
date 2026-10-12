import { build } from 'esbuild';

await build({
  entryPoints: ['app.mjs'],
  outfile: 'calculator.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  sourcemap: false,
});
