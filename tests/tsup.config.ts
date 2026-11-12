import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['tests/runtime.ts', 'tests/simulation-runtime.ts', 'tests/runtime-worker.ts', 'tests/camera-capture.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: '.test-dist',
  external: ['@mujoco/mujoco', 'three'],
  removeNodeProtocol: false,
});
