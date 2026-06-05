#!/usr/bin/env node
import { watch } from 'node:fs';
import path from 'node:path';
import { generateMujocoRegister } from '../dist/vite.js';

const usage = `
Usage:
  mujoco-react codegen <scene.xml> [...more.xml] [--out src/mujoco-register.gen.d.ts] [--watch]
  mujoco-react codegen franka=models/panda/scene.xml spot=models/spot/scene.xml

Vite users usually do not need this command. Prefer:

  import { mujocoReact } from "mujoco-react/vite";

  export default defineConfig({
    plugins: [mujocoReact({ models: { franka: "models/panda/scene.xml" } })],
  });
`;

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(usage.trim());
  process.exit(command ? 0 : 1);
}

if (command !== 'codegen') {
  console.error(`Unknown command: ${command}`);
  console.error(usage.trim());
  process.exit(1);
}

const commandArgs = args.slice(1);
const out = valueAfter(commandArgs, '--out') ?? 'src/mujoco-register.gen.d.ts';
const moduleName = valueAfter(commandArgs, '--module') ?? 'mujoco-react';
const shouldWatch = commandArgs.includes('--watch');
const models = commandArgs.filter((arg, index) => {
  if (arg.startsWith('--')) return false;
  const previous = commandArgs[index - 1];
  return previous !== '--out' && previous !== '--module';
});
const modelInput = parseModels(models);

if (!models.length) {
  console.error(usage.trim());
  process.exit(1);
}

let watchedFiles = [];
await generate();

if (shouldWatch) {
  console.log('[mujoco-react] watching model files...');
  let timer;
  const refreshWatchers = () => {
    for (const file of watchedFiles) {
      watch(file, { persistent: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          generate().catch((error) => {
            console.error('[mujoco-react] register generation failed');
            console.error(error);
          });
        }, 50);
      });
    }
  };
  refreshWatchers();
}

async function generate() {
  const result = await generateMujocoRegister({
    models: modelInput,
    out,
    moduleName,
    root: process.cwd(),
  });
  watchedFiles = result.files;
  const total = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
  console.log(`[mujoco-react] generated ${path.relative(process.cwd(), result.out)} (${total} names)`);
}

function parseModels(values) {
  if (values.every((value) => value.includes('='))) {
    return Object.fromEntries(values.map((value) => {
      const index = value.indexOf('=');
      return [value.slice(0, index), value.slice(index + 1)];
    }));
  }
  return values;
}

function valueAfter(values, flag) {
  const index = values.indexOf(flag);
  if (index === -1) return undefined;
  return values[index + 1];
}
