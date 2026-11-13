// Sonora · interfaz principal
// La música sale de YouTube (videos de letra, de preferencia) o de tus archivos; el servidor local
// hace la búsqueda, entrega el audio y guarda playlists e historial en SQLite.
import { $, $$, esc, norm, fmt, fmtLong, plural, fmtBytes, shade, store } from './util.js';
import { api } from './api.js';
import { cover, hidratar, olvidarPortadas, configurarPortadas, tintFor, tinteDeImagen } from './covers.js';
import { esAudio, nombreDesdeArchivo, medirDuracion, leerEtiquetas } from './local.js';
import * as PL from './player.js';

const { P, prefs, audio, sueno } = PL;
const escritorio = matchMedia('(min-width: 1024px)');

/* ───────── datos en memoria ───────── */
const TR = new Map();      // id ('yt:…' o 'local:n') → canción
let EST = { playlists: [], hoy: [], top: [], locales: [], resumenHoy: { segundos: 0, canciones: 0 } };
const BUSQ = new Map();    // búsqueda normalizada → { estado: 'cargando' | 'listo' | 'error', ids, error }
const DIAS = new Map();    // 'AAAA-MM-DD' → ids escuchados ese día

function registrar(c) {
  if (!c || !c.id) return null;
  const yt = c.id.startsWith('yt:'); const vid = yt ? c.id.slice(3) : null;
  const t = {
    id: c.id, t: c.titulo || 'Sin título', a: c.artista || '', canal: c.canal || '', d: +c.duracion_seg || 0,
    yt, vid, local: !yt, letra: !!c.es_letra, tv: c.titulo_video || '',
    src: 'api/audio/' + encodeURIComponent(c.id),
    artURL: yt ? 'api/miniatura/' + vid : (c.tiene_portada ? 'api/portada/' + encodeURIComponent(c.id) : null),
    artURLGrande: yt ? 'api/miniatura/' + vid + '?g=1' : null,
    pal: 'sonora', motif: 'blobs', raw: c
  };
  TR.set(c.id, t); return t;
}
const crudo = id => { const t = TR.get(id); return t ? { ...t.raw, id: t.id } : null; };
const quien = t => t.a || t.canal || (t.local ? 'Tu archivo' : 'YouTube');
async function recargar() { const e = await api.estado(); Object.values(e.canciones).forEach(registrar); EST = e; }

const plMeGusta = () => EST.playlists.find(p => p.clave === 'me-gusta') || { id: 0, ids: [] };
const plMias = () => EST.playlists.filter(p => !p.clave);
const plPorId = id => EST.playlists.find(p => p.id === id);
const likeSet = () => new Set(plMeGusta().ids);
const meGusta = id => plMeGusta().ids.includes(id);

configurarPortadas({
  track: id => TR.get(id) || null,
  playlist: id => { const p = plPorId(+id); return p ? { nombre: p.nombre, paleta: null, motivo: null, canciones: p.ids } : null; }
});

/* ───────── listas (contextos de reproducción) ───────── */
function resolver(k) {
  if (!k) return null;
  const i = k.indexOf(':'); const tipo = i < 0 ? k : k.slice(0, i); const arg = i < 0 ? null : k.slice(i + 1);
  const ok = ids => ids.filter(id => TR.has(id));
  if (tipo === 'playlist') {
    const p = plPorId(+arg); if (!p || p.clave) return null; const ids = ok(p.ids);
    return { k, tipo: 'Playlist', titulo: p.nombre, portada: k, ids, sub: 'Playlist · ' + plural(ids.length, 'canción', 'canciones'), mia: true, pid: p.id };
  }
  if (tipo === 'liked') { const ids = ok(plMeGusta().ids); return { k, tipo: 'Playlist', titulo: 'Tus me gusta', portada: 'liked', ids, sub: 'Playlist · ' + plural(ids.length, 'canción', 'canciones'), fija: true, pid: 'me-gusta', agregable: true }; }
  if (tipo === 'local') { const ids = ok(EST.locales); return { k, tipo: 'Tu música', titulo: 'Tus archivos', desc: 'Canciones que subiste desde este equipo. Se guardan en la carpeta datos/locales.', portada: 'local', ids, sub: ids.length ? plural(ids.length, 'canción', 'canciones') : 'Sube tus MP3', fija: true, local: true }; }
  if (tipo === 'hoy') { const ids = ok(EST.hoy.map(h => h.cancion_id)); return { k, tipo: 'Historial', titulo: 'Escuchado hoy', desc: 'Todo lo que sonó hoy, de lo más reciente a lo más antiguo.', portada: 'hoy', ids, sub: ids.length ? plural(ids.length, 'canción', 'canciones') : 'Nada todavía', fija: true }; }
  if (tipo === 'top') { const ids = ok(EST.top); return { k, tipo: 'Playlist', titulo: 'Lo que más escuchas', desc: 'Calculada con tu historial de reproducciones.', portada: 'top', ids, sub: 'Según tu historial' }; }
  if (tipo === 'dia') { const ids = ok(DIAS.get(arg) || []); return { k, tipo: 'Historial', titulo: fechaLarga(arg), portada: 'hoy', ids, sub: plural(ids.length, 'canción', 'canciones') }; }
  if (tipo === 'buscar') return { k, tipo: 'Búsqueda', titulo: 'Tu búsqueda', ids: [], sub: '' };
  return null;
}
function fechaLarga(d) {
  try { const f = new Date(d + 'T12:00:00'); const hoy = new Date(); const ayer = new Date(Date.now() - 864e5); const mismo = (a, b) => a.toDateString() === b.toDateString();
    if (mismo(f, hoy)) return 'Hoy'; if (mismo(f, ayer)) return 'Ayer';
    const s = f.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1);
  } catch (e) { return d; }
}

