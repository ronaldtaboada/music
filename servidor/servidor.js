// ===================================================================
//  Sonora - servidor local (Node, sin dependencias)
//  - Sirve la app en http://localhost:8787 (solo este computador)
//  - Busca en YouTube con yt-dlp (prefiriendo videos de letra) y entrega solo el audio
//  - Guarda playlists, historial y caché en datos/sonora.sqlite
//  Uso: node servidor/servidor.js [--puerto 8787] [--sin-navegador]
// ===================================================================
import http from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync, utimesSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import * as BD from './bd.js';
import * as YT from './youtube.js';

const args = process.argv.slice(2);
const PUERTO = +(args[args.indexOf('--puerto') + 1] || 0) || 8787;
const ABRIR = !args.includes('--sin-navegador');
const RAIZ = normalize(join(import.meta.dirname, '..'));
const DIR_AUDIO = join(BD.DATOS, 'cache-audio');
const DIR_MINI = join(BD.DATOS, 'miniaturas');
const DIR_LOCALES = join(BD.DATOS, 'locales');
for (const d of [DIR_AUDIO, DIR_MINI, DIR_LOCALES]) mkdirSync(d, { recursive: true });
const LIMITE_CACHE_AUDIO = 2 * 1024 ** 3; // 2 GB

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.txt': 'text/plain; charset=utf-8', '.sql': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};

