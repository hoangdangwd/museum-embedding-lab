import { parentPort } from 'node:worker_threads';
import { normalize } from './codec.mjs';
parentPort.on('message', async bytes => {
  try {
    const output = await normalize(new Uint8Array(bytes));
    parentPort.postMessage({ ok: true, bytes: output }, [output.buffer]);
  } catch { parentPort.postMessage({ ok: false }); }
});
parentPort.postMessage({ ready: true });
