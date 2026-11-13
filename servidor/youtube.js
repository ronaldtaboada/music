// YouTube con yt-dlp: buscar (prefiriendo videos de letra) y obtener el enlace del audio.
import { spawn } from 'node:child_process';
import { existsSync, statSync, mkdirSync, createWriteStream, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BIN = join(import.meta.dirname, 'bin');
const EXE = join(BIN, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const DESCARGA = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function correr(args, { timeout = 45000 } = {}) {
  return new Promise((ok, mal) => {
    const p = spawn(EXE, args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill(); mal(new Error('yt-dlp tardó demasiado')); }, timeout);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(t); mal(e); });
    p.on('close', code => { clearTimeout(t); if (code === 0) ok(out); else mal(new Error((err.split('\n').find(l => l.startsWith('ERROR')) || err || 'yt-dlp falló').trim().slice(0, 300))); });
  });
}

/* ── instalación y actualización de yt-dlp ── */
export async function asegurarYtDlp() {
  if (existsSync(EXE)) {
    // YouTube cambia seguido; si yt-dlp tiene más de una semana se intenta actualizar (sin bloquear el arranque)
    const dias = (Date.now() - statSync(EXE).mtimeMs) / 864e5;
    if (dias > 7) actualizarYtDlp().catch(() => {});
    return;
  }
  mkdirSync(BIN, { recursive: true });
  console.log('  Descargando yt-dlp (solo la primera vez)...');
  const r = await fetch(DESCARGA);
  if (!r.ok) throw new Error('No se pudo descargar yt-dlp: HTTP ' + r.status);
  const tmp = EXE + '.descarga';
  await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp, { mode: 0o755 }));
  renameSync(tmp, EXE);
}
export async function actualizarYtDlp() { const out = await correr(['-U'], { timeout: 120000 }); return out.trim().split('\n').pop(); }
export async function versionYtDlp() { try { return (await correr(['--version'], { timeout: 15000 })).trim(); } catch (e) { return null; } }

