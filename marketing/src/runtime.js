// Etkin WMS satış sitesi — küçük şablon çalışma zamanı (T-941).
// `landing.dc.html` şablonunu (Claude Design `.dc.html` biçimi) tarayıcıda çizer:
//   {{a.b}} delikleri, <sc-if value>, <sc-for list as>, on<Olay>="{{fn}}" ve
//   data-dc-options="yol" (select seçenekleri). Ön-çizilmiş HTML yerinde güncellenir
//   (sc-if/sc-for blokları yorum işaretleriyle sınırlanır; React parçaları gibi konum korunur).
// eval / new Function yoktur; CSP `script-src 'self'` ile çalışır.

const HOLE = /\{\{([\w.]+)\}\}/g;
const SINGLE = /^\{\{([\w.]+)\}\}$/;
const OPEN = "[";
const CLOSE = "]";
const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this.__mounted = false;
    this.__queued = false;
  }
  setState(update) {
    Object.assign(this.state, typeof update === "function" ? update(this.state) : update);
    if (!this.__mounted || this.__queued) return;
    this.__queued = true;
    queueMicrotask(() => {
      this.__queued = false;
      if (this.__render) this.__render();
    });
  }
}

function lookup(scope, path) {
  if (path === "true") return true;
  if (path === "false") return false;
  let v = scope;
  for (const k of path.split(".")) {
    if (v === null || v === undefined) return undefined;
    v = v[k];
  }
  return v;
}

function text(v) {
  return v === null || v === undefined || v === false ? "" : String(v);
}

function singleHole(str) {
  const m = SINGLE.exec(str || "");
  return m ? m[1] : null;
}

/** Şablon düğümlerini (template içeriği) gerçek düğümlere çizer. */
function renderInto(nodes, scope, out, handlers) {
  for (const n of nodes) {
    if (n.nodeType === 3) {
      const t = n.textContent || "";
      HOLE.lastIndex = 0;
      if (!HOLE.test(t)) {
        out.appendChild(document.createTextNode(t));
        continue;
      }
      HOLE.lastIndex = 0;
      let last = 0;
      let m;
      while ((m = HOLE.exec(t)) !== null) {
        if (m.index > last) out.appendChild(document.createTextNode(t.slice(last, m.index)));
        const span = document.createElement("span");
        span.textContent = text(lookup(scope, m[1]));
        out.appendChild(span);
        last = HOLE.lastIndex;
      }
      if (last < t.length) out.appendChild(document.createTextNode(t.slice(last)));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.localName;
    if (tag === "sc-if") {
      out.appendChild(document.createComment(OPEN));
      if (lookup(scope, singleHole(n.getAttribute("value")) || "false")) renderInto(n.childNodes, scope, out, handlers);
      out.appendChild(document.createComment(CLOSE));
      continue;
    }
    if (tag === "sc-for") {
      out.appendChild(document.createComment(OPEN));
      const list = lookup(scope, singleHole(n.getAttribute("list")) || "") || [];
      const as = n.getAttribute("as") || "item";
      for (const item of list) {
        const child = Object.create(scope);
        child[as] = item;
        renderInto(n.childNodes, child, out, handlers);
      }
      out.appendChild(document.createComment(CLOSE));
      continue;
    }
    const el = n.namespaceURI === "http://www.w3.org/2000/svg"
      ? document.createElementNS(n.namespaceURI, n.localName)
      : document.createElement(tag);
    for (const a of Array.from(n.attributes)) {
      const name = a.name;
      if (name.startsWith("hint-")) continue;
      if (/^on[a-z]+$/i.test(name)) {
        const fn = lookup(scope, singleHole(a.value) || "");
        if (typeof fn === "function") {
          handlers.push(fn);
          el.setAttribute("data-dc-" + name.slice(2).toLowerCase(), String(handlers.length - 1));
        }
        continue;
      }
      const only = singleHole(a.value);
      if (only !== null) {
        const v = lookup(scope, only);
        if (v === null || v === undefined || v === false) continue;
        el.setAttribute(name, String(v));
        continue;
      }
      el.setAttribute(name, a.value.replace(HOLE, (_m, p) => text(lookup(scope, p))));
    }
    if (tag === "select" && n.hasAttribute("data-dc-options")) {
      for (const o of lookup(scope, n.getAttribute("data-dc-options") || "") || []) {
        const opt = document.createElement("option");
        opt.textContent = text(o && typeof o === "object" ? o.n : o);
        el.appendChild(opt);
      }
    } else {
      renderInto(n.childNodes, scope, el, handlers);
    }
    out.appendChild(el);
  }
}

/** Çocuk listesini öğelere ayırır: tekil düğüm veya [ … ] bloğu. */
function itemsOf(nodes) {
  const root = [];
  const stack = [root];
  for (const node of nodes) {
    const top = stack[stack.length - 1];
    if (node.nodeType === 8 && node.data === OPEN) {
      const block = { open: node, close: null, items: [] };
      top.push(block);
      stack.push(block.items);
      continue;
    }
    if (node.nodeType === 8 && node.data === CLOSE && stack.length > 1) {
      stack.pop();
      const parentList = stack[stack.length - 1];
      parentList[parentList.length - 1].close = node;
      continue;
    }
    top.push({ node });
  }
  return root;
}

function nodesOfItem(item) {
  if (item.node) return [item.node];
  const out = [item.open];
  for (const it of item.items) out.push(...nodesOfItem(it));
  if (item.close) out.push(item.close);
  return out;
}

function sameKind(a, b) {
  return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.localName === b.localName && a.namespaceURI === b.namespaceURI));
}

