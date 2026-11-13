// Portadas: las canciones de YouTube usan su miniatura; lo demás se dibuja con canvas (arte generativo).
// Las playlists arman un mosaico con las miniaturas de sus primeras canciones.
import { $$, hash, rng, rgba, shade, hexRGB } from './util.js';

export const FAM = {
  terra: [['#264653', '#E9C46A', '#E76F51', '#F4A261'], ['#3D1F2B', '#E76F51', '#F2CC8F', '#81B29A'], ['#1D3557', '#E9C46A', '#F1FAEE', '#E63946'], ['#2B2D42', '#D4A373', '#FAEDCD', '#9B2242'], ['#0B3C49', '#F4A261', '#E9C46A', '#2A9D8F']],
  fable: [['#132A13', '#4F772D', '#ECF39E', '#90A955'], ['#0B132B', '#3A506B', '#C9A227', '#E0D6B8'], ['#2D0A0A', '#8C1C13', '#E8D5B7', '#C9A227'], ['#10302B', '#2D6A4F', '#D8F3DC', '#B7E4C7'], ['#1B1A3A', '#4C3F91', '#E8C468', '#F1E3C3']],
  tropic: [['#3A0CA3', '#F72585', '#4CC9F0', '#FDE047'], ['#0F766E', '#22D3EE', '#FDE047', '#FB7185'], ['#5B21B6', '#A3E635', '#F472B6', '#FDF4FF'], ['#1E1B4B', '#FF4D8D', '#FDBA74', '#67E8F9'], ['#9A3412', '#FDBA74', '#14B8A6', '#FEF3C7']],
  cosmos: [['#0B1026', '#3B2C85', '#D946EF', '#38BDF8'], ['#050816', '#1E3A8A', '#A78BFA', '#F0ABFC'], ['#120C2C', '#6D28D9', '#22D3EE', '#F5F3FF'], ['#0A0F1E', '#0EA5E9', '#E879F9', '#FDE68A']],
  sonora: [['#1B1440', '#FFB547', '#FF6B6B', '#7C5CFF'], ['#0E2A3B', '#2EC4B6', '#FFB547', '#E9E3FF'], ['#2A1033', '#FF5D8F', '#FFB547', '#8EECF5']]
};
const MOTIF_SET = { arches: ['arches', 'sun', 'waves', 'rings', 'grid'], peaks: ['peaks', 'rings', 'stripes', 'blobs'], sun: ['sun', 'waves', 'stripes', 'blobs', 'grid'], orbit: ['orbit', 'blobs', 'rings', 'waves'], blobs: ['blobs', 'waves', 'rings'] };

