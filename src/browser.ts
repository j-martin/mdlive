/**
 * Opens `url` with its default system handler: the browser for web pages, the app for custom schemes.
 */
export const openUrl = (url: string): void => {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  Bun.spawn([command, url], { stdout: 'ignore', stderr: 'ignore' });
};
