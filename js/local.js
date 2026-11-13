// Canciones del usuario: lectura de etiquetas ID3 (título, artista, álbum y carátula) y duración.
// El archivo de audio se guarda en IndexedDB; sus datos van a la tabla "canciones" de la base SQLite.

export const esAudio = f => (f.type && f.type.startsWith('audio/')) || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(f.name);

export function nombreDesdeArchivo(nombre) {
  const base = nombre.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}[\s.\-]+/, '').trim();
  const partes = base.split(/\s+[-–—]\s+/);
  return partes.length >= 2 ? { artista: partes[0].trim(), titulo: partes.slice(1).join(' - ').trim() } : { titulo: base || 'Canción sin título' };
}

export function medirDuracion(blob) {
  return new Promise(res => {
    let listo = false; const a = document.createElement('audio'); const url = URL.createObjectURL(blob);
    const fin = d => { if (listo) return; listo = true; try { URL.revokeObjectURL(url); } catch (e) { /* nada */ } a.removeAttribute('src'); res(isFinite(d) && d > 0 ? d : 0); };
    a.preload = 'metadata'; a.onloadedmetadata = () => fin(a.duration); a.onerror = () => fin(0); setTimeout(() => fin(0), 8000); a.src = url;
  });
}

const syncsafe = (b, o) => (b[o] & 127) << 21 | (b[o + 1] & 127) << 14 | (b[o + 2] & 127) << 7 | (b[o + 3] & 127);
const be32 = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
function texto(b) {
  const enc = b[0]; const data = b.subarray(1); let s = '';
  try {
    if (enc === 0) s = new TextDecoder('latin1').decode(data);
    else if (enc === 1) { if (data[0] === 0xFE && data[1] === 0xFF) s = new TextDecoder('utf-16be').decode(data.subarray(2)); else s = new TextDecoder('utf-16le').decode(data[0] === 0xFF && data[1] === 0xFE ? data.subarray(2) : data); }
    else if (enc === 2) s = new TextDecoder('utf-16be').decode(data);
    else s = new TextDecoder('utf-8').decode(data);
  } catch (e) { s = ''; }
  return s.split('\u0000')[0].trim();
}
function caratula(b) {
  const enc = b[0]; let i = 1; while (i < b.length && b[i] !== 0) i++;
  let mime = new TextDecoder('latin1').decode(b.subarray(1, i)).toLowerCase() || 'image/jpeg'; i += 2;
  if (enc === 1 || enc === 2) { while (i + 1 < b.length && !(b[i] === 0 && b[i + 1] === 0)) i += 2; i += 2; } else { while (i < b.length && b[i] !== 0) i++; i++; }
  const img = b.slice(i); if (img.length < 200) return null;
  if (!mime.includes('/')) mime = 'image/' + (mime === 'jpg' ? 'jpeg' : mime);
  return new Blob([img], { type: mime });
}
export async function leerEtiquetas(file) {
  try {
    const h = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return {};
    const ver = h[3], flags = h[5], size = syncsafe(h, 6);
    const b = new Uint8Array(await file.slice(10, 10 + Math.min(size, 12 * 1048576)).arrayBuffer());
    let p = 0; const out = {};
    if (flags & 0x40) p = ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4;
    while (p + 10 <= b.length) {
      const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fs = ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
      if (fs <= 0 || p + 10 + fs > b.length) break;
      const body = b.subarray(p + 10, p + 10 + fs); p += 10 + fs;
      if (id === 'TIT2') out.titulo = texto(body);
      else if (id === 'TPE1') out.artista = texto(body);
      else if (id === 'TALB') out.album = texto(body);
      else if (id === 'APIC' && !out.caratula) out.caratula = caratula(body);
    }
    return out;
  } catch (e) { return {}; }
}
