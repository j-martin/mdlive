import { SizeHint, Webview } from 'webview-bun';
import { setAppIcon } from './appIcon';
import { openUrl } from './browser';

const WIDTH = 1210;
const HEIGHT = 900;

// The window has no macOS menu bar, so the usual Cmd shortcuts do nothing unless the page handles them.
// WebKit does not let page scripts read the clipboard, so paste goes through a native binding.
// The page reports the screen height because webview-bun cannot read it. WebKit reports an outer height of 0,
// so the window asks for the whole available height and macOS fits it under the menu bar.
const INIT_SCRIPT = `
window.addEventListener('load', () => {
  const chrome = window.outerHeight > 0 ? window.outerHeight - window.innerHeight : 0;
  window.mdliveFitHeight(screen.availHeight - chrome);
}, { once: true });
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (link === null || link.origin === location.origin) {
    return;
  }
  event.preventDefault();
  window.mdliveOpenExternal(link.href);
});
document.addEventListener('keydown', (event) => {
  if (!event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'q' || key === 'w') {
    event.preventDefault();
    Promise.resolve(window.mdliveBeforeQuit?.()).finally(() => window.mdliveQuit());
  } else if (key === 'c') {
    document.execCommand('copy');
  } else if (key === 'x') {
    event.preventDefault();
    document.execCommand('cut');
  } else if (key === 'v') {
    event.preventDefault();
    window.mdliveReadClipboard().then((text) => document.execCommand('insertText', false, text));
  } else if (key === 'z') {
    event.preventDefault();
    document.execCommand(event.shiftKey ? 'redo' : 'undo');
  } else if (key === 'a') {
    event.preventDefault();
    document.execCommand('selectAll');
  } else if (key === 'r') {
    event.preventDefault();
    Promise.resolve(window.mdliveBeforeQuit?.()).finally(() => location.reload());
  }
});
`;

const readClipboard = (): string => {
  const command = process.platform === 'darwin' ? ['pbpaste'] : ['xclip', '-selection', 'clipboard', '-out'];
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'ignore' });
  return result.exitCode === 0 ? result.stdout.toString() : '';
};

/**
 * Opens a native window that shows `url` and blocks the calling thread until the window closes.
 * The window takes the full available height of the screen once the page loads.
 * Links to other origins open in the system browser.
 */
export const openWindow = (url: string, title: string): void => {
  const view = new Webview(false, { width: WIDTH, height: HEIGHT, hint: SizeHint.NONE });
  view.title = title;
  setAppIcon();
  view.bind('mdliveOpenExternal', (href: string) => openUrl(href));
  view.bind('mdliveQuit', () => process.exit(0));
  view.bind('mdliveReadClipboard', readClipboard);
  let fitted = false;
  view.bind('mdliveFitHeight', (height: number) => {
    if (fitted || !Number.isFinite(height) || height < HEIGHT) {
      return;
    }
    fitted = true;
    view.size = { width: WIDTH, height: Math.round(height), hint: SizeHint.NONE };
  });
  view.init(INIT_SCRIPT);
  view.navigate(url);
  view.run();
};
