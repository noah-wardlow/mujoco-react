#!/usr/bin/env node
process.argv.splice(2, 0, 'codegen');
await import('./mujoco-react.mjs');
