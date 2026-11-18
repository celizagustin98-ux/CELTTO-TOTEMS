#!/usr/bin/env bash
# CELTTO-TOTEMS — instalación guiada en el servidor del cliente
# Uso: sudo bash /opt/celtto/scripts/instalar.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

need_root
title "CELTTO-TOTEMS — Instalación"

if [[ -f "$ENV_FILE" ]]; then
  warn "Ya existe $ROOT/$ENV_FILE"
  ask "¿Continuar y sobrescribir la configuración? (s/N)" "N"
  if [[ ! "${REPLY,,}" =~ ^(s|si|y|yes)$ ]]; then
    info "Cancelado. Para actualizar usá: sudo bash scripts/actualizar.sh"
    exit 0
  fi
  cp -a "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  ok "Backup del .env anterior creado"
fi

check_docker

title "1/5  Imagen y red"
info "La imagen debe estar en un registry al que este servidor pueda hacer pull."
ask "Imagen Docker completa (registry/repo:tag)" "ghcr.io/celizagustin98-ux/celtto-totems:0.0.1"
CELTTO_IMAGE="$REPLY"

ask "Puerto HTTP en este servidor" "8080"
HTTP_PORT="$REPLY"

ask "Zona horaria" "America/Argentina/Cordoba"
APP_TIMEZONE="$REPLY"

ask "¿Habrá HTTPS delante (proxy/dominio con TLS)? (s/N)" "N"
if [[ "${REPLY,,}" =~ ^(s|si|y|yes)$ ]]; then
  COOKIE_SECURE=true
else
  COOKIE_SECURE=false
  warn "COOKIE_SECURE=false (HTTP). Activá true cuando tengas HTTPS."
fi

title "2/5  Base de datos y secretos"
ask "Nombre de la base Postgres" "celtto_totems"
POSTGRES_DATABASE="$REPLY"
ask "Usuario Postgres" "celtto"
POSTGRES_USER="$REPLY"

GEN_PG="$(rand_secret)"
ask_secret "Password Postgres (Enter = generar segura)" "$GEN_PG"
POSTGRES_PASSWORD="$REPLY"
if [[ ${#POSTGRES_PASSWORD} -lt 12 ]]; then
  err "Password de Postgres demasiado corta (mín. 12)"
  exit 1
fi

GEN_SS="$(rand_secret)"
ask_secret "SESSION_SECRET (Enter = generar)" "$GEN_SS"
SESSION_SECRET="$REPLY"
if [[ ${#SESSION_SECRET} -lt 32 ]]; then
  err "SESSION_SECRET debe tener al menos 32 caracteres"
  exit 1
fi

title "3/5  Usuario administrador (dueño)"
ask "Usuario dueño" "dueno"
OWNER_USER="$REPLY"
while true; do
  ask_secret "Contraseña del dueño (mín. 8)"
  OWNER_PASS="$REPLY"
  if [[ ${#OWNER_PASS} -lt 8 ]]; then
    warn "Mínimo 8 caracteres"
    continue
  fi
  ask_secret "Repetí la contraseña del dueño"
  if [[ "$REPLY" == "$OWNER_PASS" ]]; then
    break
  fi
  warn "No coinciden"
done

title "4/5  Resumen"
echo "  Carpeta:     $ROOT"
echo "  Imagen:      $CELTTO_IMAGE"
echo "  Puerto:      $HTTP_PORT"
echo "  Timezone:    $APP_TIMEZONE"
echo "  Cookie TLS:  $COOKIE_SECURE"
echo "  Base:        $POSTGRES_DATABASE (user $POSTGRES_USER)"
echo "  Dueño:       $OWNER_USER"
echo
ask "¿Escribir .env y levantar el sistema? (S/n)" "S"
if [[ ! "${REPLY,,}" =~ ^(s|si|y|yes|)$ ]]; then
  info "Cancelado"
  exit 0
fi

umask 077
cat > "$ENV_FILE" <<ENV
# Generado por scripts/instalar.sh — $(date -Iseconds)
# No compartir. Permisos recomendados: chmod 600 .env

CELTTO_IMAGE=$CELTTO_IMAGE
HTTP_PORT=$HTTP_PORT
APP_TIMEZONE=$APP_TIMEZONE
COOKIE_SECURE=$COOKIE_SECURE

POSTGRES_DATABASE=$POSTGRES_DATABASE
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

SESSION_SECRET=$SESSION_SECRET
SESSION_HOURS=12
AUTO_MIGRATE=true
LOG_HTTP=false

PG_POOL_MAX=20
TICKET_RATE_PER_MIN=120
TICKET_RATE_PER_DEVICE=30
ENV
chmod 600 "$ENV_FILE"
ok "Archivo .env escrito (chmod 600)"

title "5/5  Descarga y arranque"
info "Pull de imágenes..."
compose pull
info "Levantando servicios..."
compose up -d

wait_health || true

info "Creando usuario dueño..."
if compose exec -T app node dist/server/cli.js owner:create --user "$OWNER_USER" --pass "$OWNER_PASS"; then
  ok "Usuario dueño creado"
else
  warn "No se pudo crear el dueño automáticamente (puede existir). Revisá logs."
fi

title "Instalación lista"
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  Panel:    http://${HOST_IP:-localhost}:${HTTP_PORT}/login"
echo "  Usuario:  $OWNER_USER"
echo
echo "  Comandos útiles:"
echo "    cd $ROOT"
echo "    docker compose -f docker-compose.yml --env-file .env ps"
echo "    docker compose -f docker-compose.yml --env-file .env logs -f app"
echo "    sudo bash scripts/actualizar.sh"
echo
ok "Listo. Configurá secretarías, tótems y TVs desde el panel maestro."
