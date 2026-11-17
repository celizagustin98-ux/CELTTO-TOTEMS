# CELTTO-TOTEMS

Sistema de turnos con tótem para pacientes, panel de secretaria, llamador y pantalla de sala.
Todo se configura desde un panel maestro, sin tocar código.

**Stack actual:** aplicación en **Linux (Docker / Proxmox)** + base **PostgreSQL**.  
Más adelante la base puede moverse a **SQL Server en Windows** sin cambiar la app.

## Qué incluye

| Pantalla | Dirección | Quién la usa |
|---|---|---|
| Panel maestro | `/master` | Solo el dueño: secretarías, botones, usuarios, configuración y reportes |
| Panel de secretaria | `/panel` | Cada secretaria con su usuario; ve solo la cola de su secretaría |
| Tótem | `/totem` | Pacientes (una PC táctil por secretaría) |
| Pantalla de sala | `/tv` | TV de la sala de espera (`/tv?sectors=1,2` para filtrar secretarías) |

**Cómo funciona:** el dueño crea secretarías (con color propio). Cada secretaría tiene los botones que quiera
("Turno nuevo", "Continuar atención"…); cada botón genera un ticket con su letra (A-001), prioridad y cola de destino.
Los usuarios de secretaria se vinculan a una secretaría. La secretaria llama, vuelve a llamar, inicia, finaliza,
marca ausente o deriva. La TV muestra el llamado en el color de la secretaría, con sonido y voz configurables.

## Requisitos

- Docker + Docker Compose (servidor Linux / Proxmox)
- O Node.js 20+ si corrés sin Docker

## Instalación rápida con Docker (recomendado)

```bash
# 1. Configuración
cp .env.example .env
# Editá POSTGRES_PASSWORD en .env

# 2. Levantar PostgreSQL + aplicación
docker compose up -d --build

# 3. Crear el usuario dueño (primera vez)
docker compose exec app npx tsx src/server/cli.ts owner:create --user dueno --pass 'TuClaveSegura123'

# 4. (Opcional) datos de prueba
docker compose exec app npx tsx src/server/cli.ts seed:demo
```

Abrí `http://IP-DEL-SERVIDOR:8080/login` con el usuario dueño.

Las migraciones se aplican solas al iniciar (`AUTO_MIGRATE=true`).

### Comandos útiles

```bash
docker compose logs -f app          # logs de la app
docker compose exec app npx tsx src/server/cli.ts db:check
docker compose exec app npx tsx src/server/cli.ts migrate
docker compose restart app
```

## Desarrollo local (sin Docker)

```bash
cp .env.example .env
# Opción A: PostgreSQL local → DB_CLIENT=postgres y datos de conexión
# Opción B: SQLite → DB_CLIENT=sqlite

npm install
npm run migrate && npm run owner:create && npm run seed:demo
npm run dev:server       # API en :8080
npm run dev:web          # interfaz en :5173
npm test
```

## Configurar los equipos clientes

- **Tótem** (Chrome en pantalla completa, impresión de ticket 80 mm):
  ```
  chrome --kiosk --kiosk-printing http://SERVIDOR:8080/totem
  ```
  La primera vez pide elegir la secretaría. Para cambiarla: tocar 5 veces la esquina superior izquierda e ingresar el PIN (fábrica `0000`).

- **TV de la sala:**
  ```
  chrome --kiosk --autoplay-policy=no-user-gesture-required http://SERVIDOR:8080/tv
  ```

## Migrar la base a SQL Server (Windows) más adelante

La aplicación **sigue en Linux**. Solo cambia el destino de la base:

1. En el servidor Windows creá la base y un login SQL.
2. En el `.env` / variables del contenedor `app`:
   ```
   DB_CLIENT=mssql
   MSSQL_SERVER=IP-DEL-WINDOWS
   MSSQL_PORT=1433
   MSSQL_DATABASE=celtto_totems
   MSSQL_USER=...
   MSSQL_PASSWORD=...
   MSSQL_ENCRYPT=false
   MSSQL_TRUST_CERT=true
   ```
3. Reiniciá la app y corré `migrate` contra SQL Server.

## Estructura

- `src/server`: API (Fastify + Kysely), colas, autenticación, WebSocket, migraciones
- `src/web`: interfaz (React + TypeScript + Tailwind)
- `docker-compose.yml`: app + PostgreSQL
- `deploy/linux`: notas de despliegue en Proxmox/Linux
- `tests`: pruebas de permisos, numeración y llamados

## Notas de seguridad

- Contraseñas con hash `scrypt`; sesiones en base con cookie `httpOnly`.
- Una secretaria solo accede a la cola de su secretaría (validado en el servidor).
- El panel maestro solo admite rol dueño (creado por CLI).
- Fuera de la red interna: HTTPS + `COOKIE_SECURE=true`.


## Escalado (10 tótems, TVs, secretarias)

Ver `deploy/linux/SCALE.md`.

```bash
docker compose up -d --build
docker compose up -d --scale app=2
```

Incluye PostgreSQL afinado, Redis (tiempo real entre instancias), proxy Caddy y límites por tótem/IP.
