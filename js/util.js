// Utilidades compartidas de Sonora
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Quita tildes y pasa a minúsculas: "Épica" -> "epica"
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const fmtLong = s => { const m = Math.max(1, Math.round((s || 0) / 60)); if (m < 60) return m + ' min'; return Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
export const fmtBytes = b => b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB';

export function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let s = seed || 7; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 1000003) / 1000003; }; }

export function hexRGB(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export const rgba = (h, a) => { const [r, g, b] = hexRGB(h); return `rgba(${r},${g},${b},${a})`; };
// Mezcla un color con el fondo de la app (amt 0..1)
export function shade(h, amt) { const a = hexRGB(h), b = [13, 10, 28]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * amt)).join(',')})`; }

export function shuffled(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible */ } }
};

// Base IndexedDB compartida: guarda el archivo SQLite y las canciones subidas por el usuario
const IDB_NAME = 'sonora';
let idbPromise = null;
export function idb() {
  if (!idbPromise) {
    idbPromise = new Promise(res => {
      try {
        const rq = indexedDB.open(IDB_NAME, 1);
        rq.onupgradeneeded = () => {
          const d = rq.result;
          for (const s of ['bd', 'archivos', 'portadas']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
        };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
        rq.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
  }
  return idbPromise;
}
export async function idbGet(storeName, key) {
  const d = await idb(); if (!d) return null;
  return new Promise(res => { try { const rq = d.transaction(storeName, 'readonly').objectStore(storeName).get(key); rq.onsuccess = () => res(rq.result == null ? null : rq.result); rq.onerror = () => res(null); } catch (e) { res(null); } });
}
export async function idbPut(storeName, key, value) {
  const d = await idb(); if (!d) return false;
  return new Promise(res => { try { const tx = d.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(value, key); tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => res(false); } catch (e) { res(false); } });
}
export async function idbDel(storeName, key) {
  const d = await idb(); if (!d) return false;
  return new Promise(res => { try { const tx = d.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(key); tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => res(false); } catch (e) { res(false); } });
}
export async function idbAll(storeName) {
  const d = await idb(); if (!d) return [];
  return new Promise(res => {
    try {
      const out = []; const rq = d.transaction(storeName, 'readonly').objectStore(storeName).openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
      rq.onerror = () => res(out);
    } catch (e) { res([]); }
  });
}
