import { Worker } from 'node:worker_threads';
export class CodecPool {
  constructor(size = 2, timeout = 4000) { this.slots = Array.from({ length: size }, () => ({ worker: null, busy: false })); this.timeout = timeout; }
  run(bytes) {
    const slot = this.slots.find(s => !s.busy);
    if (!slot) return Promise.reject(Error('BUSY'));
    slot.busy = true;
    return new Promise((resolve, reject) => {
      let worker = slot.worker, timer;
      const finish = (error, output, terminate = false) => {
        clearTimeout(timer);
        worker.removeAllListeners('message'); worker.removeAllListeners('error'); worker.removeAllListeners('exit');
        if (terminate) { slot.worker = null; worker.terminate().catch(() => {}); } else worker.unref();
        slot.busy = false;
        if (error) reject(error); else resolve(output);
      };
      if (!worker) { worker = new Worker(new URL('./job.mjs', import.meta.url)); slot.worker = worker; }
      worker.ref();
      timer = setTimeout(() => finish(Error('TIMEOUT'), null, true), this.timeout);
      worker.on('message', msg => { if (msg.ready) return; if (!msg.ok) finish(Error('INVALID_IMAGE')); else finish(null, new Uint8Array(msg.bytes)); });
      worker.on('error', () => finish(Error('INVALID_IMAGE'), null, true));
      worker.on('exit', () => finish(Error('INVALID_IMAGE'), null, true));
      const data = Uint8Array.from(bytes);
      worker.postMessage(data, [data.buffer]);
    });
  }
  async close() { await Promise.all(this.slots.map(async s => { if (s.worker) { s.worker.removeAllListeners(); await s.worker.terminate(); } })); }
}
