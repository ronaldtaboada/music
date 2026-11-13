// Conexión con el servidor local de Sonora (servidor/servidor.js)
async function pedir(metodo, ruta, cuerpo, { señal } = {}) {
  const op = { method: metodo, headers: {}, signal: señal };
  if (cuerpo !== undefined) { op.headers['Content-Type'] = 'application/json'; op.body = JSON.stringify(cuerpo); }
  let r;
  try { r = await fetch('api/' + ruta, op); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error('No hay conexión con el servidor de Sonora. ¿Está abierta la ventana negra?'); }
  let datos = null; try { datos = await r.json(); } catch (e) { /* sin cuerpo */ }
  if (!r.ok) throw new Error((datos && datos.error) || 'Error ' + r.status);
  return datos;
}
const id = s => encodeURIComponent(s);

export const api = {
  estado: () => pedir('GET', 'estado'),
  buscar: (q, señal) => pedir('GET', 'buscar?q=' + encodeURIComponent(q), undefined, { señal }),
  crearPlaylist: (nombre, cancion) => pedir('POST', 'playlists', { nombre, cancion }),
  renombrarPlaylist: (pid, nombre) => pedir('PATCH', 'playlists/' + id(pid), { nombre }),
  borrarPlaylist: pid => pedir('DELETE', 'playlists/' + id(pid)),
  agregarAPlaylist: (pid, cancion) => pedir('POST', `playlists/${id(pid)}/canciones`, { cancion }),
  quitarDePlaylist: (pid, cid) => pedir('DELETE', `playlists/${id(pid)}/canciones/${id(cid)}`),
  reproduccion: (cancion, origen) => pedir('POST', 'reproducciones', { cancion, origen }).then(r => r.id),
  segundos: (rid, segundos) => pedir('PATCH', 'reproducciones/' + rid, { segundos }),
  historial: () => pedir('GET', 'historial'),
  dia: d => pedir('GET', 'historial/' + id(d)),
  info: () => pedir('GET', 'info'),
  vaciarAudio: () => pedir('DELETE', 'cache/audio'),
  vaciarBusquedas: () => pedir('DELETE', 'cache/busquedas'),
  actualizarYtDlp: () => pedir('POST', 'ytdlp/actualizar'),
  borrarCancion: cid => pedir('DELETE', 'canciones/' + id(cid)),
  precargar: cid => fetch('api/precargar/' + id(cid), { method: 'POST' }).catch(() => {}),
  async subirLocal(file, meta) {
    const r = await fetch('api/locales', {
      method: 'POST', body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Nombre': encodeURIComponent(file.name), 'X-Titulo': encodeURIComponent(meta.titulo || ''), 'X-Artista': encodeURIComponent(meta.artista || ''), 'X-Duracion': String(meta.duracion || 0) }
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo subir');
    return d.id;
  },
  subirPortada: (cid, blob) => fetch(`api/locales/${id(cid)}/portada`, { method: 'POST', body: blob }).then(r => r.ok)
};
