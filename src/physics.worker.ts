import loadMujoco from '@mujoco/mujoco';
import wasmUrl from '@mujoco/mujoco/mujoco.wasm?url';
import { createRuntimeHandler, type Request, type Response } from './runtime/protocol';
const scope = self as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage: (response: Response, transfer: Transferable[]) => void };
const handle = createRuntimeHandler(
  () => loadMujoco({ locateFile: (file: string) => file.endsWith('.wasm') ? wasmUrl : file }),
  response => {
    const transfer: Transferable[] = response.display ? Object.values(response.display.fields).map(value => value.buffer as ArrayBuffer) : [];
    if (response.display?.integration) transfer.push(response.display.integration.values.buffer as ArrayBuffer);
    scope.postMessage(response, transfer);
  },
);
scope.onmessage = event => { void handle(event.data); };
