# CELTTO-TOTEMS

Sistema de turnos con tótem para pacientes, panel de secretaria, llamador y pantalla de sala.
Todo se configura desde un panel maestro, sin tocar código.

**Stack actual:** aplicación en **Linux (Docker / Proxmox)** + base **PostgreSQL**.  
Más adelante la base puede moverse a **SQL Server en Windows** sin cambiar la app.

## Qué incluye

| Pantalla | Dirección | Quién la usa |
|---|---|---|
| Panel maestro | `/master` | Dueño, administradores y técnicos (según rol): secretarías, botones, usuarios, configuración y reportes |
| Panel de secretaria | `/panel` | Cada secretaria con su usuario; ve solo la cola de su secretaría |
| Seguimiento del turno | `/t/CODIGO` | El paciente escanea el QR del ticket y sigue su turno desde el celular |
| Tótem | `/totem` | Pacientes (una PC táctil por secretaría) |
| Pantalla de sala | `/tv` | TV de la sala de espera (`/tv?sectors=1,2` para filtrar secretarías) |

**Cómo funciona:** el dueño crea secretarías (con color propio). Cada secretaría tiene los botones que quiera
("Turno nuevo", "Continuar atención"…); cada botón genera un ticket con su letra (A-001), prioridad y cola de destino.
Los usuarios de secretaria se vinculan a una secretaría. La secretaria llama, vuelve a llamar, inicia, finaliza,
marca ausente o deriva. La TV muestra el llamado en el color de la secretaría, con sonido y voz configurables.

## Requisitos

- Docker + Docker Compose (servidor Linux / Proxmox)
- O Node.js 22+ si corrés sin Docker

## Instalación rápida con Docker (recomendado)

```bash
# 1. Configuración
cp .env.example .env
# Completá POSTGRES_PASSWORD, SESSION_SECRET y DATA_KEY (32+ caracteres cada una) en .env

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

## Desarrollo local (sin Docker ni PostgreSQL instalado)

```bash
npm install
npm run dev
```

`npm run dev` levanta todo con un solo comando:

- Un **PostgreSQL embebido** (PGlite) en `127.0.0.1:5433`, con los datos en `data/pglite/` (ignorado por git).
- Migraciones, usuario dueño y datos de demostración (solo la primera vez).
- La API en `:8080` y la interfaz en `http://127.0.0.1:5173`.

El usuario dueño y su contraseña de prueba quedan en `.env.development.local` (ignorado por git).
Las secretarias de demostración son `secretaria.a` y `secretaria.b`, con contraseña `demo12345`.

```bash
npm test           # tests de la API contra PostgreSQL embebido
npm run typecheck  # tipos del servidor y de la web
npm run build      # compilación de producción
```

## Pacientes

- Al entrar al tótem, el paciente ingresa su **documento** con el teclado en pantalla.
- Si ya está registrado, lo saluda ("¡Hola, María G.!") y pasa a los botones.
- Si no existe, completa **nombre y apellido** (teclado alfabético en pantalla) y queda registrado.
- La secretaria ve nombre, documento, visitas y observaciones, y puede completar teléfono y obra social.
- El ticket impreso trae un **QR privado**: abre en el celular cuántos turnos faltan, el tiempo estimado y el box al que ir.
- La TV **nunca** muestra nombres, solo el código del turno.
- En Configuración → Identificación del paciente: obligatoria, opcional o desactivada.

## Roles y permisos

| Rol | Puede |
|---|---|
| **Control maestro** | Control total. Es el único que administra a los administradores y puede transferir el control. Se crea por consola (`owner:create`), que también sirve de acceso de emergencia (reinicia la contraseña y el doble factor). |
| **Administrador** | Área de sistemas: secretarías, tótems, TVs, publicidad, usuarios (salvo administradores), configuración, sedes, monitoreo y auditoría. |
| **Supervisor de área** | Ve las colas, reportes y productividad **solo de sus secretarías**; puede cancelar turnos de su área. |
| **Técnico** | Tótems, TVs y monitoreo. No cambia configuración ni usuarios. |
| **Auditor** | Solo lectura: reportes, productividad y auditoría. |
| **Secretaria** | Atiende la cola de su secretaría desde `/panel`. |

El servidor valida cada permiso; el panel solo oculta lo que no corresponde. En **Usuarios → Ver permisos por rol** está la matriz completa.

**Doble factor:** cualquier usuario puede activarlo en *Mi cuenta*. En *Configuración → Seguridad y datos* se puede exigir por rol
(recomendado: control maestro y administradores).

## Datos y respaldos

- Los DNI se guardan **cifrados** (AES-256-GCM) y se buscan por un hash; nunca quedan en texto plano. La clave es `DATA_KEY`.
- Los pacientes sin visitas durante N meses se anonimizan automáticamente (configurable).
- Los turnos viejos pasan a un **archivo histórico**; las estadísticas se conservan en resúmenes diarios.
- Respaldos automáticos diarios + recuperación a un momento puntual: ver `deploy/linux/BACKUPS.md`.
- Monitoreo en *Panel → Monitoreo* y métricas Prometheus en `/api/metrics` (con `METRICS_TOKEN`).

## Tótem sin conexión

Si se corta la red, el tótem sigue emitiendo e imprimiendo turnos con numeración propia (por ejemplo `A-T3-001`),
y los sincroniza solo cuando vuelve la conexión, respetando la hora original para que entren a la cola en su orden.

## Configurar los equipos clientes

- **Tótem** (Chrome en pantalla completa, impresión de ticket 80 mm):
  ```
  chrome --kiosk --kiosk-printing http://SERVIDOR:8080/totem
  ```
  Lo recomendado es crear cada equipo en **Panel maestro → Tótems y TVs** y abrir su dirección fija (`/totem/st_…`):
  queda con su secretaría e idioma. Sin dirección fija, la primera vez pide elegir la secretaría; para cambiarla,
  tocar 5 veces la esquina superior izquierda e ingresar el PIN (fábrica `0000`: cambialo en Configuración).

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

- Contraseñas con hash `scrypt`; sesiones en base con cookie `httpOnly` + `SameSite=Strict`.
- Límite de intentos en login, PIN del tótem y emisión de turnos (compartido entre instancias con Redis).
- Cerrar sesión o cambiar la contraseña invalida la sesión en el servidor.
- Cabeceras de seguridad (CSP, HSTS con HTTPS, X-Frame-Options) y WebSocket solo desde el mismo origen.
- Auditoría de accesos y cambios en el panel maestro.
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

## Seguridad y despliegue sin código en el servidor

Ver `deploy/linux/DEPLOY-SECURE.md`.

- Imagen Docker multi-stage **sin** carpeta `src/`
- Secretos solo por `.env` (no en git)
- En producción: `SESSION_SECRET` + `POSTGRES_PASSWORD` fuertes obligatorios
- Preferí `docker-compose.prod.yml` + imagen de registry (no `git clone` en Proxmox)

## Paquete para instalar en el servidor del cliente

Ver `deploy/package/README.md`.

```bash
bash deploy/linux/pack-ops.sh
# → dist-ops/celtto-ops-package.zip  (sin código fuente)
# En el cliente: /opt/celtto + sudo bash scripts/instalar.sh
```

