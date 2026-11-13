// Motor de reproducción: cola, aleatorio, repetir, temporizador, controles del sistema y registro de escuchas.
import { shuffled, store } from './util.js';

export const audio = document.getElementById('audio');
const SILENCIO = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

// k: contexto (playlist:3, album:2…), ids: canciones del contexto, order/pos: orden de reproducción, up: "agregar a la cola"
export const P = { k: null, ids: [], order: [], pos: 0, up: [], cur: null, loaded: null, want: false, seekTo: 0, resumeAt: 0 };
export const prefs = Object.assign({ shuffle: false, repeat: 'off', volumen: 1 }, store.get('sonora.prefs', {}));
const guardarPrefs = () => store.set('sonora.prefs', { shuffle: prefs.shuffle, repeat: prefs.repeat, volumen: prefs.volumen });
try { audio.volume = Math.min(1, Math.max(0, +prefs.volumen || 1)); } catch (e) { /* iOS fija el volumen */ }

let h = { metas: () => ({}), track: () => null, cambio() {}, estado() {}, progreso() {}, aviso() {}, escucha: () => null, segundos() {}, cola() {}, precargar() {}, nombreContexto: () => '' };
export function configurarReproductor(hooks) { h = Object.assign(h, hooks); }

/* ── audio: se reproduce por streaming desde el servidor local ── */
async function urlDe(id) {
  const t = h.track(id); if (!t) throw new Error('desconocida');
  return t.src;
}
export function olvidarArchivo() { /* ya no se guardan copias en memoria */ }
const precargadas = new Set();
function precargarSiguiente() {
  const sig = P.up.length ? P.up[0] : (P.pos < P.order.length - 1 ? P.ids[P.order[P.pos + 1]] : null);
  if (sig != null && !precargadas.has(sig)) { precargadas.add(sig); h.precargar(sig); }
}

