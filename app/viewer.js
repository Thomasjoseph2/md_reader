/* Folder viewer: open a folder, files, or drop anything, then browse it as a site. */
const { esc, decodeSafe, slug } = MD;
const $ = (s) => document.querySelector(s);
const el = {
  tree: $('#tree'), results: $('#results'), treeTools: $('#treeTools'), search: $('#search'), doc: $('#doc'),
  crumbs: $('#crumbs'), meta: $('#meta'), pager: $('#pager'), toc: $('#toc'), toast: $('#toast'), rootName: $('#rootName'),
  dirInput: $('#dirInput'), fileInput: $('#fileInput'), reloadBtn: $('#reloadBtn'), reopenBtn: $('#reopenBtn'),
};
const MD_RE = /\.(md|markdown|mdx|mdown|mkd|mkdn|txt)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vscode', '.obsidian', '.trash']);
const ICON_FILE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/></svg>';
const ICON_CHEV = '<svg class="chev" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>';

const state = {
  root: '', files: new Map(), texts: new Map(), order: [], current: null, blobs: new Map(),
  dirHandle: null, openDirs: new Set(), highlight: '',
};

/* ---------- helpers ---------- */
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const isIndex = (name) => /^(readme|index|_index)\.(md|markdown|mdx)$/i.test(name);
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
function toast(msg, ms = 2600) {
  el.toast.textContent = msg; el.toast.classList.remove('hidden');
  clearTimeout(toast.t); if (ms) toast.t = setTimeout(() => el.toast.classList.add('hidden'), ms);
}
function join(dir, rel) {
  const out = [];
  for (const s of (rel.startsWith('/') ? rel.slice(1) : dir + rel).split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') out.pop(); else out.push(s);
  }
  return out.join('/');
}
const docTitle = (p) => MD.docTitle(state.texts.get(p)) || baseName(p).replace(MD_RE, '');
function blobUrl(p) {
  if (!state.blobs.has(p)) state.blobs.set(p, URL.createObjectURL(state.files.get(p)));
  return state.blobs.get(p);
}

/* ---------- theme ---------- */
MD.initTheme();
$('#themeBtn').onclick = () => {
  MD.setTheme(MD.getTheme() === 'dark' ? 'light' : 'dark');
  if (state.current) render(state.current, '', true);
};

/* ---------- remember the last folder (Chrome / Edge) ---------- */
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('md-viewer', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', mode); const r = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(r && r.result); tx.onerror = () => reject(tx.error);
    };
  });
}

