import ELKApi from "elkjs/lib/elk-api.js";
import type { ELK } from "elkjs/lib/elk-api";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";

/**
 * ELK running in a web worker, so a large layered layout never blocks pan and zoom. The worker
 * script ships with elkjs; Vite serves it as an asset.
 */
export function createElkInWorker(): ELK {
  return new ELKApi({
    workerFactory: () => new Worker(elkWorkerUrl),
  });
}