/* ───────── íconos ───────── */
const sv = (d, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
const I = {
  home: sv('<path d="M3.5 10.3 12 3.6l8.5 6.7V20a.6.6 0 0 1-.6.6h-5.2v-6.1H9.3v6.1H4.1a.6.6 0 0 1-.6-.6z"/>'),
  homeOn: sv('<path d="M3.5 10.3 12 3.6l8.5 6.7V20a.6.6 0 0 1-.6.6h-5.2v-6.1H9.3v6.1H4.1a.6.6 0 0 1-.6-.6z"/>', 1),
  search: sv('<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.6 4.6"/>'),
  searchOn: sv('<circle cx="10.8" cy="10.8" r="6.8" stroke-width="3"/><path d="m16 16 4.6 4.6" stroke-width="3"/>'),
  library: sv('<path d="M5 4v16M10 4v16M14.2 4.6l5 15"/>'),
  libraryOn: sv('<path d="M5 4v16M10 4v16M14.2 4.6l5 15" stroke-width="3"/>'),
  play: sv('<path d="M8 5.4v13.2a1 1 0 0 0 1.5.86l10.6-6.6a1 1 0 0 0 0-1.72L9.5 4.54A1 1 0 0 0 8 5.4z"/>', 1),
  pause: sv('<rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/>', 1),
  next: sv('<path d="M5.5 5.6v12.8a.8.8 0 0 0 1.24.66l9.4-6.4a.8.8 0 0 0 0-1.32l-9.4-6.4a.8.8 0 0 0-1.24.66z"/><rect x="16.8" y="5" width="2.3" height="14" rx="1"/>', 1),
  prev: sv('<path d="M18.5 5.6v12.8a.8.8 0 0 1-1.24.66l-9.4-6.4a.8.8 0 0 1 0-1.32l9.4-6.4a.8.8 0 0 1 1.24.66z"/><rect x="4.9" y="5" width="2.3" height="14" rx="1"/>', 1),
  shuffle: sv('<path d="M3 7h3.4c2 0 3.2.9 4.3 2.4l2.6 3.7c1.1 1.5 2.3 2.4 4.3 2.4H21"/><path d="m18 12.5 3 3-3 3"/><path d="M3 17h3.4c1.2 0 2.1-.3 2.9-1"/><path d="M14.7 8c.8-.7 1.7-1 2.9-1H21"/><path d="m18 4 3 3-3 3"/>'),
  repeat: sv('<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20"/><path d="m17 3 3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/><path d="m7 21-3-3 3-3"/>'),
  heart: sv('<path d="M12 20.3s-7.6-4.5-9.3-9.3C1.4 7.6 3.5 4.4 6.9 4.4c2.1 0 3.6 1.1 5.1 3 1.5-1.9 3-3 5.1-3 3.4 0 5.5 3.2 4.2 6.6-1.7 4.8-9.3 9.3-9.3 9.3z"/>'),
  heartOn: sv('<path d="M12 20.3s-7.6-4.5-9.3-9.3C1.4 7.6 3.5 4.4 6.9 4.4c2.1 0 3.6 1.1 5.1 3 1.5-1.9 3-3 5.1-3 3.4 0 5.5 3.2 4.2 6.6-1.7 4.8-9.3 9.3-9.3 9.3z"/>', 1),
  more: sv('<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>', 1),
  down: sv('<path d="m6 9 6 6 6-6"/>'),
  back: sv('<path d="m15 5-7 7 7 7"/>'),
  fwd: sv('<path d="m9 5 7 7-7 7"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  minus: sv('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
  queue: sv('<path d="M4 6h13M4 11h13M4 16h7"/><path d="M15 14v6l5-3z" fill="currentColor"/>'),
  queueAdd: sv('<path d="M4 6h12M4 11h12M4 16h6"/><path d="M17 13v7M13.5 16.5h7"/>'),
  moon: sv('<path d="M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z"/>'),
  info: sv('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6v.1" stroke-width="2.6"/>'),
  trash: sv('<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13"/>'),
  edit: sv('<path d="M4 20h4L19.3 8.7a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z"/>'),
  upload: sv('<path d="M12 15.5V4M7 8.5l5-4.5 5 4.5M5 19.5h14"/>'),
  download: sv('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v8M8.5 12.5l3.5 3.5 3.5-3.5"/>'),
  check: sv('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  note: sv('<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  person: sv('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.3-3.6 4.1-5.3 7.5-5.3s6.2 1.7 7.5 5.3"/>'),
  clock: sv('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  yt: sv('<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10.2 9.3v5.4l4.6-2.7z" fill="currentColor"/>'),
  refresh: sv('<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v3.5h3.5"/><path d="M4 13a8 8 0 0 0 14.6 4.5M20 20v-3.5h-3.5"/>'),
  database: sv('<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>'),
  gear: sv('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  vol: sv('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
  volOff: sv('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  expand: sv('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  installIcon: sv('<rect x="3.5" y="4" width="17" height="12" rx="2"/><path d="M8.5 20h7M12 7.5v5M9.8 10.5 12 12.7l2.2-2.2"/>'),
  pin: sv('<path d="M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11z"/><circle cx="12" cy="10" r="2.2"/>'),
  logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#FFB547"/><rect x="8.5" y="12" width="3.2" height="8" rx="1.6" fill="#241500"/><rect x="14.4" y="8" width="3.2" height="16" rx="1.6" fill="#241500"/><rect x="20.3" y="10.5" width="3.2" height="11" rx="1.6" fill="#241500"/></svg>'
};
const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';
const LETRA = '<span class="tag-letra" title="Video con letra">Letra</span>';

/* ───────── navegación ───────── */
const RAICES = { home: () => ({ v: 'home' }), search: () => ({ v: 'search', q: '' }), library: () => ({ v: 'library' }) };
const nav = { tab: 'home', pilas: { home: [RAICES.home()], search: [RAICES.search()], library: [RAICES.library()] }, adelante: { home: [], search: [], library: [] } };
const actual = () => { const s = nav.pilas[nav.tab]; return s[s.length - 1]; };
const main = $('#main'), vista = $('#view');
let LISTAS = {};
let filtroBiblio = 'all';

function ir(entrada) { actual().scroll = main.scrollTop; nav.pilas[nav.tab].push(entrada); nav.adelante[nav.tab] = []; pintar(); main.scrollTop = 0; }
function atras() { const s = nav.pilas[nav.tab]; if (s.length > 1) { nav.adelante[nav.tab].push(s.pop()); pintar(); main.scrollTop = actual().scroll || 0; } }
function adelante() { const f = nav.adelante[nav.tab]; if (f.length) { actual().scroll = main.scrollTop; nav.pilas[nav.tab].push(f.pop()); pintar(); main.scrollTop = 0; } }
function cambiarPestana(t) {
  if (nav.tab === t) { const s = nav.pilas[t]; if (s.length > 1) { s.length = 1; nav.adelante[t] = []; pintar(); } main.scrollTop = 0; return; }
  actual().scroll = main.scrollTop; nav.tab = t; pintar(); main.scrollTop = actual().scroll || 0;
}
function irARaiz(t) {
  if (nav.tab !== t) { actual().scroll = main.scrollTop; nav.tab = t; }
  if (actual().v === RAICES[t]().v) { pintar(); main.scrollTop = 0; return; }
  ir(RAICES[t]());
}
function abrirClave(k) { if (k.startsWith('dia:')) abrirDia(k.slice(4)); else if (resolver(k)) ir({ v: 'list', k }); }
function irABuscar(q) {
  cerrarReproductor(); if (!escritorio.matches) cerrarCola();
  if (nav.tab !== 'search') { actual().scroll = main.scrollTop; nav.tab = 'search'; }
  const s = nav.pilas.search; s.length = 1; nav.adelante.search = []; s[0].q = q;
  pintar(); main.scrollTop = 0; if (q) lanzarBusqueda(q);
}

function pintar() {
  LISTAS = {};
  const s = actual(); let html = '';
  try {
    if (s.v === 'home') html = vistaInicio();
    else if (s.v === 'search') html = vistaBuscar(s);
    else if (s.v === 'library') html = vistaBiblioteca();
    else if (s.v === 'list') html = vistaLista(s);
    else if (s.v === 'ajustes') html = vistaAjustes();
  } catch (e) { console.error(e); html = barra('') + `<div class="empty" style="padding-top:40px"><strong>Algo salió mal al mostrar esta pantalla</strong>${esc(e.message)}</div>`; }
  vista.innerHTML = html;
  hidratar(vista);
  $$('.tab').forEach(b => { const on = b.dataset.tab === nav.tab; b.classList.toggle('on', on); b.querySelector('[data-icon]').innerHTML = I[b.dataset.tab + (on ? 'On' : '')]; b.setAttribute('aria-current', on ? 'page' : 'false'); });
  $$('.side-link').forEach(b => { const on = b.dataset.tab === nav.tab && actual().v === RAICES[nav.tab]().v; b.classList.toggle('on', on); });
  marcarSonando();
  alDesplazar();
  if (s.v === 'search') { const q = $('#q'); if (q) { q.addEventListener('input', alEscribirBusqueda); q.addEventListener('keydown', alEnterBusqueda); if (escritorio.matches && !s.q) q.focus({ preventScroll: true }); } }
  if (s.v === 'list') { const r = $('#recq'); if (r) r.addEventListener('keydown', alEnterAgregar); }
  if (s.v === 'ajustes') cargarAjustes();
  const cmd = $('#cmd'); if (cmd) cmd.addEventListener('keydown', alEnterComando);
  document.title = tituloVista(s) ? tituloVista(s) + ' · Sonora' : 'Sonora Música';
}
function tituloVista(s) { if (s.v === 'list') { const L = resolver(s.k); return L ? L.titulo : ''; } return { search: 'Buscar', library: 'Tu biblioteca', ajustes: 'Ajustes' }[s.v] || ''; }
function refrescar() { const st = main.scrollTop; pintar(); main.scrollTop = st; pintarLateral(); actualizarReproductorUI(); }
function alDesplazar() { const b = $('.bar', vista); if (b) b.classList.toggle('solid', main.scrollTop > 180); }
main.addEventListener('scroll', alDesplazar, { passive: true });
// Vuelve a pedir el estado al servidor (por ejemplo tras escuchar algo) sin interrumpir si estás escribiendo
let tRecarga = 0;
function programarRecarga() {
  clearTimeout(tRecarga);
  tRecarga = setTimeout(async () => {
    try { await recargar(); } catch (e) { return; }
    pintarLateral();
    const s = actual();
    if (s.v === 'home' || s.v === 'library' || (s.v === 'list' && ['hoy', 'top'].includes(s.k))) {
      // se repinta sin perder lo que estés escribiendo en la caja de comandos
      const a = document.activeElement; const foco = a && a.id && vista.contains(a) ? { id: a.id, v: a.value, i: a.selectionStart, f: a.selectionEnd } : null;
      const st = main.scrollTop; pintar(); main.scrollTop = st;
      if (foco) { const el = document.getElementById(foco.id); if (el) { el.value = foco.v; el.focus({ preventScroll: true }); try { el.setSelectionRange(foco.i, foco.f); } catch (e) { /* nada */ } } }
    }
  }, 1200);
}

/* ───────── piezas de interfaz ───────── */
function filas(listaId, k, ids, o = {}) {
  LISTAS[listaId] = { k, ids };
  const gustos = likeSet();
  return `<div class="tracks${o.num ? ' numbered' : ''}${o.cola ? ' con-cola' : ''}" data-list="${listaId}">${ids.map((id, i) => fila(id, i, o, gustos)).join('')}</div>`;
}
function fila(id, i, o, gustos) {
  const t = TR.get(id); if (!t) return '';
  const gusta = gustos.has(id); const ide = esc(id);
  const lead = o.num ? `<span class="num">${i + 1}</span>` : `<img class="thumb" data-cover="track:${ide}" data-px="48" alt="">`;
  const hecho = o.add && o.enPl && o.enPl.has(id);
  const cola = o.cola ? `<button class="icon-btn" data-act="queue-add" data-id="${ide}" aria-label="Agregar ${esc(t.t)} a la cola" title="Agregar a la cola">${I.queueAdd}</button>` : '';
  const fin = o.add
    ? `<button class="icon-btn add${hecho ? ' done' : ''}" data-act="pl-add" data-id="${ide}" aria-label="${hecho ? esc(t.t) + ' ya está en la playlist' : 'Agregar ' + esc(t.t) + ' a la playlist'}">${hecho ? I.check : I.plus}</button>`
    : `<button class="icon-btn" data-act="track-menu" data-id="${ide}" data-from="${esc(o.from || '')}" aria-label="Más opciones para ${esc(t.t)}">${I.more}</button>`;
  const origen = `<span class="row-album">${esc(t.local ? 'Tu archivo' : t.canal)}</span>`;
  return `<div class="row" role="button" tabindex="0" data-act="play-row" data-i="${i}" data-tid="${ide}">${lead}<div class="row-text"><div class="row-title">${EQ}<span class="tt">${esc(t.t)}</span></div><div class="row-sub">${gusta ? I.heartOn : ''}${t.letra ? LETRA : ''}<button class="link" data-act="search-artist" data-id="${ide}">${esc(quien(t))}</button></div></div>${origen}<span class="dur">${t.d ? fmt(t.d) : ''}</span>${cola}${fin}</div>`;
}
function tarjeta(k) {
  const L = resolver(k); if (!L) return '';
  return `<button class="card${L.redondo ? ' round' : ''}" data-act="open" data-k="${esc(k)}" data-ctx="${esc(k)}"><span class="card-art"><img class="card-cover" data-cover="${esc(L.portada)}" data-px="160" alt=""><span class="card-play" data-act="play-list" data-k="${esc(k)}" role="button" aria-label="Reproducir ${esc(L.titulo)}">${I.play}</span></span><span class="card-title">${esc(L.titulo)}</span><span class="card-sub">${esc(L.sub || '')}</span></button>`;
}
function filaBiblio(k, compacta) {
  const L = resolver(k); if (!L) return '';
  const pin = L.fija ? `<span class="pin">${I.pin}</span>` : '';
  return `<button class="lib-row${compacta ? ' compact' : ''}" data-act="open" data-k="${esc(k)}" data-ctx="${esc(k)}"><img data-cover="${esc(L.portada)}" data-px="${compacta ? 48 : 62}" alt=""><span class="lib-txt"><span class="t">${esc(L.titulo)}</span><span class="s">${pin}${esc(L.sub || L.tipo)}</span></span>${EQ}</button>`;
}
function claveBiblioteca(f) {
  const ks = [];
  if (f === 'all' || f === 'playlists') { ks.push('liked'); plMias().forEach(p => ks.push('playlist:' + p.id)); }
  if (f === 'all') ks.push('hoy');
  if ((f === 'all' || f === 'playlists') && EST.top.length) ks.push('top');
  if (f === 'all' || f === 'local') ks.push('local');
  return ks;
}
const CHIPS = [['all', 'Todo'], ['playlists', 'Playlists'], ['local', 'Tus archivos']];
const chips = () => CHIPS.map(([id, n]) => `<button class="chip${filtroBiblio === id ? ' on' : ''}" role="tab" aria-selected="${filtroBiblio === id}" data-act="lib-filter" data-f="${id}">${n}</button>`).join('');
function pintarLateral() {
  $('#side-chips').innerHTML = chips();
  $('#side-list').innerHTML = claveBiblioteca(filtroBiblio).map(k => filaBiblio(k, true)).join('');
  hidratar($('#side'));
  marcarSonando();
}
function barra(titulo, raiz) {
  const hayAtras = nav.pilas[nav.tab].length > 1, hayAdelante = nav.adelante[nav.tab].length > 0;
  return `<div class="bar${raiz ? ' root' : ''}">
    <button class="icon-btn nav-btn" data-act="back" aria-label="Volver" ${hayAtras ? '' : 'disabled'}>${I.back}</button>
    <button class="icon-btn nav-btn desk" data-act="forward" aria-label="Adelante" ${hayAdelante ? '' : 'disabled'}>${I.fwd}</button>
    <span class="bar-title">${esc(titulo)}</span><span class="spacer"></span>
    <button class="install-btn desk" data-act="install">${I.installIcon}Instalar app</button>
    <button class="icon-btn nav-btn desk" data-act="go" data-v="ajustes" aria-label="Ajustes" title="Ajustes">${I.gear}</button>
  </div>`;
}
function encabezado(titulo, extra = '') { return `<header class="top mob">${titulo}<span class="spacer"></span>${extra}</header>`; }
// Caja de "comandos", como un bot de Discord: escribe y Enter
function cajaComando(placeholder = '¿Qué suena ahora? Escribe una canción y presiona Enter') {
  return `<form class="cmd" data-form="cmd" autocomplete="off" onsubmit="return false">
    <label class="cmd-field" for="cmd">${I.note}<input id="cmd" type="search" placeholder="${esc(placeholder)}" enterkeyhint="go" aria-describedby="cmd-ayuda"></label>
    <button type="button" class="cmd-btn" data-act="cmd-play" aria-label="Reproducir">${I.play}<span>Reproducir</span></button>
    <button type="button" class="cmd-btn ghost" data-act="cmd-queue" aria-label="Agregar a la cola">${I.queueAdd}<span>A la cola</span></button>
  </form>
  <p class="cmd-ayuda" id="cmd-ayuda"><kbd>Enter</kbd> reproduce · <kbd>Shift</kbd> + <kbd>Enter</kbd> agrega a la cola · también entiende <code>!play</code>, <code>!cola</code>, <code>!skip</code>, <code>!pausa</code></p>`;
}

/* ───────── pantallas ───────── */
function vistaInicio() {
  const h = new Date().getHours();
  const saludo = h < 5 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const hoy = resolver('hoy');
  const rapidas = ['liked', ...plMias().map(p => 'playlist:' + p.id)];
  if (hoy.ids.length) rapidas.splice(1, 0, 'hoy');
  if (EST.locales.length) rapidas.push('local');
  const min = Math.round((EST.resumenHoy.segundos || 0) / 60);
  return `${barra('', true)}
  ${encabezado(`<div class="brand">${I.logo}<span>Sonora</span></div>`, `<button class="install-btn icon-only" data-act="install" aria-label="Instalar app">${I.installIcon}</button><button class="icon-btn" data-act="go" data-v="ajustes" aria-label="Ajustes">${I.gear}</button>`)}
  <h1 class="greet">${esc(saludo)}</h1>
  ${cajaComando()}
  <div class="quick">${rapidas.slice(0, 8).map(k => { const L = resolver(k); if (!L) return ''; return `<button class="quick-item" data-act="open" data-k="${esc(k)}" data-ctx="${esc(k)}"><img data-cover="${esc(L.portada)}" data-px="56" alt=""><span>${esc(L.titulo)}</span><span class="quick-play" data-act="play-list" data-k="${esc(k)}" role="button" aria-label="Reproducir ${esc(L.titulo)}">${I.play}</span></button>`; }).join('')}</div>
  <section><div class="sec-head"><h2 class="sec-title">Escuchado hoy</h2>${hoy.ids.length ? `<button class="link-more" data-act="open" data-k="hoy">Mostrar todo</button>` : ''}</div>
    ${hoy.ids.length ? `<p class="sec-sub">${plural(EST.resumenHoy.canciones || 0, 'canción', 'canciones')} · ${min} min</p>${filas('hoy', 'hoy', hoy.ids.slice(0, 6), { from: 'hoy' })}` : `<div class="empty-card">${I.clock}<div><strong>Hoy todavía no suena nada</strong>Escribe arriba el nombre de una canción. Lo que escuches hoy aparecerá aquí.</div></div>`}</section>
  <section><h2 class="sec-title">Tus playlists</h2><div class="rail">${['liked', ...plMias().map(p => 'playlist:' + p.id)].map(tarjeta).join('')}<button class="card card-new" data-act="new-playlist"><span class="card-art"><span class="card-cover new-cover">${I.plus}</span></span><span class="card-title">Crear playlist</span><span class="card-sub">Junta tus favoritas</span></button></div></section>
  ${EST.top.length ? `<section><div class="sec-head"><h2 class="sec-title">Lo que más escuchas</h2><button class="link-more" data-act="open" data-k="top">Mostrar todo</button></div>${filas('top', 'top', resolver('top').ids.slice(0, 5), { from: 'top' })}</section>` : ''}
  <section class="cta"><div><h2>¿Tienes tus propios MP3?</h2><p>Súbelos y suenan junto con lo de YouTube. Se guardan en este computador y puedes ponerlos en tus playlists.</p><button class="btn" data-act="import">${I.upload}Subir canciones</button></div>${I.note}</section>`;
}

function vistaBuscar(s) {
  return `${barra('Buscar', true)}
  ${encabezado('<h1 class="page-title">Buscar</h1>')}
  <div class="search-field"><label class="field" for="q">${I.search}<input id="q" type="search" placeholder="Canción, artista o un pedazo de la letra" value="${esc(s.q || '')}" autocomplete="off" enterkeyhint="search"></label></div>
  <p class="cmd-ayuda">Busca en YouTube y prefiere videos con letra. <kbd>Enter</kbd> reproduce el mejor resultado.</p>
  <div id="results">${resultados(s.q || '')}</div>`;
}
let tBusqueda = 0;
function alEscribirBusqueda(e) {
  const v = e.target.value; actual().q = v; clearTimeout(tBusqueda);
  if (norm(v).trim().length < 2) { pintarResultados(); return; }
  tBusqueda = setTimeout(() => lanzarBusqueda(v), 650);
}
function alEnterBusqueda(e) {
  if (e.key !== 'Enter') return; e.preventDefault(); clearTimeout(tBusqueda);
  const v = e.target.value.trim(); if (v.length < 2) return;
  comando(v, e.shiftKey ? 'cola' : 'play');
}
function pintarResultados() { const box = $('#results'); if (!box) return; box.innerHTML = resultados(actual().q || ''); hidratar(box); marcarSonando(); }
async function buscarIds(texto) {
  const k = norm(texto).trim();
  const b = BUSQ.get(k); if (b && b.estado === 'listo') return b.ids;
  if (b && b.estado === 'cargando') return b.promesa;
  const promesa = api.buscar(texto).then(r => {
    const ids = r.resultados.map(c => registrar(c).id);
    BUSQ.set(k, { estado: 'listo', ids });
    if (ids[0]) api.precargar(ids[0]); // el mejor resultado queda listo para sonar
    return ids;
  }).catch(err => { BUSQ.set(k, { estado: 'error', error: err.message }); throw err; });
  BUSQ.set(k, { estado: 'cargando', promesa });
  return promesa;
}
async function lanzarBusqueda(texto) {
  const k = norm(texto).trim(); if (k.length < 2) return;
  const recientes = store.get('sonora.busquedas', []).filter(x => norm(x) !== k); recientes.unshift(texto.trim()); store.set('sonora.busquedas', recientes.slice(0, 8));
  const p = buscarIds(texto); pintarResultados();
  try { await p; } catch (e) { /* el error se muestra en los resultados */ }
  if (actual().v === 'search' && norm(actual().q || '').trim() === k) pintarResultados();
}
function esqueleto(n) { return `<div class="tracks">${Array.from({ length: n }, () => '<div class="row sk-row"><span class="sk sk-img"></span><div class="row-text"><span class="sk sk-l1"></span><span class="sk sk-l2"></span></div></div>').join('')}</div>`; }
function resultados(texto) {
  const k = norm(texto).trim();
  if (k.length < 2) {
    const rec = store.get('sonora.busquedas', []);
    return `${rec.length ? `<h2 class="sec-title">Búsquedas recientes</h2><div class="chips wrap-chips">${rec.map(r => `<button class="chip" data-act="search-again" data-q="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
      <div class="empty-card">${I.yt}<div><strong>Todo YouTube, sin video</strong>Sonora busca la canción, elige un video con letra (suena igual que el disco, sin las intros ni los cortes de los videos oficiales) y reproduce solo el audio.</div></div>`;
  }
  const b = BUSQ.get(k);
  if (!b || b.estado === 'cargando') return `<p class="sec-sub buscando">Buscando «${esc(texto)}» en YouTube…</p>${esqueleto(6)}`;
  if (b.estado === 'error') return `<div class="empty"><strong>No se pudo buscar</strong>${esc(b.error)}<br><button class="btn" data-act="search-again" data-q="${esc(texto)}">${I.refresh}Intentar otra vez</button></div>`;
  const ids = b.ids.filter(id => TR.has(id));
  if (!ids.length) return `<div class="empty"><strong>No encontramos «${esc(texto)}»</strong>Prueba con el nombre del artista y la canción.</div>`;
  const t = TR.get(ids[0]); const ide = esc(t.id);
  LISTAS.best = { k: 'buscar', ids: [t.id] };
  const principal = `<div class="result-top" data-list="best"><div class="row-like" role="button" tabindex="0" data-act="play-row" data-i="0" data-tid="${ide}"><img data-cover="track:${ide}" data-px="120" alt=""><strong>${esc(t.t)}</strong><span class="tag">${t.letra ? LETRA : ''}Canción · ${esc(quien(t))}${t.d ? ' · ' + fmt(t.d) : ''}</span></div>
    <div class="result-acts"><button class="btn" data-act="play-row-best" data-id="${ide}">${I.play}Reproducir</button><button class="btn ghost" data-act="queue-add" data-id="${ide}">${I.queueAdd}A la cola</button><button class="icon-btn" data-act="track-menu" data-id="${ide}" data-from="buscar" aria-label="Más opciones">${I.more}</button></div></div>`;
  return `<div class="results-grid"><section class="res-top"><h2 class="sec-title">Mejor resultado</h2>${principal}</section>
    ${ids.length > 1 ? `<section class="res-songs"><h2 class="sec-title">Otras versiones</h2>${filas('search', 'buscar', ids.slice(1), { from: 'buscar', cola: true })}</section>` : ''}</div>`;
}

function vistaBiblioteca() {
  return `${barra('Tu biblioteca', true)}
  ${encabezado('<h1 class="page-title">Tu biblioteca</h1>', `<button class="icon-btn" data-act="import" aria-label="Subir canciones">${I.upload}</button><button class="icon-btn" data-act="new-playlist" aria-label="Crear playlist">${I.plus}</button>`)}
  <h1 class="page-title desk" style="margin:8px 0 4px">Tu biblioteca</h1>
  <div class="chips" role="tablist">${chips()}</div>
  ${filtroBiblio !== 'local' ? `<button class="lib-row" data-act="new-playlist"><span class="lib-plus">${I.plus}</span><span class="lib-txt"><span class="t">Crear playlist</span><span class="s">Junta tus canciones favoritas</span></span></button>` : ''}
  ${claveBiblioteca(filtroBiblio).map(k => filaBiblio(k)).join('')}`;
}

function vistaLista(s) {
  const L = resolver(s.k);
  if (!L) return `${barra('')}<div class="empty" style="padding-top:40px"><strong>Esta lista ya no existe</strong>Puede que la hayas eliminado.</div>`;
  const total = L.ids.reduce((a, id) => a + (TR.get(id) ? TR.get(id).d : 0), 0);
  const tinte = shade(tintFor(L.portada), .35);
  const meta = L.ids.length ? `${plural(L.ids.length, 'canción', 'canciones')}${total ? ', ' + fmtLong(total) : ''}` : 'Vacía';
  const extra = L.mia
    ? `<button class="icon-btn" data-act="pl-rename" data-id="${L.pid}" aria-label="Cambiar nombre">${I.edit}</button><button class="icon-btn" data-act="pl-delete" data-id="${L.pid}" aria-label="Eliminar playlist">${I.trash}</button>`
    : (L.local ? `<button class="icon-btn" data-act="import" aria-label="Subir canciones">${I.upload}</button>` : '');
  let cuerpo;
  if (L.ids.length) cuerpo = `<div class="tracks-head desk"><span>#</span><span>Título</span><span>Canal</span><span>Duración</span></div>` + filas('main', s.k, L.ids, { from: s.k });
  else if (s.k === 'liked') cuerpo = `<div class="empty"><strong>Aún no tienes me gusta</strong>Toca el corazón mientras suena una canción y aparecerá aquí.</div>`;
  else if (s.k === 'local') cuerpo = `<div class="empty"><strong>Trae tu propia música</strong>Elige archivos MP3, M4A, WAV, OGG u OPUS. Se guardan en este computador.<br><button class="btn" data-act="import">${I.upload}Elegir canciones</button></div>`;
  else if (s.k === 'hoy') cuerpo = `<div class="empty"><strong>Hoy todavía no suena nada</strong>Lo que escuches más de 10 segundos aparecerá aquí.</div>`;
  else if (s.k === 'top') cuerpo = `<div class="empty"><strong>Todavía no hay historial</strong>Escucha canciones al menos 30 segundos y aquí aparecerán las que más repites.</div>`;
  else cuerpo = `<div class="empty"><strong>Tu playlist está vacía</strong>Busca canciones abajo o usa ⋯ › Agregar a una playlist en cualquier canción.</div>`;
  const agregar = L.mia || L.agregable ? `<div class="sub-sec"><h3>Agregar canciones</h3><p>Escribe y presiona Enter para buscar en YouTube.</p><label class="field" for="recq">${I.search}<input id="recq" type="search" placeholder="Buscar canciones" autocomplete="off" enterkeyhint="search" value="${esc(s.rq || '')}"></label><div id="recs">${agregables(L, s.rq || '')}</div></div>` : '';
  return `${barra(L.titulo).replace('class="bar"', `class="bar" style="--bar-bg:${tinte}"`)}
  <div class="head" style="--tint:${tinte}">
    <img class="hero-cover" data-cover="${esc(L.portada)}" data-px="232" alt="">
    <div class="head-txt">
      <span class="kind">${esc(L.tipo)}</span>
      <h1 class="list-title">${esc(L.titulo)}</h1>
      ${L.desc ? `<p class="list-desc">${esc(L.desc)}</p>` : ''}
      <div class="list-meta">${I.logo}<strong>Sonora</strong><span>· ${meta}</span></div>
    </div>
  </div>
  <div class="actions">
    ${L.ids.length ? `<button class="play-big" data-act="play-list" data-k="${esc(s.k)}" data-play-k="${esc(s.k)}" aria-label="Reproducir">${I.play}</button><button class="icon-btn${prefs.shuffle ? ' on' : ''}" data-act="shuffle" aria-label="Aleatorio" aria-pressed="${prefs.shuffle}">${I.shuffle}</button><button class="icon-btn" data-act="list-queue" data-k="${esc(s.k)}" aria-label="Agregar todo a la cola" title="Agregar todo a la cola">${I.queueAdd}</button>` : ''}
    ${extra}<span class="grow"></span>
  </div>
  ${cuerpo}${agregar}`;
}
function agregables(L, texto) {
  const k = norm(texto).trim(); if (k.length < 2) return '';
  const b = BUSQ.get(k);
  if (!b || b.estado === 'cargando') return esqueleto(4);
  if (b.estado === 'error') return `<div class="empty">${esc(b.error)}</div>`;
  const enPl = new Set(L.ids);
  return filas('recs', 'buscar', b.ids.filter(id => TR.has(id)).slice(0, 8), { add: true, enPl });
}
async function alEnterAgregar(e) {
  if (e.key !== 'Enter') return; e.preventDefault();
  const s = actual(); s.rq = e.target.value.trim(); const L = resolver(s.k); if (!L || s.rq.length < 2) return;
  const box = $('#recs'); box.innerHTML = esqueleto(4);
  try { await buscarIds(s.rq); } catch (err) { /* se muestra abajo */ }
  if (actual() === s) { const b2 = $('#recs'); if (b2) { b2.innerHTML = agregables(resolver(s.k), s.rq); hidratar(b2); marcarSonando(); } }
}

async function abrirDia(dia) {
  try { const r = await api.dia(dia); Object.values(r.canciones).forEach(registrar); DIAS.set(dia, r.filas.map(f => f.cancion_id)); ir({ v: 'list', k: 'dia:' + dia }); }
  catch (e) { aviso(e.message); }
}

function vistaAjustes() {
  const min = Math.round((EST.resumenHoy.segundos || 0) / 60);
  return `${barra('Ajustes')}
  <h1 class="list-title" style="margin-top:8px">Ajustes</h1>
  <section><h2 class="sec-title">Hoy</h2><div class="stats">
    <div class="stat"><strong class="tnum">${min}</strong><span>minutos escuchados</span></div>
    <div class="stat"><strong class="tnum">${EST.resumenHoy.canciones || 0}</strong><span>canciones distintas</span></div>
    <div class="stat"><strong class="tnum">${plMias().length}</strong><span>playlists</span></div>
    <div class="stat"><strong class="tnum">${plMeGusta().ids.length}</strong><span>me gusta</span></div>
  </div></section>
  <section><h2 class="sec-title">Historial por día</h2><div class="list-box" id="hist"><div class="opt-row"><span class="grow muted">Cargando…</span></div></div></section>
  <section><h2 class="sec-title">Caché</h2><p class="muted small" style="margin-bottom:10px">Sonora guarda en este computador las búsquedas y las canciones que ya sonaron, para que la próxima vez empiecen al instante y dependan menos de YouTube.</p><div class="list-box">
    <div class="opt-row"><span class="ico">${I.download}</span><span class="grow">Canciones guardadas<small id="c-audio">…</small></span><button class="btn ghost sm" data-act="clear-audio">Vaciar</button></div>
    <div class="opt-row"><span class="ico">${I.search}</span><span class="grow">Búsquedas guardadas<small id="c-busq">…</small></span><button class="btn ghost sm" data-act="clear-search">Vaciar</button></div>
    <div class="opt-row"><span class="ico">${I.yt}</span><span class="grow">yt-dlp<small id="c-yt">…</small></span><button class="btn ghost sm" data-act="update-ytdlp">Actualizar</button></div>
  </div></section>
  <section><h2 class="sec-title">App</h2><div class="list-box">
    <button class="opt-row as-btn install-row" data-act="install"><span class="ico">${I.installIcon}</span><span class="grow">Instalar Sonora como app<small>Ícono propio y ventana aparte</small></span></button>
    <div class="opt-row"><span class="ico">${I.database}</span><span class="grow">Base de datos<small>datos/sonora.sqlite · playlists, historial y caché de búsquedas. Se abre con DB Browser for SQLite.</small></span></div>
  </div></section>`;
}
async function cargarAjustes() {
  try {
    const [inf, h] = await Promise.all([api.info(), api.historial()]);
    const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
    set('#c-audio', `${plural(inf.audio.canciones, 'canción', 'canciones')} · ${fmtBytes(inf.audio.bytes)} de ${fmtBytes(inf.audio.limite)}`);
    set('#c-busq', `${plural(inf.busquedas, 'búsqueda', 'búsquedas')} · duran 14 días`);
    set('#c-yt', inf.ytdlp ? 'Versión ' + inf.ytdlp : 'No encontrado: revisa la carpeta servidor/bin');
    const box = $('#hist'); if (!box) return;
    box.innerHTML = h.dias.length ? h.dias.map(d => `<button class="opt-row as-btn" data-act="open" data-k="dia:${esc(d.dia)}"><span class="ico">${I.clock}</span><span class="grow">${esc(fechaLarga(d.dia))}<small>${plural(d.canciones, 'canción', 'canciones')} · ${Math.round(d.segundos / 60)} min</small></span>${I.fwd}</button>`).join('')
      : '<div class="opt-row"><span class="grow muted">Todavía no hay historial.</span></div>';
  } catch (e) { const box = $('#hist'); if (box) box.innerHTML = `<div class="opt-row"><span class="grow sql-error">${esc(e.message)}</span></div>`; }
}

/* ───────── comandos (estilo bot) ───────── */
async function comando(texto, modo) {
  let t = texto.trim();
  const m = /^[!/](\w+)\s*(.*)$/.exec(t);
  if (m) {
    const c = m[1].toLowerCase(); t = m[2].trim();
    if (['skip', 's', 'next', 'siguiente'].includes(c)) { PL.siguiente(); return; }
    if (['pause', 'pausa', 'stop', 'para'].includes(c)) { PL.pausar(); aviso('En pausa'); return; }
    if (['resume', 'r', 'sigue', 'continuar'].includes(c)) { PL.asegurarYReproducir(); return; }
    if (['np', 'ahora'].includes(c)) { abrirReproductor(); return; }
    if (['queue', 'q', 'cola', 'add', 'a'].includes(c) && !t) { abrirCola(); return; }
    if (['queue', 'q', 'cola', 'add', 'a'].includes(c)) modo = 'cola';
    else if (['play', 'p', 'pon'].includes(c)) modo = 'play';
    else { aviso('Comandos: !play, !cola, !skip, !pausa, !np'); return; }
  }
  if (t.length < 2) return;
  aviso(`Buscando «${t}»…`);
  let ids;
  try { ids = await buscarIds(t); } catch (e) { aviso(e.message); return; }
  const id = ids[0]; const c = TR.get(id);
  if (!c) { aviso(`No encontré «${t}»`); return; }
  if (modo === 'cola') { encolar(id); return; }
  PL.reproducirContexto('buscar', [id], 0);
  aviso(`Reproduciendo: ${c.t} — ${quien(c)}`);
  const s = actual(); if (s.v === 'search') pintarResultados();
}
function encolar(id) {
  const c = TR.get(id); if (!c) return;
  PL.agregarACola(id);
  if (P.cur == null) { PL.cargar(P.up.shift(), { play: true }); aviso(`Reproduciendo: ${c.t}`); return; }
  aviso(`En la cola (${P.up.length}): ${c.t}`);
  if (P.up.length === 1) api.precargar(id);
}
function alEnterComando(e) {
  if (e.key !== 'Enter') return; e.preventDefault();
  const v = e.target.value; if (!v.trim()) return;
  comando(v, e.shiftKey ? 'cola' : 'play'); e.target.value = '';
}

/* ───────── reproductor: interfaz ───────── */
function marcarSonando() {
  const sonando = !audio.paused && P.loaded != null;
  document.body.classList.toggle('is-paused', !sonando);
  $$('[data-tid]').forEach(el => el.classList.toggle('is-playing', el.dataset.tid === P.cur));
  $$('[data-ctx]').forEach(el => el.classList.toggle('is-ctx', el.dataset.ctx === P.k && P.loaded != null));
  $$('[data-play-k]').forEach(el => { const on = el.dataset.playK === P.k && sonando; el.innerHTML = on ? I.pause : I.play; el.setAttribute('aria-label', on ? 'Pausar' : 'Reproducir'); });
}
function sincronizarEstado() {
  const sonando = !audio.paused && P.loaded != null;
  $$('.js-play').forEach(b => { b.innerHTML = sonando ? I.pause : I.play; b.setAttribute('aria-label', sonando ? 'Pausar' : 'Reproducir'); });
  marcarSonando();
  PL.actualizarSesionMultimedia(null);
}
function aplicarTinte(tinte) {
  $('#mini').style.setProperty('--mini-bg', shade(tinte, .55));
  $('#player').style.setProperty('--p-tint', shade(tinte, .3));
  document.documentElement.style.setProperty('--now', tinte);
}
function actualizarReproductorUI() {
  const t = TR.get(P.cur);
  document.body.classList.toggle('sin-cancion', !t);
  if (!t) { sincronizarEstado(); return; }
  const gusta = meGusta(t.id);
  $$('.js-cover').forEach(img => { const u = cover('track:' + t.id, +img.dataset.px || 56); if (img.getAttribute('src') !== u) img.src = u; });
  $$('.js-title').forEach(el => { el.textContent = t.t; });
  $$('.js-artist').forEach(el => { el.textContent = quien(t); });
  $$('.js-like').forEach(b => { b.innerHTML = gusta ? I.heartOn : I.heart; b.classList.toggle('liked', gusta); b.setAttribute('aria-label', gusta ? 'Quitar de Tus me gusta' : 'Agregar a Tus me gusta'); });
  $$('.js-shuffle').forEach(b => { b.classList.toggle('on', prefs.shuffle); b.setAttribute('aria-pressed', prefs.shuffle); });
  $$('.js-repeat').forEach(b => { b.classList.toggle('on', prefs.repeat !== 'off'); b.innerHTML = I.repeat + (prefs.repeat === 'one' ? '<span class="one">1</span>' : ''); b.setAttribute('aria-label', prefs.repeat === 'off' ? 'Repetir: desactivado' : prefs.repeat === 'all' ? 'Repetir: toda la lista' : 'Repetir: esta canción'); });
  const L = resolver(P.k); $('#p-from').textContent = P.k === 'buscar' || !L ? (t.letra ? 'YouTube · video con letra' : (t.local ? 'Tus archivos' : 'YouTube')) : L.titulo;
  aplicarTinte(tintFor('track:' + t.id));
  if (t.artURL) tinteDeImagen(t.artURL).then(hex => { if (hex && P.cur === t.id) aplicarTinte(hex); });
  sincronizarEstado(); actualizarProgreso();
}
let arrastrando = false;
function duracionActual() { const t = TR.get(P.cur); return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (t ? t.d : 0); }
function actualizarProgreso() {
  const d = duracionActual(); const c = P.loaded === P.cur ? (audio.currentTime || 0) : (P.resumeAt || 0);
  const pct = d ? Math.min(100, c / d * 100) : 0;
  $$('.js-prog').forEach(el => { el.style.width = pct + '%'; });
  if (!arrastrando) { $$('.js-range').forEach(r => { r.value = Math.round(pct * 10); r.style.setProperty('--p', pct + '%'); }); $$('.js-cur').forEach(el => { el.textContent = fmt(c); }); }
  $$('.js-dur').forEach(el => { el.textContent = fmt(d); });
  const b = $('#p-sleep'), l = $('#p-sleep-l');
  if (b) { b.classList.toggle('on', !!sueno.modo); l.textContent = sueno.modo === 'tiempo' ? fmt(Math.max(0, (sueno.fin - Date.now()) / 1000)) : sueno.modo === 'cancion' ? 'Fin de canción' : 'Temporizador'; }
  $$('.js-sleep').forEach(x => x.classList.toggle('on', !!sueno.modo));
}
$$('.js-range').forEach(r => {
  r.addEventListener('input', () => { arrastrando = true; r.style.setProperty('--p', (r.value / 10) + '%'); $$('.js-cur').forEach(el => { el.textContent = fmt(r.value / 1000 * duracionActual()); }); });
  r.addEventListener('change', () => { PL.buscarEn(r.value / 1000 * duracionActual()); arrastrando = false; actualizarProgreso(); });
});
const vol = $('#b-vol');
function pintarVolumen() { vol.value = Math.round(prefs.volumen * 100); vol.style.setProperty('--p', (prefs.volumen * 100) + '%'); $('#b-vol-ico').innerHTML = prefs.volumen > 0 ? I.vol : I.volOff; }
vol.addEventListener('input', () => { PL.fijarVolumen(vol.value / 100); pintarVolumen(); });
let volAnterior = 1;
function silenciar() { if (prefs.volumen > 0) { volAnterior = prefs.volumen; PL.fijarVolumen(0); } else PL.fijarVolumen(volAnterior || 1); pintarVolumen(); }

function abrirReproductor() { const p = $('#player'); p.classList.add('open'); p.setAttribute('aria-hidden', 'false'); actualizarReproductorUI(); setTimeout(() => { const b = $('#player [data-act="close-player"]'); if (b) b.focus({ preventScroll: true }); }, 60); }
function cerrarReproductor() { const p = $('#player'); p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); }
function renderCola() {
  const box = $('#q-body'); if (!box || !$('#queue').classList.contains('open')) return;
  const t = TR.get(P.cur); const L = resolver(P.k); const sig = PL.proximas(40); const gustos = likeSet();
  LISTAS.q_up = { k: null, ids: P.up.slice() };
  box.innerHTML = `${t ? `<div class="q-label">Sonando ahora</div><div class="tracks">${fila(t.id, 0, {}, gustos).replace('data-act="play-row"', 'data-act="open-player"')}</div>` : ''}
    ${P.up.length ? `<div class="q-label">En tu cola <span>· ${P.up.length}</span></div><div class="tracks">${P.up.map((id, i) => fila(id, i, {}, gustos).replace('data-act="play-row"', 'data-act="q-jump-up"').replace(/data-act="track-menu"[^>]*aria-label="[^"]*"/, `data-act="q-remove" data-i="${i}" aria-label="Quitar de la cola"`).replace(I.more, I.minus)).join('')}</div>` : ''}
    ${sig.length ? `<div class="q-label">Después, de: <span>${esc(L && P.k !== 'buscar' ? L.titulo : 'tu búsqueda')}</span></div><div class="tracks">${sig.map((id, i) => fila(id, i, {}, gustos).replace('data-act="play-row"', `data-act="q-jump" data-off="${i + 1}"`)).join('')}</div>` : ''}
    ${!P.up.length && !sig.length ? '<div class="empty">La cola está vacía. Escribe una canción en Inicio y presiona <kbd>Shift</kbd> + <kbd>Enter</kbd>, o usa ⋯ › Agregar a la cola.</div>' : ''}
    ${P.up.length ? `<div class="row-btns"><button class="btn ghost sm" data-act="q-clear">Vaciar la cola</button></div>` : ''}`;
  hidratar(box); marcarSonando();
}
function abrirCola() { const q = $('#queue'); if (q.classList.contains('open')) { cerrarCola(); return; } q.classList.add('open'); q.setAttribute('aria-hidden', 'false'); renderCola(); }
function cerrarCola() { const q = $('#queue'); q.classList.remove('open'); q.setAttribute('aria-hidden', 'true'); }
function metaSesion() {
  const t = TR.get(P.cur); if (!t) return null;
  const arte = t.artURLGrande || t.artURL;
  return { title: t.t, artist: quien(t), album: t.local ? 'Tus archivos' : 'YouTube', artwork: arte ? [{ src: new URL(arte, location.href).href, sizes: '480x360', type: 'image/jpeg' }] : [{ src: cover('track:' + t.id, 256), sizes: '512x512', type: 'image/jpeg' }] };
}

PL.configurarReproductor({
  track: id => TR.get(id),
  metas: ids => { const o = {}; ids.forEach(id => { const c = crudo(id); if (c) o[id] = c; }); return o; },
  cambio: () => { actualizarReproductorUI(); marcarSonando(); renderCola(); PL.actualizarSesionMultimedia(metaSesion()); },
  estado: () => sincronizarEstado(),
  progreso: () => actualizarProgreso(),
  aviso: m => aviso(m),
  precargar: id => { const t = TR.get(id); if (t && t.yt) api.precargar(id); },
  escucha: (id, k) => { const c = crudo(id); if (!c) return null; return api.reproduccion(c, k || null).catch(() => null); },
  segundos: (rid, s) => { Promise.resolve(rid).then(r => r && api.segundos(r, s)).then(programarRecarga).catch(() => {}); },
  cola: () => renderCola()
});

function reproducirClave(k) {
  const L = resolver(k);
  if (!L || !L.ids.length) { aviso('Esta lista está vacía'); return; }
  if (P.k === k && P.cur != null && L.ids.includes(P.cur)) { PL.alternar(); return; }
  PL.reproducirContexto(k, L.ids, prefs.shuffle ? Math.floor(Math.random() * L.ids.length) : 0);
}

/* ───────── me gusta y playlists ───────── */
async function hacer(promesa, ok) {
  try { const r = await promesa; await recargar(); if (ok) aviso(typeof ok === 'function' ? ok(r) : ok); olvidarPortadas(k => k.startsWith('playlist:')); refrescar(); return r; }
  catch (e) { aviso(e.message); return null; }
}
async function alternarMeGusta(id) {
  const c = crudo(id); if (!c) return;
  if (meGusta(id)) await hacer(api.quitarDePlaylist('me-gusta', id), 'Quitada de Tus me gusta');
  else { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* nada */ } await hacer(api.agregarAPlaylist('me-gusta', c), 'Agregada a Tus me gusta'); }
}
async function crearPlaylist(nombre, primera) {
  const n = String(nombre || '').trim().slice(0, 80) || 'Mi playlist n.º ' + (plMias().length + 1);
  const r = await hacer(api.crearPlaylist(n, primera ? crudo(primera) : undefined), primera ? `Agregada a «${n}»` : `Creaste «${n}»`);
  return r ? r.id : null;
}
function agregarAPlaylist(pid, cid) {
  const p = plPorId(+pid); const c = crudo(cid); if (!p || !c) return;
  return hacer(api.agregarAPlaylist(p.id, c), r => r.agregada ? `Agregada a «${p.nombre}»` : `Ya está en «${p.nombre}»`);
}

/* ───────── hojas de opciones, diálogos y avisos ───────── */
let hojaAbierta = false;
function abrirHoja(html) { const s = $('#sheet'); s.innerHTML = '<div class="grab"></div>' + html; hidratar(s); s.classList.add('open'); s.setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('open'); hojaAbierta = true; const f = s.querySelector('button'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30); }
function cerrarHoja() { const s = $('#sheet'); s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('open'); hojaAbierta = false; }
const opcion = (act, label, icon, data = {}, cls = '') => `<button class="sheet-item ${cls}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${icon}<span>${label}</span></button>`;
function menuCancion(id, desde) {
  const t = TR.get(id); if (!t) return;
  const gusta = meGusta(id); const L = desde ? resolver(desde) : null;
  abrirHoja(`<div class="sheet-head"><img data-cover="track:${esc(id)}" data-px="52" alt=""><div><strong>${esc(t.t)}</strong><span>${esc(quien(t))}${t.letra ? ' · video con letra' : ''}</span></div></div>
    ${opcion('queue-add', 'Agregar a la cola', I.queueAdd, { id })}
    ${opcion('like', gusta ? 'Quitar de Tus me gusta' : 'Agregar a Tus me gusta', gusta ? I.heartOn : I.heart, { id }, gusta ? 'on' : '')}
    ${opcion('pick-playlist', 'Agregar a una playlist', I.plus, { id })}
    ${t.a || t.canal ? opcion('search-artist', `Buscar más de ${esc(quien(t))}`, I.person, { id }) : ''}
    ${t.yt ? opcion('open-yt', 'Abrir en YouTube', I.yt, { id }) : ''}
    ${L && (L.mia || L.k === 'liked') ? opcion('pl-remove', L.k === 'liked' ? 'Quitar de Tus me gusta' : 'Quitar de esta playlist', I.minus, { id, from: desde }) : ''}
    ${t.local ? opcion('local-delete', 'Eliminar de este equipo', I.trash, { id }, 'danger') : ''}`);
}
function elegirPlaylist(tid) {
  const mias = plMias();
  abrirHoja(`<div class="sheet-title">Agregar a una playlist</div>
    ${opcion('pl-new-with', 'Nueva playlist', I.plus, { id: tid })}
    ${mias.map(p => opcion('pl-add-to', esc(p.nombre), p.ids.includes(tid) ? I.check : I.note, { pid: p.id, id: tid }, p.ids.includes(tid) ? 'on' : '')).join('')}
    ${mias.length ? '' : '<p class="sheet-text">Todavía no tienes playlists. Crea la primera.</p>'}`);
}
function hojaSueno() {
  const ops = [[5, '5 minutos'], [15, '15 minutos'], [30, '30 minutos'], [45, '45 minutos'], [60, '1 hora'], ['cancion', 'Al terminar esta canción']];
  abrirHoja(`<div class="sheet-title">Temporizador para dormir</div><p class="sheet-text">La música se detiene sola.</p>
    ${ops.map(([v, n]) => opcion('sleep-set', n, I.moon, { v }, sueno.modo === 'cancion' && v === 'cancion' ? 'on' : '')).join('')}
    ${sueno.modo ? opcion('sleep-set', 'Apagar temporizador', I.minus, { v: 0 }, 'danger') : ''}`);
}
function confirmar(texto, act, data, si) { abrirHoja(`<div class="sheet-title">${esc(texto)}</div>${opcion(act, si, I.trash, data, 'danger')}${opcion('close-sheet', 'Cancelar', I.back)}`); }
let alAceptar = null;
function abrirDialogo(titulo, valor, boton, cb) {
  const d = $('#dialog');
  d.innerHTML = `<form class="dlg" id="dlg-form"><h2>${esc(titulo)}</h2><label class="field" for="dlg-in"><input id="dlg-in" maxlength="80" value="${esc(valor)}" autocomplete="off" aria-label="${esc(titulo)}"></label><div class="row-btns"><button type="button" class="btn ghost" data-act="dialog-cancel">Cancelar</button><button type="submit" class="btn">${esc(boton)}</button></div></form>`;
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); alAceptar = cb;
  d.onclick = e => { if (e.target === d) cerrarDialogo(); };
  $('#dlg-form').addEventListener('submit', e => { e.preventDefault(); const v = $('#dlg-in').value; cerrarDialogo(); if (alAceptar) alAceptar(v); });
  setTimeout(() => { const i = $('#dlg-in'); i.focus(); i.select(); }, 40);
}
function cerrarDialogo() { const d = $('#dialog'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
let tAviso = 0;
function aviso(msg) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('top', hojaAbierta || $('#player').classList.contains('open') || ($('#queue').classList.contains('open') && !escritorio.matches)); t.classList.add('show'); clearTimeout(tAviso); tAviso = setTimeout(() => t.classList.remove('show'), 2800); }

/* ───────── tus archivos: subir al servidor ───────── */
async function importarArchivos(files) {
  const lista = files.filter(esAudio);
  if (!lista.length) { aviso('Esos archivos no son de audio'); return; }
  let ok = 0, fallidas = 0;
  for (const f of lista) {
    aviso(`Subiendo ${ok + fallidas + 1} de ${lista.length}: ${f.name}`);
    try {
      const tags = await leerEtiquetas(f); const n = nombreDesdeArchivo(f.name); const dur = await medirDuracion(f);
      const id = await api.subirLocal(f, { titulo: tags.titulo || n.titulo, artista: tags.artista || n.artista || '', duracion: dur });
      if (tags.caratula) await api.subirPortada(id, tags.caratula);
      ok++;
    } catch (e) { fallidas++; }
  }
  await recargar(); olvidarPortadas(() => true);
  aviso(fallidas ? `Se subieron ${ok}; ${fallidas} no se pudieron guardar` : plural(ok, 'canción subida', 'canciones subidas'));
  const s = actual(); if (!(s.v === 'list' && s.k === 'local')) ir({ v: 'list', k: 'local' }); else refrescar();
  pintarLateral();
}
async function borrarLocal(id) {
  PL.quitarCancion(id);
  await hacer(api.borrarCancion(id), 'Canción eliminada de este equipo');
  TR.delete(id);
}
$('#filepick').addEventListener('change', e => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) importarArchivos(files); });

/* ───────── acciones ───────── */
const A = {
  tab: el => { if (el.closest('#side')) irARaiz(el.dataset.tab); else cambiarPestana(el.dataset.tab); },
  go: el => { if (el.dataset.v === 'ajustes' && actual().v !== 'ajustes') ir({ v: 'ajustes' }); },
  back: () => atras(),
  forward: () => adelante(),
  open: el => abrirClave(el.dataset.k),
  'play-list': el => reproducirClave(el.dataset.k),
  'play-row': el => {
    const box = el.closest('[data-list]'); const L = box && LISTAS[box.dataset.list]; if (!L) return;
    const i = +el.dataset.i; if (P.cur === L.ids[i] && P.loaded != null && (P.k === L.k || L.k === 'buscar')) { PL.alternar(); return; }
    if (L.k === 'buscar') { const id = L.ids[i]; PL.reproducirContexto('buscar', [id], 0); return; } // una búsqueda suena sola; lo demás va a la cola
    PL.reproducirContexto(L.k, L.ids, i);
  },
  'play-row-best': el => { const id = el.dataset.id; if (P.cur === id && P.loaded != null) PL.alternar(); else PL.reproducirContexto('buscar', [id], 0); },
  'track-menu': el => menuCancion(el.dataset.id, el.dataset.from),
  'cmd-play': () => { const i = $('#cmd'); if (i && i.value.trim()) { comando(i.value, 'play'); i.value = ''; } else if (i) i.focus(); },
  'cmd-queue': () => { const i = $('#cmd'); if (i && i.value.trim()) { comando(i.value, 'cola'); i.value = ''; } else if (i) i.focus(); },
  'search-again': el => { actual().q = el.dataset.q; const q = $('#q'); if (q) q.value = el.dataset.q; BUSQ.delete(norm(el.dataset.q).trim()); lanzarBusqueda(el.dataset.q); },
  'search-artist': el => { cerrarHoja(); const t = TR.get(el.dataset.id); if (t) irABuscar(quien(t)); },
  'open-yt': el => { cerrarHoja(); const t = TR.get(el.dataset.id); if (t && t.yt) window.open('https://www.youtube.com/watch?v=' + t.vid, '_blank', 'noopener'); },
  toggle: () => { if (!PL.alternar()) { const i = $('#cmd') || $('#q'); if (i) i.focus(); aviso('Escribe una canción para empezar'); } },
  next: () => PL.siguiente(),
  prev: () => PL.anterior(),
  shuffle: () => { const on = PL.alternarAleatorio(); aviso(on ? 'Aleatorio activado' : 'Aleatorio desactivado'); $$('[data-act="shuffle"]').forEach(b => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); },
  repeat: () => { const r = PL.cambiarRepetir(); aviso(r === 'all' ? 'Repetir la lista' : r === 'one' ? 'Repetir esta canción' : 'Repetir desactivado'); actualizarReproductorUI(); },
  mute: () => silenciar(),
  'like-current': () => { if (P.cur != null) alternarMeGusta(P.cur); },
  'open-player': () => abrirReproductor(),
  'close-player': () => cerrarReproductor(),
  'player-menu': () => { if (P.cur != null) menuCancion(P.cur, ''); },
  'player-artist': () => { const t = TR.get(P.cur); if (t) irABuscar(quien(t)); },
  'yt-current': () => { const t = TR.get(P.cur); if (t && t.yt) window.open('https://www.youtube.com/watch?v=' + t.vid, '_blank', 'noopener'); else if (t) aviso('Es un archivo tuyo'); },
  'open-queue': () => abrirCola(),
  'close-queue': () => cerrarCola(),
  'q-jump': el => PL.saltarA(+el.dataset.off),
  'q-jump-up': el => { const id = P.up.splice(+el.dataset.i, 1)[0]; if (id != null) PL.cargar(id, { play: true }); },
  'q-remove': el => { P.up.splice(+el.dataset.i, 1); renderCola(); },
  'q-clear': () => { P.up.length = 0; renderCola(); aviso('Cola vacía'); },
  'list-queue': el => { const L = resolver(el.dataset.k); if (!L) return; L.ids.forEach(id => PL.agregarACola(id)); if (P.cur == null && P.up.length) PL.cargar(P.up.shift(), { play: true }); aviso(`${plural(L.ids.length, 'canción agregada', 'canciones agregadas')} a la cola`); },
  sleep: () => hojaSueno(),
  'sleep-set': el => { cerrarHoja(); const v = el.dataset.v; PL.fijarSueno(v === 'cancion' ? 'cancion' : +v); },
  import: () => $('#filepick').click(),
  'new-playlist': () => abrirDialogo('Nueva playlist', 'Mi playlist n.º ' + (plMias().length + 1), 'Crear', async nombre => { const id = await crearPlaylist(nombre); if (id) ir({ v: 'list', k: 'playlist:' + id }); }),
  'lib-filter': el => { filtroBiblio = el.dataset.f; pintarLateral(); if (actual().v === 'library') pintar(); },
  like: el => { cerrarHoja(); alternarMeGusta(el.dataset.id); },
  'pick-playlist': el => elegirPlaylist(el.dataset.id),
  'pl-new-with': el => { const tid = el.dataset.id; cerrarHoja(); abrirDialogo('Nueva playlist', 'Mi playlist n.º ' + (plMias().length + 1), 'Crear', nombre => crearPlaylist(nombre, tid)); },
  'pl-add-to': el => { cerrarHoja(); agregarAPlaylist(el.dataset.pid, el.dataset.id); },
  'pl-add': el => { const L = resolver(actual().k); if (!L) return; if (L.k === 'liked') { if (!meGusta(el.dataset.id)) alternarMeGusta(el.dataset.id); return; } if (L.mia) agregarAPlaylist(L.pid, el.dataset.id); },
  'pl-remove': el => { cerrarHoja(); const L = resolver(el.dataset.from); if (!L) return; hacer(api.quitarDePlaylist(L.pid, el.dataset.id), L.k === 'liked' ? 'Quitada de Tus me gusta' : `Quitada de «${L.titulo}»`); },
  'pl-rename': el => { const p = plPorId(+el.dataset.id); if (!p) return; abrirDialogo('Cambiar nombre', p.nombre, 'Guardar', n => { if (n.trim()) hacer(api.renombrarPlaylist(p.id, n.trim())); }); },
  'pl-delete': el => { const p = plPorId(+el.dataset.id); if (p) confirmar(`¿Eliminar «${p.nombre}»?`, 'pl-delete-yes', { id: p.id }, 'Eliminar playlist'); },
  'pl-delete-yes': async el => { cerrarHoja(); const p = plPorId(+el.dataset.id); if (!p) return; const r = await hacer(api.borrarPlaylist(p.id), `Eliminaste «${p.nombre}»`); if (r) atras(); },
  'queue-add': el => { cerrarHoja(); encolar(el.dataset.id); },
  'local-delete': el => { const t = TR.get(el.dataset.id); if (t) confirmar(`¿Eliminar «${t.t}» de este equipo?`, 'local-delete-yes', { id: t.id }, 'Eliminar canción'); },
  'local-delete-yes': el => { cerrarHoja(); borrarLocal(el.dataset.id); },
  'close-sheet': () => cerrarHoja(),
  'dialog-cancel': () => cerrarDialogo(),
  install: () => instalar(),
  'clear-audio': async () => { try { await api.vaciarAudio(); aviso('Se vaciaron las canciones guardadas'); } catch (e) { aviso(e.message); } cargarAjustes(); },
  'clear-search': async () => { try { await api.vaciarBusquedas(); BUSQ.clear(); aviso('Se vaciaron las búsquedas guardadas'); } catch (e) { aviso(e.message); } cargarAjustes(); },
  'update-ytdlp': async () => { aviso('Actualizando yt-dlp…'); try { const r = await api.actualizarYtDlp(); aviso(r.mensaje || 'yt-dlp actualizado'); } catch (e) { aviso(e.message); } cargarAjustes(); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const f = A[el.dataset.act]; if (!f) return;
  if (el.disabled) return;
  e.preventDefault(); e.stopPropagation();
  if (el.dataset.act !== 'close-sheet' && hojaAbierta && !el.closest('#sheet')) cerrarHoja();
  f(el, e);
});
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.dataset.act) { e.preventDefault(); e.target.click(); return; }
  if (e.key === 'Escape') { if ($('#dialog').classList.contains('open')) cerrarDialogo(); else if (hojaAbierta) cerrarHoja(); else if ($('#queue').classList.contains('open')) cerrarCola(); else if ($('#player').classList.contains('open')) cerrarReproductor(); return; }
  if (tag === 'input' || tag === 'textarea' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { const i = $('#cmd') || $('#q'); if (i) { e.preventDefault(); i.focus(); } else { e.preventDefault(); irARaiz('home'); setTimeout(() => { const c = $('#cmd'); if (c) c.focus(); }, 30); } return; }
  if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); A.toggle(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) PL.siguiente();
  else if (e.key === 'ArrowLeft' && e.shiftKey) PL.anterior();
});
(() => { // deslizar hacia abajo para cerrar el reproductor en el celular
  const p = $('#player'); let y0 = null, dy = 0;
  p.addEventListener('touchstart', e => { if (p.scrollTop > 0 || e.target.closest('input')) { y0 = null; return; } y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  p.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 6) { p.style.transition = 'none'; p.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  p.addEventListener('touchend', () => { if (y0 == null) return; p.style.transition = ''; p.style.transform = ''; if (dy > 110) cerrarReproductor(); y0 = null; });
})();

/* ───────── instalar (PWA) ───────── */
let eventoInstalar = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); eventoInstalar = e; document.body.classList.add('puede-instalar'); });
window.addEventListener('appinstalled', () => { eventoInstalar = null; document.body.classList.remove('puede-instalar'); aviso('Sonora quedó instalada como app'); });
async function instalar() {
  if (eventoInstalar) { eventoInstalar.prompt(); try { await eventoInstalar.userChoice; } catch (e) { /* nada */ } eventoInstalar = null; document.body.classList.remove('puede-instalar'); return; }
  if (matchMedia('(display-mode: standalone)').matches) { aviso('Ya estás usando Sonora como app instalada'); return; }
  aviso('Usa el ícono de instalar en la barra de direcciones de Chrome o Edge');
}
if (matchMedia('(display-mode: standalone)').matches) document.body.classList.add('instalada');
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker no registrado', err)); });
}
window.addEventListener('hashchange', () => abrirDesdeHash());
function abrirDesdeHash() { const h = location.hash.replace('#', ''); if (h === 'buscar') cambiarPestana('search'); else if (h === 'biblioteca') cambiarPestana('library'); }

/* ───────── arranque ───────── */
function restaurarPosicion() {
  const r = PL.leerPosicionGuardada(); if (!r || r.cur == null) return;
  Object.values(r.canciones || {}).forEach(c => { if (!TR.has(c.id)) registrar(c); });
  if (!TR.has(r.cur)) return;
  const L = r.k && r.k !== 'buscar' ? resolver(r.k) : null;
  const ids = (L ? L.ids : (Array.isArray(r.ids) ? r.ids : [])).filter(id => TR.has(id));
  const lista = ids.includes(r.cur) ? ids : [r.cur];
  PL.fijarContexto(L ? r.k : 'buscar', lista, lista.indexOf(r.cur)); P.cur = r.cur; P.resumeAt = +r.t || 0;
  (r.up || []).filter(id => TR.has(id)).forEach(id => P.up.push(id));
}
async function arrancar() {
  $$('[data-icon]').forEach(el => { if (I[el.dataset.icon]) el.innerHTML = I[el.dataset.icon]; });
  $('#side .brand').innerHTML = I.logo + '<span>Sonora</span>';
  try { await recargar(); }
  catch (e) {
    console.error(e);
    $('#splash .splash-body').innerHTML = `<div class="onboard"><h1>Sonora no encuentra su servidor</h1><p>${esc(e.message)}</p><p class="small muted">Abre Sonora con el archivo «INICIAR SONORA.bat» y deja abierta la ventana negra. Necesita Node.js 22 o más reciente.</p><button class="btn" onclick="location.reload()">Intentar otra vez</button></div>`;
    $('#splash').classList.remove('cargando'); return;
  }
  pintarVolumen(); PL.configurarSesionMultimedia();
  // las portadas dibujadas llevan texto: se esperan las fuentes (máximo 2,5 s)
  try { await Promise.race([Promise.all([document.fonts.load('800 64px "Bricolage Grotesque"'), document.fonts.load('700 20px "Outfit"'), document.fonts.load('700 20px "Figtree"')]), new Promise(r => setTimeout(r, 2500))]); } catch (e) { /* sin fuentes */ }
  restaurarPosicion();
  abrirDesdeHash();
  pintar(); pintarLateral(); actualizarReproductorUI();
  $('#splash').classList.remove('show', 'cargando');
}
escritorio.addEventListener('change', () => { pintar(); });
arrancar();
