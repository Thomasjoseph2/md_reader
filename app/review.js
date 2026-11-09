/* Review mode: comment on selected text, a file, a folder or the whole project; download the review as a
   file (readable Markdown + exact JSON data at the end) and open other people's review files. */
(() => {
  const { esc } = MD;
  const APP_URL = 'https://markdown-viewer-online.vercel.app/';
  const TYPES = { comment: 'Comment', question: 'Question', change: 'Change request', approve: 'Looks good' };
  const R = { comments: [], dirty: false, filter: 'file', draft: null, editing: null, key: '', ranges: new Map(), pendingFocus: null, changedFiles: [] };
  const ui = {
    btn: $('#cmtBtn'), count: $('#cmtCount'), dot: $('#cmtDot'), panel: $('#cmtPanel'), list: $('#cmtList'), name: $('#cmtName'),
    status: $('#cmtStatus'), form: $('#cmtForm'), where: $('#fWhere'), quote: $('#fQuote'), scope: $('#fScope'), scopeWrap: $('#fScopeWrap'),
    type: $('#fType'), text: $('#fText'), sug: $('#fSug'), sugWrap: $('#fSugWrap'), float: $('#cmtFloat'), modal: $('#leaveModal'),
    input: $('#reviewInput'), tabs: $('#cmtTabs'),
  };

  /* ---------- small helpers ---------- */
  const me = () => ui.name.value.trim();
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'review';
  const linesText = (c) => (c.lineStart ? (c.lineStart === c.lineEnd ? `line ${c.lineStart}` : `lines ${c.lineStart}–${c.lineEnd}`) : '');
  const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  function where(c) {
    if (c.scope === 'project') return 'Whole project';
    if (c.scope === 'folder') return `Folder: ${c.folder || state.root}`;
    if (c.scope === 'file') return `${c.file} (whole file)`;
    return [c.file, c.section, linesText(c)].filter(Boolean).join(' · ');
  }
  async function hashOf(path) {
    const text = state.texts.get(path);
    if (text == null || !crypto.subtle) return undefined;
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { return undefined; }
  }

  /* ---------- saved in this browser until downloaded ---------- */
  try { ui.name.value = localStorage.getItem('mdv-reviewer') || ''; } catch {}
  ui.name.addEventListener('input', () => { ui.name.classList.remove('need'); try { localStorage.setItem('mdv-reviewer', me()); } catch {} });
  const storeKey = () => 'mdv-review:' + state.root + ':' + state.texts.size;
  function persist() { try { localStorage.setItem(R.key, JSON.stringify({ comments: R.comments, dirty: R.dirty })); } catch {} }
  function restore() {
    R.key = storeKey(); R.comments = []; R.dirty = false; R.changedFiles = [];
    try {
      const d = JSON.parse(localStorage.getItem(R.key) || 'null');
      if (d?.comments?.length) {
        R.comments = d.comments; R.dirty = !!d.dirty;
        toast(`Restored ${d.comments.length} comment${d.comments.length > 1 ? 's' : ''} from your last visit`);
      }
    } catch {}
    refresh(); decorate();
  }
  function changed() { R.dirty = true; persist(); refresh(); }

  /* ---------- hook into the viewer ---------- */
  const viewerLoad = load;
  load = async function (items, root, keepPlace) {
    if (!keepPlace && R.dirty && R.comments.length) {
      const choice = await askLeave();
      if (choice === 'cancel') return;
      if (choice === 'download') await downloadReview();
    }
    await viewerLoad(items, root, keepPlace);
    if (keepPlace) { R.key = storeKey(); persist(); } else restore();
  };
  const viewerRender = render;
  render = async function (...args) {
    await viewerRender(...args);
    decorate();
    if (isOpen()) renderList();
    if (R.pendingFocus) { const id = R.pendingFocus; R.pendingFocus = null; focusComment(id); }
  };
  addEventListener('beforeunload', (e) => {
    if (R.dirty && R.comments.length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- highlights in the document ---------- */
  const blocksFor = (ls, le) => [...el.doc.querySelectorAll('[data-line]')].filter((b) => +b.dataset.line <= le && +b.dataset.lineEnd >= ls);
  function findRange(blocks, quote) {
    const nodes = [];
    let text = '';
    for (const b of blocks) {
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement.closest('.anchor, .copy, .cmt-badge') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      while (w.nextNode()) { nodes.push({ node: w.currentNode, at: text.length }); text += w.currentNode.nodeValue; }
      text += ' ';
    }
    let flat = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) { if (!flat || flat.endsWith(' ')) continue; flat += ' '; } else flat += text[i];
      map.push(i);
    }
    const idx = flat.indexOf(quote);
    if (idx < 0 || !quote) return null;
    const s = map[idx], e = map[idx + quote.length - 1] + 1;
    const at = (pos, end) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const { node, at: start } = nodes[i];
        if (end ? start < pos : start <= pos) return [node, Math.min(pos - start, node.nodeValue.length)];
      }
      return null;
    };
    const a = at(s, false), b = at(e, true);
    if (!a || !b) return null;
    const r = document.createRange();
    r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
    return r;
  }
  function decorate() {
    el.doc.querySelectorAll('.cmt-badge').forEach((b) => b.remove());
    el.doc.querySelectorAll('.has-cmt').forEach((b) => b.classList.remove('has-cmt'));
    R.ranges.clear();
    const hl = window.Highlight ? new Highlight() : null;
    const byBlock = new Map();
    for (const c of R.comments) {
      if (c.file !== state.current || c.scope !== 'text' || !c.lineStart) continue;
      const blocks = blocksFor(c.lineStart, c.lineEnd);
      const range = blocks.length ? findRange(blocks, c.quote) : null;
      if (range) { R.ranges.set(c.id, range); hl?.add(range); }
      if (blocks[0]) { if (!byBlock.has(blocks[0])) byBlock.set(blocks[0], []); byBlock.get(blocks[0]).push(c); }
    }
    if (window.CSS?.highlights) { CSS.highlights.set('mdv-comment', hl); CSS.highlights.delete('mdv-comment-active'); }
    for (const [block, cs] of byBlock) {
      const host = block.tagName === 'TABLE' ? block.parentElement : block;
      host.classList.add('has-cmt');
      const b = document.createElement('button');
      b.className = 'cmt-badge';
      b.textContent = cs.length;
      b.title = `${cs.length} comment${cs.length > 1 ? 's' : ''}`;
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openPanel('file'); focusComment(cs[0].id); };
      host.append(b);
    }
  }
  function focusComment(id) {
    const c = R.comments.find((x) => x.id === id);
    if (!c) return;
    if (c.file && c.file !== state.current && state.texts.has(c.file)) { R.pendingFocus = id; go(c.file); return; }
    if (c.scope === 'folder' || c.scope === 'project') { // open the folder's start page
      const target = c.scope === 'project' ? defaultFile() : resolveDoc(c.folder || '');
      if (target && target !== state.current) { R.pendingFocus = id; go(target); return; }
    }
    const r = R.ranges.get(id);
    if (r) {
      if (window.CSS?.highlights && window.Highlight) CSS.highlights.set('mdv-comment-active', new Highlight(r));
      (r.startContainer.parentElement || el.doc).scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (c.lineStart) blocksFor(c.lineStart, c.lineEnd)[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ui.list.querySelectorAll('.cmt-item.active').forEach((x) => x.classList.remove('active'));
    const item = ui.list.querySelector(`.cmt-item[data-id="${CSS.escape(id)}"]`);
    if (item) { item.classList.add('active'); item.scrollIntoView({ block: 'nearest' }); }
  }
  // Clicking highlighted text opens its comment.
  el.doc.addEventListener('click', (e) => {
    if (!R.ranges.size || !getSelection().isCollapsed || e.target.closest('a, button')) return;
    let node, offset;
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { node = p.offsetNode; offset = p.offset; } }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(e.clientX, e.clientY); if (r) { node = r.startContainer; offset = r.startOffset; } }
    if (!node) return;
    for (const [id, r] of R.ranges) {
      try { if (r.isPointInRange(node, offset)) { openPanel('file'); focusComment(id); return; } } catch {}
    }
  });

  /* ---------- select text → Comment ---------- */
  let sel = null, selTimer;
  const hideFloat = () => { ui.float.classList.add('hidden'); };
  document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(checkSelection, 150); });
  function checkSelection() {
    const s = getSelection();
    if (!state.current || !s.rangeCount || s.isCollapsed) return hideFloat();
    const r = s.getRangeAt(0);
    if (!el.doc.contains(r.commonAncestorContainer)) return hideFloat();
    const quote = norm(s.toString());
    if (!quote) return hideFloat();
    const rects = r.getClientRects();
    const last = rects[rects.length - 1] || r.getBoundingClientRect();
    ui.float.style.left = Math.max(8, Math.min(innerWidth - 130, last.right - 40)) + scrollX + 'px';
    ui.float.style.top = last.bottom + scrollY + 8 + 'px';
    ui.float.classList.remove('hidden');
    sel = { range: r.cloneRange(), quote };
  }
  ui.float.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
  ui.float.onclick = () => {
    if (!sel) return;
    const draft = describe(sel);
    hideFloat();
    getSelection().removeAllRanges();
    startCompose(draft);
  };
  function describe({ range, quote }) {
    const block = (n) => (n.nodeType === 1 ? n : n.parentElement)?.closest('[data-line]');
    const b1 = block(range.startContainer), b2 = block(range.endContainer) || b1;
    let ls = b1 ? +b1.dataset.line : null, le = b2 ? +b2.dataset.lineEnd : ls;
    if (ls) [ls, le] = refineLines(state.texts.get(state.current), ls, Math.max(ls, le), quote);
    return { scope: 'text', file: state.current, quote, lineStart: ls, lineEnd: le, section: sectionAt(range.startContainer) };
  }
  // Narrow a block's line range to the lines that hold the start and end of the quoted text.
  function refineLines(text, ls, le, quote) {
    const lines = text.split('\n');
    const strip = (s) => norm(s.replace(/[*_`~[\]()>#|\\]/g, '')).toLowerCase();
    const words = strip(quote).split(' ');
    const head = words.slice(0, 3).join(' '), tail = words.slice(-3).join(' ');
    let s = ls, e = le;
    for (let i = ls; i <= le; i++) if (strip(lines[i - 1] || '').includes(head)) { s = i; break; }
    for (let i = le; i >= s; i--) if (strip(lines[i - 1] || '').includes(tail)) { e = i; break; }
    return [s, e];
  }
  function sectionAt(node) {
    let title = '';
    for (const h of el.doc.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if (h === node || h.contains(node) || h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) title = h.dataset.title;
      else break;
    }
    return title;
  }

  /* ---------- the comment form ---------- */
  function startCompose(draft, editing = null) {
    R.draft = draft; R.editing = editing;
    openPanel(R.filter);
    ui.form.classList.remove('hidden');
    ui.where.textContent = draft.scope === 'text' ? where(draft) : 'Comment on';
    ui.quote.textContent = draft.quote || '';
    ui.quote.classList.toggle('hidden', !draft.quote);
    ui.scopeWrap.classList.toggle('hidden', draft.scope === 'text');
    if (draft.scope !== 'text') {
      const opts = [];
      const file = draft.file || state.current;
      if (file) opts.push(['file', `This file: ${baseName(file)}`]);
      const parts = (file || '').split('/').slice(0, -1);
      for (let i = parts.length; i >= 1; i--) opts.push(['folder:' + parts.slice(0, i).join('/'), `Folder: ${parts.slice(0, i).join('/')}`]);
      opts.push(['project', `Whole project: ${state.root}`]);
      ui.scope.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
      ui.scope.value = draft.scope === 'folder' ? 'folder:' + draft.folder : draft.scope;
      if (!ui.scope.value) ui.scope.selectedIndex = 0;
    }
    ui.type.value = editing?.type || 'comment';
    ui.text.value = editing?.text || '';
    ui.sug.value = editing?.suggestion || draft.quote || '';
    toggleSuggestion();
    (me() ? ui.text : ui.name).focus();
  }
  function closeForm() { ui.form.classList.add('hidden'); R.draft = R.editing = null; }
  function toggleSuggestion() { ui.sugWrap.classList.toggle('hidden', ui.type.value !== 'change'); }
  ui.type.onchange = toggleSuggestion;
  $('#fCancel').onclick = closeForm;
  ui.form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeForm();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ui.form.requestSubmit();
  });
  ui.form.onsubmit = async (e) => {
    e.preventDefault();
    if (!me()) { ui.name.classList.add('need'); ui.name.focus(); toast('Add your name first, so the owner knows who commented.'); return; }
    const type = ui.type.value, text = ui.text.value.trim();
    const suggestion = type === 'change' ? ui.sug.value.replace(/\s+$/, '') : '';
    if (!text && type !== 'approve' && !(type === 'change' && suggestion && suggestion !== R.draft.quote)) { ui.text.focus(); return; }
    const d = { ...R.draft };
    if (d.scope !== 'text') {
      const v = ui.scope.value;
      d.file = v === 'file' ? d.file || state.current : null;
      d.scope = v.startsWith('folder:') ? 'folder' : v;
      d.folder = v.startsWith('folder:') ? v.slice(7) : undefined;
      delete d.quote; delete d.lineStart; delete d.lineEnd; delete d.section;
    }
    const now = new Date().toISOString();
    if (R.editing) Object.assign(R.editing, d, { type, text, suggestion, updatedAt: now });
    else {
      R.comments.push({
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        ...d, type, text, suggestion, author: me(), createdAt: now, fileHash: d.file ? await hashOf(d.file) : undefined,
      });
    }
    closeForm();
    changed();
    decorate();
  };

  /* ---------- the panel ---------- */
  const isOpen = () => !ui.panel.classList.contains('hidden');
  function openPanel(filter) {
    if (filter) R.filter = filter;
    ui.panel.classList.remove('hidden');
    document.body.classList.add('cmt-open');
    ui.btn.setAttribute('aria-expanded', 'true');
    renderList();
  }
  function closePanel() {
    ui.panel.classList.add('hidden');
    document.body.classList.remove('cmt-open');
    ui.btn.setAttribute('aria-expanded', 'false');
    closeForm();
  }
  ui.btn.onclick = () => (isOpen() ? closePanel() : openPanel());
  $('#cmtClose').onclick = closePanel;
  $('#cmtAdd').onclick = () => startCompose({ scope: 'file', file: state.current });
  ui.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (b) { R.filter = b.dataset.f; renderList(); }
  });
  function refresh() {
    const n = R.comments.length;
    ui.count.textContent = n || '';
    ui.dot.classList.toggle('hidden', !(R.dirty && n));
    ui.status.innerHTML = !n ? 'Select text in the document and click <b>Comment</b>, or use <b>+ Add comment</b>.'
      : `${n} comment${n > 1 ? 's' : ''} · ` + (R.dirty ? '<span class="warn">not downloaded yet</span>' : 'downloaded')
        + (R.changedFiles.length ? `<br><span class="warn">Changed since the review:</span> ${R.changedFiles.map(esc).join(', ')}` : '');
    if (isOpen()) renderList();
  }
  function order(c) {
    if (c.scope === 'project') return [0, 0, 0];
    if (c.scope === 'folder') return [1, 0, 0];
    const i = state.order.indexOf(c.file);
    return [2, i < 0 ? 1e6 : i, c.scope === 'file' ? 0 : c.lineStart || 0];
  }
  function renderList() {
    const here = R.comments.filter((c) => c.file === state.current);
    const list = (R.filter === 'file' ? here : [...R.comments]).sort((a, b) => {
      const x = order(a), y = order(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.createdAt.localeCompare(b.createdAt);
    });
    ui.tabs.querySelector('[data-f="file"]').textContent = `This file (${here.length})`;
    ui.tabs.querySelector('[data-f="all"]').textContent = `All (${R.comments.length})`;
    ui.tabs.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === R.filter));
    if (!list.length) {
      ui.list.innerHTML = `<p class="cmt-empty">${R.filter === 'file' ? 'No comments on this file yet.' : 'No comments yet.'}</p>`;
      return;
    }
    let lastGroup = '';
    ui.list.innerHTML = list.map((c) => {
      let head = '';
      if (R.filter === 'all') {
        const g = c.scope === 'project' ? 'Whole project' : c.scope === 'folder' ? 'Folder: ' + (c.folder || state.root) : c.file;
        if (g !== lastGroup) {
          lastGroup = g;
          head = `<div class="cmt-group">${esc(g)}${c.file && !state.texts.has(c.file) ? ' <small>(not in this folder)</small>' : ''}</div>`;
        }
      }
      const loc = c.scope === 'text' ? [c.section, linesText(c)].filter(Boolean).join(' · ') : c.scope === 'file' ? 'Whole file' : '';
      return head + `<div class="cmt-item" data-id="${esc(c.id)}">
        <div class="ci-top"><span class="chip t-${esc(c.type)}">${esc(TYPES[c.type] || 'Comment')}</span><b>${esc(c.author || '')}</b><span class="ci-time">${esc(fmtDate(c.updatedAt || c.createdAt))}</span></div>
        ${loc || (R.filter === 'file' ? '' : '') ? `<button class="ci-where" data-act="go">${esc(loc)}</button>` : ''}
        ${c.quote ? `<blockquote>${esc(c.quote)}</blockquote>` : ''}
        ${c.text ? `<p class="ci-text">${esc(c.text)}</p>` : ''}
        ${c.suggestion ? `<div class="ci-sug"><small>Suggested text</small><pre>${esc(c.suggestion)}</pre></div>` : ''}
        <div class="ci-act"><button data-act="go">Show</button><button data-act="edit">Edit</button><button data-act="del">Delete</button></div>
      </div>`;
    }).join('');
  }
  ui.list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'), item = e.target.closest('.cmt-item');
    if (!b || !item) return;
    const c = R.comments.find((x) => x.id === item.dataset.id);
    if (!c) return;
    if (b.dataset.act === 'go') focusComment(c.id);
    if (b.dataset.act === 'edit') startCompose({ ...c }, c);
    if (b.dataset.act === 'del') {
      if (!b.classList.contains('confirm')) { // ask once before deleting
        b.classList.add('confirm'); b.textContent = 'Delete? Click again';
        setTimeout(() => { b.classList.remove('confirm'); b.textContent = 'Delete'; }, 4000);
        return;
      }
      R.comments = R.comments.filter((x) => x !== c);
      changed(); decorate();
    }
  });

  /* ---------- download a review file ---------- */
  function reviewMarkdown(d) {
    const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const fence = (s) => '`'.repeat(Math.max(3, ...(s.match(/`+/g) || []).map((m) => m.length + 1)));
    const files = new Set(d.comments.map((c) => c.file).filter(Boolean));
    const L = [
      `# Review: ${d.folder}`, '',
      '| | |', '| --- | --- |',
      `| Reviewer | ${cell(d.reviewer)} |`,
      `| Downloaded | ${fmtDate(d.exportedAt)} |`,
      `| Comments | ${d.comments.length} on ${files.size} file${files.size === 1 ? '' : 's'} |`,
      `| Comment authors | ${[...new Set(d.comments.map((c) => c.author))].map(cell).join(', ')} |`, '',
      `> **See each comment in place:** open the same folder in ${d.app} and choose **Comments → Open review file**.`,
      '> **AI agents:** the exact data (file, line numbers, quoted text, suggested text) is in the JSON block at the end of this file.', '',
    ];
    let group = '', n = 0;
    for (const c of d.comments) {
      const g = c.scope === 'project' ? 'Whole project' : c.scope === 'folder' ? `Folder: ${c.folder || d.folder}` : c.file;
      if (g !== group) { group = g; L.push(`## ${g}`, ''); }
      n++;
      L.push(`### ${n}. ${TYPES[c.type] || 'Comment'}${c.scope === 'file' ? ' · whole file' : ''}${c.section ? ` · ${c.section}` : ''}${linesText(c) ? ` · ${linesText(c)}` : ''}`, '');
      if (c.quote) L.push(...c.quote.split('\n').map((l) => '> ' + l), '');
      if (c.text) L.push(c.text, '');
      if (c.suggestion) { const f = fence(c.suggestion); L.push('**Suggested text:**', '', f + 'text', c.suggestion, f, ''); }
      L.push(`*${c.author} · ${fmtDate(c.updatedAt || c.createdAt)}*`, '');
    }
    L.push('<!-- md-viewer-review', JSON.stringify(d, null, 2).replace(/-->/g, '--\\u003e'), '-->', '');
    return L.join('\n');
  }
  async function downloadReview() {
    if (!R.comments.length) { toast('No comments to download yet.'); return; }
    if (!me()) { openPanel(); ui.name.classList.add('need'); ui.name.focus(); toast('Add your name first, so the owner knows who reviewed.'); return; }
    const now = new Date();
    const sorted = [...R.comments].sort((a, b) => {
      const x = order(a), y = order(b);
      return x[0] - y[0] || (a.folder || '').localeCompare(b.folder || '') || x[1] - y[1] || x[2] - y[2];
    });
    const files = {};
    for (const c of sorted) if (c.file && !files[c.file]) files[c.file] = { hash: state.texts.has(c.file) ? await hashOf(c.file) : c.fileHash };
    const data = {
      format: 'md-viewer-review', version: 1, app: APP_URL, folder: state.root, reviewer: me(),
      exportedAt: now.toISOString(), files, comments: sorted,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([reviewMarkdown(data)], { type: 'text/markdown' }));
    a.download = `review-${slugify(state.root)}-${slugify(me())}-${now.toISOString().slice(0, 10)}.md`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    R.dirty = false; persist(); refresh();
    toast('Review downloaded. Send this file to the document owner.', 4000);
  }
  $('#cmtDownload').onclick = downloadReview;

  /* ---------- open someone's review file ---------- */
  $('#cmtImport').onclick = () => ui.input.click();
  const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const num = (v) => (Number.isFinite(v) ? v : undefined);
  function clean(c) {
    return {
      id: str(c.id, 80), scope: ['text', 'file', 'folder', 'project'].includes(c.scope) ? c.scope : 'file',
      file: str(c.file, 1000) || null, folder: str(c.folder, 1000), section: str(c.section, 500), quote: str(c.quote),
      lineStart: num(c.lineStart), lineEnd: num(c.lineEnd), type: TYPES[c.type] ? c.type : 'comment', text: str(c.text) || '',
      suggestion: str(c.suggestion) || '', author: str(c.author, 100) || 'Unknown', createdAt: str(c.createdAt, 40) || new Date().toISOString(),
      updatedAt: str(c.updatedAt, 40), fileHash: str(c.fileHash, 64),
    };
  }
  // A review made on a sub-folder (or a parent folder) still lines up with what is open now:
  // paths are matched by the folder name first, then by the end of the path.
  function pathMapper(reviewRoot) {
    const dirs = new Set([...state.texts.keys()].flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
    const sub = reviewRoot && reviewRoot !== state.root ? [...dirs].find((d) => d === reviewRoot || d.endsWith('/' + reviewRoot)) : null;
    const remap = (p) => {
      if (!p) return p;
      if (sub && state.texts.has(sub + '/' + p)) return sub + '/' + p;
      if (state.texts.has(p)) return p;
      const parts = p.split('/'); // review was made on a parent folder: drop leading folders until it fits
      for (let i = 1; i < parts.length; i++) if (state.texts.has(parts.slice(i).join('/'))) return parts.slice(i).join('/');
      const ends = [...state.texts.keys()].filter((k) => k.endsWith('/' + p));
      return ends.length === 1 ? ends[0] : p;
    };
    const remapDir = (d) => {
      if (d == null) return d;
      if (sub) return d ? sub + '/' + d : sub;
      return dirs.has(d) ? d : [...dirs].find((x) => x.endsWith('/' + d)) || d;
    };
    return { remap, remapDir };
  }
  async function openReview(file) {
    const txt = await file.text();
    let data;
    try {
      const i = txt.lastIndexOf('<!-- md-viewer-review');
      data = JSON.parse(i >= 0 ? txt.slice(i + '<!-- md-viewer-review'.length, txt.indexOf('-->', i)) : txt);
    } catch { data = null; }
    if (data?.format !== 'md-viewer-review' || !Array.isArray(data.comments)) return { error: file.name };
    const { remap, remapDir } = pathMapper(str(data.folder, 500));
    let added = 0, missing = 0;
    for (const raw of data.comments) {
      const c = clean(raw);
      if (!c.id) continue;
      c.file = remap(c.file);
      if (c.scope === 'folder') c.folder = remapDir(c.folder || '');
      const old = R.comments.find((x) => x.id === c.id);
      if (old) { if ((c.updatedAt || c.createdAt) > (old.updatedAt || old.createdAt)) Object.assign(old, c); }
      else { R.comments.push(c); added++; }
      if (c.file && !state.texts.has(c.file)) missing++;
    }
    for (const [path, info] of Object.entries(data.files || {})) {
      const p = remap(path);
      if (info?.hash && state.texts.has(p) && (await hashOf(p)) !== info.hash && !R.changedFiles.includes(p)) R.changedFiles.push(p);
    }
    return { reviewer: str(data.reviewer, 100) || 'someone', added, missing };
  }
  ui.input.onchange = async () => {
    const files = [...ui.input.files];
    ui.input.value = '';
    if (!files.length) return;
    R.changedFiles = [];
    const results = [];
    for (const f of files) results.push(await openReview(f));
    persist(); refresh(); decorate(); openPanel('all');
    const ok = results.filter((r) => !r.error), bad = results.filter((r) => r.error);
    const added = ok.reduce((n, r) => n + r.added, 0), missing = ok.reduce((n, r) => n + r.missing, 0);
    toast((ok.length ? `Opened ${[...new Set(ok.map((r) => r.reviewer))].join(', ')}: ${added} new comment${added === 1 ? '' : 's'}` +
      (missing ? `, ${missing} on files not in this folder` : '') : '') +
      (bad.length ? `${ok.length ? '. ' : ''}Not a review file: ${bad.map((r) => r.error).join(', ')}` : ''), 6000);
  };

  /* ---------- "download before you go?" when opening another folder ---------- */
  function askLeave() {
    return new Promise((resolve) => {
      $('#lmCount').textContent = R.comments.length;
      ui.modal.classList.remove('hidden');
      const done = (choice) => { ui.modal.classList.add('hidden'); ui.modal.onclick = null; resolve(choice); };
      ui.modal.onclick = (e) => {
        const b = e.target.closest('[data-choice]');
        if (b) done(b.dataset.choice); else if (e.target === ui.modal) done('cancel');
      };
    });
  }

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen() && ui.form.classList.contains('hidden') && document.activeElement === document.body) closePanel();
  });
})();
