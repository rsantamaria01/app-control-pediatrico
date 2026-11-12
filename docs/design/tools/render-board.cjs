// Minimal local renderer for the board's .dc.html artboards -> PNG.
// Usage: node render.js <projectDir> <outDir>
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [projectDir, outDir] = process.argv.slice(2);
const canvas = JSON.parse(fs.readFileSync(path.join(projectDir, 'canvas.json'), 'utf8'));
const files = {};
for (const f of fs.readdirSync(projectDir)) if (f.endsWith('.dc.html')) files[f.replace('.dc.html', '')] = fs.readFileSync(path.join(projectDir, f), 'utf8');
fs.mkdirSync(outDir, { recursive: true });

function pageMain(files) {
  class DCLogic { constructor() { this.props = {}; this.state = {}; } setState() {} }
  const parse = (name) => {
    const src = files[name].replace(/<sc-(for|if)\b/g, '<template data-k="sc-$1"').replace(/<\/sc-(for|if)>/g, '</template>');
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const xdc = doc.querySelector('x-dc');
    const helmet = xdc.querySelector('helmet');
    helmet.remove();
    const sc = doc.querySelector('script[data-dc-script]');
    const pdef = JSON.parse(sc.getAttribute('data-props') || '{}');
    const Comp = new Function('DCLogic', sc.textContent + '\nreturn Component;')(DCLogic);
    return { helmet, xdc, pdef, Comp };
  };
  const resolve = (e, s) => {
    e = e.trim();
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (/^-?\d/.test(e)) return Number(e);
    if (/^['"]/.test(e)) return e.slice(1, -1);
    return e.split('.').reduce((o, k) => (o == null ? undefined : o[k]), s);
  };
  const whole = (str, s) => { const m = str.match(/^\{\{([^}]*)\}\}$/); return m ? resolve(m[1], s) : str.replace(/\{\{([^}]*)\}\}/g, (_, e) => { const v = resolve(e, s); return v == null ? '' : String(v); }); };
  const text = (str, s) => str.replace(/\{\{([^}]*)\}\}/g, (_, e) => { const v = resolve(e, s); return v == null ? '' : String(v); });
  const renderNodes = (src, s, out) => { for (const n of src.childNodes) renderNode(n, s, out); };
  const renderNode = (n, s, out) => {
    if (n.nodeType === 3) { out.appendChild(document.createTextNode(text(n.data, s))); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase() === 'template' && n.dataset.k ? n.dataset.k : n.tagName.toLowerCase();
    const kids = n.content || n;
    if (tag === 'sc-for') { const list = whole(n.getAttribute('list'), s) || []; const as = n.getAttribute('as'); for (const it of list) renderNodes(kids, { ...s, [as]: it }, out); return; }
    if (tag === 'sc-if') { if (whole(n.getAttribute('value'), s)) renderNodes(kids, s, out); return; }
    if (tag === 'script') return;
    if (tag === 'dc-import') {
      const props = {};
      for (const a of n.attributes) if (a.name !== 'name' && !a.name.startsWith('hint-')) props[a.name] = whole(a.value, s);
      const [w, h] = (n.getAttribute('hint-size') || '100%,auto').split(',');
      const host = document.createElement('div');
      host.style.width = w;
      host.style.minHeight = h === 'auto' ? '' : h;
      mount(n.getAttribute('name'), props, host);
      out.appendChild(host);
      return;
    }
    const el = n.namespaceURI === 'http://www.w3.org/1999/xhtml' ? document.createElement(tag) : document.createElementNS(n.namespaceURI, n.tagName);
    for (const a of n.attributes) { if (/^on/i.test(a.name)) continue; const v = whole(a.value, s); el.setAttribute(a.name, v == null ? '' : String(v)); }
    renderNodes(n, s, el);
    out.appendChild(el);
  };
  const mount = (name, props, host) => {
    const p = parse(name);
    const defaults = {};
    for (const [k, v] of Object.entries(p.pdef)) if (k[0] !== '$' && v && 'default' in v) defaults[k] = v.default;
    const c = new p.Comp();
    c.props = { ...defaults, ...props };
    const vals = c.renderVals ? c.renderVals() : {};
    const root = host.attachShadow({ mode: 'open' });
    const reset = document.createElement('style');
    reset.textContent = '*,*::before,*::after{box-sizing:border-box}';
    root.appendChild(reset);
    for (const h of p.helmet.children) if (h.tagName.toLowerCase() === 'style') root.appendChild(h.cloneNode(true));
    renderNodes(p.xdc, vals, root);
  };
  window.__mount = (name, w) => {
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    const host = document.createElement('div');
    host.id = 'host';
    host.style.width = w + 'px';
    document.body.appendChild(host);
    mount(name, {}, host);
  };
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const [file, box] of Object.entries(canvas.boards)) {
    const name = file.replace('.dc.html', '');
    const p = await b.newPage({ viewport: { width: box.w, height: box.h }, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    await p.setContent('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Inter,system-ui,sans-serif}</style></head><body></body></html>');
    await p.evaluate(pageMain.toString().replace(/^function pageMain\(files\) \{/, 'files => {').replace(/^/, '(') + ')(' + JSON.stringify(files) + ')');
    try {
      await p.evaluate(([n, w]) => window.__mount(n, w), [name, box.w]);
      await p.waitForTimeout(80);
      const el = await p.$('#host');
      await el.screenshot({ path: path.join(outDir, name + '.png') });
    } catch (e) { errs.push(`${name}: ${e.message.split('\n')[0]}`); }
    await p.close();
  }
  await b.close();
  console.log(errs.length ? errs.join('\n') : 'ALL OK');
})();
