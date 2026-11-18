#!/usr/bin/env bash
# CELTTO-TOTEMS — actualización de versión en el servidor del cliente
# Uso:
#   sudo bash /opt/celtto/scripts/actualizar.sh
#   sudo bash /opt/celtto/scripts/actualizar.sh ghcr.io/org/celtto-totems:0.0.2
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

need_root
title "CELTTO-TOTEMS — Actualización"

if [[ ! -f "$ENV_FILE" ]]; then
  err "No hay $ROOT/$ENV_FILE. ¿Corriste scripts/instalar.sh?"
  exit 1
fi

check_docker

# shellcheck disable=SC1090
set -a
# leer valores actuales sin exportar todo de forma insegura en logs
source "$ENV_FILE"
set +a

CURRENT_IMAGE="${CELTTO_IMAGE:-}"
if [[ -z "$CURRENT_IMAGE" ]]; then
  err "CELTTO_IMAGE no está definido en .env"
  exit 1
fi

info "Imagen actual: $CURRENT_IMAGE"

NEW_IMAGE="${1-}"
if [[ -z "$NEW_IMAGE" ]]; then
  ask "Nueva imagen (registry/repo:tag)" "$CURRENT_IMAGE"
  NEW_IMAGE="$REPLY"
fi

if [[ "$NEW_IMAGE" == "$CURRENT_IMAGE" ]]; then
  warn "Es la misma imagen. Se hará pull por si el tag se movió."
fi

ask "¿Hacer backup de Postgres antes de actualizar? (S/n)" "S"
DO_BACKUP=false
if [[ "${REPLY,,}" =~ ^(s|si|y|yes|)$ ]]; then
  DO_BACKUP=true
fi

ask "¿Continuar con la actualización a: $NEW_IMAGE ? (S/n)" "S"
if [[ ! "${REPLY,,}" =~ ^(s|si|y|yes|)$ ]]; then
  info "Cancelado"
  exit 0
fi

if [[ "$DO_BACKUP" == true ]]; then
  mkdir -p "$ROOT/backups"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_FILE="$ROOT/backups/pg-${STAMP}.sql.gz"
  info "Backup → $BACKUP_FILE"
  if compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' 2>/dev/null | gzip > "$BACKUP_FILE"; then
    ok "Backup OK ($(du -h "$BACKUP_FILE" | awk '{print $1}'))"
  else
    # fallback con variables del .env
    if compose exec -T db pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DATABASE}" 2>/dev/null | gzip > "$BACKUP_FILE"; then
      ok "Backup OK"
    else
      warn "No se pudo hacer backup automático. ¿Continuar igual? (s/N)"
      read -r REPLY || true
      if [[ ! "${REPLY,,}" =~ ^(s|si|y|yes)$ ]]; then
        exit 1
      fi
    fi
  fi
fi

# Actualizar tag en .env
umask 077
TMP_ENV="$(mktemp)"
if grep -q '^CELTTO_IMAGE=' "$ENV_FILE"; then
  sed "s|^CELTTO_IMAGE=.*|CELTTO_IMAGE=$NEW_IMAGE|" "$ENV_FILE" > "$TMP_ENV"
else
  cat "$ENV_FILE" > "$TMP_ENV"
  echo "CELTTO_IMAGE=$NEW_IMAGE" >> "$TMP_ENV"
fi
mv "$TMP_ENV" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok ".env actualizado"

info "Pull..."
compose pull
info "Recreando servicios..."
compose up -d

wait_health || true

title "Actualización lista"
echo "  Imagen: $NEW_IMAGE"
echo "  Estado:  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE ps"
echo "  Logs:    docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f app"
ok "Hecho"
