#!/bin/sh
# Restaura una copia diaria en la base de CELTTO-TOTEMS.
#
#   docker compose exec backup sh /scripts/restore.sh                 # lista las copias
#   docker compose exec backup sh /scripts/restore.sh celtto-AAAAMMDD-HHMM.dump
#
# IMPORTANTE: detené la app antes (docker compose stop app) y volvé a iniciarla al terminar.
# La restauración reemplaza los datos actuales. Necesitás la misma DATA_KEY de cuando se hizo la copia
# para poder leer los DNI cifrados.
set -eu
B=/backups/daily
if [ $# -eq 0 ]; then
  echo "Copias disponibles:"
  ls -1t "$B" | head -n 30
  exit 0
fi
f="$B/$1"
[ -f "$f" ] || { echo "No existe $f"; exit 1; }
echo "Restaurando $f en $PGDATABASE (los datos actuales se reemplazan)…"
pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$f"
echo "Listo. Iniciá la app: docker compose start app"