/* ───────── utilidades HTTP ───────── */
function json(res, codigo, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(cuerpo) });
  res.end(cuerpo);
}
const error = (res, codigo, msg) => json(res, codigo, { error: msg });
async function leerJSON(req) {
  let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('Cuerpo demasiado grande'); }
  return s ? JSON.parse(s) : {};
}
// Sirve un archivo con soporte de rangos (necesario para adelantar/atrasar el audio)
function servirArchivo(req, res, ruta, mime, extra = {}) {
  let tam; try { tam = statSync(ruta).size; } catch (e) { return error(res, 404, 'No encontrado'); }
  const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', ...extra };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && tam > 0) {
    let ini = m[1] === '' ? Math.max(0, tam - +m[2]) : +m[1];
    let fin = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], tam - 1) : tam - 1;
    if (ini > fin || ini >= tam) { res.writeHead(416, { 'Content-Range': `bytes */${tam}` }); return res.end(); }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${ini}-${fin}/${tam}`, 'Content-Length': fin - ini + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(ruta, { start: ini, end: fin }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': tam });
  if (req.method === 'HEAD') return res.end();
  createReadStream(ruta).pipe(res);
}

/* ───────── caché de audio en disco (LRU por fecha de último uso) ───────── */
const enDisco = vid => { for (const ext of ['m4a', 'webm']) { const r = join(DIR_AUDIO, `${vid}.${ext}`); if (existsSync(r)) return { ruta: r, mime: ext === 'webm' ? 'audio/webm' : 'audio/mp4' }; } return null; };
const descargando = new Map();
function guardarEnDisco(vid, info) {
  if (enDisco(vid) || descargando.has(vid)) return descargando.get(vid);
  const destino = join(DIR_AUDIO, `${vid}.${info.ext === 'webm' ? 'webm' : 'm4a'}`);
  const tmp = destino + '.parcial';
  const p = (async () => {
    const r = await fetch(info.url, { headers: { ...info.headers, Range: 'bytes=0-' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
    renameSync(tmp, destino);
    recortarCache();
  })().catch(() => { try { unlinkSync(tmp); } catch (e) { /* nada */ } }).finally(() => descargando.delete(vid));
  descargando.set(vid, p);
  return p;
}
function recortarCache() {
  const archivos = readdirSync(DIR_AUDIO).filter(f => /\.(m4a|webm)$/.test(f)).map(f => { const r = join(DIR_AUDIO, f); const s = statSync(r); return { r, tam: s.size, uso: s.mtimeMs }; });
  let total = archivos.reduce((a, f) => a + f.tam, 0);
  for (const f of archivos.sort((a, b) => a.uso - b.uso)) { if (total <= LIMITE_CACHE_AUDIO) break; try { unlinkSync(f.r); total -= f.tam; } catch (e) { /* en uso */ } }
}
function infoCache() {
  let tam = 0, n = 0;
  for (const f of readdirSync(DIR_AUDIO)) if (/\.(m4a|webm)$/.test(f)) { tam += statSync(join(DIR_AUDIO, f)).size; n++; }
  return { canciones: n, bytes: tam, limite: LIMITE_CACHE_AUDIO };
}

async function servirAudioYouTube(req, res, vid) {
  const local = enDisco(vid);
  if (local) { const ahora = new Date(); try { utimesSync(local.ruta, ahora, ahora); } catch (e) { /* nada */ } return servirArchivo(req, res, local.ruta, local.mime, { 'Cache-Control': 'no-store' }); }
  for (let intento = 0; intento < 2; intento++) {
    let info;
    try { info = await YT.resolverAudio(vid); } catch (e) { return error(res, 502, 'YouTube no entregó el audio: ' + e.message); }
    guardarEnDisco(vid, info);
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());
    let r;
    try { r = await fetch(info.url, { headers: { ...info.headers, Range: req.headers.range || 'bytes=0-' }, signal: ctrl.signal }); }
    catch (e) { if (res.destroyed) return; return error(res, 502, 'Sin conexión con YouTube'); }
    if (r.status === 403 || r.status === 410) { YT.olvidarEnlace(vid); continue; } // el enlace venció: se pide otro
    const h = { 'Content-Type': info.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    for (const k of ['content-length', 'content-range']) { const v = r.headers.get(k); if (v) h[k] = v; }
    res.writeHead(r.status, h);
    if (req.method === 'HEAD' || !r.body) return res.end();
    return Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
  }
  error(res, 502, 'YouTube rechazó el audio');
}

/* ───────── miniaturas de YouTube (se guardan para no pedirlas otra vez) ───────── */
const pidiendoMini = new Map();
async function servirMiniatura(req, res, vid, grande) {
  const ruta = join(DIR_MINI, `${vid}${grande ? '-g' : ''}.jpg`);
  if (!existsSync(ruta)) {
    if (!pidiendoMini.has(ruta)) {
      pidiendoMini.set(ruta, (async () => {
        for (const v of grande ? ['maxresdefault', 'sddefault', 'hqdefault'] : ['mqdefault', 'hqdefault']) {
          const r = await fetch(`https://i.ytimg.com/vi/${vid}/${v}.jpg`);
          if (r.ok) { const tmp = ruta + '.parcial'; await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp)); renameSync(tmp, ruta); return; }
        }
      })().catch(() => {}).finally(() => pidiendoMini.delete(ruta)));
    }
    await pidiendoMini.get(ruta);
    if (!existsSync(ruta)) return error(res, 404, 'Sin miniatura');
  }
  servirArchivo(req, res, ruta, 'image/jpeg', { 'Cache-Control': 'public, max-age=2592000' });
}

/* ───────── búsqueda ───────── */
const busquedasEnCurso = new Map();
async function buscar(texto) {
  const clave = YT.norm(texto);
  const guardada = BD.busquedaGuardada(clave);
  if (guardada) return { resultados: guardada, cache: true };
  if (!busquedasEnCurso.has(clave)) {
    busquedasEnCurso.set(clave, YT.buscarEnYouTube(texto).then(r => { if (r.length) BD.guardarBusqueda(clave, r); return r; }).finally(() => busquedasEnCurso.delete(clave)));
  }
  return { resultados: await busquedasEnCurso.get(clave), cache: false };
}

