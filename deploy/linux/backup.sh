#!/bin/sh
# Servicio de respaldo de CELTTO-TOTEMS (corre en el contenedor "backup" del docker compose).
#
# - Todos los días (BACKUP_HOUR, por defecto 02 h): copia completa con pg_dump + verificación.
# - Los domingos: copia base (pg_basebackup) para recuperar a un momento puntual junto con el archivo WAL.
# - El primer día de cada mes: prueba de restauración real en una base temporal.
# - Conserva BACKUP_KEEP_DAYS días de copias diarias (14 por defecto) y 4 copias base.
# - Deja el estado en /backups/status.json (la app lo muestra en Monitoreo).
set -eu

B=/backups
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR:-02}"
mkdir -p "$B/daily" "$B/base" "$B/wal"
# La base (usuario postgres del otro contenedor) escribe el archivo WAL acá
chmod 0777 "$B/wal"

status() { # $1=json parcial: se fusiona con el estado anterior
  prev="{}"
  [ -f "$B/status.json" ] && prev="$(cat "$B/status.json")"
  printf '%s' "$prev" | sed 's/}$//' > "$B/status.tmp"
  [ "$prev" = "{}" ] && printf '{' > "$B/status.tmp" || printf ',' >> "$B/status.tmp"
  printf '%s}' "$1" >> "$B/status.tmp"
  # Si una clave se repite, JSON.parse se queda con la última: el estado siempre refleja lo más reciente
  mv "$B/status.tmp" "$B/status.json"
}

daily() {
  ts="$(date -u +%Y%m%d-%H%M)"
  f="$B/daily/celtto-$ts.dump"
  echo "[backup] copia diaria → $f"
  if pg_dump -Fc -Z 6 -f "$f.part" && pg_restore --list "$f.part" > /dev/null; then
    mv "$f.part" "$f"
    size="$(wc -c < "$f" | tr -d ' ')"
    status "\"lastOk\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"lastFile\":\"$(basename "$f")\",\"lastSizeBytes\":$size,\"lastError\":null"
  else
    rm -f "$f.part"
    status "\"lastError\":\"pg_dump falló $(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    echo "[backup] ERROR en la copia diaria" >&2
  fi
  find "$B/daily" -name 'celtto-*.dump' -mtime +"$KEEP_DAYS" -delete
}

base() {
  d="$B/base/$(date -u +%Y%m%d)"
  [ -d "$d" ] && return 0
  echo "[backup] copia base semanal → $d"
  if pg_basebackup -D "$d" -Ft -z -X none -c fast; then
    # Quedan las 4 copias base más nuevas; se borra el WAL anterior a la más vieja que se conserva
    ls -1d "$B"/base/* 2>/dev/null | sort | head -n -4 | xargs -r rm -rf
    oldest="$(ls -1d "$B"/base/* | sort | head -n 1)"
    find "$B/wal" -type f ! -newer "$oldest" -delete
  else
    rm -rf "$d"
    echo "[backup] ERROR en la copia base (¿falta la regla de replicación en pg_hba.conf?)" >&2
  fi
}

verify() {
  last="$(ls -1 "$B"/daily/celtto-*.dump 2>/dev/null | sort | tail -n 1)"
  [ -n "$last" ] || return 0
  echo "[backup] prueba de restauración de $(basename "$last")"
  dropdb --if-exists celtto_restore_test
  createdb celtto_restore_test
  if pg_restore -d celtto_restore_test --no-owner "$last" > /dev/null 2>&1 && \
     psql -d celtto_restore_test -tAc "select count(*) from kysely_migration" > /dev/null; then
    status "\"lastVerifyOk\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    echo "[backup] restauración verificada"
  else
    status "\"lastVerifyError\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    echo "[backup] ERROR: la copia no se pudo restaurar" >&2
  fi
  dropdb --if-exists celtto_restore_test
}

until pg_isready -q; do sleep 3; done
daily
[ ! -f "$B/status.json" ] || grep -q lastVerifyOk "$B/status.json" || verify
while true; do
  now="$(date +%H)"
  if [ "$now" = "$HOUR" ]; then
    daily
    [ "$(date +%u)" = "7" ] && base
    [ "$(date +%d)" = "01" ] && verify
    sleep 3700
  fi
  sleep 600
done