/* ── título del video → artista y canción ── */
const RUIDO = /(lyric|letra|official|oficial|audio|v[ií]deo|visuali[sz]er|\bhd\b|\bhq\b|\b4k\b|traduc|subtitul|\bsub\b|espa[nñ]ol|english|ingl[eé]s|testo|tradu[cç][aã]o|remaster)/i;
export function separarTitulo(tituloVideo, canal) {
  let t = String(tituloVideo || '');
  t = t.replace(/\s*[(\[【「]([^)\]】」]*)[)\]】」]/g, (m, dentro) => RUIDO.test(dentro) ? '' : m);
  t = t.replace(/\s*[|｜•].*$/, '').replace(/\s*\/\/.*$/, '');
  t = t.replace(/\s*[-–—]?\s*\b(lyrics?|letras?|lyric video|con letra)\s*$/i, '');
  t = t.replace(/["“”]/g, '').replace(/\s{2,}/g, ' ').trim();
  const partes = t.split(/\s+[-–—=~]\s*|\s*[-–—=~]\s+/);
  if (partes.length >= 2 && partes[0].length <= 60) return { artista: partes[0].trim(), titulo: partes.slice(1).join(' - ').trim() || t };
  const c = String(canal || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const canalDeLetras = /lyric|letra|music|vibe|cloud|sound|beats|records|tracks/i.test(c);
  return { artista: canalDeLetras ? '' : c, titulo: t || String(tituloVideo || '') };
}

/* ── búsqueda con preferencia por videos de letra ── */
const PIDE_LETRA = /\b(lyrics?|letras?|con letra)\b/i;
const ES_LETRA = /\blyrics?\b|\bletras?\b|lyric video|con letra|testo|paroles/i;
const MALOS = [
  ['oficial', /\b(official (music )?video|video oficial|videoclip|music video|mv)\b/i, 7],
  ['vivo', /\b(live|en vivo|ao vivo|concert|concierto|session|tour)\b/i, 9],
  ['cover', /\bcover\b/i, 9], ['remix', /\b(remix|mashup|bootleg)\b/i, 8],
  ['karaoke', /\b(karaoke|instrumental|backing track)\b/i, 10],
  ['efecto', /\b(nightcore|sped ?up|slowed|reverb|8d|bass ?boost(ed)?|tiktok version)\b/i, 10],
  ['largo', /\b(1 hour|1 hora|10 hours|loop|extended)\b/i, 10],
  ['reaccion', /\b(reaction|reacci[oó]n|tutorial|how to|análisis|review)\b/i, 12]
];
export function puntuar(entradas, consulta) {
  const q = norm(consulta);
  const n = entradas.length;
  return entradas.map((e, i) => {
    const titulo = e.title || '';
    const letra = ES_LETRA.test(titulo);
    let s = (n - i) * 1.2 + Math.log10((e.view_count || 0) + 10) * 1.4;
    if (letra) s += 9;
    for (const [palabra, re, castigo] of MALOS) if (re.test(titulo) && !re.test(q) && !(palabra === 'oficial' && letra)) s -= castigo;
    const d = e.duration || 0;
    if (d && (d < 60 || d > 900)) s -= 8;
    if (e.live_status && e.live_status !== 'not_live' && e.live_status !== 'was_live') s -= 20;
    return { e, s, letra };
  }).sort((a, b) => b.s - a.s);
}

function aCancion({ e, letra }) {
  const { artista, titulo } = separarTitulo(e.title, e.channel || e.uploader);
  return {
    id: 'yt:' + e.id, fuente: 'youtube', video_id: e.id, titulo, artista, duracion_seg: e.duration || 0,
    canal: e.channel || e.uploader || '', titulo_video: e.title || '', es_letra: letra ? 1 : 0
  };
}

export async function buscarEnYouTube(consulta, cuantos = 12) {
  const texto = String(consulta).trim();
  const busqueda = PIDE_LETRA.test(texto) ? texto : texto + ' lyrics';
  const out = await correr([`ytsearch${cuantos}:${busqueda}`, '--flat-playlist', '-J', '--no-warnings']);
  const j = JSON.parse(out);
  const entradas = (j.entries || []).filter(e => e && e.id && e.id.length === 11 && e.title && !/^\[(private|deleted)/i.test(e.title));
  return puntuar(entradas, texto).map(aCancion);
}

/* ── enlace directo del audio (dura unas horas; se guarda en memoria) ── */
const enlaces = new Map();      // videoId → { url, headers, ext, mime, vence }
const pendientes = new Map();   // videoId → promesa en curso
export function olvidarEnlace(vid) { enlaces.delete(vid); }
export function resolverAudio(vid) {
  const e = enlaces.get(vid);
  if (e && e.vence > Date.now()) return Promise.resolve(e);
  if (pendientes.has(vid)) return pendientes.get(vid);
  const p = correr(['-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio', '-j', '--no-playlist', '--no-warnings', 'https://www.youtube.com/watch?v=' + vid], { timeout: 60000 })
    .then(out => {
      const j = JSON.parse(out);
      const exp = +(new URL(j.url).searchParams.get('expire') || 0) * 1000;
      const info = {
        url: j.url, headers: j.http_headers || {}, ext: j.ext || 'm4a',
        mime: j.ext === 'webm' ? 'audio/webm' : 'audio/mp4',
        tam: j.filesize || j.filesize_approx || 0,
        vence: (exp || Date.now() + 5 * 3600e3) - 10 * 60e3,
        meta: { duracion_seg: j.duration || 0, titulo_video: j.title || '', canal: j.channel || j.uploader || '' }
      };
      enlaces.set(vid, info);
      return info;
    })
    .finally(() => pendientes.delete(vid));
  pendientes.set(vid, p);
  return p;
}

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