const M = {
  sun(x, S, R, P) {
    const g = x.createLinearGradient(0, 0, 0, S); g.addColorStop(0, P[0]); g.addColorStop(1, P[3]); x.fillStyle = g; x.fillRect(0, 0, S, S);
    const cx = S * (.3 + R() * .4), cy = S * (.42 + R() * .16), r = S * (.2 + R() * .12);
    x.fillStyle = P[1]; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.fillStyle = P[0]; for (let i = 0; i < 5; i++) x.fillRect(0, cy + r * .12 + i * r * .2, S, r * .035 * (i + 1));
    x.fillStyle = P[2]; x.fillRect(0, S * .7, S, S * .3);
    x.fillStyle = rgba(P[3], .45); for (let i = 0; i < 6; i++) x.fillRect(S * R() * .7, S * (.74 + i * .04), S * (.12 + R() * .3), S * .011);
  },
  waves(x, S, R, P) {
    x.fillStyle = P[0]; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) {
      x.fillStyle = P[1 + i % 3]; x.globalAlpha = .88;
      const base = S * (.22 + i * .13), amp = S * (.03 + R() * .05), f = 1 + R() * 2, ph = R() * 6;
      x.beginPath(); x.moveTo(0, S);
      for (let k = 0; k <= 48; k++) x.lineTo(k / 48 * S, base + Math.sin(k / 48 * Math.PI * 2 * f + ph) * amp);
      x.lineTo(S, S); x.closePath(); x.fill();
    }
    x.globalAlpha = 1;
  },
  peaks(x, S, R, P) {
    const g = x.createLinearGradient(0, 0, 0, S); g.addColorStop(0, P[0]); g.addColorStop(1, P[1]); x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.fillStyle = P[3]; x.beginPath(); x.arc(S * (.2 + R() * .6), S * (.17 + R() * .1), S * .085, 0, 7); x.fill();
    const cols = [P[2], P[1], P[0]];
    for (let l = 0; l < 3; l++) {
      x.fillStyle = cols[l]; x.globalAlpha = .6 + l * .2;
      const base = S * (.56 + l * .15); let px = -S * .05;
      x.beginPath(); x.moveTo(-1, S); x.lineTo(-1, base);
      while (px < S) { const w = S * (.14 + R() * .2), h = S * (.1 + R() * .24); x.lineTo(px + w / 2, base - h); x.lineTo(px + w, base); px += w; }
      x.lineTo(S + 1, S); x.closePath(); x.fill();
    }
    x.globalAlpha = 1;
  },
  rings(x, S, R, P) {
    x.fillStyle = P[0]; x.fillRect(0, 0, S, S);
    const cx = S * (R() < .5 ? .18 : .82), cy = S * (R() < .5 ? .2 : .8);
    x.lineWidth = S * .052;
    for (let i = 13; i > 0; i--) { x.strokeStyle = P[1 + i % 3]; x.beginPath(); x.arc(cx, cy, i * S * .083, 0, 7); x.stroke(); }
  },
  arches(x, S, R, P) {
    x.fillStyle = P[1]; x.fillRect(0, 0, S, S);
    const n = 3 + (R() * 2 | 0), w = S / n;
    for (let i = 0; i < n; i++) {
      x.fillStyle = i % 2 ? P[0] : P[2]; const h = S * (.42 + R() * .3);
      x.beginPath(); x.moveTo(i * w + w * .12, S); x.lineTo(i * w + w * .12, S - h); x.arc(i * w + w / 2, S - h, w * .38, Math.PI, 0); x.lineTo(i * w + w * .88, S); x.closePath(); x.fill();
    }
    x.fillStyle = P[3]; x.beginPath(); x.arc(S * (.2 + R() * .6), S * .17, S * .07, 0, 7); x.fill();
  },
  orbit(x, S, R, P) {
    const g = x.createRadialGradient(S * .3, S * .3, 0, S * .5, S * .5, S * .85); g.addColorStop(0, P[1]); g.addColorStop(1, P[0]); x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.fillStyle = '#fff'; for (let i = 0; i < 70; i++) { x.globalAlpha = R() * .8; x.beginPath(); x.arc(R() * S, R() * S, S * (.002 + R() * .005), 0, 7); x.fill(); }
    x.globalAlpha = 1;
    const cx = S * (.35 + R() * .3), cy = S * (.4 + R() * .2), r = S * (.16 + R() * .1);
    const pg = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r); pg.addColorStop(0, P[3]); pg.addColorStop(1, P[2]);
    x.fillStyle = pg; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.strokeStyle = P[3]; x.lineWidth = S * .018; x.beginPath(); x.ellipse(cx, cy, r * 1.9, r * .45, -.35, 0, 7); x.stroke();
  },
  stripes(x, S, R, P) {
    x.fillStyle = P[0]; x.fillRect(0, 0, S, S); x.save(); x.translate(S / 2, S / 2); x.rotate(-Math.PI / 4 + (R() - .5) * .7);
    const w = S * .13; for (let i = -9; i < 9; i++) { x.fillStyle = P[1 + (i + 9) % 3]; x.fillRect(i * w * 1.6, -S, w, S * 2); }
    x.restore();
  },
  blobs(x, S, R, P) {
    x.fillStyle = P[0]; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 5; i++) { const cx = R() * S, cy = R() * S, r = S * (.3 + R() * .4), c = P[1 + i % 3]; const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, rgba(c, .95)); g.addColorStop(1, rgba(c, 0)); x.fillStyle = g; x.fillRect(0, 0, S, S); }
  },
  grid(x, S, R, P) {
    x.fillStyle = P[1]; x.fillRect(0, 0, S, S);
    x.fillStyle = P[2]; x.beginPath(); x.arc(S * (R() < .5 ? 0 : 1), S, S * .8, 0, 7); x.fill();
    x.fillStyle = P[0]; const n = 7; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.beginPath(); x.arc((i + .5) * S / n, (j + .5) * S / n, S * .013, 0, 7); x.fill(); }
    x.fillStyle = P[3]; x.fillRect(S * .1, S * .1, S * .22, S * .05);
  }
};

