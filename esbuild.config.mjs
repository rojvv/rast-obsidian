import * as esbuild from 'esbuild';
const watch = process.argv.includes('--watch');
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outfile: 'main.js',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  banner: { js: '/* Rast for Obsidian | MIT License */' },
});
if (watch) await context.watch();
else { await context.rebuild(); await context.dispose(); }
