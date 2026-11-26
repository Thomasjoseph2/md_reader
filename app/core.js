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
  // Box-drawing diagrams keep their alignment, so shrink the font to fit the column instead of scrolling.
  function fitAsciiArt(pre) {
    const code = pre.querySelector('code'); if (!code) return;
    code.style.fontSize = ''; const avail = pre.clientWidth - 36;
    if (!avail || code.scrollWidth <= avail) return;
    const base = parseFloat(getComputedStyle(code).fontSize);
    code.style.fontSize = Math.max(9, base * avail / code.scrollWidth).toFixed(2) + 'px';
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
        if (stack) { const d = buildLayerStack(stack); if (pre.dataset.line) { d.dataset.line = pre.dataset.line; d.dataset.lineEnd = pre.dataset.lineEnd; } pre.replaceWith(d); return; }
        if (/[│┌┐└┘├┤─═║╔╗╚╝▼▲►◄→]/.test(code.textContent)) { pre.classList.add('ascii-art'); fitAsciiArt.queue.push(pre); }
      }
      if (window.hljs && lang && hljs.getLanguage(lang)) hljs.highlightElement(code); else code.classList.add('hljs');
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
    const clone = svg.cloneNode(true); clone.removeAttribute('style'); clone.removeAttribute('loading'); if (clone.tagName !== 'IMG') { clone.removeAttribute('width'); clone.removeAttribute('height'); } clone.draggable = false; clone.style.cursor = 'grab';
    stage.append(clone);
    const bar = document.createElement('div'); bar.className = 'mm-bar';
    bar.innerHTML = '<button data-a="out" title="Zoom out">−</button><button data-a="fit" title="Fit">Fit</button><button data-a="in" title="Zoom in">+</button><button data-a="x" title="Close (Esc)">✕</button>';
    ov.append(stage, bar); document.body.append(ov);
    let k = 1, x = 0, y = 0;
    const apply = () => { clone.style.transform = `translate(${x}px,${y}px) scale(${k})`; };
    const fit = () => { k = 1; x = 0; y = 0; apply(); };
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
    apply();
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