function grain(x, S, R) { x.globalAlpha = .06; for (let i = 0, n = S * S / 110; i < n; i++) { x.fillStyle = R() < .5 ? '#000' : '#fff'; x.fillRect(R() * S, R() * S, 1.3, 1.3); } x.globalAlpha = 1; }

function fitTitle(x, S, text) {
  const pad = S * .08, maxW = S - pad * 2, words = String(text).split(/\s+/);
  let size = S * .2; const font = s => `800 ${s}px "Bricolage Grotesque","Arial Narrow",sans-serif`;
  x.font = font(size);
  while (size > S * .08 && Math.max(...words.map(w => x.measureText(w).width)) > maxW) { size -= S * .005; x.font = font(size); }
  const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width <= maxW) cur = t; else { if (cur) lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  const lh = size * .92; const y0 = S - pad - (lines.length - 1) * lh;
  x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = S * .03; x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
  lines.forEach((l, i) => x.fillText(l, pad, y0 + i * lh));
  x.shadowBlur = 0;
  x.font = `700 ${S * .052}px "Figtree",system-ui,sans-serif`; x.fillStyle = 'rgba(255,255,255,.92)';
  x.fillText('SONORA', pad, pad + S * .045);
}
function glyph(x, S, ch, scale) { x.fillStyle = 'rgba(255,255,255,.92)'; x.font = `800 ${S * scale}px "Figtree",system-ui,sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, S / 2, S / 2 + S * .03); x.textAlign = 'start'; x.textBaseline = 'alphabetic'; }
function heartPath(x, cx, cy, s) { x.beginPath(); x.moveTo(cx, cy + s * .35); x.bezierCurveTo(cx - s * .9, cy - s * .2, cx - s * .45, cy - s * .85, cx, cy - s * .38); x.bezierCurveTo(cx + s * .45, cy - s * .85, cx + s * .9, cy - s * .2, cx, cy + s * .35); x.closePath(); }

// La app indica de dónde salen los datos de cada portada
let src = { track: () => null, album: () => null, artist: () => null, playlist: () => null, genre: () => null };
export function configurarPortadas(fuente) { src = Object.assign(src, fuente); }

function famOf(pal) { return FAM[pal] || FAM.sonora; }
export function trackPalette(id) {
  const t = src.track(id); const R = rng(hash('track:' + id));
  const fam = famOf(t ? t.pal : 'sonora');
  return { P: fam[Math.floor(R() * fam.length)], R, t };
}
function paintTrack(x, id, S) {
  const { P, R, t } = trackPalette(id);
  const set = MOTIF_SET[t && t.motif] || MOTIF_SET.blobs;
  M[set[Math.floor(R() * set.length)]](x, S, R, P); grain(x, S, R);
  if (t && t.local) glyph(x, S, '♪', .34);
}

function draw(key, S) {
  const i = key.indexOf(':'); const type = i < 0 ? key : key.slice(0, i); const id = i < 0 ? '' : key.slice(i + 1);
  if (type === 'track') { const t = src.track(id); if (t && t.artURL) return S >= 320 && t.artURLGrande ? t.artURLGrande : t.artURL; }
  const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const R = rng(hash(key));
  if (type === 'track') paintTrack(x, id, S);
  else if (type === 'playlist') {
    const p = src.playlist(id);
    if (p && p.paleta) { M[p.motivo] ? M[p.motivo](x, S, R, p.paleta) : M.blobs(x, S, R, p.paleta); grain(x, S, R); const g = x.createLinearGradient(0, S * .45, 0, S); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)'); x.fillStyle = g; x.fillRect(0, 0, S, S); fitTitle(x, S, p.nombre); }
    else {
      const ids = p ? p.canciones : [];
      const fotos = ids.map(t => src.track(t)).filter(t => t && t.artURL).slice(0, 4).map(t => t.artURL);
      if (fotos.length) componerMosaico(key, S, fotos);
      if (ids.length >= 4) { const h = S / 2; ids.slice(0, 4).forEach((tid, n) => { x.save(); x.translate((n % 2) * h, (n >> 1) * h); x.beginPath(); x.rect(0, 0, h, h); x.clip(); paintTrack(x, tid, h); x.restore(); }); }
      else if (ids.length) paintTrack(x, ids[0], S);
      else { M.blobs(x, S, R, FAM.sonora[0]); glyph(x, S, '♪', .46); }
    }
  }
  else if (type === 'album') { const a = src.album(id); const fam = famOf(a && a.paleta); M[(a && M[a.motivo]) ? a.motivo : 'blobs'](x, S, R, fam[0]); grain(x, S, R); }
  else if (type === 'artist') {
    const a = src.artist(id); const fam = famOf(a && a.paleta); const P = fam[hash(String(id)) % fam.length]; M.blobs(x, S, R, P); grain(x, S, R);
    const ini = (a ? a.nombre : '?').replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    x.fillStyle = 'rgba(255,255,255,.95)'; x.font = `800 ${S * (ini.length > 1 ? .36 : .46)}px "Bricolage Grotesque","Arial Narrow",sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ini, S / 2, S / 2 + S * .02);
  }
  else if (type === 'liked') { const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#5B3FD9'); g.addColorStop(.6, '#B65CF0'); g.addColorStop(1, '#FFB547'); x.fillStyle = g; x.fillRect(0, 0, S, S); x.fillStyle = '#fff'; heartPath(x, S / 2, S / 2 + S * .06, S * .36); x.fill(); }
  else if (type === 'local') { const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#0B7285'); g.addColorStop(1, '#5B3FD9'); x.fillStyle = g; x.fillRect(0, 0, S, S); glyph(x, S, '♪', .5); }
  else if (type === 'hoy') { const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#0E7490'); g.addColorStop(1, '#FFB547'); x.fillStyle = g; x.fillRect(0, 0, S, S); fitTitle(x, S, 'Escuchado hoy'); }
  else if (type === 'top') { const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#E8590C'); g.addColorStop(1, '#5B3FD9'); x.fillStyle = g; x.fillRect(0, 0, S, S); fitTitle(x, S, 'Tus más escuchadas'); }
  else if (type === 'genre') { const g = src.genre(id); const col = g ? g.color : '#5B3FD9'; M.grid(x, S, R, [col, shade(col, .3), rgba('#ffffff', .25), '#ffffff']); fitTitle(x, S, g ? g.nombre : ''); }
  else M.blobs(x, S, R, FAM.sonora[0]);
  return c.toDataURL('image/jpeg', .86);
}

const cache = new Map();
function cargarImagen(url) { return new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; }); }
function pintarImagen(x, img, dx, dy, w, h) { const r = Math.max(w / img.naturalWidth, h / img.naturalHeight); const sw = w / r, sh = h / r; x.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, dx, dy, w, h); }
// Mosaico 2×2 (o una sola imagen) con las miniaturas; reemplaza la portada provisional cuando termina.
async function componerMosaico(key, S, urls) {
  try {
    const imgs = await Promise.all((urls.length >= 4 ? urls : urls.slice(0, 1)).map(cargarImagen));
    const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    if (imgs.length >= 4) imgs.forEach((im, n) => pintarImagen(x, im, (n % 2) * S / 2, (n >> 1) * S / 2, S / 2, S / 2));
    else pintarImagen(x, imgs[0], 0, 0, S, S);
    const url = c.toDataURL('image/jpeg', .86);
    cache.set(key + '@' + S, url);
    $$('img[data-cover]').forEach(img => { if (img.dataset.cover === key) { const u = cover(key, +img.dataset.px || 96); if (img.getAttribute('src') !== u) img.src = u; } });
  } catch (e) { /* se queda la portada dibujada */ }
}

