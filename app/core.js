/* Markdown rendering shared by the folder viewer (viewer.js) and the single-file view (page.js). */
(() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const slug = (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
  const isExternal = (href) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href);
  const IMG_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;

  if (window.marked) marked.use({ gfm: true });

  /* ---------- theme ---------- */
  let theme = 'light';
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    if (!window.mermaid) return;
    // Diagrams use the page's own paper colours and font instead of Mermaid's defaults.
    const dark = theme === 'dark';
    const c = dark
      ? { bg: '#121826', box: '#1E2638', border: '#3A4760', text: '#E2E8F0', line: '#94A3B8', alt: '#172A45', note: '#3A3216' }
      : { bg: '#FDFBF7', box: '#F4F1EA', border: '#CFC6B6', text: '#1A1C20', line: '#6B6760', alt: '#E3EFF7', note: '#FBF0CC' };
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base',
      flowchart: { curve: 'basis', padding: 16, nodeSpacing: 44, rankSpacing: 54, htmlLabels: true, useMaxWidth: true },
      sequence: { useMaxWidth: true, actorMargin: 60, messageMargin: 38, boxMargin: 10, mirrorActors: false },
      er: { useMaxWidth: true }, state: { useMaxWidth: true }, class: { useMaxWidth: true },
      gantt: { useMaxWidth: true }, journey: { useMaxWidth: true }, timeline: { useMaxWidth: true },
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      themeVariables: {
        darkMode: dark, background: c.bg, fontSize: '15px', fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
        primaryColor: dark ? '#1B3556' : '#DCEBF7', primaryBorderColor: dark ? '#60A5FA' : '#0277BD', primaryTextColor: c.text,
        secondaryColor: dark ? '#1F3B33' : '#E1F1E3', secondaryBorderColor: dark ? '#34D399' : '#2E7D32', secondaryTextColor: c.text,
        tertiaryColor: dark ? '#2C2547' : '#ECE6F7', tertiaryBorderColor: c.border, tertiaryTextColor: c.text,
        lineColor: c.line, textColor: c.text, mainBkg: dark ? '#1B3556' : '#DCEBF7', nodeBorder: dark ? '#60A5FA' : '#0277BD', clusterBkg: dark ? '#161D2D' : '#F7F4EC', clusterBorder: c.border,
        cScale0: dark ? '#60A5FA' : '#0277BD', cScale1: dark ? '#34D399' : '#2E7D32', cScale2: dark ? '#A78BFA' : '#6A4BA8', cScale3: dark ? '#E3B341' : '#9A6700',
        edgeLabelBackground: c.bg, noteBkgColor: c.note, noteBorderColor: c.border, noteTextColor: c.text,
        actorBkg: c.box, actorBorder: c.border, actorTextColor: c.text, signalColor: c.line, signalTextColor: c.text,
        labelBoxBkgColor: c.box, labelBoxBorderColor: c.border, labelTextColor: c.text,
        attributeBackgroundColorOdd: c.bg, attributeBackgroundColorEven: c.box,
      },
    });
  }
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('mdv-theme'); } catch {}
    theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme();
    return theme;
  }
  function setTheme(t, persist = true) {
    theme = t;
    if (persist) try { localStorage.setItem('mdv-theme', t); } catch {}
    applyTheme();
  }

  /* ---------- text diagrams: layer stacks ("name   description", │ continuation lines, ▼ between) ---------- */
  function parseLayerStack(text) {
    const lines = text.replace(/\s+$/, '').split('\n');
    const blocks = []; let cur = null, arrows = 0;
    for (const raw of lines) {
      if (!raw.trim()) continue;
      if (/^\s*[▼↓⬇v]\s*$/.test(raw)) { arrows++; cur = null; continue; }
      if (/^\S/.test(raw)) {
        const m = raw.match(/^(\S.*?)(?:\s{2,}(.*))?$/);
        cur = { title: m[1], lines: m[2] ? [m[2]] : [] }; blocks.push(cur); continue;
      }
      const c = raw.replace(/^\s*[│|]?\s*/, '');
      if (!cur || !c) { if (!cur) return null; continue; }
      cur.lines.push(c);
    }
    return blocks.length >= 3 && arrows >= blocks.length - 2 && blocks.every((b) => b.lines.length <= 6) ? blocks : null;
  }
  function buildLayerStack(blocks) {
    const root = document.createElement('div'); root.className = 'layer-stack';
    blocks.forEach((b, i) => {
      if (i) { const a = document.createElement('div'); a.className = 'layer-arrow'; a.innerHTML = '<svg viewBox="0 0 24 28" width="22" height="26" aria-hidden="true"><path d="M12 1v20M5 15l7 8 7-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; root.append(a); }
      const card = document.createElement('div'); card.className = 'layer layer-' + (i % 4);
      const t = document.createElement('div'); t.className = 'layer-title'; t.textContent = b.title;
      const d = document.createElement('div'); d.className = 'layer-desc';
      b.lines.forEach((l) => {
        const p = document.createElement('div');
        l.split(/(`[^`]+`)/).forEach((part) => { if (/^`[^`]+`$/.test(part)) { const c = document.createElement('code'); c.textContent = part.slice(1, -1); p.append(c); } else p.append(part); });
        d.append(p);
      });
      card.append(t, d); root.append(card);
    });
    return root;
  }
  /* ---------- text diagrams: indented "name/   description" lists (folder maps) ---------- */
  function parseTree(text) {
    const lines = text.replace(/\s+$/, '').split('\n').filter((l) => l.trim());
    const rows = lines.map((l) => { const m = l.match(/^(\s*)([\w.@\-\/\[\]*]+)(?:\s{2,}(\S.*))?$/); return { l, indent: l.match(/^\s*/)[0].length, name: m && m[2], desc: m && m[3], descAt: m && m[3] ? l.length - m[3].length : -1 }; });
    const cols = rows.filter((r) => r.descAt > 0).map((r) => r.descAt);
    if (cols.length < 3 || lines.length > 40) return null;
    const freq = {}; cols.forEach((c) => { freq[c] = (freq[c] || 0) + 1; });
    const [col, n] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    if (n < 3 || n < cols.length * 0.7) return null;
    const out = [];
    for (const r of rows) {
      if (r.indent >= +col) { if (!out.length) return null; out.at(-1).desc = (out.at(-1).desc ? out.at(-1).desc + ' ' : '') + r.l.trim(); continue; }
      if (!r.name) return null;
      if (r.descAt > 0 && r.descAt !== +col) { const o = out.at(-1); if (r.descAt > +col) { if (!o) return null; o.desc += ' ' + r.l.trim(); continue; } }
      out.push({ depth: Math.round(r.indent / 2), name: r.name, desc: r.desc || '' });
    }
    return out.length >= 3 ? out : null;
  }
  function buildTree(rows) {
    const root = document.createElement('div'); root.className = 'tree-card';
    rows.forEach((r) => {
      const row = document.createElement('div'); row.className = 'tree-row' + (!r.desc && /\s/.test(r.name) ? ' solo' : ''); row.style.setProperty('--d', r.depth);
      const n = document.createElement('div'); n.className = 'tree-name' + (r.name.endsWith('/') ? ' dir' : ''); n.textContent = r.name;
      const d = document.createElement('div'); d.className = 'tree-desc';
      (r.desc || '').split(/(`[^`]+`)/).forEach((part) => { if (/^`[^`]+`$/.test(part)) { const c = document.createElement('code'); c.textContent = part.slice(1, -1); d.append(c); } else d.append(part); });
      row.append(n, d); root.append(row);
    });
    return root;
  }
  /* ---------- text diagrams: numbered workflows ("1. TITLE   note", indented detail, "a. sub-step", "cond   -> result") ---------- */
  const ARROW = /\s{2,}(?:->|→)\s+/;
  const arrows = (t) => t.replace(/\s->\s/g, ' → ');
  function parseSteps(text) {
    if (/[│┌┐└┘▼›]/.test(text)) return null;
    const lines = text.replace(/\s+$/, '').split('\n').filter((l) => l.trim());
    const first = lines[0] && lines[0].match(/^(\s*)(\d+)[.)]\s+/);
    if (!first) return null;
    const base = first[1].length, steps = []; let expect = +first[2];
    for (const l of lines) {
      const ind = l.match(/^\s*/)[0].length, m = l.match(/^(\s*)(\d+)[.)]\s+(\S.*)$/);
      if (m && ind === base) {
        if (+m[2] !== expect++) return null;
        const mm = m[3].match(/^(.*?\S)(?:\s{2,}(\S.*))?$/);
        const st = { n: m[2], title: mm[1], rest: mm[2] || '', tag: '', textCol: base + m[2].length + 2, items: [] };
        const tg = st.rest.match(/^([\w.\/@<>\-\[\]*{}]+)(?:\s{2,}(\S.*))?$/);     // "kernel/http/csrf.ts" (+ optional note)
        if (tg) { st.tag = tg[1]; st.rest = tg[2] || ''; }
        steps.push(st);
        continue;
      }
      if (ind <= base || !steps.length) return null;
      const st = steps.at(-1), t = l.trim(), last = st.items.at(-1);
      let m2;
      if ((m2 = t.match(/^([a-z])[.)]\s+(.*)$/))) { st.items.push({ kind: 'sub', mark: m2[1], text: m2[2], ind, cont: [] }); continue; }
      if (!st.rest && !st.tag && !last && !/[.:?!)]$/.test(st.title)) { st.title += ' ' + t; continue; }   // a sentence-title wrapped onto the next line
      if (ARROW.test(t)) { const [c, r] = t.split(ARROW); st.items.push({ kind: 'row', text: c, res: r, ind, cont: [] }); continue; }
      if (last && last.kind !== 'para' && ind > last.ind) { const c = last.cont; if (c.length && !/[.:?!)]$/.test(c.at(-1))) c[c.length - 1] += ' ' + t; else c.push(t); continue; }                 // detail under a sub-step or row
      if (last && last.kind === 'para' && (ind > last.ind || !/[:.]$/.test(last.text))) { last.text += ' ' + t; continue; }
      if (!last && st.rest && !/:$/.test(st.rest) && ind >= st.textCol) { st.rest += ' ' + t; continue; }
      st.items.push({ kind: 'para', text: t, ind });
    }
    for (const st of steps) {                                   // "sub-step" lines with their own arrow: "public  -> let it through."
      st.items.forEach((it) => { if (it.kind === 'sub') { const p = it.text.split(ARROW); if (p.length === 2) { it.text = p[0]; it.res = p[1]; } } });
    }
    return steps.length >= 2 ? steps : null;
  }
  const addText = (el, text) => {                               // text with `code` spans
    arrows(text).split(/(`[^`]+`)/).forEach((part) => { if (/^`[^`]+`$/.test(part)) { const c = document.createElement('code'); c.textContent = part.slice(1, -1); el.append(c); } else el.append(part); });
    return el;
  };
  const div = (cls, text) => { const d = document.createElement('div'); d.className = cls; if (text != null) addText(d, text); return d; };
  function buildSteps(steps) {
    const root = div('flow-steps');
    steps.forEach((st) => {
      const row = div('flow-step'), num = div('flow-num', st.n), card = div('flow-card');
      const head = div('flow-head'), title = div('flow-title' + (st.title.length > 46 ? ' long' : ''), st.title); head.append(title);
      if (st.tag) { const tag = div('flow-tag'); tag.textContent = st.tag; head.append(tag); }
      card.append(head);
      if (st.rest) card.append(div('flow-desc', st.rest));
      st.items.forEach((it) => {
        if (it.kind === 'para') card.append(div('flow-desc', it.text));
        else if (it.kind === 'sub' || it.kind === 'row') {
          const r = div('flow-item' + (it.kind === 'row' ? ' is-row' : '')); if (it.mark) r.append(div('flow-mark', it.mark));
          r.append(div('flow-text', it.text));
          if (it.res) { const res = div('flow-res'); res.append('→ '); addText(res, it.res); r.append(res); }
          (it.cont || []).forEach((c) => r.append(div('flow-more', c)));
          card.append(r);
        }
      });
      row.append(num, card); root.append(row);
    });
    return root;
  }

  /* ---------- text diagrams: "Key:   value" forms ---------- */
  function parseKV(text) {
    if (/[│┌┐└┘▼]/.test(text)) return null;
    const lines = text.replace(/\s+$/, '').split('\n').filter((l) => l.trim());
    const rows = [];
    for (const l of lines) {
      const m = l.match(/^([A-Za-z][A-Za-z0-9 _\/-]{0,28}):\s+(\S.*)$/);
      if (m) rows.push({ k: m[1], v: m[2], col: l.length - m[2].length });
      else if (rows.length && l.match(/^\s*/)[0].length > 2) rows.at(-1).v += ' ' + l.trim();
      else return null;
    }
    const freq = {}; rows.forEach((r) => { freq[r.col] = (freq[r.col] || 0) + 1; });
    const top = Math.max(...Object.values(freq));
    return rows.length >= 3 && top >= 3 && top >= rows.length * 0.6 ? rows : null;
  }
  function buildKV(rows) {
    const root = div('kv-card');
    rows.forEach((r) => { const row = div('kv-row'); row.append(div('kv-key', r.k), div('kv-val', r.v)); root.append(row); });
    return root;
  }

  /* ---------- text diagrams: folder trees drawn with ├── └── │ ---------- */
  function parseBoxTree(text) {
    if (!/[├└]── /.test(text) || /[┌┐┘┬┴┼▼▲]/.test(text)) return null;      // real tree branches only; box drawings stay diagrams
    const rows = [], all = text.replace(/\s+$/, '').split('\n').filter((l) => l.trim());
    if (all.filter((l) => /^[│├└─\s]*[├└│]/.test(l)).length < all.length * 0.6) return null;
    for (const l of text.replace(/\s+$/, '').split('\n')) {
      if (!l.trim()) continue;
      const m = l.match(/^([│├└─\s]*)(\S.*)$/); if (!m) return null;
      const depth = Math.floor(m[1].length / 4), mm = m[2].match(/^(.*?\S)(?:\s{2,}(\S.*))?$/);
      if (/^[│├└─]+$/.test(mm[1])) continue;
      rows.push({ depth, name: mm[1], desc: mm[2] || '' });
    }
    return rows.length >= 4 && rows.length <= 160 ? rows : null;
  }

  // Box-drawing diagrams keep their alignment: use the page margins, then shrink the font to fit (not below 11px); "Expand" shows them large.
  function fitAsciiArt(pre) {
    const code = pre.querySelector('code'); if (!code) return;
    code.style.fontSize = ''; pre.style.marginInline = '';
    const wrap = pre.closest('.doc-wrap');
    const ext = wrap ? Math.max(0, Math.min(parseFloat(getComputedStyle(wrap).paddingLeft), parseFloat(getComputedStyle(wrap).paddingRight)) - 14) : 0;
    const need = () => code.scrollWidth, room = () => code.clientWidth;      // <code> is the scrolling box (highlight.js makes it display:block)
    if (ext && need() > room()) pre.style.marginInline = `-${Math.min(ext, Math.ceil((need() - room()) / 2) + 2)}px`;
    if (!room() || need() <= room()) return;
    const base = parseFloat(getComputedStyle(code).fontSize);
    code.style.fontSize = Math.max(11, base * room() / need()).toFixed(2) + 'px';
  }
  fitAsciiArt.queue = [];
  addEventListener('resize', () => document.querySelectorAll('pre.ascii-art').forEach(fitAsciiArt));

  /* ---------- Markdown → HTML ---------- */
  // Obsidian-style [[Note]], [[Note|label]], [[Note#Heading]], ![[image.png]]. Code is left alone.
  function wikilinks(src, resolve) {
    return src.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : part.replace(
      /(!?)\[\[([^\]\n|#]*)(#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g,
      (m, bang, target, hash = '', alias) => {
        const t = target.trim();
        const url = t ? resolve(t, !!bang) : '';
        const label = (alias || t || hash.slice(1)).trim();
        if (bang && IMG_RE.test(t)) return `![${label}](<${url}>)`;
        return `[${label}](<${url}${hash}>)`;
      },
    ))).join('');
  }
  // sourceLines: tag each top-level block with the source lines it came from (data-line / data-line-end).
  function toHtml(text, { name = '', wiki, sourceLines = false } = {}) {
    let src = text, front = '', firstLine = 1;
    const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (fm) {
      src = src.slice(fm[0].length);
      firstLine += (fm[0].match(/\n/g) || []).length;
      front = `<details class="frontmatter"><summary>Front matter</summary><pre><code>${esc(fm[1])}</code></pre></details>`;
    }
    if (/\.txt$/i.test(name)) return front + `<pre class="plain">${esc(src)}</pre>`;
    if (/\.mdx$/i.test(name)) src = src.replace(/^(import|export)\s.*$/gm, '');
    if (wiki) src = wikilinks(src, wiki);
    if (!sourceLines) return front + DOMPurify.sanitize(marked.parse(src));
    const tokens = marked.lexer(src);
    let line = firstLine, html = '';
    for (const tok of tokens) {
      const start = line, breaks = (tok.raw.match(/\n/g) || []).length;
      line += breaks;
      if (tok.type === 'space') continue;
      const end = Math.max(start, start + breaks - (tok.raw.endsWith('\n') ? 1 : 0));
      html += marked.parser(Object.assign([tok], { links: tokens.links }))
        .replace(/^(\s*<[a-z][a-z0-9-]*)/i, `$1 data-line="${start}" data-line-end="${end}"`);
    }
    return front + DOMPurify.sanitize(html);
  }
  function docTitle(text) {
    const m = (text || '').match(/^#\s+(.+?)\s*#*\s*$/m);
    return m ? m[1].replace(/[*_`]/g, '') : '';
  }

  /* ---------- after rendering ----------
     opts.selfLink(anchor)  → href for a heading in this same document
     opts.resolveLink(href) → {href, newTab} | null (missing) ; leave out to keep links as written
     opts.resolveImage(src) → url | null (missing) ; leave out to keep images as written        */
  function enhance(root, { prefix = '', selfLink, resolveLink, resolveImage } = {}) {
    const used = new Map();
    root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
      let s = slug(h.textContent) || 'section';
      const n = used.get(s) || 0;
      used.set(s, n + 1);
      if (n) s += '-' + n;
      h.id = prefix + 'h-' + s;
      h.dataset.slug = s;
      h.dataset.title = h.textContent.trim();
      const a = document.createElement('a');
      a.className = 'anchor'; a.href = selfLink(s); a.textContent = '#'; a.setAttribute('aria-hidden', 'true');
      h.prepend(a);
    });
    root.querySelectorAll('pre > code').forEach((code) => {
      const lang = (code.className.match(/language-([\w+-]+)/) || [])[1];
      const pre = code.parentElement;
      if (lang === 'mermaid') {
        const d = document.createElement('div');
        d.className = 'mermaid'; d.textContent = code.textContent; d.dataset.src = code.textContent;
        if (pre.dataset.line) { d.dataset.line = pre.dataset.line; d.dataset.lineEnd = pre.dataset.lineEnd; }
        pre.replaceWith(d);
        return;
      }
      if (!lang || /^(text|txt|ascii|plain|plaintext|diagram)$/.test(lang)) {
        const stack = parseLayerStack(code.textContent);
        const txt = code.textContent;
        const steps = !stack && parseSteps(txt), btree = !stack && !steps && parseBoxTree(txt);
        const tree = !stack && !steps && !btree && !/[│┌┐└┘├┤═║╔╗╚╝▼▲]/.test(txt) && parseTree(txt);
        const kv = !stack && !steps && !btree && !tree && parseKV(txt);
        const built = stack ? buildLayerStack(stack) : steps ? buildSteps(steps) : btree ? buildTree(btree) : tree ? buildTree(tree) : kv ? buildKV(kv) : null;
        if (built) { if (pre.dataset.line) { built.dataset.line = pre.dataset.line; built.dataset.lineEnd = pre.dataset.lineEnd; } pre.replaceWith(built); return; }
        if (/[│┌┐└┘├┤─═║╔╗╚╝▼▲►◄→]/.test(code.textContent)) {
          pre.classList.add('ascii-art'); fitAsciiArt.queue.push(pre);
          const x = document.createElement('button'); x.type = 'button'; x.className = 'mm-expand'; x.textContent = '⤢ Expand'; x.title = 'Open large, with zoom';
          x.onclick = () => openDiagram(pre); pre.append(x);
        }
      }
      if (window.hljs && lang && hljs.getLanguage(lang)) hljs.highlightElement(code); else code.classList.add('hljs');
      if (!pre.classList.contains('ascii-art')) {
        const wrapDefault = !lang || /^(text|txt|plain|plaintext|markdown|md|bash|sh|shell|zsh|console|terminal|log|diff)$/i.test(lang);
        const w = document.createElement('button'); w.type = 'button'; w.className = 'wrapbtn';
        const sync = () => { w.textContent = pre.classList.contains('wrap') ? 'Scroll' : 'Wrap'; w.title = pre.classList.contains('wrap') ? 'Scroll sideways instead' : 'Wrap long lines'; };
        pre.classList.toggle('wrap', wrapDefault); sync();
        w.onclick = () => { pre.classList.toggle('wrap'); sync(); };
        pre.append(w);
      }
      const b = document.createElement('button');
      b.className = 'copy'; b.textContent = 'Copy';
      b.onclick = () => navigator.clipboard?.writeText(code.textContent).then(() => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1200); });
      pre.append(b);
    });
    requestAnimationFrame(() => { fitAsciiArt.queue.splice(0).forEach(fitAsciiArt); });
    root.querySelectorAll('table').forEach((t) => { const w = document.createElement('div'); w.className = 'table-wrap'; t.replaceWith(w); w.append(t); });
    // Tables wider than the text column may use the page margins (see .table-wrap.wide in viewer.css).
    requestAnimationFrame(() => root.querySelectorAll('.table-wrap').forEach((w) => {
      if (w.firstElementChild.scrollWidth > w.clientWidth + 2) w.classList.add('wide');
      if (w.firstElementChild.scrollWidth > w.clientWidth + 2) w.classList.add('fit');       // still too wide: let the cells wrap instead of scrolling
    }));
    root.querySelectorAll('blockquote').forEach((bq) => {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') return;
      const m = p.innerHTML.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br>\s*)?/i);
      if (!m) return;
      const type = m[1].toLowerCase();
      p.innerHTML = p.innerHTML.slice(m[0].length);
      if (!p.innerHTML.trim()) p.remove();
      bq.className = 'alert alert-' + type;
      const t = document.createElement('p');
      t.className = 'alert-title'; t.textContent = type[0].toUpperCase() + type.slice(1);
      bq.prepend(t);
    });
    root.querySelectorAll('a[href]').forEach((a) => {
      if (a.classList.contains('anchor')) return;
      const href = a.getAttribute('href');
      if (isExternal(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
      if (href.startsWith('#')) { a.href = selfLink(decodeSafe(href.slice(1))); return; }
      if (!resolveLink) return;
      const r = resolveLink(href);
      if (r) { a.href = r.href; if (r.newTab) a.target = '_blank'; return; }
      a.classList.add('broken'); a.title = 'Not found: ' + href; a.removeAttribute('href');
    });
    root.querySelectorAll('img[src]').forEach((img) => {
      img.loading = 'lazy';
      const src = img.getAttribute('src');
      if (isExternal(src) || !resolveImage) return;
      const url = resolveImage(src);
      if (url) img.src = url;
      else { img.alt = `${img.alt || 'image'} (not found: ${src})`; img.removeAttribute('src'); }
    });
  }

  // Mermaid is 3 MB, so the viewer page loads it only when a document has a diagram.
  // (In the extension's file view it is already loaded by the manifest.)
  const coreSrc = document.currentScript?.src;
  let mermaidLoading;
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(true);
    if (!coreSrc) return Promise.resolve(false);
    mermaidLoading ||= new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = new URL('lib/mermaid.min.js', coreSrc).href;
      s.onload = () => { applyTheme(); resolve(true); };
      s.onerror = () => { mermaidLoading = null; resolve(false); };
      document.head.append(s);
    });
    return mermaidLoading;
  }
  function addDiagramTools(n) {
    const svg = n.querySelector('svg');
    if (!svg || n.querySelector('.mm-tools')) return;
    const bar = document.createElement('div'); bar.className = 'mm-tools';
    const btn = (label, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'mm-expand'; b.textContent = label; b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; bar.append(b); };
    btn('⤢ Expand', 'Expand diagram', () => openDiagram(svg));
    btn('SVG', 'Download as SVG', () => saveDiagram(svg, 'svg'));
    btn('PNG', 'Download as PNG', () => saveDiagram(svg, 'png'));
    n.append(bar);
    svg.style.cursor = 'zoom-in'; svg.onclick = () => openDiagram(svg);
  }
  function saveDiagram(svg, type) {
    const c = svg.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.removeAttribute('style');
    const vb = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
    const w = vb[2] || svg.getBoundingClientRect().width, h = vb[3] || svg.getBoundingClientRect().height;
    c.setAttribute('width', w); c.setAttribute('height', h);
    const xml = new XMLSerializer().serializeToString(c);
    const save = (blob, ext) => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'diagram.' + ext }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    if (type === 'svg') return save(new Blob([xml], { type: 'image/svg+xml' }), 'svg');
    const img = new Image();
    img.onload = () => {
      const k = 2, cv = document.createElement('canvas'); cv.width = w * k; cv.height = h * k;
      const g = cv.getContext('2d'); g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      try { cv.toBlob((b) => b && save(b, 'png'), 'image/png'); } catch { if (typeof toast === 'function') toast('PNG export is blocked in this browser. Use SVG.'); }
    };
    img.onerror = () => { if (typeof toast === 'function') toast('Could not make a PNG. Use SVG.'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }
  function openDiagram(svg) {
    const ov = document.createElement('div'); ov.className = 'mm-overlay';
    const stage = document.createElement('div'); stage.className = 'mm-stage';
    const isPre = svg.tagName === 'PRE';
    const clone = svg.cloneNode(true); clone.removeAttribute('style'); clone.removeAttribute('loading');
    if (isPre) { clone.querySelectorAll('button').forEach((b) => b.remove()); clone.classList.remove('ascii-art'); clone.classList.add('mm-pre'); const c = clone.querySelector('code'); if (c) c.style.fontSize = ''; } if (clone.tagName !== 'IMG') { clone.removeAttribute('width'); clone.removeAttribute('height'); } clone.draggable = false; clone.style.cursor = 'grab';
    stage.append(clone);
    const bar = document.createElement('div'); bar.className = 'mm-bar';
    bar.innerHTML = '<button data-a="out" title="Zoom out">−</button><button data-a="fit" title="Fit">Fit</button><button data-a="in" title="Zoom in">+</button><button data-a="x" title="Close (Esc)">✕</button>';
    ov.append(stage, bar); document.body.append(ov);
    let k = 1, x = 0, y = 0;
    const apply = () => { clone.style.transform = `translate(${x}px,${y}px) scale(${k})`; };
    const fit = () => { k = 1; x = 0; y = 0; if (isPre) k = Math.min(1.8, (stage.clientWidth - 80) / clone.offsetWidth, (stage.clientHeight - 80) / clone.offsetHeight); apply(); };
    const zoom = (f) => { k = Math.min(8, Math.max(.3, k * f)); apply(); };
    const close = () => { ov.remove(); removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    bar.onclick = (e) => { const a = e.target.dataset.a; if (a === 'in') zoom(1.25); else if (a === 'out') zoom(.8); else if (a === 'fit') fit(); else if (a === 'x') close(); };
    ov.onclick = (e) => { if (e.target === ov || e.target === stage) close(); };
    ov.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : .89); }, { passive: false });
    let drag = null;
    clone.onpointerdown = (e) => { drag = { px: e.clientX - x, py: e.clientY - y }; clone.setPointerCapture(e.pointerId); clone.style.cursor = 'grabbing'; };
    clone.onpointermove = (e) => { if (drag) { x = e.clientX - drag.px; y = e.clientY - drag.py; apply(); } };
    clone.onpointerup = () => { drag = null; clone.style.cursor = 'grab'; };
    fit();
  }
  async function renderMermaid(root) {
    const nodes = [...root.querySelectorAll('.mermaid')];
    if (!nodes.length) return;
    if (!(await loadMermaid())) { nodes.forEach((n) => n.classList.add('mermaid-error')); return; }
    try { await mermaid.run({ nodes }); nodes.forEach(addDiagramTools); } catch (e) {
      nodes.forEach((n) => { if (!n.querySelector('svg')) { n.classList.add('mermaid-error'); n.textContent = n.dataset.src + '\n\n⚠ ' + (e.message || e); } });
    }
  }

  let spy;
  function buildToc(root, tocEl, link) {
    spy?.disconnect();
    const hs = [...root.querySelectorAll('h2,h3')];
    if (hs.length < 2) { tocEl.innerHTML = ''; return; }
    tocEl.innerHTML = '<h4>On this page</h4><ul>' + hs.map((h) =>
      `<li><a class="${h.tagName === 'H3' ? 'l3' : ''}" href="${link(h.dataset.slug)}" data-slug="${esc(h.dataset.slug)}">${esc(h.dataset.title)}</a></li>`).join('') + '</ul>';
    const links = new Map([...tocEl.querySelectorAll('a')].map((a) => [a.dataset.slug, a]));
    spy = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting);
      if (!vis.length) return;
      tocEl.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
      links.get(vis[0].target.dataset.slug)?.classList.add('active');
    }, { rootMargin: '-60px 0px -70% 0px' });
    hs.forEach((h) => spy.observe(h));
  }

  function scrollToAnchor(anchor, smooth) {
    if (!anchor) return false;
    const target = document.getElementById('h-' + anchor) || document.getElementById('h-' + slug(anchor));
    if (target) target.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    return !!target;
  }

  function highlightText(root, q) {
    const ql = q.toLowerCase(), nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement.closest('.mermaid, button, .anchor') || !n.nodeValue.toLowerCase().includes(ql) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let first = null;
    for (const n of nodes) {
      const text = n.nodeValue, frag = document.createDocumentFragment();
      let i = 0, j;
      while ((j = text.toLowerCase().indexOf(ql, i)) >= 0) {
        frag.append(text.slice(i, j));
        const m = document.createElement('mark'); m.textContent = text.slice(j, j + q.length);
        frag.append(m); first ||= m; i = j + q.length;
      }
      frag.append(text.slice(i));
      n.replaceWith(frag);
    }
    return first;
  }

  const imagesReady = (root) => Promise.all([...root.querySelectorAll('img')].map((img) => {
    img.loading = 'eager';
    return img.complete ? 0 : new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 4000); });
  }));

  // Opens the print dialog (where "Save as PDF" lives). prepare() runs first, in the light theme;
  // the screen theme comes back afterwards and the caller redraws.
  async function printAsPdf(title, prepare) {
    const wasDark = theme === 'dark';
    if (wasDark) setTheme('light', false);
    const old = document.title;
    try {
      await prepare?.();
      document.title = title; // Chrome uses this as the PDF file name
      await new Promise((resolve) => {
        addEventListener('afterprint', resolve, { once: true });
        window.print();
      });
    } finally {
      document.title = old;
      if (wasDark) setTheme('dark', false);
    }
  }

  window.MD = {
    esc, decodeSafe, slug, isExternal, initTheme, setTheme, getTheme: () => theme,
    openZoom: openDiagram, toHtml, docTitle, enhance, renderMermaid, buildToc, scrollToAnchor, highlightText, imagesReady, printAsPdf,
  };
})();