function syncAttributes(from, to) {
  const skipValue = FORM_TAGS.has(from.tagName);
  for (const a of Array.from(from.attributes)) {
    if (skipValue && (a.name === "value" || a.name === "checked")) continue;
    if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
  }
  for (const a of Array.from(to.attributes)) {
    if (skipValue && (a.name === "value" || a.name === "checked")) continue;
    if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
  }
}

function morphNode(from, to) {
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  syncAttributes(from, to);
  if (from.tagName === "INPUT" || from.tagName === "TEXTAREA") return;
  if (from.tagName === "SELECT") {
    const keep = from.selectedIndex;
    morphList(from, itemsOf(Array.from(from.childNodes)), itemsOf(Array.from(to.childNodes)), null);
    if (keep >= 0 && keep < from.options.length) from.selectedIndex = keep;
    return;
  }
  morphList(from, itemsOf(Array.from(from.childNodes)), itemsOf(Array.from(to.childNodes)), null);
}

/** `parent` içinde `before` düğümünden önce kalan öğe listesini hedefe uyarlar. */
function morphList(parent, fromItems, toItems, before) {
  const count = Math.max(fromItems.length, toItems.length);
  for (let i = 0; i < count; i++) {
    const f = fromItems[i];
    const t = toItems[i];
    if (t === undefined) {
      if (f !== undefined) for (const node of nodesOfItem(f)) node.remove();
      continue;
    }
    const ref = f !== undefined ? nodesOfItem(f)[0] : before;
    if (f !== undefined && f.node && t.node && sameKind(f.node, t.node)) {
      morphNode(f.node, t.node);
      continue;
    }
    if (f !== undefined && !f.node && !t.node) {
      morphList(parent, f.items, t.items, f.close);
      continue;
    }
    for (const node of nodesOfItem(t)) parent.insertBefore(node, ref || null);
    if (f !== undefined) for (const node of nodesOfItem(f)) node.remove();
  }
}

/**
 * @param {HTMLElement} root ön-çizilmiş içerik kabı
 * @param {HTMLTemplateElement} tpl şablon
 * @param {any} comp bileşen örneği
 */
function mount(root, tpl, comp) {
  let handlers = [];
  const draw = () => {
    const next = [];
    const frag = document.createDocumentFragment();
    renderInto(Array.from(tpl.content.childNodes), comp.renderVals(), frag, next);
    handlers = next;
    morphList(root, itemsOf(Array.from(root.childNodes)), itemsOf(Array.from(frag.childNodes)), null);
    const lang = comp.state.lang || comp.props.lang;
    if (lang && document.documentElement.lang !== lang) document.documentElement.lang = lang;
  };
  for (const type of ["click", "input", "change"]) {
    root.addEventListener(type, (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-dc-" + type + "]") : null;
      if (!target || !root.contains(target)) return;
      const fn = handlers[Number(target.getAttribute("data-dc-" + type))];
      if (typeof fn === "function") fn(event);
    });
  }
  comp.__render = draw;
  draw();
  comp.__mounted = true;
  if (typeof comp.componentDidMount === "function") comp.componentDidMount();
}

window.EtkinDC = { DCLogic, mount };
