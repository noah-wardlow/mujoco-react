import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['tests/runtime.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: '.test-dist',
  external: ['@mujoco/mujoco', 'three'],
  removeNodeProtocol: false,
});
