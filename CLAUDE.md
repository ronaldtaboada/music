# CLAUDE.md — Sonora

Contexto para Claude Code (local o remoto en GitHub). Léelo antes de tocar código.

## Qué es

**Sonora**: reproductor de música personal, estilo "bot de Discord". Escribes una canción, el servidor local la busca
en YouTube con `yt-dlp` (prefiere videos *lyrics* porque traen el audio del disco) y entrega solo el audio.
Tiene playlists, me gusta, cola, aleatorio, repetir, temporizador para dormir, historial y subida de MP3 propios.
PWA instalable. Uso personal en un solo computador (Windows), servidor en `localhost:8787`.

Todo el proyecto (código, comentarios, UI, commits, nombres de variables) está **en español**. Mantenerlo así.

## Stack y reglas de oro

- **Cero dependencias.** Node puro (`node:http`, `node:sqlite`, `node:child_process`). No hay `npm install`, ni
  bundler, ni framework. No agregar paquetes sin que el usuario lo pida explícitamente.
- **Node ≥ 22.13** (requiere `node:sqlite` estable). La máquina del usuario tiene Node 26.
- Frontend: **JS vanilla con módulos ES** (`<script type="module">`), CSS plano, sin build. Lo que se edita es lo que se sirve.
- Base de datos: SQLite en `datos/sonora.sqlite` (modo WAL). El esquema se aplica en cada arranque con
  `CREATE TABLE IF NOT EXISTS` → **no hay sistema de migraciones**: un cambio de columnas en tablas existentes
  necesita una migración explícita en `servidor/bd.js` (p. ej. `PRAGMA user_version`).
- `yt-dlp` se descarga solo en `servidor/bin/` (ignorado por git) y se autoactualiza cada 7 días.
- Estilo de código: denso, líneas largas, funciones cortas en una línea, `catch (e) { /* nada */ }` para errores
  ignorables. Respetar ese estilo; no reformatear archivos enteros.

## Mapa del código

```
INICIAR SONORA.bat        lanzador para el usuario (verifica node y corre el servidor)
servidor/servidor.js      HTTP: archivos estáticos + API /api/* + streaming de audio con Range + caché en disco
servidor/youtube.js       yt-dlp: instalar/actualizar, buscar, puntuar resultados (premia "lyrics"), resolver URL de audio
servidor/bd.js            SQLite: helpers q/q1/run/tx, canciones, playlists, reproducciones, caché de búsquedas
base-de-datos/esquema.sql esquema real (canciones, playlists, playlist_canciones, reproducciones, cache_busquedas)
index.html                shell de la app (vistas se pintan desde js/app.js)
js/app.js                 interfaz completa: navegación por pilas, vistas, comandos !play/!cola/!skip, hojas, diálogos
js/player.js              motor de reproducción: cola, orden, shuffle/repeat, MediaSession, registro de escuchas
js/api.js                 cliente fetch de la API local
js/covers.js              portadas: miniaturas de YouTube o arte generativo en canvas; mosaicos de playlists
js/local.js               lectura de MP3 subidos (etiquetas ID3, duración)
js/util.js                $, $$, esc, norm, fmt, store (localStorage)…
css/sonora.css            todos los estilos
sw.js                     service worker: cachea solo la app (network-first). Subir VERSION al cambiar archivos de la app
manifest.webmanifest      PWA
datos/                    (git-ignored) sonora.sqlite, cache-audio/ (máx 2 GB, LRU por mtime), miniaturas/, locales/
```

### API (`servidor/servidor.js`, función `api`)

`GET estado` · `GET buscar?q=` · `GET|HEAD audio/:id` · `POST precargar/:id` · `GET miniatura/:vid[?g]` ·
`GET portada/:id` · `POST|PATCH|DELETE playlists[/:pid][/canciones[/:cid]]` (`:pid` puede ser `me-gusta`) ·
`POST|PATCH reproducciones[/:rid]` · `GET historial[/:dia]` · `POST locales`, `POST locales/:id/portada` ·
`DELETE canciones/:id` · `GET info` · `DELETE cache/audio|busquedas` · `POST ytdlp/actualizar`.

IDs de canción: `yt:<11 chars>` o `local:<n>` (validados con regex en `bd.js` y `servidor.js`).

### Seguridad que no se debe romper
- El servidor escucha **solo en 127.0.0.1 / ::1**. No cambiar a `0.0.0.0` sin pedirlo.
- `estatico()` bloquea `datos/`, `servidor/`, `.git`, `node_modules` y path traversal (`PRIVADO` + `startsWith(RAIZ)`).
- Todo texto que llega a HTML pasa por `esc()`; las consultas SQL siempre con parámetros `?`.

## Cómo correr y verificar

```bash
node servidor/servidor.js --sin-navegador --puerto 8787     # en remoto, siempre --sin-navegador
curl -s localhost:8787/api/estado                           # humo: debe devolver JSON
node --check servidor/servidor.js servidor/bd.js servidor/youtube.js   # sintaxis
```

- **No hay tests ni CI todavía.** Si se agregan, usar el runner nativo `node --test` (sin dependencias), en `pruebas/`.
- `puntuar()` y `separarTitulo()` de `youtube.js` y las funciones de `bd.js` son puras/aisladas → buenos candidatos
  a tests. Para `bd.js` hay que permitir apuntar a otra ruta de base de datos (hoy está fija en `datos/`).
- En un entorno remoto/nube **YouTube puede bloquear yt-dlp** (IPs de datacenter) y puede no haber red para
  descargarlo. No asumir que la búsqueda funciona allí: probar API, base y UI; dejar lo de YouTube como
  "verificar en local" en el PR.
