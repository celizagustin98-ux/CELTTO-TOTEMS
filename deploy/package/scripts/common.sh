#!/usr/bin/env bash
# Utilidades compartidas — CELTTO-TOTEMS (paquete de operación)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

info()  { echo "${CYAN}→${RESET} $*"; }
ok()    { echo "${GREEN}✓${RESET} $*"; }
warn()  { echo "${YELLOW}!${RESET} $*"; }
err()   { echo "${RED}✗${RESET} $*" >&2; }
title() { echo; echo "${BOLD}$*${RESET}"; echo; }

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "Ejecutá con sudo: sudo bash $0"
    exit 1
  fi
}

compose() {
  if docker compose version &>/dev/null; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  elif command -v docker-compose &>/dev/null; then
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    err "No se encontró Docker Compose"
    exit 1
  fi
}

rand_secret() {
  # 48 bytes hex ≈ 96 chars
  if command -v openssl &>/dev/null; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

ask() {
  # ask "Prompt" "default" → escribe en REPLY
  local prompt="$1"
  local def="${2-}"
  if [[ -n "$def" ]]; then
    read -r -p "${prompt} [${def}]: " REPLY || true
    REPLY="${REPLY:-$def}"
  else
    read -r -p "${prompt}: " REPLY || true
  fi
}

ask_secret() {
  local prompt="$1"
  local def="${2-}"
  if [[ -n "$def" ]]; then
    read -r -s -p "${prompt} [Enter = generar/usar default]: " REPLY || true
    echo
    REPLY="${REPLY:-$def}"
  else
    read -r -s -p "${prompt}: " REPLY || true
    echo
  fi
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    err "Docker no está instalado. Instalá Docker Engine y volvé a correr el script."
    exit 1
  fi
  if ! docker info &>/dev/null; then
    err "Docker no responde. ¿Está el servicio activo? (systemctl start docker)"
    exit 1
  fi
  if ! docker compose version &>/dev/null && ! command -v docker-compose &>/dev/null; then
    err "Falta el plugin Docker Compose."
    exit 1
  fi
  ok "Docker OK"
}

wait_health() {
  local tries="${1:-30}"
  local i
  info "Esperando que el sistema responda..."
  for ((i=1; i<=tries; i++)); do
    if compose exec -T app node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" &>/dev/null; then
      ok "API saludable"
      return 0
    fi
    sleep 2
  done
  warn "No se confirmó health a tiempo. Revisá: docker compose -f $COMPOSE_FILE logs app"
  return 1
}
