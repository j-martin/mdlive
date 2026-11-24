import { listContinuation, locateOffset, locateText, visibleSpaces } from './sourcePosition';

/**
 * Page script that lets the user edit the rendered text in place. It runs in the same scope as the page script
 * and uses its `content`, `current`, `applySnapshot`, `errorBox`, `previousText` and `EXCLUDED_TEXT`.
 *
 * Every `beforeinput` event is cancelled and turned into a patch of the Markdown source. An edit inside a single
 * text is also applied to the page at once. Other edits (Enter, edits across formatting, Cmd+B) are rendered by the
 * server without saving, then the caret goes back to the same source offset. The patches are saved together on
 * Cmd+S or Ctrl+S, when the page loses focus, after 10 seconds without edits, when editing stops, and before the page closes.
 */
export const EDITOR_SCRIPT = `
const locateOffset = ${locateOffset.toString()};
const locateText = ${locateText.toString()};
const listContinuation = ${listContinuation.toString()};
const visibleSpaces = ${visibleSpaces.toString()};

const editModeBox = document.getElementById('edit-mode');
const SAVE_IDLE_MS = 10000;
const PATCH_CONTEXT = 24;
const READ_ONLY = '.change-removed, del, .mermaid, pre:has(code.language-mermaid), img, svg, input';
let localSource = null;
let pendingSnapshot = null;
// Edits since the last save, as patches to apply in order.
const unsaved = [];
let saving = null;
let saveTimer = null;
// The source the file has once the last save is written, when no other program changed it.
let savedSource = null;
let previewRequest = 0;
let caretAfterRender = null;
// After Enter, the new line has no text in the page yet. Typing goes to this source offset while the
// selection stays where it was put.
let virtualCaret = null;
const undoStack = [];
const redoStack = [];

const showEditError = (message) => {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
};

const isSourceText = (node) => node.data.trim() !== '' && !node.parentElement.closest(EXCLUDED_TEXT);

const sourceTextNodes = (block) => {
  const nodes = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isSourceText(node)) {
      nodes.push(node);
    }
  }
  return nodes;
};

// Typed spaces can show as non-breaking spaces, which are plain spaces in the source.
const shownText = (node) => node.data.replaceAll('\\u00a0', ' ');

const blockRange = (block) => block.dataset.src.split('-').map(Number);

const sourceBlocks = () => [...content.querySelectorAll('[data-src]')];

const prepareEditable = () => {
  if (!editModeBox.checked) {
    return;
  }
  content.contentEditable = 'true';
  content.querySelectorAll(READ_ONLY).forEach((node) => {
    node.contentEditable = 'false';
  });
};

// A point between elements goes to the closest text that comes from the source.
const textPointAt = (container, offset) => {
  if (container.nodeType === Node.TEXT_NODE) {
    return { node: container, offset };
  }
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const boundary = container.childNodes[offset] ?? null;
  let previous = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isSourceText(node)) {
      continue;
    }
    const after = boundary === null
      ? container.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING && !container.contains(node)
      : boundary === node || boundary.contains(node) || boundary.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (after) {
      return { node, offset: 0 };
    }
    previous = node;
  }
  return previous ? { node: previous, offset: previous.data.length } : null;
};

const sourceOffsetAt = (container, offset, source = localSource) => {
  const point = textPointAt(container, offset);
  const block = point?.node.parentElement.closest('[data-src]');
  if (!block || !content.contains(block)) {
    return null;
  }
  const [start, end] = blockRange(block);
  const nodes = sourceTextNodes(block);
  const index = nodes.indexOf(point.node);
  if (index === -1) {
    return null;
  }
  return locateOffset(source, { start, end, texts: nodes.slice(0, index + 1).map(shownText), offset: point.offset });
};

// Checks that the source around the mapped offset shows the same text, so a wrong mapping never edits the file.
const matchesSource = (node, from, to, startOffset, endOffset) => {
  const text = shownText(node);
  if (localSource.slice(from, to) !== text.slice(startOffset, endOffset)) {
    return false;
  }
  const before = text.slice(0, startOffset).trimStart().slice(-6);
  const after = text.slice(endOffset).trimEnd().slice(0, 6);
  return localSource.slice(from - before.length, from) === before && localSource.slice(to, to + after.length) === after;
};

const shiftRanges = (from, to, insertedLength) => {
  const delta = insertedLength - (to - from);
  for (const block of sourceBlocks()) {
    let [start, end] = blockRange(block);
    if (start >= to && start > from) {
      start += delta;
      end += delta;
    } else if (end >= from) {
      end = Math.max(start, end + delta);
    }
    block.dataset.src = start + '-' + end;
  }
};

// Saving waits for a pause, so that the file and its watchers do not change on every key.
const saveEdits = () => {
  clearTimeout(saveTimer);
  if (saving) {
    return saving.then(() => (unsaved.length > 0 ? saveEdits() : undefined));
  }
  if (unsaved.length === 0) {
    return Promise.resolve();
  }
  const patches = unsaved.splice(0);
  savedSource = localSource;
  saving = fetch('/patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patches }),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(await response.text());
      }
    })
    .catch((error) => {
      unsaved.unshift(...patches);
      showEditError(String(error.message ?? error) + ' Your edits are still on the page. Copy them before you reload.');
    })
    .finally(() => {
      saving = null;
      applyPendingSnapshot();
    });
  return saving;
};

const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveEdits, SAVE_IDLE_MS);
};

// Consecutive typing merges into one undo step.
const recordUndo = (from, removed, text) => {
  const last = undoStack.at(-1);
  if (last && removed === '' && last.removed === '' && last.from + last.text.length === from && !/\\s/.test(text)) {
    last.text += text;
  } else {
    undoStack.push({ from, removed, text });
  }
  redoStack.length = 0;
};

const patchSource = (from, to, text) => {
  unsaved.push({
    from,
    to,
    text,
    before: localSource.slice(Math.max(0, from - PATCH_CONTEXT), from),
    removed: localSource.slice(from, to),
    after: localSource.slice(to, to + PATCH_CONTEXT),
  });
  localSource = localSource.slice(0, from) + text + localSource.slice(to);
  shiftRanges(from, to, text.length);
  scheduleSave();
  renderCommit();
};

// Edits that change the structure render without saving. A response for an older source is dropped,
// because a newer edit asked for its own render.
const requestPreview = async (caret) => {
  caretAfterRender = caret;
  const request = ++previewRequest;
  const source = localSource;
  const response = await fetch('/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  if (!response.ok || request !== previewRequest || source !== localSource || !editModeBox.checked) {
    return;
  }
  applyWhileEditing(await response.json());
};

const editSource = (from, to, text, caret) => {
  recordUndo(from, localSource.slice(from, to), text);
  patchSource(from, to, text);
  requestPreview(caret);
};

const blockAt = (offset) => {
  const blocks = sourceBlocks();
  return blocks.find((block) => {
    const [start, end] = blockRange(block);
    return start <= offset && offset <= end;
  }) ?? blocks.find((block) => blockRange(block)[0] >= offset) ?? blocks.at(-1);
};

const emptyLineAfter = (block, node) =>
  [...block.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6, td, th')].find((element) =>
    element.textContent.trim() === '' && (!node || node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));

const placeCaret = (offset) => {
  virtualCaret = null;
  const block = blockAt(offset);
  if (!block) {
    return;
  }
  const [start, end] = blockRange(block);
  const nodes = sourceTextNodes(block);
  const texts = nodes.map(shownText);
  const position = locateText(localSource, { start, end, texts }, offset);
  const selection = window.getSelection();
  const shown = position && locateOffset(localSource, { start, end, texts: texts.slice(0, position.index + 1), offset: position.offset }) === offset;
  if (shown) {
    selection.collapse(nodes[position.index], position.offset);
    return;
  }
  const empty = emptyLineAfter(block, position ? nodes[position.index] : null);
  if (empty) {
    selection.collapse(empty, 0);
  } else if (position) {
    selection.collapse(nodes[position.index], position.offset);
  } else {
    selection.collapse(block, 0);
  }
  virtualCaret = { offset, node: selection.focusNode, nodeOffset: selection.focusOffset };
};

const activeVirtualCaret = () => {
  const selection = window.getSelection();
  return virtualCaret && selection.isCollapsed && selection.focusNode === virtualCaret.node &&
    selection.focusOffset === virtualCaret.nodeOffset ? virtualCaret : null;
};

// Moves a source offset of the previous version to the same place in the new version, using the
// common start and end of both versions.
const carryOffset = (offset, before, after) => {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
    suffix += 1;
  }
  if (offset <= prefix) {
    return offset;
  }
  return offset >= before.length - suffix ? offset + after.length - before.length : prefix;
};

const caretSourceOffset = () => {
  const selection = window.getSelection();
  return selection.rangeCount === 0 || !content.contains(selection.focusNode)
    ? null
    : sourceOffsetAt(selection.focusNode, selection.focusOffset);
};

const applyWhileEditing = (snapshot) => {
  const ours = snapshot.source === localSource;
  const previous = localSource;
  const known = caretAfterRender ?? activeVirtualCaret()?.offset ?? (localSource === null ? null : caretSourceOffset());
  const caret = known === null || ours || previous === null ? known : carryOffset(known, previous, snapshot.source);
  const scroll = window.scrollY;
  if (ours) {
    previousText = null;
  }
  localSource = snapshot.source;
  caretAfterRender = null;
  applySnapshot(snapshot);
  window.scrollTo(window.scrollX, scroll);
  if (caret !== null && document.activeElement === content) {
    placeCaret(Math.min(caret, localSource.length));
  }
};

// The render of our own save is applied, unless newer edits are on the page. A render of changes made by another
// program first saves the edits on the page, so that the next render has both.
const applyPendingSnapshot = () => {
  if (!pendingSnapshot || saving) {
    return;
  }
  const snapshot = pendingSnapshot;
  if (localSource !== null && snapshot.source !== localSource) {
    if (snapshot.source === savedSource) {
      pendingSnapshot = null;
      return;
    }
    if (unsaved.length > 0) {
      saveEdits();
      return;
    }
  }
  pendingSnapshot = null;
  applyWhileEditing(snapshot);
};

const receiveSnapshot = (snapshot) => {
  if (!editModeBox.checked) {
    applySnapshot(snapshot);
    return;
  }
  pendingSnapshot = snapshot;
  applyPendingSnapshot();
};

// The caret goes to the first text visible under the header, so that starting to edit does not scroll.
const caretAtFirstVisibleText = () => {
  const headerBottom = document.querySelector('header').getBoundingClientRect().bottom;
  const block = sourceBlocks().find((element) => element.getBoundingClientRect().bottom > headerBottom);
  const node = block ? sourceTextNodes(block).find((text) => text.parentElement.getBoundingClientRect().bottom > headerBottom) : null;
  if (node) {
    window.getSelection().collapse(node, node.data.length - node.data.trimStart().length);
  }
};

const setEditMode = (enabled, caretOffset = null) => {
  editModeBox.checked = enabled;
  document.body.classList.toggle('editing', enabled);
  renderToggles();
  if (enabled) {
    turnOffOtherModes(editModeBox);
    const scroll = window.scrollY;
    localSource = current?.source ?? null;
    prepareEditable();
    const hadCaret = content.contains(window.getSelection().focusNode);
    content.focus({ preventScroll: true });
    if (caretOffset !== null && localSource !== null) {
      placeCaret(caretOffset);
    } else if (!hadCaret) {
      caretAtFirstVisibleText();
    }
    window.scrollTo(window.scrollX, scroll);
    return;
  }
  content.contentEditable = 'false';
  content.blur();
  saveEdits();
  localSource = null;
  undoStack.length = 0;
  redoStack.length = 0;
  if (pendingSnapshot && !saving) {
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    applySnapshot(snapshot);
  }
};

const undoOrRedo = (from, to) => {
  const entry = from.pop();
  if (!entry || localSource === null) {
    return;
  }
  patchSource(entry.from, entry.from + entry.text.length, entry.removed);
  to.push({ from: entry.from, removed: entry.text, text: entry.removed });
  requestPreview(entry.from + entry.removed.length);
};

const wrapSelection = (marker) => {
  const selection = window.getSelection();
  if (selection.rangeCount === 0 || localSource === null) {
    return;
  }
  const range = selection.getRangeAt(0);
  const from = sourceOffsetAt(range.startContainer, range.startOffset);
  const to = range.collapsed ? from : sourceOffsetAt(range.endContainer, range.endOffset);
  if (from === null || to === null || to < from) {
    showEditError('This text cannot be edited here.');
    return;
  }
  const removed = localSource.slice(from, to);
  editSource(from, to, marker + removed + marker, to + marker.length * (removed === '' ? 1 : 2));
};

const insertedText = (event, from) => {
  switch (event.inputType) {
    case 'insertText':
    case 'insertReplacementText':
    case 'insertFromPaste':
    case 'insertFromYank':
      return event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
    case 'insertParagraph':
      return listContinuation(localSource, from);
    case 'insertLineBreak':
      return '\\n';
    default:
      return event.inputType.startsWith('delete') ? '' : null;
  }
};

content.addEventListener('beforeinput', (event) => {
  if (!editModeBox.checked) {
    return;
  }
  event.preventDefault();
  if (localSource === null) {
    return;
  }
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    undoOrRedo(event.inputType === 'historyUndo' ? undoStack : redoStack, event.inputType === 'historyUndo' ? redoStack : undoStack);
    return;
  }
  if (event.inputType === 'formatBold' || event.inputType === 'formatItalic') {
    wrapSelection(event.inputType === 'formatBold' ? '**' : '*');
    return;
  }
  const virtual = activeVirtualCaret();
  if (virtual) {
    const isDelete = event.inputType.startsWith('delete');
    const backward = event.inputType === 'deleteContentBackward';
    const from = isDelete && backward ? Math.max(0, virtual.offset - 1) : virtual.offset;
    const to = isDelete && !backward ? Math.min(localSource.length, virtual.offset + 1) : virtual.offset;
    const text = insertedText(event, from);
    if (text !== null) {
      editSource(from, to, text, from + text.length);
      virtualCaret = { ...virtual, offset: from + text.length };
      return;
    }
  }
  virtualCaret = null;
  const range = event.getTargetRanges()[0] ?? (window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null);
  if (!range) {
    return;
  }
  const from = sourceOffsetAt(range.startContainer, range.startOffset);
  const to = range.collapsed ? from : sourceOffsetAt(range.endContainer, range.endOffset);
  const text = from === null ? null : insertedText(event, from);
  if (from === null || to === null || to < from || text === null) {
    showEditError('This text cannot be edited here. Use "Open in Obsidian" instead.');
    return;
  }
  const node = range.startContainer;
  const simple = node === range.endContainer && node.nodeType === Node.TEXT_NODE && isSourceText(node) && !text.includes('\\n');
  if (simple) {
    if (!matchesSource(node, from, to, range.startOffset, range.endOffset)) {
      showEditError('This text cannot be edited here. Use "Open in Obsidian" instead.');
      return;
    }
    recordUndo(from, localSource.slice(from, to), text);
    patchSource(from, to, text);
    node.replaceData(range.startOffset, range.endOffset - range.startOffset, text);
    node.data = visibleSpaces(node.data, range.startOffset - 1, range.startOffset + text.length + 1);
    window.getSelection().collapse(node, range.startOffset + text.length);
    return;
  }
  editSource(from, to, text, from + text.length);
});

content.addEventListener('keydown', (event) => {
  if (!editModeBox.checked) {
    return;
  }
  const key = event.key.toLowerCase();
  if (event.key === 'Escape') {
    event.preventDefault();
    setEditMode(false);
  } else if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === 'z' || key === 'b' || key === 'i')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === 'b' || key === 'i') {
      wrapSelection(key === 'b' ? '**' : '*');
    } else if (event.shiftKey) {
      undoOrRedo(redoStack, undoStack);
    } else {
      undoOrRedo(undoStack, redoStack);
    }
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveEdits();
  }
});

content.addEventListener('drop', (event) => {
  if (editModeBox.checked) {
    event.preventDefault();
  }
});

editModeBox.addEventListener('change', () => setEditMode(editModeBox.checked));
content.addEventListener('focusout', (event) => {
  if (editModeBox.checked && !content.contains(event.relatedTarget)) {
    saveEdits();
  }
});
window.addEventListener('blur', () => saveEdits());
// The native window waits for this before it quits. A browser tab can only send the edits without waiting.
window.mdliveBeforeQuit = () => saveEdits();
window.addEventListener('pagehide', () => {
  if (unsaved.length > 0) {
    navigator.sendBeacon('/patch', new Blob([JSON.stringify({ patches: unsaved.splice(0) })], { type: 'application/json' }));
  }
});
`;
