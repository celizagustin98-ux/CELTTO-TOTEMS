#!/usr/bin/env bash
# Genera el zip del paquete de operación (opción A) desde el repo
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/dist-ops/celtto-ops-package.zip}"
mkdir -p "$(dirname "$OUT")"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -a "$ROOT/deploy/package/." "$STAGE/"
# no incluir .env de ejemplo con secretos
rm -f "$STAGE/.env" "$STAGE/.env.*"
( cd "$STAGE" && zip -r -q "$OUT" . )
echo "Paquete: $OUT"
