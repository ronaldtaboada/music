-- ============================================================
--  Sonora · Consultas de ejemplo
--  Puedes probarlas en la app (Ajustes › Base de datos › Consola SQL)
--  o en DB Browser for SQLite con el archivo exportado.
-- ============================================================

-- 1. Todas las canciones con su artista, álbum y licencia (vista que une 4 tablas)
SELECT titulo, artista, album, licencia, round(duracion_seg / 60.0, 1) AS minutos
FROM v_canciones
ORDER BY artista, titulo;

-- 2. Canciones de una playlist en su orden
SELECT pc.posicion, c.titulo, ar.nombre AS artista
FROM playlist_canciones pc
JOIN canciones c ON c.id = pc.cancion_id
JOIN artistas ar ON ar.id = c.artista_id
WHERE pc.playlist_id = (SELECT id FROM playlists WHERE nombre = 'Enfoque total')
ORDER BY pc.posicion;

-- 3. Cuántas canciones y minutos hay por género (relación muchos a muchos)
SELECT g.nombre AS genero, COUNT(*) AS canciones, round(SUM(c.duracion_seg) / 60) AS minutos
FROM generos g
JOIN cancion_generos cg ON cg.genero_id = g.id
JOIN canciones c ON c.id = cg.cancion_id
GROUP BY g.id
ORDER BY canciones DESC;

-- 4. Las canciones que más ha escuchado cada usuario
SELECT u.nombre AS usuario, v.titulo, v.artista, v.veces
FROM v_mas_escuchadas v
JOIN usuarios u ON u.id = v.usuario_id
ORDER BY u.nombre, v.veces DESC;

-- 5. Artistas favoritos de cada usuario según sus "me gusta"
SELECT u.nombre AS usuario, ar.nombre AS artista, COUNT(*) AS me_gusta
FROM me_gusta mg
JOIN usuarios u  ON u.id = mg.usuario_id
JOIN canciones c ON c.id = mg.cancion_id
JOIN artistas ar ON ar.id = c.artista_id
GROUP BY u.id, ar.id
ORDER BY u.nombre, me_gusta DESC;

-- 6. Minutos escuchados por usuario en los últimos 30 días
SELECT u.nombre AS usuario, round(SUM(r.segundos) / 60.0) AS minutos, COUNT(*) AS reproducciones
FROM reproducciones r
JOIN usuarios u ON u.id = r.usuario_id
WHERE r.reproducido_en >= datetime('now', 'localtime', '-30 days')
GROUP BY u.id;

-- 7. Playlists de cada usuario con su tamaño y duración (vista)
SELECT u.nombre AS usuario, v.nombre AS playlist, v.canciones, round(v.duracion_seg / 60) AS minutos
FROM v_resumen_playlists v
JOIN usuarios u ON u.id = v.usuario_id
ORDER BY u.nombre, v.nombre;

-- 8. Canciones que nadie ha escuchado todavía
SELECT c.titulo, ar.nombre AS artista
FROM canciones c
JOIN artistas ar ON ar.id = c.artista_id
WHERE NOT EXISTS (SELECT 1 FROM reproducciones r WHERE r.cancion_id = c.id)
ORDER BY ar.nombre;
