import { describe, expect, test } from 'bun:test';
import { renderMarkdownDiff } from './render';

const BASE = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n';

describe('renderMarkdownDiff', () => {
  test('shows no change when the documents are equal', () => {
    expect(renderMarkdownDiff(BASE, BASE).html).not.toContain('class="change');
  });

  test('marks a new paragraph as added', () => {
    const result = renderMarkdownDiff(BASE, `${BASE}\nThird paragraph.\n`);
    expect(result.html).toContain('<div class="change change-added"><p data-src="46-63">Third paragraph.</p>');
  });

  test('marks a deleted paragraph as removed', () => {
    const result = renderMarkdownDiff(BASE, '# Title\n\nFirst paragraph.\n');
    expect(result.html).toContain('<div class="change change-removed"><p>Second paragraph.</p>');
  });

  test('shows a word-level diff for an edited paragraph', () => {
    const result = renderMarkdownDiff(BASE, BASE.replace('First paragraph.', 'First new paragraph.'));
    expect(result.html).toContain('<p data-src="9-29">First <ins>new</ins> paragraph.</p>');
  });

  test('counts an edited paragraph as one modified change', () => {
    const result = renderMarkdownDiff(BASE, BASE.replace('First paragraph.', 'First new paragraph.'));
    expect(result.stats).toEqual({ added: 0, removed: 0, modified: 1 });
  });

  test('shows a rewritten paragraph as removed and added', () => {
    const result = renderMarkdownDiff(BASE, BASE.replace('Second paragraph.', 'Totally unrelated words here.'));
    expect(result.stats).toEqual({ added: 1, removed: 1, modified: 0 });
  });

  test('marks the full document as added when there is no base', () => {
    expect(renderMarkdownDiff(null, BASE).html.startsWith('<div class="change change-added">')).toBe(true);
  });

  test('shows a word-level diff for an edited list item', () => {
    const result = renderMarkdownDiff('- one\n- two\n', '- one\n- three\n');
    expect(result.html).toContain('<li><del>two</del><ins>three</ins></li>');
  });
});

describe('source positions', () => {
  test('marks an unchanged block with its position in the new document', () => {
    expect(renderMarkdownDiff(BASE, BASE).html).toContain('<p data-src="9-25">First paragraph.</p>');
  });

  test('marks an added block with its position in the new document', () => {
    const result = renderMarkdownDiff(BASE, `${BASE}\nThird paragraph.\n`);
    expect(result.html).toContain('<p data-src="46-63">Third paragraph.</p>');
  });

  test('marks an edited block with its position in the new document', () => {
    const result = renderMarkdownDiff(BASE, BASE.replace('First paragraph.', 'First new paragraph.'));
    expect(result.html).toContain('<p data-src="9-29">First <ins>new</ins> paragraph.</p>');
  });

  test('does not mark a removed block', () => {
    const result = renderMarkdownDiff(BASE, '# Title\n\nFirst paragraph.\n');
    expect(result.html).toContain('<div class="change change-removed"><p>Second paragraph.</p>');
  });

  test('counts positions on the document with Windows line endings normalized', () => {
    const result = renderMarkdownDiff(null, '# Title\r\n\r\nText.\r\n');
    expect(result.html).toContain('<p data-src="9-15">Text.</p>');
  });
});
