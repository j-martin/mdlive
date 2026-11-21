#!/usr/bin/env bun
import * as Util from 'node:util';
import { parsePullRequestUrl } from './src/review';
import { start, type StartConfig } from './src/start';
import { openUrl } from './src/browser';
import type { WorkerMessage } from './src/worker';

const USAGE = `Usage: mdlive <file.md | pull request link> [options]

Render a Markdown file in a window, update it live, and show the git diff inline.
With a GitHub pull request link, show a Markdown file of the pull request to review it.

Options:
  --base <ref>     Git ref to compare with (default: HEAD). Example: --base master
  --file <path>    File of the pull request to show (default: its first Markdown file)
  --port <number>  HTTP port (default: random free port)
  --browser        Open the page in the default browser instead of a window
  --no-open        Do not open a window or a browser, only start the server
  --help           Show this help`;

type Display = 'window' | 'browser' | 'none';

type Options = {
  config: StartConfig;
  display: Display;
};

const parseOptions = (): Options => {
  const { values, positionals } = Util.parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      base: { type: 'string', default: 'HEAD' },
      file: { type: 'string' },
      port: { type: 'string', default: '0' },
      browser: { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (positionals.length !== 1) {
    console.error(USAGE);
    process.exit(1);
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid port "${values.port}"`);
  }
  const display: Display = values['no-open'] ? 'none' : values.browser ? 'browser' : 'window';
  const target = positionals[0];
  const config: StartConfig = parsePullRequestUrl(target)
    ? { kind: 'pull-request', url: target, file: values.file ?? null, port }
    : { kind: 'file', file: target, base: values.base, port };
  return { config, display };
};

const fail = (message: string): never => {
  console.error(`mdlive: ${message}`);
  process.exit(1);
};

// The window's event loop blocks the main thread, so the server, the file watcher and the base polling run in a worker.
const startAppInWorker = (config: StartConfig): Promise<{ url: string; fileLabel: string }> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./src/worker.ts', import.meta.url).href);
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'ready') {
        resolve(event.data);
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage(config);
  });

const main = async (): Promise<void> => {
  const options = parseOptions();
  const config = options.config;
  if (options.display !== 'window') {
    const app = await start(config);
    if (options.display === 'browser') {
      openUrl(app.url);
    }
    return;
  }
  const app = await startAppInWorker(config);
  const { openWindow } = await import('./src/window');
  openWindow(app.url, `${app.fileLabel} · mdlive`);
  process.exit(0);
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
