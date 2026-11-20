// Runs the runtime suite against every supported @mujoco/mujoco release.
// Usage: npm run test:engines [-- 3.11.0 4.0.1]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep in sync with the supported range in docs/installation.mdx.
const supported = ['3.8.1', '3.9.0', '3.10.0', '3.11.0', '3.12.0', '3.13.0', '3.14.0', '3.15.0', '3.16.0', '3.17.0', '4.0.0', '4.0.1'];
const versions = process.argv.length > 2 ? process.argv.slice(2) : supported;
const suites = ['runtime', 'simulation-runtime', 'camera-capture', 'classic-appearance'].map((name) => `.test-dist/${name}.js`);
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

run('npx', ['tsup', '--config', 'tests/tsup.config.ts']);
const failed = [];
for (const version of versions) {
  // The suite resolves @mujoco/mujoco next to .test-dist, so each engine gets its own copy.
  const dir = resolve('node_modules/.cache/mujoco-engines', version);
  if (!existsSync(resolve(dir, 'node_modules/@mujoco/mujoco'))) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'package.json'), '{"private":true}');
    run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', `@mujoco/mujoco@${version}`], dir);
    symlinkSync(resolve('node_modules/three'), resolve(dir, 'node_modules/three'));
  }
  rmSync(resolve(dir, '.test-dist'), { recursive: true, force: true });
  cpSync('.test-dist', resolve(dir, '.test-dist'), { recursive: true });
  console.log(`\n# @mujoco/mujoco ${version}`);
  try { run('node', ['--test', ...suites], dir); } catch { failed.push(version); }
}
if (failed.length) {
  console.error(`\nRuntime suite failed on @mujoco/mujoco ${failed.join(', ')}`);
  process.exit(1);
}