/* ───────── archivos propios ───────── */
const EXT_AUDIO = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/webm': 'webm' };
async function subirLocal(req, res) {
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
  const nombre = decodeURIComponent(String(req.headers['x-nombre'] || ''));
  const ext = EXT_AUDIO[mime] || (/\.([a-z0-9]{2,5})$/i.exec(nombre) || [])[1]?.toLowerCase();
  if (!ext || !Object.values(EXT_AUDIO).includes(ext)) return error(res, 415, 'Ese archivo no es de audio');
  const dec = h => decodeURIComponent(String(req.headers[h] || ''));
  const c = BD.crearLocal({ titulo: dec('x-titulo'), artista: dec('x-artista'), duracion: +req.headers['x-duracion'] || 0, mime: MIME['.' + ext] || mime, ext });
  try { await pipeline(req, createWriteStream(join(DIR_LOCALES, c.archivo))); }
  catch (e) { BD.borrarCancion(c.id); return error(res, 500, 'No se pudo guardar el archivo'); }
  json(res, 201, { id: c.id });
}
async function subirPortada(req, res, id) {
  const c = BD.cancion(id); if (!c || c.fuente !== 'local') return error(res, 404, 'No existe');
  await pipeline(req, createWriteStream(join(DIR_LOCALES, id.slice(6) + '.portada')));
  BD.marcarPortada(id); json(res, 200, { ok: true });
}
function borrarLocal(id) {
  const c = BD.cancion(id); if (!c || c.fuente !== 'local') return false;
  for (const f of [c.archivo, id.slice(6) + '.portada']) { try { unlinkSync(join(DIR_LOCALES, f)); } catch (e) { /* nada */ } }
  BD.borrarCancion(id); return true;
}

/* ───────── rutas de la API ───────── */
async function api(req, res, url) {
  const p = url.pathname.slice(5).split('/').map(decodeURIComponent); // sin "/api/"
  const M = req.method;
  const [r0, r1, r2, r3] = p;

  if (r0 === 'estado' && M === 'GET') return json(res, 200, BD.estado());
  if (r0 === 'buscar' && M === 'GET') {
    const texto = String(url.searchParams.get('q') || '').trim().slice(0, 150);
    if (texto.length < 2) return json(res, 200, { resultados: [] });
    try { return json(res, 200, await buscar(texto)); } catch (e) { return error(res, 502, 'No se pudo buscar en YouTube: ' + e.message); }
  }
  if (r0 === 'audio' && (M === 'GET' || M === 'HEAD')) {
    if (r1 && r1.startsWith('yt:') && YT.VIDEO_ID.test(r1.slice(3))) return servirAudioYouTube(req, res, r1.slice(3));
    if (r1 && /^local:\d+$/.test(r1)) { const c = BD.cancion(r1); if (!c) return error(res, 404, 'No existe'); return servirArchivo(req, res, join(DIR_LOCALES, c.archivo), c.tipo_mime || 'audio/mpeg'); }
    return error(res, 400, 'Canción no válida');
  }
  if (r0 === 'precargar' && M === 'POST') { // prepara la siguiente canción para que empiece sin espera
    if (r1 && r1.startsWith('yt:') && YT.VIDEO_ID.test(r1.slice(3)) && !enDisco(r1.slice(3))) YT.resolverAudio(r1.slice(3)).then(i => guardarEnDisco(r1.slice(3), i)).catch(() => {});
    return json(res, 202, { ok: true });
  }
  if (r0 === 'miniatura' && M === 'GET' && YT.VIDEO_ID.test(r1 || '')) return servirMiniatura(req, res, r1, url.searchParams.has('g'));
  if (r0 === 'portada' && M === 'GET' && /^local:\d+$/.test(r1 || '')) return servirArchivo(req, res, join(DIR_LOCALES, r1.slice(6) + '.portada'), 'image/jpeg', { 'Cache-Control': 'no-cache' });

  if (r0 === 'playlists') {
    if (!r1 && M === 'POST') { const b = await leerJSON(req); return json(res, 201, { id: BD.crearPlaylist(b.nombre, b.cancion) }); }
    const pid = BD.idPlaylist(r1);
    if (!r2 && M === 'PATCH') { const b = await leerJSON(req); BD.renombrarPlaylist(pid, b.nombre); return json(res, 200, { ok: true }); }
    if (!r2 && M === 'DELETE') return json(res, 200, { borradas: BD.borrarPlaylist(pid) });
    if (r2 === 'canciones' && M === 'POST') { const b = await leerJSON(req); return json(res, 200, { agregada: BD.agregarAPlaylist(pid, b.cancion) }); }
    if (r2 === 'canciones' && r3 && M === 'DELETE') return json(res, 200, { quitada: BD.quitarDePlaylist(pid, r3) });
  }
  if (r0 === 'reproducciones') {
    if (!r1 && M === 'POST') { const b = await leerJSON(req); return json(res, 201, { id: BD.registrarReproduccion(b.cancion, b.origen) }); }
    if (r1 && M === 'PATCH') { const b = await leerJSON(req); BD.fijarSegundos(+r1, b.segundos); return json(res, 200, { ok: true }); }
  }
  if (r0 === 'historial' && M === 'GET') return json(res, 200, r1 ? BD.reproduccionesDelDia(r1) : { dias: BD.historial(30) });
  if (r0 === 'locales' && M === 'POST' && !r1) return subirLocal(req, res);
  if (r0 === 'locales' && r1 && r2 === 'portada' && M === 'POST') return subirPortada(req, res, r1);
  if (r0 === 'canciones' && r1 && M === 'DELETE') return json(res, 200, { borrada: borrarLocal(r1) });

  if (r0 === 'info' && M === 'GET') return json(res, 200, { audio: infoCache(), busquedas: BD.contarBusquedas(), ytdlp: await YT.versionYtDlp() });
  if (r0 === 'cache' && r1 === 'audio' && M === 'DELETE') { for (const f of readdirSync(DIR_AUDIO)) { try { unlinkSync(join(DIR_AUDIO, f)); } catch (e) { /* en uso */ } } return json(res, 200, { ok: true }); }
  if (r0 === 'cache' && r1 === 'busquedas' && M === 'DELETE') return json(res, 200, { borradas: BD.vaciarBusquedas() });
  if (r0 === 'ytdlp' && r1 === 'actualizar' && M === 'POST') { try { return json(res, 200, { mensaje: await YT.actualizarYtDlp() }); } catch (e) { return error(res, 500, e.message); } }

  error(res, 404, 'Ruta desconocida');
}

