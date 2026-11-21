/**
 * Page script for the selection box of the Prompt and Review modes: selecting text opens a box under the
 * selection. In Prompt mode, the text goes to the Claude Code pane that works on the file. In Review mode, it
 * becomes a draft review comment on the pull request. It runs in the same scope as the page and editor
 * scripts and uses their `content`, `current`, `errorBox` and `sourceOffsetAt`.
 */
export const PROMPT_SCRIPT = `
const promptModeBox = document.getElementById('prompt-mode');
const promptBox = document.getElementById('prompt-box');
const promptQuote = document.getElementById('prompt-quote');
const promptInput = document.getElementById('prompt-input');
const promptHint = document.getElementById('prompt-hint');
const PROMPT_MODE_KEY = 'mdlive.promptMode';
const QUOTE_KEY = 'mdlive.quoteSelection';
const quoteToggle = document.getElementById('prompt-quote-toggle');
const quoteBox = document.getElementById('prompt-quote-box');
// The box serves the Prompt and the Review modes; each one has its own texts and its own way to send.
const SELECTION_MODES = {
  prompt: {
    placeholder: 'Ask Claude about the selection…',
    hint: '↩ send to Claude · ⇧↩ new line · Esc cancel',
    busy: 'Sending to Claude…',
  },
  review: {
    placeholder: 'Leave review feedback on the selection…',
    hint: '↩ add a draft review comment · ⇧↩ new line · Esc cancel',
    busy: 'Adding the draft review comment…',
  },
};
let promptSelection = null;
let selectionMode = 'prompt';

const activeSelectionMode = () => {
  if (promptModeBox.checked && current?.canPrompt) {
    return 'prompt';
  }
  return reviewModeBox.checked && current?.canReview ? 'review' : null;
};

const savePromptMode = () => {
  renderToggles();
  try {
    localStorage.setItem(PROMPT_MODE_KEY, promptModeBox.checked ? '1' : '0');
  } catch {}
  if (!promptModeBox.checked) {
    closePromptBox();
  }
};

// A selection end that does not map to the source falls back to the edge of its block.
const selectionOffset = (container, offset, edge) => {
  const mapped = current ? sourceOffsetAt(container, offset, current.source) : null;
  if (mapped !== null) {
    return mapped;
  }
  const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
  const block = element?.closest('[data-src]');
  return block ? blockRange(block)[edge] : null;
};

const highlightSelection = (range) => {
  if (window.CSS?.highlights && window.Highlight) {
    CSS.highlights.set('prompt-selection', new Highlight(range));
  }
};

const closePromptBox = () => {
  promptBox.hidden = true;
  promptSelection = null;
  promptInput.disabled = false;
  promptHint.textContent = SELECTION_MODES[selectionMode].hint;
  if (window.CSS?.highlights) {
    CSS.highlights.delete('prompt-selection');
  }
};

const openPromptBox = (mode = activeSelectionMode() ?? 'prompt') => {
  selectionMode = mode;
  promptInput.placeholder = SELECTION_MODES[mode].placeholder;
  promptHint.textContent = SELECTION_MODES[mode].hint;
  quoteToggle.hidden = mode !== 'review';
  promptBox.classList.toggle('no-quote', mode === 'review' && !quoteBox.checked);
  const selection = window.getSelection();
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }
  const range = selection.getRangeAt(0).cloneRange();
  if (!content.contains(range.commonAncestorContainer)) {
    return;
  }
  const from = selectionOffset(range.startContainer, range.startOffset, 0);
  const to = selectionOffset(range.endContainer, range.endOffset, 1);
  const text = range.toString();
  if (from === null || to === null || text.trim() === '') {
    return;
  }
  promptSelection = { from: Math.min(from, to), to: Math.max(from, to), text };
  highlightSelection(range);
  const rects = [...range.getClientRects()];
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const column = content.getBoundingClientRect();
  promptQuote.textContent = text.length > 160 ? text.slice(0, 157) + '…' : text;
  promptBox.style.top = bottom + window.scrollY + 8 + 'px';
  promptBox.style.left = column.left + window.scrollX + 24 + 'px';
  promptBox.style.width = Math.max(column.width - 48, 240) + 'px';
  promptBox.hidden = false;
  promptInput.focus();
};

const sendPrompt = async () => {
  if (!promptSelection || promptInput.value.trim() === '' || promptInput.disabled) {
    return;
  }
  promptInput.disabled = true;
  promptHint.textContent = SELECTION_MODES[selectionMode].busy;
  const review = selectionMode === 'review';
  const response = await fetch(review ? '/review/comment' : '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(review ? { ...promptSelection, feedback: promptInput.value, quote: quoteBox.checked } : { ...promptSelection, prompt: promptInput.value }),
  });
  if (!response.ok) {
    errorBox.textContent = await response.text();
    errorBox.classList.add('visible');
    promptInput.disabled = false;
    promptHint.textContent = SELECTION_MODES[selectionMode].hint;
    promptInput.focus();
    return;
  }
  if (review) {
    renderReview(await response.json());
  }
  promptInput.value = '';
  closePromptBox();
};

const maybeOpenPromptBox = (event) => {
  const mode = activeSelectionMode();
  if (!mode || promptBox.contains(event.target)) {
    return;
  }
  setTimeout(() => openPromptBox(mode), 0);
};

// Edit, Open in Obsidian, Prompt and Review all act on a click or a selection, so only one of them is on at a time.
const turnOffOtherModes = (active) => {
  if (active !== editModeBox && editModeBox.checked) {
    setEditMode(false);
  }
  if (active !== editBox && editBox.checked) {
    editBox.checked = false;
    saveEditOnClick();
  }
  if (active !== promptModeBox && promptModeBox.checked) {
    promptModeBox.checked = false;
    savePromptMode();
  }
  if (active !== reviewModeBox && reviewModeBox.checked) {
    setReviewMode(false);
  }
};

try {
  promptModeBox.checked = localStorage.getItem(PROMPT_MODE_KEY) === '1';
  quoteBox.checked = localStorage.getItem(QUOTE_KEY) !== '0';
} catch {}
// Review comments quote the selection unless the reviewer turns it off; the choice stays for the next comments.
quoteBox.addEventListener('change', () => {
  promptBox.classList.toggle('no-quote', !quoteBox.checked);
  try {
    localStorage.setItem(QUOTE_KEY, quoteBox.checked ? '1' : '0');
  } catch {}
  promptInput.focus();
});
if (promptModeBox.checked && editBox.checked) {
  editBox.checked = false;
  saveEditOnClick();
}
promptModeBox.addEventListener('change', () => {
  savePromptMode();
  if (promptModeBox.checked) {
    turnOffOtherModes(promptModeBox);
  }
});
content.addEventListener('mouseup', maybeOpenPromptBox);
content.addEventListener('keyup', (event) => {
  if (event.shiftKey) {
    maybeOpenPromptBox(event);
  }
});
promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closePromptBox();
  } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendPrompt();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!promptBox.hidden && !promptBox.contains(event.target) && promptInput.value.trim() === '') {
    closePromptBox();
  }
});
`;