/* ---------- reading files and folders ---------- */
async function walkHandle(dir, prefix, out) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file') out.push({ path: prefix + name, file: await h.getFile() });
    else if (!SKIP_DIRS.has(name)) await walkHandle(h, prefix + name + '/', out);
  }
}
async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    out.push({ path: prefix + entry.name, file: await new Promise((res, rej) => entry.file(res, rej)) });
  } else if (entry.isDirectory && !SKIP_DIRS.has(entry.name)) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await walkEntry(e, prefix + entry.name + '/', out);
    } while (batch.length);
  }
}
// One folder → name it after the folder. One file → name it after the file. A mix → the fallback name.
function nameAndStrip(items, fallback) {
  const tops = new Set(items.map((i) => i.path.split('/')[0]));
  if (tops.size === 1 && items.every((i) => i.path.includes('/'))) {
    const root = [...tops][0];
    return { root, items: items.map((i) => ({ path: i.path.slice(root.length + 1), file: i.file })) };
  }
  const mds = items.filter((i) => MD_RE.test(i.path));
  return { root: mds.length === 1 ? baseName(mds[0].path) : fallback, items };
}
async function load(items, root, keepPlace = false) {
  items = items.filter((i) => !i.path.split('/').some((s) => SKIP_DIRS.has(s)));
  const mdPaths = items.map((i) => i.path).filter((p) => MD_RE.test(p));
  if (!mdPaths.length) { toast('No Markdown files found there.'); return; }
  toast(`Reading ${mdPaths.length} file${mdPaths.length > 1 ? 's' : ''}…`, 0);
  const prev = keepPlace ? state.current : null;
  state.blobs.forEach((u) => URL.revokeObjectURL(u));
  state.blobs.clear();
  state.files = new Map(items.map((i) => [i.path, i.file]));
  const texts = await Promise.all(mdPaths.map((p) => state.files.get(p).text()));
  state.texts = new Map(mdPaths.map((p, i) => [p, texts[i]]));
  if (state.root !== root) state.openDirs.clear();
  state.root = root;
  el.rootName.textContent = root;
  el.reloadBtn.classList.toggle('hidden', !state.dirHandle);
  document.body.classList.add('loaded');
  document.body.classList.toggle('one-file', state.texts.size === 1);
  buildTree();
  el.toast.classList.add('hidden');
  if (el.search.value.trim()) runSearch();
  const h = parseHash();
  const target = prev && state.texts.has(prev) ? prev : h && state.texts.has(h.path) ? h.path : defaultFile();
  state.current = null;
  if (h && h.path === target) render(target, h.anchor); else go(target);
}
function defaultFile() {
  const top = state.order.filter((p) => !p.includes('/'));
  return top.find((p) => isIndex(baseName(p))) || top[0] || state.order[0];
}
async function loadHandle(handle) {
  toast('Reading folder…', 0);
  const out = [];
  await walkHandle(handle, '', out);
  state.dirHandle = handle;
  await load(out, handle.name, state.root === handle.name);
}
async function pickFolder() {
  if (window.showDirectoryPicker) {
    try {
      const handle = await showDirectoryPicker({ mode: 'read' });
      await loadHandle(handle);
      try { await idb('readwrite', (s) => s.put(handle, 'last')); } catch {}
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  el.dirInput.click();
}
function fromInput(input, fallback) {
  const items = [...input.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
  input.value = '';
  if (!items.length) return;
  state.dirHandle = null;
  const r = nameAndStrip(items, fallback);
  load(r.items, r.root);
}
$('#openFolderBtn').onclick = pickFolder;
$('#changeBtn').onclick = pickFolder;
$('#openFilesBtn').onclick = () => el.fileInput.click();
el.dirInput.onchange = () => fromInput(el.dirInput, 'Folder');
el.fileInput.onchange = () => fromInput(el.fileInput, 'Files');
el.reloadBtn.onclick = async () => {
  if (!state.dirHandle) return pickFolder();
  try {
    if ((await state.dirHandle.queryPermission({ mode: 'read' })) !== 'granted' &&
        (await state.dirHandle.requestPermission({ mode: 'read' })) !== 'granted') return;
    await loadHandle(state.dirHandle);
    toast('Reloaded from disk');
  } catch { toast('Could not re-read the folder. Open it again.'); }
};
(async () => {
  if (!window.showDirectoryPicker) return;
  try {
    const handle = await idb('readonly', (s) => s.get('last'));
    if (!handle) return;
    el.reopenBtn.textContent = `Reopen “${handle.name}”`;
    el.reopenBtn.classList.remove('hidden');
    el.reopenBtn.onclick = async () => {
      try {
        if ((await handle.requestPermission({ mode: 'read' })) === 'granted') await loadHandle(handle);
      } catch { toast('That folder is no longer available. Open it again.'); el.reopenBtn.classList.add('hidden'); }
    };
  } catch {}
})();
// Running as the Chrome extension: suggest turning on file access so .md files open straight in Chrome.
if (window.chrome?.runtime?.id) document.body.classList.add('is-ext');
if (window.chrome?.extension?.isAllowedFileSchemeAccess) {
  chrome.extension.isAllowedFileSchemeAccess((ok) => { if (!ok) $('#fileTip').classList.remove('hidden'); });
  $('#fileTipBtn').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
}

/* drag and drop anywhere: files, folders, or a mix */
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const files = [...e.dataTransfer.files];
  let out = [];
  if (entries.length) { for (const en of entries) await walkEntry(en, '', out); }
  else out = files.map((f) => ({ path: f.name, file: f }));
  if (!out.length) return;
  state.dirHandle = null;
  const r = nameAndStrip(out, 'Dropped files');
  load(r.items, r.root);
});

/* ---------- sidebar tree ---------- */
function buildTree() {
  const root = { dirs: new Map(), files: [] };
  for (const p of state.texts.keys()) {
    let node = root;
    for (const d of p.split('/').slice(0, -1)) {
      if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] });
      node = node.dirs.get(d);
    }
    node.files.push(p);
  }
  state.order = [];
  el.tree.replaceChildren(renderNode(root, ''));
}
function renderNode(node, prefix) {
  const ul = document.createElement('ul');
  node.files.sort((a, b) => isIndex(baseName(b)) - isIndex(baseName(a)) || byName(baseName(a), baseName(b)));
  for (const p of node.files) {
    state.order.push(p);
    const li = document.createElement('li');
    li.innerHTML = `<a href="${hrefFor(p)}" data-path="${esc(p)}" title="${esc(p)}">${ICON_FILE}<span>${esc(baseName(p).replace(MD_RE, ''))}</span></a>`;
    ul.append(li);
  }
  for (const [name, child] of [...node.dirs].sort((a, b) => byName(a[0], b[0]))) {
    const path = prefix + name;
    const li = document.createElement('li');
    li.className = 'dir' + (state.openDirs.has(path) ? ' open' : '');
    li.dataset.dir = path;
    li.innerHTML = `<button class="dir-btn" title="${esc(path)}">${ICON_CHEV}<span>${esc(name)}</span></button>`;
    li.append(renderNode(child, path + '/'));
    ul.append(li);
  }
  return ul;
}
el.tree.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir-btn');
  if (btn) {
    const li = btn.parentElement;
    li.classList.toggle('open');
    state.openDirs[li.classList.contains('open') ? 'add' : 'delete'](li.dataset.dir);
  } else if (e.target.closest('a')) document.body.classList.remove('nav-open');
});
function setAllDirs(open) {
  el.tree.querySelectorAll('li.dir').forEach((li) => {
    li.classList.toggle('open', open);
    state.openDirs[open ? 'add' : 'delete'](li.dataset.dir);
  });
}
$('#expandAll').onclick = () => setAllDirs(true);
$('#collapseAll').onclick = () => setAllDirs(false);
function setActive(path) {
  el.tree.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const d = parts.slice(0, i).join('/');
    state.openDirs.add(d);
    el.tree.querySelector(`li.dir[data-dir="${CSS.escape(d)}"]`)?.classList.add('open');
  }
  const a = el.tree.querySelector(`a[data-path="${CSS.escape(path)}"]`);
  if (a) { a.classList.add('active'); a.scrollIntoView({ block: 'nearest' }); }
}
$('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
document.querySelector('main').addEventListener('click', () => document.body.classList.remove('nav-open'));

/* ---------- routing ---------- */
function hrefFor(path, anchor) {
  return '#/' + path.split('/').map(encodeURIComponent).join('/') + (anchor ? '#' + encodeURIComponent(anchor) : '');
}
function parseHash() {
  const h = location.hash;
  if (!h.startsWith('#/')) return null;
  const rest = h.slice(2), i = rest.indexOf('#');
  const p = i < 0 ? rest : rest.slice(0, i);
  return { path: p.split('/').map(decodeSafe).join('/'), anchor: i < 0 ? '' : decodeSafe(rest.slice(i + 1)) };
}
function go(path, anchor) {
  const h = hrefFor(path, anchor);
  if (location.hash === h) render(path, anchor); else location.hash = h;
}
addEventListener('hashchange', () => {
  const h = parseHash();
  if (!h || !state.texts.has(h.path)) return;
  if (h.path === state.current) MD.scrollToAnchor(h.anchor, true);
  else render(h.path, h.anchor);
});

/* ---------- link resolution ---------- */
function resolveDoc(p) {
  const pre = p ? p + '/' : '';
  const cands = [p, pre + 'README.md', pre + 'readme.md', pre + 'index.md', p + '.md'];
  for (const c of cands) if (state.texts.has(c)) return c;
  const lc = cands.map((c) => c.toLowerCase());
  for (const k of state.texts.keys()) if (lc.includes(k.toLowerCase())) return k;
  // A link to a folder with no README opens the first file inside it.
  return p ? state.order.find((k) => k.toLowerCase().startsWith(pre.toLowerCase())) || null : null;
}
// [[Wiki links]] find their target by name anywhere in the folder, closest to the top wins.
function wikiResolve(target, embed) {
  const t = target.replace(/\\/g, '/').toLowerCase();
  const hasExt = /\.[a-z0-9]+$/i.test(t);
  const pool = embed && hasExt && !MD_RE.test(t) ? state.files.keys() : state.texts.keys();
  let best = null;
  for (const p of pool) {
    const pl = p.toLowerCase(), bare = pl.replace(MD_RE, '');
    if (pl === t || bare === t || pl.endsWith('/' + t) || bare.endsWith('/' + t)) {
      if (!best || p.split('/').length < best.split('/').length) best = p;
    }
  }
  return '/' + (best || target + (hasExt ? '' : '.md'));
}
const toHtml = (path) => MD.toHtml(state.texts.get(path), { name: path, wiki: wikiResolve, sourceLines: true });
function enhanceDoc(root, path, { prefix = '', link = hrefFor } = {}) {
  const dir = dirOf(path);
  MD.enhance(root, {
    prefix,
    selfLink: (a) => link(path, a),
    resolveLink(href) {
      const hashAt = href.indexOf('#');
      const rel = decodeSafe((hashAt < 0 ? href : href.slice(0, hashAt)).split('?')[0]);
      const anchor = hashAt < 0 ? '' : decodeSafe(href.slice(hashAt + 1));
      const full = join(dir, rel);
      const doc = resolveDoc(full);
      if (doc) return { href: link(doc, anchor) };
      if (state.files.has(full)) return { href: blobUrl(full), newTab: true };
      return null;
    },
    resolveImage(src) {
      const p = join(dir, decodeSafe(src.split(/[?#]/)[0]));
      return state.files.has(p) ? blobUrl(p) : null;
    },
  });
}

/* ---------- rendering ---------- */
async function render(path, anchor, keepScroll) {
  state.current = path;
  const y = scrollY;
  el.doc.innerHTML = toHtml(path);
  enhanceDoc(el.doc, path);

  const parts = path.split('/');
  el.crumbs.innerHTML = [`<a href="${hrefFor(defaultFile())}">${esc(state.root)}</a>`]
    .concat(parts.slice(0, -1).map((d, i) => {
      const idx = resolveDoc(parts.slice(0, i + 1).join('/'));
      return idx ? `<a href="${hrefFor(idx)}">${esc(d)}</a>` : `<span>${esc(d)}</span>`;
    }), `<span>${esc(parts.at(-1))}</span>`).join('<span>/</span>');
  const file = state.files.get(path);
  const words = (state.texts.get(path).match(/\S+/g) || []).length;
  el.meta.textContent = `${Math.max(1, Math.round(words / 220))} min read · ${words.toLocaleString()} words` +
    (file?.lastModified ? ` · edited ${new Date(file.lastModified).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : '');

  const i = state.order.indexOf(path), prev = state.order[i - 1], next = state.order[i + 1];
  el.pager.innerHTML =
    (prev ? `<a class="prev" href="${hrefFor(prev)}"><small>← Previous</small><span>${esc(docTitle(prev))}</span></a>` : '') +
    (next ? `<a class="next" href="${hrefFor(next)}"><small>Next →</small><span>${esc(docTitle(next))}</span></a>` : '');

  MD.buildToc(el.doc, el.toc, (s) => hrefFor(path, s));
  setActive(path);
  document.title = `${docTitle(path)} · ${state.root}`;

  let scrolled = false;
  if (state.highlight) {
    const first = MD.highlightText(el.doc, state.highlight);
    state.highlight = '';
    if (first && !anchor) { first.scrollIntoView({ block: 'center' }); scrolled = true; }
  }
  if (keepScroll) { scrollTo(0, y); scrolled = true; }
  if (!scrolled && !MD.scrollToAnchor(anchor)) scrollTo(0, 0);
  await MD.renderMermaid(el.doc);
  if (anchor && !keepScroll) MD.scrollToAnchor(anchor);
}

/* ---------- PDF export (print dialog → Save as PDF) ---------- */
const pdfMenu = $('#pdfMenu'), pdfBtn = $('#pdfBtn');
function closePdfMenu() { pdfMenu.classList.add('hidden'); pdfBtn.setAttribute('aria-expanded', 'false'); }
pdfBtn.onclick = (e) => {
  e.stopPropagation();
  if (state.texts.size === 1) return exportPdf(false);
  const hidden = pdfMenu.classList.toggle('hidden');
  pdfBtn.setAttribute('aria-expanded', String(!hidden));
};
addEventListener('click', (e) => { if (!e.target.closest('.pdf-wrap')) closePdfMenu(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closePdfMenu(); });
$('#pdfPage').onclick = () => exportPdf(false);
$('#pdfAll').onclick = () => exportPdf(true);

async function buildPrintAll() {
  const docs = state.order;
  const pfx = new Map(docs.map((p, i) => [p, `p${i}-`]));
  const link = (p, a) => '#' + pfx.get(p) + (a ? 'h-' + slug(a) : 'top');
  const box = document.createElement('div');
  box.id = 'printAll';
  box.innerHTML = `<section class="print-cover"><h1>${esc(state.root)}</h1>
    <p class="print-sub">${docs.length} documents · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <ol class="print-toc">${docs.map((p) => `<li style="--d:${p.split('/').length - 1}"><a href="${link(p)}">${esc(docTitle(p))}</a><span>${esc(p)}</span></li>`).join('')}</ol></section>`;
  for (const p of docs) {
    const sec = document.createElement('section');
    sec.className = 'print-doc md';
    sec.id = pfx.get(p) + 'top';
    sec.innerHTML = `<div class="print-path">${esc(p)}</div>` + toHtml(p);
    enhanceDoc(sec, p, { prefix: pfx.get(p), link });
    box.append(sec);
  }
  document.body.append(box);
  await MD.renderMermaid(box);
  await MD.imagesReady(box);
  return box;
}
async function exportPdf(all) {
  closePdfMenu();
  if (!state.current) return;
  let box;
  try {
    await MD.printAsPdf(all ? state.root : docTitle(state.current), async () => {
      await render(state.current, '', true); // redraw diagrams and code in the light theme
      if (all) {
        toast(`Preparing ${state.order.length} documents…`, 0);
        box = await buildPrintAll();
        document.body.classList.add('print-all');
        el.toast.classList.add('hidden');
      } else await MD.imagesReady(el.doc);
    });
  } finally {
    box?.remove();
    document.body.classList.remove('print-all');
    el.toast.classList.add('hidden');
    render(state.current, '', true);
  }
}

/* ---------- search ---------- */
function snippet(text, at, q) {
  const start = Math.max(0, at - 50), end = Math.min(text.length, at + q.length + 70);
  const s = (start ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let out = '', last = 0;
  for (const m of s.matchAll(re)) { out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
  return out + esc(s.slice(last));
}
function runSearch() {
  const q = el.search.value.trim();
  const searching = q.length >= 2;
  el.tree.classList.toggle('hidden', searching);
  el.treeTools.classList.toggle('hidden', searching);
  el.results.classList.toggle('hidden', !searching);
  if (!searching) return;
  const ql = q.toLowerCase(), res = [];
  for (const [p, t] of state.texts) {
    const tl = t.toLowerCase();
    let count = 0, i = tl.indexOf(ql);
    const first = i;
    while (i >= 0 && count < 999) { count++; i = tl.indexOf(ql, i + ql.length); }
    const nameHit = p.toLowerCase().includes(ql);
    if (count || nameHit) res.push({ p, count, first, nameHit });
  }
  res.sort((a, b) => b.nameHit - a.nameHit || b.count - a.count);
  el.results.innerHTML = res.length
    ? res.slice(0, 150).map((r, i) => `<a class="result${i === 0 ? ' sel' : ''}" href="${hrefFor(r.p)}" data-path="${esc(r.p)}">
        <div class="r-name"><span>${esc(baseName(r.p).replace(MD_RE, ''))}</span>${r.count ? `<span class="r-count">${r.count}</span>` : ''}</div>
        <div class="r-path">${esc(r.p)}</div>
        ${r.first >= 0 ? `<div class="r-snip">${snippet(state.texts.get(r.p), r.first, q)}</div>` : ''}</a>`).join('')
    : `<div class="empty">No matches for “${esc(q)}”.</div>`;
}
let searchTimer;
el.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
el.search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { el.search.value = ''; runSearch(); el.search.blur(); }
  if (e.key === 'Enter') { const r = el.results.querySelector('.result'); if (r) r.click(); }
});
el.results.addEventListener('click', (e) => {
  const r = e.target.closest('.result');
  if (!r) return;
  e.preventDefault();
  state.highlight = el.search.value.trim();
  document.body.classList.remove('nav-open');
  if (r.dataset.path === state.current) render(state.current); else go(r.dataset.path);
});
addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('loaded')) return;
  const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault(); document.body.classList.add('nav-open'); el.search.focus(); el.search.select();
  }
});
