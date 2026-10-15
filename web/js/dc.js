// Runtime de las páginas de Obra Parada.
//
// Cada página trae dos cosas:
//   <template id="vista">   el HTML con huecos {{a.b}}, listas <template sc-for> y condicionales <template sc-if>
//   <script type="text/x-dc" id="logica">   class Component extends DCLogic { renderVals() {...} }
//
// La plantilla se compila una sola vez. En cada setState() se arma un árbol liviano (objetos, no
// nodos del DOM) solo con lo que tiene huecos; las partes fijas se reutilizan tal cual. Después se
// compara contra lo que está en pantalla y se tocan únicamente los atributos y textos que cambiaron,
// así los elementos se conservan y las transiciones de CSS funcionan.
(function () {
  'use strict';

  const HUECO = /\{\{\s*([^}]+?)\s*\}\}/g;
  const SOLO_HUECO = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const EVENTOS = {
    onclick: 'click', oninput: 'input', onchange: 'change', onfocus: 'focus',
    onmousemove: 'mousemove', onmouseenter: 'mouseenter', onmouseleave: 'mouseleave',
    onpointerdown: 'pointerdown', onpointermove: 'pointermove', onpointerup: 'pointerup', onpointerleave: 'pointerleave',
  };

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
    setState(parcial) {
      const p = typeof parcial === 'function' ? parcial(this.state) : parcial;
      if (!p) return;
      this.state = Object.assign({}, this.state, p);
      if (this.__pintar) this.__pintar();
    }
  }

  // ---- valores ----
  const RUTAS = new Map();
  function ruta(r) {
    let c = RUTAS.get(r);
    if (c) return c;
    if (r === 'true') c = { lit: true };
    else if (r === 'false') c = { lit: false };
    else if (/^-?\d+(\.\d+)?$/.test(r)) c = { lit: Number(r) };
    else c = { p: r.split('.') };
    RUTAS.set(r, c);
    return c;
  }
  function buscar(r, ambito) {
    if ('lit' in r) return r.lit;
    const p = r.p;
    let v = ambito[p[0]];
    for (let i = 1; i < p.length && v != null; i++) v = v[p[i]];
    return v;
  }
  // texto con huecos -> ['fijo', {ruta}, 'fijo', ...]; null si no tiene huecos
  function partes(s) {
    if (s.indexOf('{{') < 0) return null;
    const out = [];
    let ult = 0;
    s.replace(HUECO, (m, r, pos) => { out.push(s.slice(ult, pos), ruta(r)); ult = pos + m.length; return m; });
    out.push(s.slice(ult));
    return out;
  }
  function unir(p, ambito) {
    let s = '';
    for (let i = 0; i < p.length; i++) {
      const x = p[i];
      if (typeof x === 'string') s += x;
      else { const v = buscar(x, ambito); if (v != null && v !== false) s += v; }
    }
    return s;
  }

  // ---- compilar la plantilla (una vez) ----
  // Un nodo compilado sin huecos en todo su subárbol (fijo: true) sirve también como su propio
  // nodo virtual: no se vuelve a evaluar ni a comparar.
  function compilar(nodo) {
    if (nodo.nodeType === 3) {
      const p = partes(nodo.data);
      return { k: 't', s: nodo.data, p, fijo: !p };
    }
    if (nodo.nodeType !== 1) return null;
    const tag = nodo.localName;
    const fuente = nodo.content ? nodo.content.childNodes : nodo.childNodes;
    const kids = [];
    for (const h of fuente) { const c = compilar(h); if (c) kids.push(c); }
    if (tag === 'sc-for' || (tag === 'template' && nodo.hasAttribute('sc-for'))) {
      return { k: 'for', lista: ruta((nodo.getAttribute('list').match(SOLO_HUECO) || [])[1] || ''), como: nodo.getAttribute('as') || 'item', kids };
    }
    if (tag === 'sc-if' || (tag === 'template' && nodo.hasAttribute('sc-if'))) {
      return { k: 'if', v: ruta((nodo.getAttribute('value').match(SOLO_HUECO) || [])[1] || ''), kids };
    }
    const attrs = [], ev = [], fijos = {}, ns = {};
    let din = false;
    for (const a of nodo.attributes) {
      const n = a.name;
      if (n.startsWith('hint-')) continue;
      const solo = a.value.match(SOLO_HUECO);
      if (EVENTOS[n]) { if (solo) { ev.push([EVENTOS[n], ruta(solo[1])]); din = true; } continue; }
      if (a.namespaceURI) ns[n] = a.namespaceURI;
      if (solo) { attrs.push({ n, solo: ruta(solo[1]) }); din = true; continue; }
      const p = partes(a.value);
      if (p) din = true; else fijos[n] = a.value;
      attrs.push({ n, v: a.value, p });
    }
    const html = nodo.namespaceURI === XHTML;
    return {
      k: 'e', tag, ns: nodo.namespaceURI, html, crearComo: html ? tag : nodo.tagName,
      attrs, ev, kids, atFijos: fijos, attrNs: ns,
      esValor: tag === 'input' || tag === 'select' || tag === 'textarea',
      fijo: !din && kids.every((k) => k.fijo),
    };
  }

  // ---- armar el árbol virtual ----
  function armar(c, ambito, out) {
    if (c.fijo) { out.push(c); return; }
    if (c.k === 't') { out.push({ k: 't', s: unir(c.p, ambito) }); return; }
    if (c.k === 'for') {
      const lista = buscar(c.lista, ambito) || [];
      for (let i = 0; i < lista.length; i++) {
        const sub = Object.create(ambito);
        sub[c.como] = lista[i];
        for (const k of c.kids) armar(k, sub, out);
      }
      return;
    }
    if (c.k === 'if') {
      if (buscar(c.v, ambito)) for (const k of c.kids) armar(k, ambito, out);
      return;
    }
    const at = {};
    let valor;
    for (const a of c.attrs) {
      let v;
      if (a.solo) {
        v = buscar(a.solo, ambito);
        if (v == null) continue;
        if (typeof v === 'boolean') {
          if (a.n.startsWith('aria-') || a.n.startsWith('data-')) v = String(v);
          else if (!v) continue;
          else v = '';
        }
        v = String(v);
      } else v = a.p ? unir(a.p, ambito) : a.v;
      at[a.n] = v;
      if (a.n === 'value' && c.esValor) valor = v;
    }
    let ev = null;
    for (const [tipo, r] of c.ev) {
      const fn = buscar(r, ambito);
      if (typeof fn === 'function') (ev || (ev = {}))[tipo] = fn;
    }
    const kids = [];
    for (const k of c.kids) armar(k, ambito, kids);
    out.push({ k: 'e', c, at, ev, kids, valor });
  }

  // ---- del árbol virtual al DOM ----
  const compDe = (v) => (v.fijo ? v : v.c);
  const attrsDe = (v) => (v.fijo ? v.atFijos : v.at);
  function poner(el, c, n, v) {
    const ns = c.attrNs[n];
    if (ns) el.setAttributeNS(ns, n, v); else el.setAttribute(n, v);
  }
  function crear(v) {
    if (v.k === 't') return document.createTextNode(v.s);
    const c = compDe(v);
    const el = c.html ? document.createElement(c.crearComo) : document.createElementNS(c.ns, c.crearComo);
    const at = attrsDe(v);
    for (const n in at) poner(el, c, n, at[n]);
    el.__c = c; el.__at = at;
    for (const k of v.kids) el.appendChild(crear(k));
    if (!v.fijo) {
      if (v.valor !== undefined) { el.__valor = v.valor; el.value = v.valor; }
      el.__ev = v.ev;
      if (v.ev) enganchar(el);
    }
    return el;
  }
  function enganchar(el) {
    const ya = el.__tipos || (el.__tipos = new Set());
    for (const tipo in el.__ev) {
      if (ya.has(tipo)) continue;
      ya.add(tipo);
      el.addEventListener(tipo, (e) => {
        const fn = el.__ev && el.__ev[tipo];
        if (typeof fn === 'function') fn(e);
      });
    }
  }
  function mismo(vivo, v) {
    if (v.k === 't') return vivo.nodeType === 3;
    if (vivo.nodeType !== 1 || !vivo.__c) return false;
    const c = compDe(v);
    return vivo.__c === c || (vivo.__c.tag === c.tag && vivo.__c.ns === c.ns);
  }
  function parchar(vivo, v) {
    if (v.k === 't') { if (vivo.data !== v.s) vivo.data = v.s; return; }
    if (v.fijo && vivo.__c === v) return; // parte fija ya pintada: no hay nada que revisar
    const c = compDe(v);
    const antes = vivo.__at || {}, ahora = attrsDe(v);
    for (const n in antes) if (!(n in ahora)) vivo.removeAttribute(n);
    for (const n in ahora) if (antes[n] !== ahora[n]) poner(vivo, c, n, ahora[n]);
    vivo.__c = c; vivo.__at = ahora;
    vivo.__ev = v.fijo ? null : v.ev;
    if (vivo.__ev) enganchar(vivo);
    hijos(vivo, v.kids);
    if (!v.fijo && v.valor !== undefined) {
      vivo.__valor = v.valor;
      const enfocado = document.activeElement === vivo && vivo.type !== 'range';
      if (vivo.value !== v.valor && !enfocado) vivo.value = v.valor;
    }
  }
  function hijos(vivo, nuevos) {
    const v = vivo.childNodes;
    const largo = v.length;
    for (let i = 0; i < nuevos.length; i++) {
      if (i >= largo) { vivo.appendChild(crear(nuevos[i])); continue; }
      const actual = v[i];
      if (mismo(actual, nuevos[i])) parchar(actual, nuevos[i]);
      else vivo.replaceChild(crear(nuevos[i]), actual);
    }
    while (vivo.childNodes.length > nuevos.length) vivo.removeChild(vivo.lastChild);
  }

  // ---- montar la página ----
  function montar() {
    const vista = document.getElementById('vista');
    const logica = document.getElementById('logica');
    const raiz = document.getElementById('app');
    if (!vista || !logica || !raiz) return;
    const plantilla = [];
    for (const h of vista.content.childNodes) { const c = compilar(h); if (c) plantilla.push(c); }
    const Component = new Function('DCLogic', `${logica.textContent}\nreturn Component;`)(DCLogic);
    const c = new Component({});
    let pendiente = false, montado = false;
    const pintar = () => {
      pendiente = false;
      const vals = c.renderVals();
      const arbol = [];
      for (const n of plantilla) armar(n, vals, arbol);
      hijos(raiz, arbol);
    };
    c.__pintar = () => {
      if (!montado || pendiente) return;
      pendiente = true;
      queueMicrotask(pintar);
    };
    pintar();
    montado = true;
    // en el celular el menú es una fila que se desliza: se deja a la vista la página actual
    const actual = document.querySelector('header .nav a.on');
    const menu = actual && actual.parentElement;
    if (menu && menu.scrollWidth > menu.clientWidth) {
      menu.scrollLeft = actual.offsetLeft - menu.offsetLeft - (menu.clientWidth - actual.offsetWidth) / 2;
    }
    if (typeof c.componentDidMount === 'function') c.componentDidMount();
    cabeceraMovil();
    menuMas();
    window.addEventListener('pagehide', () => {
      if (typeof c.componentWillUnmount === 'function') c.componentWillUnmount();
    });
  }

  // En el celular la cabecera (menú y submenú) se esconde al bajar y vuelve al subir un poco,
  // para que no ocupe pantalla mientras se lee.
  function cabeceraMovil() {
    const cab = document.querySelector('header');
    if (!cab) return;
    const css = document.createElement('style');
    css.textContent = '@media (max-width:760px){header{transition:transform .25s ease}header.oculta{transform:translateY(-100%)}}';
    document.head.appendChild(css);
    let antes = window.scrollY, pend = false;
    window.addEventListener('scroll', () => {
      if (pend) return;
      pend = true;
      requestAnimationFrame(() => {
        pend = false;
        const y = window.scrollY;
        if (y > antes + 6 && y > 160) cab.classList.add('oculta');
        else if (y < antes - 6 || y < 160) cab.classList.remove('oculta');
        antes = y;
      });
    }, { passive: true });
  }

  // El menú "Más" se cierra al hacer clic afuera o con Escape.
  function menuMas() {
    const cerrar = (e) => document.querySelectorAll('details.mas[open]').forEach((d) => {
      if (e.key === 'Escape' || !d.contains(e.target)) d.removeAttribute('open');
    });
    document.addEventListener('click', cerrar);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(e); });
  }

  window.DCLogic = DCLogic;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
