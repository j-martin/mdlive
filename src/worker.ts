import { start, type StartConfig } from './start';

declare const self: Worker;

export type WorkerMessage = { type: 'ready'; url: string; fileLabel: string } | { type: 'error'; message: string };

self.onmessage = async (event: MessageEvent<StartConfig>) => {
  try {
    const app = await start(event.data);
    self.postMessage({ type: 'ready', url: app.url, fileLabel: app.fileLabel } satisfies WorkerMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', message } satisfies WorkerMessage);
  }
};
