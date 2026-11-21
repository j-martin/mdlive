import { describe, expect, test } from 'bun:test';
import { buildPrompt, pickClaudePane, pickHerdrSpace, type ClaudePane, type HcPane } from './claude';

const pane = (address: string, cwd: string, activeMs: number): ClaudePane => ({ address, cwd, activeMs });

describe('pickClaudePane', () => {
  const file = '/repo/docs/rfcs/a.md';

  test('picks a pane whose working directory contains the file', () => {
    expect(pickClaudePane([pane('t1', '/other', 9), pane('t2', '/repo', 1)], file)?.address).toBe('t2');
  });

  test('prefers the deepest working directory', () => {
    expect(pickClaudePane([pane('t1', '/repo', 9), pane('t2', '/repo/docs', 1)], file)?.address).toBe('t2');
  });

  test('prefers the most recently active pane in the same directory', () => {
    expect(pickClaudePane([pane('t1', '/repo', 1), pane('t2', '/repo', 9)], file)?.address).toBe('t2');
  });

  test('does not match a directory that only shares a prefix', () => {
    expect(pickClaudePane([pane('t1', '/repo/do', 9)], file)).toBeNull();
  });

  test('returns null when no pane works on the file', () => {
    expect(pickClaudePane([pane('t1', '/elsewhere', 9)], file)).toBeNull();
  });
});

describe('buildPrompt', () => {
  const prompt = buildPrompt({
    path: 'docs/rfcs/a.md',
    startLine: 12,
    endLine: 13,
    source: 'First line.\nSecond **line**.',
    prompt: 'Make this shorter.',
  });

  test('names the file and the lines', () => {
    expect(prompt).toContain('In `docs/rfcs/a.md`, lines 12-13:');
  });

  test('quotes the selected source', () => {
    expect(prompt).toContain('> First line.\n> Second **line**.');
  });

  test('ends with the prompt', () => {
    expect(prompt.endsWith('\n\nMake this shorter.')).toBe(true);
  });

  test('names a single line', () => {
    expect(buildPrompt({ path: 'a.md', startLine: 3, endLine: 3, source: 'x', prompt: 'y' })).toContain('line 3:');
  });
});

describe('pickHerdrSpace', () => {
  const terminal = (cwd: string, activeMs: number, space: string | null): HcPane => ({
    address: 't',
    agent: 'zsh',
    cwd,
    activeMs,
    space,
  });

  test('picks the space of a terminal that works in the repository', () => {
    expect(pickHerdrSpace([terminal('/other', 9, 'a'), terminal('/repo/docs', 1, 'b')], '/repo')).toBe('b');
  });

  test('prefers the most recently active terminal in the repository', () => {
    expect(pickHerdrSpace([terminal('/repo', 1, 'a'), terminal('/repo', 9, 'b')], '/repo')).toBe('b');
  });

  test('falls back to the most recently active terminal', () => {
    expect(pickHerdrSpace([terminal('/other', 1, 'a'), terminal('/elsewhere', 9, 'b')], '/repo')).toBe('b');
  });

  test('ignores terminals that are not in Herdr', () => {
    expect(pickHerdrSpace([terminal('/repo', 9, null), terminal('/other', 1, 'a')], '/repo')).toBe('a');
  });

  test('returns null when no terminal is in Herdr', () => {
    expect(pickHerdrSpace([terminal('/repo', 9, null)], '/repo')).toBeNull();
  });
});

