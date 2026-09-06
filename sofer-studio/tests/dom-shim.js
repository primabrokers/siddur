// tests/dom-shim.js
// Minimal DOM/environment shim for exercising the browser-only public/*.js
// modules under Node. Provides just enough of the DOM API that every module's
// init() and synchronous render path can run without a browser. This is NOT a
// full DOM — it exists so the frontend logic has test coverage instead of none.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const allElements = new Set();

function classSet(el) {
  return String(el.className || '').split(/\s+/).filter(Boolean);
}

function makeStyle() {
  const style = {
    setProperty(k, v) { style[k] = v; },
    getPropertyValue(k) { return (k in style && typeof style[k] !== 'function') ? String(style[k]) : ''; },
    removeProperty(k) { delete style[k]; },
  };
  return style;
}

function makeClassList(el) {
  return {
    add(...names) { const s = new Set(classSet(el)); names.forEach((n) => s.add(n)); el.className = [...s].join(' '); },
    remove(...names) { const s = new Set(classSet(el)); names.forEach((n) => s.delete(n)); el.className = [...s].join(' '); },
    toggle(name, force) {
      const s = new Set(classSet(el));
      const want = force === undefined ? !s.has(name) : !!force;
      if (want) s.add(name); else s.delete(name);
      el.className = [...s].join(' ');
      return want;
    },
    contains(name) { return classSet(el).includes(name); },
    replace(a, b) { const s = new Set(classSet(el)); if (s.delete(a)) s.add(b); el.className = [...s].join(' '); },
  };
}

class FakeText {
  constructor(text) { this.nodeType = 3; this.nodeName = '#text'; this._data = String(text); this.parentNode = null; }
  get textContent() { return this._data; }
  set textContent(v) { this._data = String(v); }
  get nodeValue() { return this._data; }
  set nodeValue(v) { this._data = String(v); }
}

function walk(root, visit) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    visit(n);
    if (n.childNodes) for (let i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]);
  }
}

function findById(id) {
  for (const el of allElements) {
    if (el.nodeType === 1 && el.getAttribute('id') === id) return el;
  }
  return null;
}

function matchCompound(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  let rest = sel;
  const tag = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
  if (tag) {
    if (el.tagName.toLowerCase() !== tag[1].toLowerCase()) return false;
    rest = rest.slice(tag[1].length);
  }
  const tokenRe = /#([\w-]+)|\.([\w-]+)|\[([^\]]+)\]/g;
  let m;
  while ((m = tokenRe.exec(rest)) !== null) {
    if (m[1] !== undefined) {
      if (el.getAttribute('id') !== m[1]) return false;
    } else if (m[2] !== undefined) {
      if (!classSet(el).includes(m[2])) return false;
    } else if (m[3] !== undefined) {
      const a = m[3];
      const eq = a.indexOf('=');
      const name = (eq >= 0 ? a.slice(0, eq) : a).trim();
      const val = eq >= 0 ? a.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '') : null;
      if (!el.hasAttribute(name)) return false;
      if (val !== null && el.getAttribute(name) !== val) return false;
    }
  }
  return true;
}

function matchPath(el, parts) {
  if (!el || el.nodeType !== 1) return false;
  // The rightmost compound selector must match the element itself (not an ancestor).
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  // Earlier parts are descendant combinators: each must match some ancestor.
  let cur = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    let node = cur;
    while (node) {
      if (matchCompound(node, parts[i])) { found = true; break; }
      node = node.parentNode;
    }
    if (!found) return false;
    cur = node.parentNode;
  }
  return true;
}

function matchAny(el, selector) {
  return selector.split(',').some((alt) => {
    const parts = alt.trim().split(/\s+/).filter(Boolean);
    return matchPath(el, parts);
  });
}

function collectMatches(root, selector) {
  const out = [];
  if (!root) return out;
  walk(root, (n) => {
    if (n !== root && matchAny(n, selector)) out.push(n);
  });
  return out;
}

class FakeElement {
  constructor(tag, ns) {
    this.nodeType = 1;
    this.nodeName = String(tag).toUpperCase();
    this.tagName = this.nodeName;
    this._tag = String(tag).toLowerCase();
    this._ns = ns || null;
    this._attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = {};
    this.style = makeStyle();
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.selected = false;
    this.multiple = false;
    this.required = false;
    this.readonly = false;
    this.title = '';
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.offsetWidth = 0;
    this.scrollTop = 0;
    allElements.add(this);
  }

  get firstChild() { return this.childNodes.length ? this.childNodes[0] : null; }
  get lastChild() { return this.childNodes.length ? this.childNodes[this.childNodes.length - 1] : null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get classList() { return makeClassList(this); }

  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }

  // className is backed by the class attribute so util.el's "el.className = v"
  // and attribute/class selectors plus classList all agree.
  get className() { return this._attrs['class'] || ''; }
  set className(v) { this._attrs['class'] = String(v); }

