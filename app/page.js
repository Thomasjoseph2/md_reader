/* Chrome extension: shows a .md file opened from disk (file://…/notes.md) as a formatted page.
   Links to other .md files keep working because the browser opens them and this runs again. */
(() => {
  if (!/\.(md|markdown|mdown|mkd|mkdn|mdx)$/i.test(location.pathname)) return;
  const pre = document.body?.querySelector(':scope > pre');
  if (!pre || document.body.children.length !== 1) return; // not Chrome's plain-text view
  const text = pre.textContent;
  const name = decodeURIComponent(location.pathname.split('/').pop());
  const { esc } = MD;

  MD.initTheme();
  const meta = document.createElement('meta');
  meta.name = 'viewport'; meta.content = 'width=device-width, initial-scale=1';
  document.head.append(meta);
  document.body.className = 'loaded single';
  document.body.innerHTML = `
<header>
  <div class="brand"><img src="${chrome.runtime.getURL('icons/32.png')}" width="20" height="20" alt=""><span class="hide-sm">MD Viewer</span></div>
  <span id="rootName">${esc(name)}</span>
  <span class="spacer"></span>
  <button class="btn" id="pdfBtn" title="Save as PDF"><span>PDF</span></button>
  <button class="btn hide-sm" id="folderBtn" title="Open a whole folder of docs">Open a folder</button>
  <button class="btn icon-btn" id="themeBtn" aria-label="Toggle dark mode" title="Toggle dark mode"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0Zm0 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13ZM3 8a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8Zm13 0a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8Z"/></svg></button>
</header>
<div class="page-layout">
  <main><div class="doc-wrap"><article class="md" id="doc"></article></div></main>
  <nav class="toc" id="toc"></nav>
</div>`;
  const doc = document.getElementById('doc');
  const toc = document.getElementById('toc');
  const self = (a) => '#' + encodeURIComponent(a);
  const wiki = (t) => (/\.[a-z0-9]+$/i.test(t) ? t : t + '.md');

  async function draw() {
    const y = scrollY;
    doc.innerHTML = MD.toHtml(text, { name, wiki });
    MD.enhance(doc, { selfLink: self });
    MD.buildToc(doc, toc, self);
    scrollTo(0, y);
    await MD.renderMermaid(doc);
  }
  document.title = MD.docTitle(text) || name;
  draw().then(() => MD.scrollToAnchor(MD.decodeSafe(location.hash.slice(1))));
  addEventListener('hashchange', () => MD.scrollToAnchor(MD.decodeSafe(location.hash.slice(1)), true));

  document.getElementById('themeBtn').onclick = () => { MD.setTheme(MD.getTheme() === 'dark' ? 'light' : 'dark'); draw(); };
  document.getElementById('pdfBtn').onclick = async () => {
    try { await MD.printAsPdf(document.title, async () => { await draw(); await MD.imagesReady(doc); }); }
    finally { draw(); }
  };
  document.getElementById('folderBtn').onclick = () => chrome.runtime.sendMessage({ type: 'open-viewer' });
})();