/* ───────── archivos de la app ───────── */
const PRIVADO = /^[\\/](datos|servidor|node_modules|\.git)([\\/]|$)/i;
function estatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const ruta = normalize(join(RAIZ, rel));
  if (!ruta.startsWith(RAIZ + sep) || PRIVADO.test(ruta.slice(RAIZ.length))) return error(res, 403, 'Prohibido');
  if (!existsSync(ruta) || statSync(ruta).isDirectory()) return error(res, 404, 'No encontrado');
  servirArchivo(req, res, ruta, MIME[extname(ruta).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
}

async function manejar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Método no permitido');
    estatico(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) error(res, e instanceof SyntaxError ? 400 : 500, e.message || 'Error');
    else res.destroy();
  }
}

/* ───────── arranque ───────── */
async function iniciar() {
  try { await YT.asegurarYtDlp(); } catch (e) { console.error('  ' + e.message + '\n  Las búsquedas no funcionarán hasta que haya internet.'); }
  BD.limpiarBusquedasViejas();
  const servidores = [];
  for (const host of ['127.0.0.1', '::1']) {
    await new Promise(ok => {
      const s = http.createServer(manejar);
      s.on('error', e => {
        if (e.code === 'EADDRINUSE' && host === '127.0.0.1') { console.log(`\n  Sonora ya estaba abierta (o el puerto ${PUERTO} está ocupado).`); if (ABRIR) abrirNavegador(); process.exit(0); }
        ok(); // sin IPv6: basta con IPv4
      });
      s.listen(PUERTO, host, () => { servidores.push(s); ok(); });
    });
  }
  const url = `http://localhost:${PUERTO}/`;
  console.log('\n  ===============================================');
  console.log(`   Sonora está funcionando en ${url}`);
  console.log('  ===============================================\n');
  console.log('   - Deja esta ventana abierta mientras escuchas música.');
  console.log('   - Para cerrar Sonora, cierra esta ventana.\n');
  if (ABRIR) abrirNavegador();
}
function abrirNavegador() {
  const url = `http://localhost:${PUERTO}/`;
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}
iniciar();