- UI: se puede verificar con Playwright abriendo `http://localhost:8787` (móvil 390×844 y escritorio 1280×800).

## Deuda y restos conocidos (verificado el 2026-11-13)

Quedan archivos de una versión anterior ("catálogo de música libre" en el navegador, con sql.js):
- `musica/` (≈121 MB de MP3 + `CREDITOS.txt`): **ningún código los usa**. Inflan el repo.
- `vendor/sql.js/`: **no se usa** (ahora la base vive en el servidor con `node:sqlite`).
- `base-de-datos/datos-iniciales.sql` y `diagrama-entidad-relacion.*`: hablan de tablas `licencias`, `artistas`,
  álbumes… que **no existen** en `esquema.sql`. `consultas-ejemplo.sql` también puede estar desactualizado.
- `manifest.webmanifest`: descripción vieja ("Música libre… funciona sin internet").
- `npm` (archivo vacío) y `package-lock.json` en la raíz: basura accidental.
- `DESIGN.md`: guía visual inspirada en Spotify; la app ya tiene su propia identidad (paleta `#0D0A1C`, fuentes
  Bricolage Grotesque / Outfit / Figtree). Úsalo solo como referencia de estructura, no copiar marca de Spotify.
- `js/app.js` (~800 líneas) concentra toda la UI; `player.js` tiene `olvidarArchivo()` vacío (resto).

No borrar nada de esto sin confirmación del usuario: proponerlo en un issue/PR propio.

---

## Trabajo remoto por GitHub

### Preparación (una sola vez, la hace el usuario)
1. El repo **aún no tiene remoto**. Crear repo privado y subir:
   `gh repo create sonora --private --source . --push`
   (Antes conviene decidir qué hacer con `musica/` — 121 MB de binarios en el historial.)
2. Para que Claude trabaje desde GitHub: `/install-github-app` en Claude Code (instala la GitHub App y el workflow
   `.github/workflows/claude.yml`), o usar Claude Code en la web (claude.ai/code) apuntando al repo.
3. Luego se le asignan tareas con `@claude` en issues/PRs o se lanzan sesiones remotas.

### Reglas para cada tarea remota
- Una tarea = un issue = una rama `claude/<tema-corto>` = un PR contra `main`. Nunca push directo a `main`.
- PRs pequeños y revisables. Si la tarea es grande, dividirla en fases y abrir un PR por fase.
- La descripción del PR debe decir: qué cambió, cómo se verificó (comandos y salida), y qué **no** se pudo
  verificar en remoto (típicamente: búsqueda/audio real de YouTube, reproducción en el celular, Windows `.bat`).
- Si se tocan archivos servidos por la app, subir `VERSION` en `sw.js` y actualizar `ARCHIVOS_APP` si cambian nombres.
- Si se cambia el esquema, incluir migración para bases existentes (el usuario ya tiene datos reales en `datos/`).
- Actualizar `LEEME.txt` (texto para el usuario final, sin tildes) y este archivo cuando cambie algo relevante.
- Mantener cero dependencias, idioma español y servidor solo-localhost.

### Backlog de trabajos pesados (candidatos a issues)
Ordenados por valor/riesgo. Cada uno es apto para una sesión remota.

1. **Limpieza del repo** — quitar `musica/`, `vendor/sql.js`, SQL/diagramas obsoletos, `npm`, `package-lock.json`
   raíz; regenerar el diagrama E-R desde `esquema.sql`; corregir el manifest. (Pedir confirmación antes; si ya
   están en GitHub, considerar `git filter-repo` para sacar los 121 MB del historial.)
2. **Tests + CI** — `pruebas/` con `node --test`: `puntuar`, `separarTitulo`, `norm`, CRUD de `bd.js` sobre una base
   temporal (requiere hacer configurable la ruta de `DATOS`, p. ej. variable `SONORA_DATOS`), y prueba de humo HTTP
   de la API y del bloqueo de rutas privadas/path traversal. Workflow de GitHub Actions con Node 22 y 24.
3. **Migraciones de esquema** — `PRAGMA user_version` + lista ordenada de migraciones en `bd.js`.
4. **Partir `js/app.js`** en módulos por vista (`vistas/inicio.js`, `buscar.js`, `biblioteca.js`, `lista.js`,
   `ajustes.js`), `hojas.js`, `iconos.js`. Sin cambiar comportamiento; verificar con Playwright antes/después.
5. **Robustez del servidor** — límite de tamaño en `leerJSON` y subidas, timeouts, manejo de `yt-dlp` caído,
   reintento al expirar el enlace de audio, logs con nivel.
6. **Letras sincronizadas** (p. ej. LRCLIB) mostradas en el reproductor a pantalla completa.
7. **Exportar/importar** playlists e historial (JSON), y respaldo de `datos/sonora.sqlite`.
8. **Acceso desde el celular en la red local** (opcional, solo si el usuario lo pide): escuchar en LAN con
   un PIN/token, porque hoy no hay autenticación.
9. **Estadísticas** — vista "tu año/mes" a partir de `reproducciones` (top artistas, horas, rachas).
10. **Accesibilidad y móvil** — auditoría de foco, teclado, `prefers-reduced-motion`, safe-area, 100dvh.

Plantilla sugerida para el issue:
```
Objetivo: …
Alcance: archivos/áreas que se pueden tocar; qué NO tocar
Criterio de listo: comportamiento esperado + cómo verificarlo
Notas: limitaciones del entorno remoto (YouTube), datos existentes del usuario
```