// Color dominante (vivo) de una imagen, para teñir el fondo del reproductor
const tintes = new Map();
export function tinteGuardado(url) { return tintes.get(url) || null; }
export async function tinteDeImagen(url) {
  if (tintes.has(url)) return tintes.get(url);
  try {
    const img = await cargarImagen(url); const n = 24;
    const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d', { willReadFrequently: true });
    pintarImagen(x, img, 0, 0, n, n);
    const d = x.getImageData(0, 0, n, n).data; let R = 0, G = 0, B = 0, W = 0, r2 = 0, g2 = 0, b2 = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
      const s = mx === mn ? 0 : (l > .5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
      r2 += r; g2 += g; b2 += b;
      if (l < .12 || l > .85 || s < .2) continue;
      const w = s * s; R += r * w; G += g * w; B += b * w; W += w;
    }
    const px = d.length / 4; const [r, g, b] = W > .5 ? [R / W, G / W, B / W] : [r2 / px, g2 / px, b2 / px];
    const hex = '#' + [r, g, b].map(v => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join('');
    tintes.set(url, hex); return hex;
  } catch (e) { return null; }
}
export function cover(key, px) {
  const dpr = Math.min(2, window.devicePixelRatio || 1); const S = Math.max(64, Math.round(px * dpr / 32) * 32);
  const ck = key + '@' + S;
  if (!cache.has(ck)) { let url = ''; try { url = draw(key, S); } catch (e) { url = ''; } cache.set(ck, url); }
  return cache.get(ck);
}
export function olvidarPortadas(pred) { for (const k of [...cache.keys()]) if (pred(k)) cache.delete(k); }
export function hidratar(root = document) { $$('img[data-cover]', root).forEach(img => { const u = cover(img.dataset.cover, +img.dataset.px || 96); if (u && img.getAttribute('src') !== u) img.src = u; }); }

// Color de fondo de cada pantalla: el tono más vivo (ni muy claro ni muy oscuro) de su portada
export function pickTint(P) {
  let best = null, bs = -1;
  for (const c of P) {
    if (!/^#/.test(c)) continue;
    const [r, g, b] = hexRGB(c).map(v => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    const s = mx === mn ? 0 : (l > .5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
    const lum = .2126 * r + .7152 * g + .0722 * b;
    if (lum < .08 || lum > .7) continue;
    const score = s * (1 - Math.abs(lum - .35));
    if (score > bs) { bs = score; best = c; }
  }
  return best || P[1];
}
export function tintFor(key) {
  const i = key.indexOf(':'); const type = i < 0 ? key : key.slice(0, i); const id = key.slice(i + 1);
  if (type === 'track') { const t = src.track(id); const g = t && t.artURL && tintes.get(t.artURL); return g || pickTint(trackPalette(id).P); }
  if (type === 'playlist') { const p = src.playlist(id); if (p && p.paleta) return pickTint(p.paleta); if (p && p.canciones.length) return tintFor('track:' + p.canciones[0]); return '#5B3FD9'; }
  if (type === 'album') { const a = src.album(id); return pickTint(famOf(a && a.paleta)[0]); }
  if (type === 'artist') { const a = src.artist(id); const fam = famOf(a && a.paleta); return pickTint(fam[hash(String(id)) % fam.length]); }
  if (type === 'genre') { const g = src.genre(id); return g ? g.color : '#5B3FD9'; }
  if (type === 'liked') return '#6B4BE0';
  if (type === 'local') return '#0B7285';
  if (type === 'top') return '#C2410C';
  if (type === 'hoy') return '#0E7490';
  return '#5B3FD9';
}
