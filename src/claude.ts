import * as Path from 'node:path';
import { runTool } from './tool';

const HERDR_BUNDLE_ID = 'dev.herdr.app';
const CLAUDE_MODEL = 'claude-opus-5-5';

export type ClaudePane = {
  /** `hc` terminal address, such as `t44`. */
  address: string;
  /** Working directory of the `claude` process, not of the shell around it. */
  cwd: string;
  /** Time of the last status change, in milliseconds. */
  activeMs: number;
};

export type HcPane = ClaudePane & {
  /** Program that `hc` detected, such as `claude-code` or `zsh`. */
  agent: string;
  /** Herdr space that shows the pane, or `null` when Herdr does not show it. */
  space: string | null;
};

export type PromptParts = {
  /** File path relative to the working directory of the pane. */
  path: string;
  startLine: number;
  endLine: number;
  /** Markdown source of the selection. */
  source: string;
  prompt: string;
};

type HcTerminal = {
  address: string;
  agent?: string;
  state?: string;
  cwd?: string;
  status_ms?: number;
  foreground?: { cwd?: string } | null;
  labels?: Record<string, string>;
};

const isInside = (path: string, directory: string): boolean =>
  path === directory || path.startsWith(directory.endsWith(Path.sep) ? directory : directory + Path.sep);

/**
 * Picks the Claude Code pane to send a prompt about `filePath` to: a pane whose working directory contains
 * the file, the deepest one first, then the most recently active one. Returns `null` when none matches.
 */
export const pickClaudePane = (panes: ClaudePane[], filePath: string): ClaudePane | null =>
  panes
    .filter((pane) => filePath.startsWith(pane.cwd.endsWith(Path.sep) ? pane.cwd : pane.cwd + Path.sep))
    .sort((a, b) => b.cwd.length - a.cwd.length || b.activeMs - a.activeMs)[0] ?? null;

/**
 * Builds the text sent to Claude: the file and lines, the quoted selection, then the prompt.
 */
export const buildPrompt = (parts: PromptParts): string => {
  const lines = parts.startLine === parts.endLine ? `line ${parts.startLine}` : `lines ${parts.startLine}-${parts.endLine}`;
  const quote = parts.source
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
  return `In \`${parts.path}\`, ${lines}:\n\n${quote}\n\n${parts.prompt.trim()}`;
};

const runHc = (args: string[]): Promise<string> => runTool('hc', args);

const hasHerdrApp = (): boolean => Bun.which('herdr-app') !== null;

// `herdr-app do` controls the running Herdr window and prints what the command made.
const runHerdr = async <T>(command: string, args: Record<string, string>): Promise<T> => {
  const flags = Object.entries(args).flatMap(([name, value]) => [`--${name}`, value]);
  return JSON.parse(await runTool('herdr-app', ['do', command, ...flags])) as T;
};

/**
 * Picks the Herdr space for a new pane: the space of the most recently active terminal that works in `root`,
 * else the space of the most recently active terminal. Returns `null` when Herdr shows no terminal.
 */
export const pickHerdrSpace = (panes: HcPane[], root: string): string | null => {
  const shown = panes.filter((pane) => pane.space !== null).sort((a, b) => b.activeMs - a.activeMs);
  return (shown.find((pane) => isInside(pane.cwd, root)) ?? shown[0])?.space ?? null;
};

/**
 * Lists the live terminals that `hc` knows about. For a program such as `claude`, the working directory is the
 * one of the program, not of the shell around it.
 */
export const listPanes = async (): Promise<HcPane[]> => {
  const { terminals } = JSON.parse(await runHc(['ls', '--json'])) as { terminals: HcTerminal[] };
  const live = terminals.filter((terminal) => terminal.state === 'live');
  const details = await Promise.all(
    live.map(async (terminal) => JSON.parse(await runHc(['get', terminal.address, '--json'])) as HcTerminal),
  );
  return details.map((terminal, index) => ({
    address: terminal.address,
    agent: live[index].agent ?? '',
    cwd: terminal.foreground?.cwd ?? terminal.cwd ?? '',
    activeMs: terminal.status_ms ?? 0,
    space: terminal.labels?.['herdr.space'] ?? null,
  }));
};

const bringHerdrToFront = (): void => {
  if (process.platform === 'darwin') {
    Bun.spawn(['open', '-b', HERDR_BUNDLE_ID], { stdout: 'ignore', stderr: 'ignore' });
  }
};

// A pane that Herdr does not show cannot be focused, but the prompt was delivered, so that is only a warning.
const focusPane = async (address: string): Promise<void> => {
  if (hasHerdrApp()) {
    await runHerdr('pane.focus', { terminal: address }).catch((error) => console.warn(`mdlive: ${String(error)}`));
  }
  bringHerdrToFront();
};

/**
 * Pastes `text` into the pane and presses Enter, then shows the pane in Herdr and brings Herdr to the front.
 */
export const sendToClaude = async (pane: ClaudePane, text: string): Promise<void> => {
  await runHc(['send', pane.address, text]);
  await focusPane(pane.address);
};

/**
 * Starts Claude Code with `text` as its first prompt in a new tab of the Herdr `space`, in `cwd`, shows that tab
 * and brings Herdr to the front. The prompt goes on the command line, so it is not typed before Claude Code is
 * ready. Herdr runs it in the interactive shell, which stays when Claude Code exits.
 * Without `herdr-app`, the pane starts with `hc` and carries the Herdr labels, so Herdr still shows it.
 * Returns the address of the new pane.
 */
export const startClaude = async (cwd: string, text: string, space: string | null): Promise<string> => {
  const argv = ['claude', '--model', CLAUDE_MODEL];
  if (hasHerdrApp()) {
    const { terminal } = await runHerdr<{ terminal: string }>('tab.new', {
      ...(space === null ? {} : { space }),
      folder: cwd,
      argv: JSON.stringify(argv),
      task: text,
    });
    bringHerdrToFront();
    return terminal;
  }
  // Herdr shows a terminal in the space and tab of its labels. A tab id that Herdr does not know opens a new tab.
  const herdr = space === null ? [] : ['--label', `herdr.space=${space}`, '--label', `herdr.tab=tb${crypto.randomUUID().replaceAll('-', '')}`];
  const output = await runHc(['run', '--bg', '--json', '--no-parent', '--keep', ...herdr, '--cwd', cwd, '--', ...argv, text]);
  const { address } = JSON.parse(output) as { address: string };
  bringHerdrToFront();
  return address;
};

/**
 * True when the `hc` command line tool is on the `PATH`.
 */
export const hasHc = (): boolean => Bun.which('hc') !== null;
