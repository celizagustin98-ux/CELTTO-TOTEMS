# CELTTO-TOTEMS — Paquete de operación (opción A)

Este directorio es lo **único** que debe vivir en el servidor del cliente.

```text
/opt/celtto/
  docker-compose.yml
  Caddyfile
  scripts/instalar.sh
  scripts/actualizar.sh
  scripts/common.sh
  .env                 # lo crea el instalador (no viene en el paquete)
  backups/             # lo crea el actualizador
```

**No incluye código fuente.** Solo orquestación Docker + scripts.

## Requisitos del servidor

- Linux (Ubuntu/Debian recomendado)
- Docker Engine + plugin Compose
- Acceso a internet al registry de la imagen (o imagen precargada)

## Instalación

```bash
# 1) Copiá este paquete a /opt/celtto
sudo mkdir -p /opt/celtto
sudo cp -a . /opt/celtto/
cd /opt/celtto

# 2) Instalación guiada
sudo bash scripts/instalar.sh
```

El script pide imagen, puerto, passwords (o las genera), crea el `.env` y levanta el sistema.

## Actualización

```bash
sudo bash scripts/actualizar.sh
# o con tag explícito:
sudo bash scripts/actualizar.sh ghcr.io/tu-org/celtto-totems:0.0.2
```

Opcionalmente hace backup de Postgres antes del `pull`.

## Build de la imagen (en tu máquina, no en el cliente)

```bash
# en el repo fuente
docker build -t ghcr.io/tu-usuario/celtto-totems:0.0.1 .
docker push ghcr.io/tu-usuario/celtto-totems:0.0.1
```

## Seguridad

- `.env` con `chmod 600`
- No publiques el puerto de Postgres
- Repo fuente privado; el cliente solo recibe este paquete + la imagen
