# Escalado CELTTO-TOTEMS (10 tótems, TVs, secretarias)

## Capacidad objetivo

- ~10 tótems emitiendo turnos
- Varias TVs por sector
- ~5 secretarias por sector
- Picos altos de tickets (decenas de miles/día)

## Arquitectura

- `db` — PostgreSQL 16 (conexiones e índices)
- `redis` — pub/sub para que todas las instancias notifiquen a las TVs
- `app` — API Node (escalable horizontalmente)
- `proxy` — Caddy con balanceo y healthcheck

## Arranque

```bash
cp .env.example .env
# definir POSTGRES_PASSWORD

docker compose up -d --build
docker compose exec app npx tsx src/server/cli.ts owner:create --user dueno --pass 'ClaveSegura123'
```

## Escalar a 2 (o más) instancias de API

```bash
docker compose up -d --scale app=2 --no-recreate
```

El proxy reparte el tráfico. Redis mantiene los llamados de TV sincronizados entre instancias.

## Variables útiles

| Variable | Default | Uso |
|----------|---------|-----|
| `PG_POOL_MAX` | 20 | Conexiones por instancia app |
| `TICKET_RATE_PER_MIN` | 120 | Límite por IP |
| `TICKET_RATE_PER_DEVICE` | 30 | Límite por tótem (`deviceKey`) |
| `REDIS_URL` | redis://redis:6379 | Obligatorio con varias apps |

## Health

`GET /api/health` → `ok`, `dbLatencyMs`, `hub` (`redis`|`memory`), `instanceId`, `wsClients`.

## Dimensionamiento orientativo (Proxmox)

| Componente | Mínimo razonable |
|------------|------------------|
| VM app+proxy | 2 vCPU / 2 GB RAM |
| VM o contenedor Postgres | 2–4 vCPU / 4 GB RAM |
| Redis | 256 MB–512 MB |

## Prueba rápida de pico

Desde una máquina de prueba, emitir muchos tickets concurrentes al endpoint público y verificar:

1. Códigos únicos (sin duplicar A-001)
2. Latencia aceptable
3. TVs actualizan con `hub: redis`