/* ── reproducción ── */
let desbloqueado = false, token = 0;
function desbloquear() { if (desbloqueado) return; desbloqueado = true; try { audio.src = SILENCIO; const p = audio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* nada */ } }
function doPlay() {
  P.want = true;
  if (audio.readyState < 3) document.body.classList.add('loading');
  const p = audio.play();
  if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') { P.want = false; document.body.classList.remove('loading'); h.estado(); h.aviso('Toca reproducir para empezar'); } });
}
export async function cargar(id, { play = true, at = 0 } = {}) {
  if (!h.track(id)) return;
  if (play) desbloquear();
  cerrarEscucha();
  const mio = ++token;
  P.cur = id; P.want = play; P.seekTo = at; P.loaded = null;
  if (play) document.body.classList.add('loading');
  h.cambio();
  let url;
  try { url = await urlDe(id); }
  catch (e) {
    if (mio !== token) return;
    document.body.classList.remove('loading'); P.want = false; h.estado();
    h.aviso('No se pudo cargar la canción. Revisa que la ventana del servidor de Sonora siga abierta.');
    return;
  }
  if (mio !== token) return;
  P.loaded = id; audio.src = url;
  if (P.want) doPlay(); else document.body.classList.remove('loading');
  guardarPosicion(true);
}
function ctxActual() { return P.ids[P.order[P.pos]]; }
export function fijarContexto(k, ids, inicio) {
  P.k = k; P.ids = ids.slice();
  if (prefs.shuffle) { P.order = [inicio].concat(shuffled(P.ids.map((_, i) => i).filter(i => i !== inicio))); P.pos = 0; }
  else { P.order = P.ids.map((_, i) => i); P.pos = inicio; }
}
export function reproducirContexto(k, ids, inicio = 0) {
  ids = ids.filter(id => h.track(id)); if (!ids.length) return false;
  fijarContexto(k, ids, Math.min(Math.max(0, inicio), ids.length - 1));
  cargar(ctxActual(), { play: true });
  return true;
}
export function asegurarYReproducir() {
  if (P.cur == null) return false;
  if (P.loaded !== P.cur || !audio.getAttribute('src') || audio.src === SILENCIO) { cargar(P.cur, { play: true, at: P.resumeAt || 0 }); P.resumeAt = 0; }
  else doPlay();
  return true;
}
export function alternar() { if (audio.paused || P.loaded == null) return asegurarYReproducir(); P.want = false; audio.pause(); return true; }
export function pausar() { P.want = false; audio.pause(); }
export function siguiente(auto = false) {
  if (P.up.length) { cargar(P.up.shift(), { play: true }); h.cola(); return; }
  if (!P.ids.length) return;
  if (P.pos < P.order.length - 1) P.pos++;
  else if (prefs.repeat === 'all' || !auto) { P.pos = 0; if (prefs.shuffle) P.order = shuffled(P.order); }
  else { P.pos = 0; cargar(ctxActual(), { play: false }); return; }
  cargar(ctxActual(), { play: true });
}
export function anterior() {
  if ((audio.currentTime || 0) > 3 || !P.ids.length) { try { audio.currentTime = 0; } catch (e) { /* nada */ } if (audio.paused) asegurarYReproducir(); return; }
  if (P.pos > 0) P.pos--; else if (prefs.repeat === 'all') P.pos = P.order.length - 1; else { try { audio.currentTime = 0; } catch (e) { /* nada */ } return; }
  cargar(ctxActual(), { play: true });
}
export function saltarA(offset) { P.pos = Math.min(P.order.length - 1, P.pos + offset); cargar(ctxActual(), { play: true }); }
export function alternarAleatorio() {
  prefs.shuffle = !prefs.shuffle; guardarPrefs();
  if (P.ids.length) {
    const ci = P.order[P.pos];
    if (prefs.shuffle) { P.order = [ci].concat(shuffled(P.ids.map((_, i) => i).filter(i => i !== ci))); P.pos = 0; }
    else { P.order = P.ids.map((_, i) => i); P.pos = ci; }
  }
  h.cola(); return prefs.shuffle;
}
export function cambiarRepetir() { prefs.repeat = prefs.repeat === 'off' ? 'all' : prefs.repeat === 'all' ? 'one' : 'off'; guardarPrefs(); return prefs.repeat; }
export function agregarACola(id) { P.up.push(id); h.cola(); }
export function proximas(n = 40) { const out = []; for (let i = P.pos + 1; i < P.order.length && out.length < n; i++) out.push(P.ids[P.order[i]]); return out; }
export function fijarVolumen(v) { prefs.volumen = Math.min(1, Math.max(0, v)); try { audio.volume = prefs.volumen; } catch (e) { /* nada */ } guardarPrefs(); }
export function buscarEn(seg) { if (P.loaded === P.cur && audio.readyState > 0) { try { audio.currentTime = seg; } catch (e) { /* nada */ } } else P.resumeAt = seg; h.progreso(); }
export function quitarCancion(id) {
  P.up = P.up.filter(x => x !== id);
  const i = P.ids.indexOf(id);
  if (i >= 0) { const actual = P.ids[P.order[P.pos]]; P.ids.splice(i, 1); P.order = P.ids.map((_, k) => k); P.pos = Math.max(0, P.ids.indexOf(actual)); }
  if (P.cur === id) { audio.pause(); audio.removeAttribute('src'); P.loaded = null; P.cur = P.ids.length ? P.ids[P.order[Math.min(P.pos, P.ids.length - 1)]] : null; h.cambio(); }
  olvidarArchivo(id);
}

/* ── historial de escucha (tabla reproducciones) ── */
let escucha = { id: null, track: null, seg: 0, ult: 0, guardado: 0 };
function cerrarEscucha() { if (escucha.id && escucha.seg - escucha.guardado >= 1) { h.segundos(escucha.id, Math.round(escucha.seg)); escucha.guardado = escucha.seg; } }
audio.addEventListener('playing', () => {
  document.body.classList.remove('loading');
  if (P.loaded != null && escucha.track !== P.loaded) { cerrarEscucha(); escucha = { id: h.escucha(P.loaded, P.k), track: P.loaded, seg: 0, ult: audio.currentTime, guardado: 0 }; }
  else escucha.ult = audio.currentTime;
  precargarSiguiente(); h.estado();
});
audio.addEventListener('seeked', () => { escucha.ult = audio.currentTime; });
audio.addEventListener('timeupdate', () => {
  if (!audio.paused && escucha.id && escucha.track === P.loaded) {
    const dt = audio.currentTime - escucha.ult; if (dt > 0 && dt < 2) escucha.seg += dt; escucha.ult = audio.currentTime;
    if (escucha.seg - escucha.guardado >= 15) cerrarEscucha();
  }
  h.progreso(); guardarPosicion(false);
});
audio.addEventListener('pause', () => { cerrarEscucha(); h.estado(); guardarPosicion(true); });
audio.addEventListener('play', () => h.estado());
audio.addEventListener('waiting', () => { if (P.want) document.body.classList.add('loading'); });
audio.addEventListener('canplay', () => document.body.classList.remove('loading'));
audio.addEventListener('loadedmetadata', () => {
  if (P.seekTo > 0 && isFinite(audio.duration) && P.seekTo < audio.duration - 2) { try { audio.currentTime = P.seekTo; } catch (e) { /* nada */ } }
  P.seekTo = 0; h.progreso();
});
audio.addEventListener('ended', () => {
  // el audio silencioso que desbloquea el sonido en iPhone también "termina": no cuenta como canción
  if (P.loaded == null || audio.src === SILENCIO) return;
  cerrarEscucha(); escucha.track = null;
  if (sueno.modo === 'cancion') { sueno.modo = null; P.want = false; h.estado(); h.aviso('Temporizador: listo, buenas noches'); return; }
  if (prefs.repeat === 'one') { try { audio.currentTime = 0; } catch (e) { /* nada */ } doPlay(); return; }
  siguiente(true);
});
// Si una canción falla (YouTube cambió algo, el video ya no existe…) se salta a la siguiente, como un bot.
let fallosSeguidos = 0;
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src') || audio.src === SILENCIO || P.loaded == null) return;
  document.body.classList.remove('loading');
  const hayMas = P.up.length || P.pos < P.order.length - 1;
  if (P.want && hayMas && ++fallosSeguidos <= 3) { h.aviso('No se pudo reproducir esta canción. Pasando a la siguiente…'); setTimeout(() => siguiente(true), 900); return; }
  P.want = false; fallosSeguidos = 0; h.estado();
  h.aviso(navigator.onLine === false ? 'Sin conexión: esta canción no está guardada en el equipo.' : 'No se pudo reproducir. Prueba otra versión desde Buscar.');
});
audio.addEventListener('playing', () => { fallosSeguidos = 0; });

