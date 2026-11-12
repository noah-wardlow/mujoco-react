import { parentPort } from 'node:worker_threads';
import loadMujoco from '@mujoco/mujoco';
import { createRuntimeHandler } from '../src/runtime/protocol';
const handle = createRuntimeHandler(loadMujoco, response => parentPort!.postMessage(response));
parentPort!.on('message', request => { void handle(request); });
