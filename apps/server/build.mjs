// Bundle the server (and the @cricstudio/* workspace TS packages) into plain ESM for production.
// npm dependencies stay external and are loaded from node_modules at runtime.
import { readFileSync } from 'node:fs';
import { build, context } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})].filter((d) => !d.startsWith('@cricstudio/'));

const options = {
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
};

if (process.argv.includes('--watch')) {
  // dev: rebuild on change; `node --watch dist/index.js` restarts the server
  const ctx = await context(options);
  await ctx.watch();
  console.log('esbuild watching src → dist/index.js');
} else {
  await build(options);
  console.log('server bundled → dist/index.js');
}