/* ── última posición, para retomar al volver ── */
let ultGuardado = 0;
function guardarPosicion(forzar) {
  const ahora = Date.now(); if (!forzar && ahora - ultGuardado < 5000) return; ultGuardado = ahora;
  if (P.cur == null) return;
  store.set('sonora.retomar', { k: P.k, ids: P.ids.slice(0, 300), up: P.up.slice(0, 100), cur: P.cur, t: Math.floor(P.loaded === P.cur ? audio.currentTime || 0 : P.resumeAt || 0), canciones: h.metas([P.cur, ...P.ids.slice(0, 300), ...P.up.slice(0, 100)]) });
}
export function leerPosicionGuardada() { return store.get('sonora.retomar', null); }

/* ── temporizador para dormir ── */
export const sueno = { modo: null, fin: 0, timer: 0 };
export function fijarSueno(v) {
  clearInterval(sueno.timer); sueno.modo = null;
  if (v === 'cancion') { sueno.modo = 'cancion'; h.aviso('Sonora se pausará al terminar esta canción'); }
  else if (v > 0) { sueno.modo = 'tiempo'; sueno.fin = Date.now() + v * 60000; sueno.timer = setInterval(tic, 1000); h.aviso(`Sonora se pausará en ${v} minutos`); }
  else h.aviso('Temporizador apagado');
  h.progreso();
}
function tic() { if (sueno.modo !== 'tiempo') return; if (Date.now() >= sueno.fin) { clearInterval(sueno.timer); sueno.modo = null; apagarSuave(); } h.progreso(); }
function apagarSuave() {
  const inicio = audio.volume; let n = 0;
  const f = setInterval(() => { n++; try { audio.volume = Math.max(0, inicio * (1 - n / 12)); } catch (e) { /* nada */ } if (n >= 12) { clearInterval(f); pausar(); try { audio.volume = inicio; } catch (e) { /* nada */ } } }, 300);
}

/* ── controles del sistema (teclas multimedia, pantalla de bloqueo, audífonos) ── */
export function configurarSesionMultimedia() {
  if (!('mediaSession' in navigator)) return;
  const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* no soportado */ } };
  set('play', () => asegurarYReproducir());
  set('pause', () => pausar());
  set('previoustrack', () => anterior());
  set('nexttrack', () => siguiente());
  set('seekto', d => { if (d && d.seekTime != null) buscarEn(d.seekTime); });
  set('seekbackward', () => buscarEn(Math.max(0, (audio.currentTime || 0) - 10)));
  set('seekforward', () => buscarEn(Math.min(audio.duration || 0, (audio.currentTime || 0) + 10)));
}
export function actualizarSesionMultimedia(meta) {
  if (!('mediaSession' in navigator)) return;
  try {
    if (meta && typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = new MediaMetadata(meta);
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  } catch (e) { /* nada */ }
}
export const SILENCIO_URL = SILENCIO;
