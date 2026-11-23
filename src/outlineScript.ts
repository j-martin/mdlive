/**
 * Page script for the outline sidebar, which lists the headings of the page and scrolls to one on click.
 * It runs in the same scope as the page script and uses its `content` and `renderToggles`.
 *
 * Removed headings are left out. The heading of the section at the top of the screen is highlighted. A dot marks a
 * section whose text, up to the next heading, has changes.
 */
export const OUTLINE_SCRIPT = `
const outlineBox = document.getElementById('outline-on');
const outlineNav = document.getElementById('outline');
const outlineList = document.getElementById('outline-list');
const OUTLINE_KEY = 'mdlive.outline';
let outlineEntries = [];

const headingText = (heading) => {
  const copy = heading.cloneNode(true);
  copy.querySelectorAll('del, .change-removed').forEach((node) => node.remove());
  return copy.textContent.trim();
};

const headingChange = (heading) => {
  const change = heading.closest('.change');
  if (change?.classList.contains('change-added')) {
    return 'added';
  }
  return change?.classList.contains('change-modified') || heading.querySelector('ins, del') ? 'modified' : null;
};

const textChange = (node) => {
  const element = node.parentElement;
  if (element.closest('ins, .change-added')) {
    return 'added';
  }
  if (element.closest('del, .change-removed')) {
    return 'removed';
  }
  return element.closest('.change-modified') ? 'modified' : null;
};

// Text before the first heading belongs to no section. A removed heading is text of the section it was in.
const sectionChanges = (headings) => {
  const changes = headings.map(() => new Set());
  const indexes = new Map(headings.map((heading, index) => [heading, index]));
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let section = -1;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const heading = indexes.get(node.parentElement.closest('h1, h2, h3, h4, h5, h6'));
    if (heading !== undefined) {
      section = heading;
      continue;
    }
    const change = node.data.trim() === '' ? null : textChange(node);
    if (section !== -1 && change) {
      changes[section].add(change);
    }
  }
  return changes;
};

const changeDot = (kinds) => {
  const dot = document.createElement('span');
  dot.className = 'outline-dot ' + (kinds.size === 1 ? [...kinds][0] : 'modified');
  dot.title = 'Changes in this section: ' + [...kinds].join(', ');
  return dot;
};

const renderOutline = () => {
  const headings = [...content.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter((heading) => !heading.closest('.change-removed') && headingText(heading) !== '');
  const top = Math.min(...headings.map((heading) => Number(heading.tagName[1])));
  const changes = sectionChanges(headings);
  outlineEntries = headings.map((heading, index) => {
    const link = document.createElement('a');
    link.href = '#';
    const text = document.createElement('span');
    text.className = 'outline-text';
    text.textContent = headingText(heading);
    link.title = text.textContent;
    link.append(text);
    if (changes[index].size > 0) {
      link.append(changeDot(changes[index]));
    }
    link.style.paddingLeft = (Number(heading.tagName[1]) - top) * 12 + 8 + 'px';
    const change = headingChange(heading);
    if (change) {
      link.classList.add('outline-' + change);
    }
    link.onclick = (event) => {
      event.preventDefault();
      const headerBottom = document.querySelector('header').getBoundingClientRect().bottom;
      window.scrollTo(window.scrollX, window.scrollY + heading.getBoundingClientRect().top - headerBottom - 8);
    };
    return { heading, link };
  });
  outlineList.replaceChildren(...outlineEntries.map((entry) => entry.link));
  applyOutline();
  markCurrentHeading();
};

// The current heading is the last one above the bottom of the header, or the first one above any heading.
const markCurrentHeading = () => {
  const headerBottom = document.querySelector('header').getBoundingClientRect().bottom + 8;
  let currentEntry = outlineEntries[0] ?? null;
  for (const entry of outlineEntries) {
    if (entry.heading.getBoundingClientRect().top > headerBottom) {
      break;
    }
    currentEntry = entry;
  }
  for (const entry of outlineEntries) {
    entry.link.classList.toggle('current', entry === currentEntry);
  }
  const link = currentEntry?.link;
  if (link && (link.offsetTop < outlineNav.scrollTop || link.offsetTop + link.offsetHeight > outlineNav.scrollTop + outlineNav.clientHeight)) {
    outlineNav.scrollTop = link.offsetTop - outlineNav.clientHeight / 2;
  }
};

const applyOutline = () => {
  const shown = outlineBox.checked && outlineEntries.length > 0;
  outlineNav.hidden = !shown;
  document.body.classList.toggle('outline-on', shown);
};

// Storage can be unavailable (private mode, blocked site data), so the outline falls back to on.
try {
  outlineBox.checked = localStorage.getItem(OUTLINE_KEY) !== '0';
} catch {}
outlineBox.addEventListener('change', () => {
  applyOutline();
  try {
    localStorage.setItem(OUTLINE_KEY, outlineBox.checked ? '1' : '0');
  } catch {}
});

// The sidebar starts under the header, whose height changes when its rows wrap.
new ResizeObserver(() => {
  document.body.style.setProperty('--header-height', document.querySelector('header').offsetHeight + 'px');
}).observe(document.querySelector('header'));
window.addEventListener('scroll', markCurrentHeading, { passive: true });
`;
