import { startApp, type AppConfig, type RunningApp } from './app';
import { startPullRequestApp, type PullRequestConfig } from './pullRequestApp';

export type StartConfig = ({ kind: 'file' } & AppConfig) | ({ kind: 'pull-request' } & PullRequestConfig);

/**
 * Starts the app for a local file or for a pull request link.
 */
export const start = async (config: StartConfig): Promise<RunningApp> =>
  config.kind === 'file' ? startApp(config) : startPullRequestApp(config);
