import * as Fs from 'node:fs';
import * as Os from 'node:os';
import * as Path from 'node:path';
import { openUrl } from './browser';
import type { SourcePosition } from './sourcePosition';

export type VaultFile = {
  /** Vault name, which Obsidian takes from the vault folder name. */
  name: string;
  /** Path of the file relative to the vault root. */
  relativePath: string;
};

type ObsidianConfig = {
  vaults?: Record<string, { path?: string }>;
};

const defaultConfigPath = (): string => {
  if (process.platform === 'darwin') {
    return Path.join(Os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  }
  if (process.platform === 'win32') {
    return Path.join(process.env.APPDATA ?? Path.join(Os.homedir(), 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
  }
  return Path.join(process.env.XDG_CONFIG_HOME ?? Path.join(Os.homedir(), '.config'), 'obsidian', 'obsidian.json');
};

const realPathOrNull = (path: string): string | null => {
  try {
    return Fs.realpathSync(path);
  } catch {
    return null;
  }
};

/**
 * Finds the Obsidian vault that contains `filePath`, using the vault list of the Obsidian app.
 * Returns `null` when Obsidian is not installed or no vault contains the file.
 */
export const findVault = (filePath: string, configPath = defaultConfigPath()): VaultFile | null => {
  if (!Fs.existsSync(configPath)) {
    return null;
  }
  const config = JSON.parse(Fs.readFileSync(configPath, 'utf8')) as ObsidianConfig;
  const file = Fs.realpathSync(filePath);
  for (const vault of Object.values(config.vaults ?? {})) {
    const root = vault.path === undefined ? null : realPathOrNull(vault.path);
    if (root !== null && file.startsWith(root + Path.sep)) {
      return { name: Path.basename(root), relativePath: Path.relative(root, file).split(Path.sep).join('/') };
    }
  }
  return null;
};

/**
 * Builds the script that `obsidian eval` runs to open `relativePath` in source mode with the cursor at `position`.
 * A tab that already shows the file is reused.
 */
export const buildOpenScript = (relativePath: string, position: SourcePosition): string => `(async () => {
  const path = ${JSON.stringify(relativePath)};
  const pos = ${JSON.stringify({ line: position.line, ch: position.ch })};
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) {
    return 'missing';
  }
  const leaf = app.workspace.getLeavesOfType('markdown').find((item) => item.view.file?.path === path) ?? app.workspace.getLeaf(false);
  await leaf.openFile(file, { active: true, state: { mode: 'source' } });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const editor = leaf.view.editor;
  editor.setCursor(pos);
  editor.scrollIntoView({ from: pos, to: pos }, true);
  editor.focus();
  return 'ok';
})()`;

/**
 * Opens the file in Obsidian with the cursor at `position`, then brings the vault window to the front.
 * Needs the `obsidian` command line tool that ships with recent Obsidian versions, and Obsidian must be running.
 */
export const openInObsidian = async (vault: VaultFile, position: SourcePosition): Promise<void> => {
  const command = ['obsidian', `vault=${vault.name}`, 'eval', `code=${buildOpenScript(vault.relativePath, position)}`];
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    child = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  } catch (error) {
    throw new Error(`Cannot run the "obsidian" command line tool: ${String(error)}`);
  }
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await child.exited;
  if (stdout.trim() !== '=> ok') {
    throw new Error(`Obsidian could not open ${vault.relativePath} in vault "${vault.name}": ${(stdout + stderr).trim()}`);
  }
  openUrl(`obsidian://open?vault=${encodeURIComponent(vault.name)}`);
};