  get textContent() {
    let s = '';
    walk(this, (n) => { if (n.nodeType === 3) s += n._data; });
    return s;
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v != null) this.childNodes.push(new FakeText(v));
  }

  get innerHTML() { return this.textContent; }
  set innerHTML(v) {
    this.childNodes = [];
    if (v == null || v === '') return;
    // Minimal flat HTML renderer (no nesting) sufficient for the handful of
    // template strings the modules assign to innerHTML.
    const re = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)\/>/g;
    let last = 0;
    let m;
    const parts = [];
    while ((m = re.exec(v)) !== null) {
      const before = v.slice(last, m.index);
      if (before) parts.push({ text: before });
      const tag = m[1] || m[4];
      const attrs = m[2] || m[5] || '';
      const inner = m[3];
      const el = new FakeElement(tag);
      const ar = /([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g;
      let am;
      while ((am = ar.exec(attrs)) !== null) el.setAttribute(am[1], am[2]);
      if (inner != null) el.textContent = inner;
      parts.push({ el });
      last = re.lastIndex;
    }
    const tail = v.slice(last);
    if (tail) parts.push({ text: tail });
    for (const p of parts) this.appendChild(p.el || new FakeText(p.text));
  }

  appendChild(child) {
    if (child == null) return child;
    if (child.parentNode) this.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child, ref) {
    if (child == null) return child;
    if (child.parentNode) this.removeChild(child);
    child.parentNode = this;
    const i = this.childNodes.indexOf(ref);
    if (i < 0) this.childNodes.push(child);
    else this.childNodes.splice(i, 0, child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(k, v) {
    this._attrs[String(k)] = String(v);
    if (k === 'id') { /* id getter reads _attrs */ }
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, String(k)) ? this._attrs[String(k)] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, String(k)); }
  removeAttribute(k) { delete this._attrs[String(k)]; }

  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const a = this._listeners[type]; if (!a) return;
    const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
  dispatchEvent(ev) {
    if (ev && ev.type) {
      const a = (this._listeners[ev.type] || []).slice();
      for (const fn of a) { try { fn(ev); } catch (e) { /* swallow */ } }
    }
    return true;
  }
  click() { this.dispatchEvent({ type: 'click', target: this }); }
  focus() {}
  replaceWith(node) { if(this.parentNode) {const p=this.parentNode;p.insertBefore(node,this);p.removeChild(this);} }
  cloneNode(deep=false) {
    const clone=new FakeElement(this._tag,this._ns);
    for(const [name,value] of Object.entries(this._attrs))clone.setAttribute(name,value);
    Object.assign(clone.dataset,this.dataset);
    if(deep)for(const child of this.childNodes)clone.appendChild(child.nodeType===3?new FakeText(child._data):child.cloneNode(true));
    return clone;
  }
  blur() {}
  scrollIntoView() {}
  contains(node) {
    let cur = node;
    while (cur) { if (cur === this) return true; cur = cur.parentNode; }
    return false;
  }
  closest(sel) {
    let cur = this;
    while (cur) { if (cur.nodeType === 1 && matchAny(cur, sel)) return cur; cur = cur.parentNode; }
    return null;
  }
  matches(sel) { return matchAny(this, sel); }
  querySelector(sel) { return collectMatches(this, sel)[0] || null; }
  querySelectorAll(sel) { return collectMatches(this, sel); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}

export function createDomShim({ ids = [] } = {}) {
  const document = {
    nodeType: 9,
    readyState: 'complete',
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    _listeners: {},
    createElement(tag) { return new FakeElement(tag); },
    createElementNS(ns, tag) { return new FakeElement(tag, ns); },
    createTextNode(text) { return new FakeText(text); },
    getElementById(id) { return findById(id); },
    querySelector(sel) {
      if (matchAny(this.documentElement, sel)) return this.documentElement;
      return collectMatches(this.documentElement, sel)[0] || null;
    },
    querySelectorAll(sel) { return collectMatches(this.documentElement, sel); },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { const a = this._listeners[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    dispatchEvent(ev) { const a = (this._listeners[ev && ev.type] || []).slice(); a.forEach((fn) => fn(ev)); return true; },
  };

  // Pre-create the static panel roots that index.html provides, so util.byId(...)
  // resolves for every module's init().
  for (const id of ids) {
    const el = new FakeElement('div');
    el.setAttribute('id', id);
    document.body.appendChild(el);
  }

  const storage = () => {
    const m = {};
    return {
      getItem(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem(k, v) { m[String(k)] = String(v); },
      removeItem(k) { delete m[k]; },
      clear() { for (const k of Object.keys(m)) delete m[k]; },
      key(i) { return Object.keys(m)[i] || null; },
      get length() { return Object.keys(m).length; },
    };
  };

  const sandbox = {
    window: undefined,
    document,
    localStorage: storage(),
    sessionStorage: storage(),
    location: { href: 'http://127.0.0.1:3080/', origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', hostname: '127.0.0.1', port: '3080', protocol: 'http:', pathname: '/' },
    navigator: { language: 'he', userAgent: 'dom-shim' },
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    Blob: function Blob(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; },
    fetch: async () => { throw new Error('fetch is not available in the DOM shim'); },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  sandbox.confirm = () => false;
  sandbox.alert = () => {};
  const windowEvents = new Map();
  sandbox.addEventListener = (name, callback) => { const callbacks=windowEvents.get(name)||[];callbacks.push(callback);windowEvents.set(name,callbacks); };
  sandbox.removeEventListener = (name, callback) => { windowEvents.set(name,(windowEvents.get(name)||[]).filter(fn=>fn!==callback)); };
  sandbox.dispatchEvent = event => { for(const fn of windowEvents.get(event.type)||[])fn(event);return true; };
  sandbox.requestAnimationFrame = callback => setTimeout(callback, 0);
  sandbox.cancelAnimationFrame = clearTimeout;

  vm.createContext(sandbox);

  function load(filePath) {
    const src = readFileSync(filePath, 'utf8');
    vm.runInContext(src, sandbox, { filename: filePath });
  }

  return { sandbox, document, load, byId: (id) => findById(id) };
}

export const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
