import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as Fs from 'node:fs';
import * as Os from 'node:os';
import * as Path from 'node:path';
import { buildOpenScript, findVault } from './obsidian';

let root = '';
let configPath = '';

beforeAll(() => {
  root = Fs.realpathSync(Fs.mkdtempSync(Path.join(Os.tmpdir(), 'mdlive-obsidian-')));
  Fs.mkdirSync(Path.join(root, 'notes', 'docs'), { recursive: true });
  Fs.mkdirSync(Path.join(root, 'other'));
  Fs.writeFileSync(Path.join(root, 'notes', 'docs', 'a.md'), '# A\n');
  Fs.writeFileSync(Path.join(root, 'other', 'b.md'), '# B\n');
  configPath = Path.join(root, 'obsidian.json');
  Fs.writeFileSync(
    configPath,
    JSON.stringify({ vaults: { one: { path: Path.join(root, 'notes') }, two: { path: Path.join(root, 'notes-old') } } }),
  );
});

afterAll(() => {
  Fs.rmSync(root, { recursive: true, force: true });
});

describe('findVault', () => {
  test('finds the vault that contains the file', () => {
    expect(findVault(Path.join(root, 'notes', 'docs', 'a.md'), configPath)).toEqual({
      name: 'notes',
      relativePath: 'docs/a.md',
    });
  });

  test('returns null for a file outside every vault', () => {
    expect(findVault(Path.join(root, 'other', 'b.md'), configPath)).toBeNull();
  });

  test('returns null when Obsidian is not installed', () => {
    expect(findVault(Path.join(root, 'notes', 'docs', 'a.md'), Path.join(root, 'missing.json'))).toBeNull();
  });
});

describe('buildOpenScript', () => {
  test('quotes the path so it cannot break out of the script', () => {
    expect(buildOpenScript('a"b\\c.md', { line: 3, ch: 4 })).toContain('const path = "a\\"b\\\\c.md";');
  });

  test('moves the cursor to the position', () => {
    expect(buildOpenScript('a.md', { line: 3, ch: 4 })).toContain('const pos = {"line":3,"ch":4};');
  });
});
