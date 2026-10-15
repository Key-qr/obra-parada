// Runtime de las páginas de Obra Parada.
//
// Cada página trae dos cosas:
//   <template id="vista">   el HTML con huecos {{a.b}}, listas <sc-for> y condicionales <sc-if>
//   <script type="text/x-dc" id="logica">   class Component extends DCLogic { renderVals() {...} }
//
// renderVals() devuelve los valores de los huecos. Cada setState() vuelve a pintar: se arma el
// árbol nuevo y se compara contra el que está en pantalla nodo por nodo, así los elementos
// que siguen ahí se reutilizan y las transiciones de CSS funcionan.
(function () {
  'use strict';

  const HUECO = /\{\{\s*([^}]+?)\s*\}\}/g;
  const SOLO_HUECO = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
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
  function buscar(ruta, ambito) {
    if (ruta === 'true') return true;
    if (ruta === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(ruta)) return Number(ruta);
    const partes = ruta.split('.');
    let v = ambito[partes[0]];
    for (let i = 1; i < partes.length && v != null; i++) v = v[partes[i]];
    return v;
  }
  const texto = (s, ambito) => s.replace(HUECO, (_, r) => {
    const v = buscar(r, ambito);
    return v == null || v === false ? '' : String(v);
  });

  // ---- construir el árbol nuevo desde la plantilla ----
  function construir(nodo, ambito, destino) {
    if (nodo.nodeType === 3) {
      destino.appendChild(document.createTextNode(nodo.data.indexOf('{{') < 0 ? nodo.data : texto(nodo.data, ambito)));
      return;
    }
    if (nodo.nodeType !== 1) return;
    const tag = nodo.localName;
    // <sc-for>/<sc-if> llegan como <template sc-for> / <template sc-if> para que el parser
    // no los saque de un <select> o de una tabla
    const kids = nodo.content ? nodo.content.childNodes : nodo.childNodes;
    const esFor = tag === 'sc-for' || (tag === 'template' && nodo.hasAttribute('sc-for'));
    const esIf = tag === 'sc-if' || (tag === 'template' && nodo.hasAttribute('sc-if'));
    if (esFor) {
      const lista = buscar((nodo.getAttribute('list').match(SOLO_HUECO) || [])[1] || '', ambito) || [];
      const como = nodo.getAttribute('as') || 'item';
      for (let i = 0; i < lista.length; i++) {
        const sub = Object.create(ambito);
        sub[como] = lista[i];
        for (const h of kids) construir(h, sub, destino);
      }
      return;
    }
    if (esIf) {
      const v = buscar((nodo.getAttribute('value').match(SOLO_HUECO) || [])[1] || '', ambito);
      if (v) for (const h of kids) construir(h, ambito, destino);
      return;
    }
    const el = nodo.namespaceURI === 'http://www.w3.org/1999/xhtml'
      ? document.createElement(tag)
      : document.createElementNS(nodo.namespaceURI, nodo.tagName);
    let valor;
    for (const a of nodo.attributes) {
      const nombre = a.name;
      if (nombre.startsWith('hint-')) continue;
      const solo = a.value.match(SOLO_HUECO);
      if (EVENTOS[nombre]) {
        const fn = solo ? buscar(solo[1], ambito) : null;
        if (typeof fn === 'function') (el.__ev || (el.__ev = {}))[EVENTOS[nombre]] = fn;
        continue;
      }
      let v;
      if (solo) {
        v = buscar(solo[1], ambito);
        if (v == null) continue;
        if (typeof v === 'boolean') {
          if (nombre.startsWith('aria-') || nombre.startsWith('data-')) v = String(v);
          else if (!v) continue;
          else v = '';
        }
        v = String(v);
      } else {
        v = a.value.indexOf('{{') < 0 ? a.value : texto(a.value, ambito);
      }
      if (nombre === 'value' && (tag === 'input' || tag === 'select' || tag === 'textarea')) valor = v;
      if (a.namespaceURI) el.setAttributeNS(a.namespaceURI, nombre, v);
      else el.setAttribute(nombre, v);
    }
    for (const h of nodo.childNodes) construir(h, ambito, el);
    if (valor !== undefined) { el.__valor = valor; el.value = valor; }
    if (el.__ev) enganchar(el);
    destino.appendChild(el);
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

  // ---- llevar lo que está en pantalla al árbol nuevo ----
  function mismo(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    return a.namespaceURI === b.namespaceURI && a.localName === b.localName;
  }
  function parchar(vivo, nuevo) {
    if (vivo.nodeType === 3) {
      if (vivo.data !== nuevo.data) vivo.data = nuevo.data;
      return;
    }
    const va = vivo.attributes, na = nuevo.attributes;
    for (let i = va.length - 1; i >= 0; i--) {
      const a = va[i];
      if (!nuevo.hasAttribute(a.name)) vivo.removeAttribute(a.name);
    }
    for (const a of na) {
      if (vivo.getAttribute(a.name) !== a.value) {
        if (a.namespaceURI) vivo.setAttributeNS(a.namespaceURI, a.name, a.value);
        else vivo.setAttribute(a.name, a.value);
      }
    }
    vivo.__ev = nuevo.__ev;
    if (vivo.__ev) enganchar(vivo);
    hijos(vivo, nuevo);
    if (nuevo.__valor !== undefined) {
      vivo.__valor = nuevo.__valor;
      const enfocado = document.activeElement === vivo && vivo.type !== 'range';
      if (vivo.value !== nuevo.__valor && !enfocado) vivo.value = nuevo.__valor;
    }
  }
  function hijos(vivo, nuevo) {
    const v = Array.from(vivo.childNodes), n = Array.from(nuevo.childNodes);
    for (let i = 0; i < n.length; i++) {
      if (i >= v.length) vivo.appendChild(n[i]);
      else if (mismo(v[i], n[i])) parchar(v[i], n[i]);
      else vivo.replaceChild(n[i], v[i]);
    }
    for (let i = v.length - 1; i >= n.length; i--) vivo.removeChild(v[i]);
  }

  // ---- montar la página ----
  function montar() {
    const vista = document.getElementById('vista');
    const logica = document.getElementById('logica');
    const raiz = document.getElementById('app');
    if (!vista || !logica || !raiz) return;
    const Component = new Function('DCLogic', `${logica.textContent}\nreturn Component;`)(DCLogic);
    const c = new Component({});
    let pendiente = false, montado = false;
    const pintar = () => {
      pendiente = false;
      const vals = c.renderVals();
      const tmp = document.createElement('div');
      for (const h of vista.content.childNodes) construir(h, vals, tmp);
      if (!montado) {
        while (tmp.firstChild) raiz.appendChild(tmp.firstChild);
      } else {
        hijos(raiz, tmp);
      }
    };
    c.__pintar = () => {
      if (!montado || pendiente) return;
      pendiente = true;
      queueMicrotask(pintar);
    };
    pintar();
    montado = true;
    if (typeof c.componentDidMount === 'function') c.componentDidMount();
    window.addEventListener('pagehide', () => {
      if (typeof c.componentWillUnmount === 'function') c.componentWillUnmount();
    });
  }

  window.DCLogic = DCLogic;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
