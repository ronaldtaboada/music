-- ============================================================
--  Sonora · Esquema de la base de datos (SQLite, en el servidor)
--  Archivo: datos/sonora.sqlite (se crea solo la primera vez).
--  Guarda solo lo tuyo: canciones que usaste, playlists,
--  reproducciones y la caché de búsquedas de YouTube.
-- ============================================================

PRAGMA foreign_keys = ON;

-- Canciones que escuchaste, agregaste a una playlist o subiste.
-- id: 'yt:<id del video>' para YouTube o 'local:<n>' para tus archivos.
CREATE TABLE IF NOT EXISTS canciones (
  id              TEXT    PRIMARY KEY,
  fuente          TEXT    NOT NULL CHECK (fuente IN ('youtube', 'local')),
  video_id        TEXT    UNIQUE,                       -- solo YouTube
  titulo          TEXT    NOT NULL,
  artista         TEXT    NOT NULL DEFAULT '',
  duracion_seg    REAL    NOT NULL DEFAULT 0 CHECK (duracion_seg >= 0),
  canal           TEXT,                                 -- canal de YouTube que subió el video
  titulo_video    TEXT,                                 -- título tal como aparece en YouTube
  es_letra        INTEGER NOT NULL DEFAULT 0 CHECK (es_letra IN (0, 1)),   -- 1 = video de letra (lyrics)
  archivo         TEXT,                                 -- solo locales: nombre en datos/locales
  tipo_mime       TEXT,
  tiene_portada   INTEGER NOT NULL DEFAULT 0 CHECK (tiene_portada IN (0, 1)),
  agregada_en     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Playlists. La de clave 'me-gusta' es fija y guarda tus me gusta.
CREATE TABLE IF NOT EXISTS playlists (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clave           TEXT    UNIQUE,
  nombre          TEXT    NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 80),
  creada_en       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  actualizada_en  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS playlist_canciones (
  playlist_id  INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  cancion_id   TEXT    NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  posicion     INTEGER NOT NULL,
  agregada_en  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  PRIMARY KEY (playlist_id, cancion_id)
);

-- Historial: una fila cada vez que empieza a sonar una canción.
CREATE TABLE IF NOT EXISTS reproducciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cancion_id      TEXT    NOT NULL REFERENCES canciones(id) ON DELETE CASCADE,
  dia             TEXT    NOT NULL DEFAULT (date('now', 'localtime')),
  reproducida_en  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  segundos        INTEGER NOT NULL DEFAULT 0,
  origen          TEXT                                   -- desde dónde sonó: 'playlist:3', 'buscar'…
);

-- Caché de búsquedas de YouTube (evita repetir la misma búsqueda, que tarda unos segundos).
CREATE TABLE IF NOT EXISTS cache_busquedas (
  consulta     TEXT    PRIMARY KEY,                      -- texto normalizado
  resultados   TEXT    NOT NULL,                         -- JSON
  guardada_en  INTEGER NOT NULL                          -- milisegundos desde 1970
);

CREATE INDEX IF NOT EXISTS idx_playlist_orden       ON playlist_canciones(playlist_id, posicion);
CREATE INDEX IF NOT EXISTS idx_reproducciones_dia   ON reproducciones(dia, id);
CREATE INDEX IF NOT EXISTS idx_reproducciones_canc  ON reproducciones(cancion_id);

CREATE TRIGGER IF NOT EXISTS trg_playlist_insert AFTER INSERT ON playlist_canciones
BEGIN
  UPDATE playlists SET actualizada_en = datetime('now', 'localtime') WHERE id = NEW.playlist_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_playlist_delete AFTER DELETE ON playlist_canciones
BEGIN
  UPDATE playlists SET actualizada_en = datetime('now', 'localtime') WHERE id = OLD.playlist_id;
END;

INSERT OR IGNORE INTO playlists (clave, nombre) VALUES ('me-gusta', 'Tus me gusta');

PRAGMA user_version = 2;
