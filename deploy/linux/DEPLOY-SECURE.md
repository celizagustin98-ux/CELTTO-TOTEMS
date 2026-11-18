# Despliegue seguro sin código fuente en el servidor

## Idea

| Dónde | Qué hay |
|-------|---------|
| GitHub | Código fuente (privado) |
| CI / PC de build | Construye la **imagen Docker** |
| Registry (GHCR) | Solo la imagen (binarios + deps) |
| Proxmox / Linux prod | **Solo** imagen + `.env` + `docker-compose.prod.yml` |

El servidor de producción **no clona el repo** y **no tiene** carpeta `src/`.

## 1. Build de la imagen (en CI o máquina de confianza)

```bash
# en un entorno con el código
docker build -t ghcr.io/TU_USUARIO/celtto-totems:0.0.1 .
docker push ghcr.io/TU_USUARIO/celtto-totems:0.0.1
```

Podés automatizar el build en CI cuando el token tenga permiso `workflow`.

## 2. En el servidor de producción (Proxmox VM)

Creá una carpeta mínima:

```text
/opt/celtto/
  docker-compose.prod.yml
  Caddyfile
  .env          # permisos 600, nunca en git
```

`.env` ejemplo:

```env
CELTTO_IMAGE=ghcr.io/TU_USUARIO/celtto-totems:0.0.1
POSTGRES_PASSWORD=clave-larga-aleatoria-aqui
SESSION_SECRET=otra-clave-larga-minimo-32-caracteres-xyz
COOKIE_SECURE=true
APP_TIMEZONE=America/Argentina/Cordoba
HTTP_PORT=8080
```

```bash
chmod 600 .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# primer usuario dueño (una sola vez)
docker compose -f docker-compose.prod.yml exec app \
  node dist/server/cli.js owner:create --user dueno --pass 'ClaveSeguraLarga123'
```

## 3. Qué NO hacer en producción

- No `git clone` del proyecto en el servidor
- No copiar `src/`
- No dejar `.env` legible por otros usuarios (`chmod 600`)
- No publicar puerto de Postgres al exterior
- No usar `POSTGRES_PASSWORD=cambiar-esta-clave`

## 4. Actualizar versión

```bash
# editá CELTTO_IMAGE=...:0.0.2 en .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## 5. Qué queda dentro de la imagen

Solo:

- `dist/server` (JS compilado)
- `dist/web` (frontend minificado, sin source maps)
- `node_modules` de producción

No incluye TypeScript fuente, tests ni `.env`.
