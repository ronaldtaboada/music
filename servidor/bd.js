// Base de datos SQLite del servidor (módulo node:sqlite, viene con Node; no hay que instalar nada).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
export const DATOS = join(RAIZ, 'datos');
mkdirSync(DATOS, { recursive: true });

export const db = new DatabaseSync(join(DATOS, 'sonora.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(readFileSync(join(RAIZ, 'base-de-datos', 'esquema.sql'), 'utf8'));

const cacheSt = new Map();
const st = sql => { let s = cacheSt.get(sql); if (!s) { s = db.prepare(sql); cacheSt.set(sql, s); } return s; };
export const q = (sql, ...p) => st(sql).all(...p);
export const q1 = (sql, ...p) => st(sql).get(...p) || null;
export const run = (sql, ...p) => st(sql).run(...p);
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const ID = /^(yt:[A-Za-z0-9_-]{11}|local:\d+)$/;
export const idValido = id => ID.test(String(id || ''));
const txt = (v, max) => String(v == null ? '' : v).slice(0, max);

/* ── canciones ── */
// Guarda (o actualiza) una canción de YouTube que llega desde la app. Las locales se crean al subirlas.
export function guardarCancion(c) {
  if (!c || !idValido(c.id)) throw new Error('Canción no válida');
  if (c.id.startsWith('local:')) { if (!q1('SELECT 1 AS x FROM canciones WHERE id = ?', c.id)) throw new Error('Ese archivo ya no existe'); return c.id; }
  const vid = c.id.slice(3);
  run(`INSERT INTO canciones (id, fuente, video_id, titulo, artista, duracion_seg, canal, titulo_video, es_letra)
       VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, artista = excluded.artista,
         duracion_seg = CASE WHEN excluded.duracion_seg > 0 THEN excluded.duracion_seg ELSE canciones.duracion_seg END,
         canal = COALESCE(excluded.canal, canciones.canal), titulo_video = COALESCE(excluded.titulo_video, canciones.titulo_video), es_letra = excluded.es_letra`,
    c.id, vid, txt(c.titulo, 200) || vid, txt(c.artista, 120), Math.max(0, +c.duracion_seg || 0), txt(c.canal, 120) || null, txt(c.titulo_video, 300) || null, c.es_letra ? 1 : 0);
  return c.id;
}
const COLS = 'id, fuente, video_id, titulo, artista, duracion_seg, canal, titulo_video, es_letra, tipo_mime, tiene_portada';
export function cancionesPorId(ids) {
  const out = {};
  for (const id of new Set(ids)) { const c = q1(`SELECT ${COLS} FROM canciones WHERE id = ?`, id); if (c) out[id] = { ...c }; }
  return out;
}

/* ── estado completo para la app ── */
export function estado() {
  const playlists = q('SELECT id, clave, nombre, actualizada_en FROM playlists ORDER BY (clave IS NULL), actualizada_en DESC, id DESC')
    .map(p => ({ ...p, ids: q('SELECT cancion_id FROM playlist_canciones WHERE playlist_id = ? ORDER BY posicion', p.id).map(r => r.cancion_id) }));
  const hoy = q(`SELECT cancion_id, MAX(reproducida_en) AS ultima, COUNT(*) AS veces, SUM(segundos) AS segundos
                 FROM reproducciones WHERE dia = date('now', 'localtime') AND segundos >= 10
                 GROUP BY cancion_id ORDER BY MAX(id) DESC`);
  const top = q(`SELECT cancion_id, COUNT(*) AS veces FROM reproducciones WHERE segundos >= 30
                 GROUP BY cancion_id ORDER BY veces DESC, MAX(id) DESC LIMIT 30`).map(r => r.cancion_id);
  const locales = q("SELECT id FROM canciones WHERE fuente = 'local' ORDER BY agregada_en DESC, id DESC").map(r => r.id);
  const resumenHoy = q1(`SELECT COALESCE(SUM(segundos), 0) AS segundos, COUNT(DISTINCT cancion_id) AS canciones
                         FROM reproducciones WHERE dia = date('now', 'localtime') AND segundos >= 10`);
  const ids = [...playlists.flatMap(p => p.ids), ...hoy.map(h => h.cancion_id), ...top, ...locales];
  return { playlists, hoy: hoy.map(h => ({ ...h })), resumenHoy: { ...resumenHoy }, top, locales, canciones: cancionesPorId(ids) };
}

export function historial(dias = 14) {
  return q(`SELECT dia, COUNT(DISTINCT cancion_id) AS canciones, SUM(segundos) AS segundos
            FROM reproducciones WHERE segundos >= 10 GROUP BY dia ORDER BY dia DESC LIMIT ?`, dias).map(r => ({ ...r }));
}
export function reproduccionesDelDia(dia) {
  const filas = q(`SELECT cancion_id, MAX(reproducida_en) AS ultima, COUNT(*) AS veces FROM reproducciones
                   WHERE dia = ? AND segundos >= 10 GROUP BY cancion_id ORDER BY MAX(id) DESC`, dia).map(r => ({ ...r }));
  return { dia, filas, canciones: cancionesPorId(filas.map(f => f.cancion_id)) };
}

/* ── playlists ── */
const nombreValido = n => { const v = String(n || '').trim().slice(0, 80); if (!v) throw new Error('Escribe un nombre'); return v; };
export function crearPlaylist(nombre, cancion) {
  return tx(() => {
    const id = Number(run('INSERT INTO playlists (nombre) VALUES (?)', nombreValido(nombre)).lastInsertRowid);
    if (cancion) agregarAPlaylist(id, cancion);
    return id;
  });
}
export function renombrarPlaylist(id, nombre) { run("UPDATE playlists SET nombre = ?, actualizada_en = datetime('now', 'localtime') WHERE id = ? AND clave IS NULL", nombreValido(nombre), id); }
export function borrarPlaylist(id) { return run('DELETE FROM playlists WHERE id = ? AND clave IS NULL', id).changes; }
export function idPlaylist(ref) { if (ref === 'me-gusta') return q1("SELECT id FROM playlists WHERE clave = 'me-gusta'").id; return +ref; }
export function agregarAPlaylist(pid, cancion) {
  if (!q1('SELECT 1 AS x FROM playlists WHERE id = ?', pid)) throw new Error('Esa playlist no existe');
  const cid = guardarCancion(cancion);
  return run(`INSERT OR IGNORE INTO playlist_canciones (playlist_id, cancion_id, posicion)
              VALUES (?, ?, COALESCE((SELECT MAX(posicion) FROM playlist_canciones WHERE playlist_id = ?), 0) + 1)`, pid, cid, pid).changes;
}
export function quitarDePlaylist(pid, cid) { return run('DELETE FROM playlist_canciones WHERE playlist_id = ? AND cancion_id = ?', pid, cid).changes; }

/* ── reproducciones ── */
export function registrarReproduccion(cancion, origen) {
  const cid = guardarCancion(cancion);
  return Number(run('INSERT INTO reproducciones (cancion_id, origen) VALUES (?, ?)', cid, origen ? txt(origen, 60) : null).lastInsertRowid);
}
export function fijarSegundos(id, s) { run('UPDATE reproducciones SET segundos = ? WHERE id = ?', Math.max(0, Math.round(+s || 0)), id); }

/* ── caché de búsquedas ── */
const DURA_BUSQUEDA = 14 * 864e5;
export function busquedaGuardada(consulta) {
  const f = q1('SELECT resultados, guardada_en FROM cache_busquedas WHERE consulta = ?', consulta);
  if (!f || Date.now() - f.guardada_en > DURA_BUSQUEDA) return null;
  try { return JSON.parse(f.resultados); } catch (e) { return null; }
}
export function guardarBusqueda(consulta, resultados) {
  run('INSERT INTO cache_busquedas (consulta, resultados, guardada_en) VALUES (?, ?, ?) ON CONFLICT(consulta) DO UPDATE SET resultados = excluded.resultados, guardada_en = excluded.guardada_en',
    consulta, JSON.stringify(resultados), Date.now());
}
export function limpiarBusquedasViejas() { return run('DELETE FROM cache_busquedas WHERE guardada_en < ?', Date.now() - DURA_BUSQUEDA).changes; }
export function vaciarBusquedas() { return run('DELETE FROM cache_busquedas').changes; }
export function contarBusquedas() { return q1('SELECT COUNT(*) AS n FROM cache_busquedas').n; }

/* ── archivos propios ── */
export function crearLocal({ titulo, artista, duracion, mime, ext }) {
  const n = (q1("SELECT COALESCE(MAX(CAST(substr(id, 7) AS INTEGER)), 0) + 1 AS n FROM canciones WHERE fuente = 'local'").n);
  const id = 'local:' + n;
  run(`INSERT INTO canciones (id, fuente, titulo, artista, duracion_seg, archivo, tipo_mime) VALUES (?, 'local', ?, ?, ?, ?, ?)`,
    id, txt(titulo, 200) || 'Canción sin título', txt(artista, 120), Math.max(0, +duracion || 0), n + '.' + ext, mime || null);
  return { id, n, archivo: n + '.' + ext };
}
export const cancion = id => q1(`SELECT ${COLS}, archivo FROM canciones WHERE id = ?`, id);
export function marcarPortada(id) { run('UPDATE canciones SET tiene_portada = 1 WHERE id = ?', id); }
export function borrarCancion(id) { return run('DELETE FROM canciones WHERE id = ?', id).changes; }
