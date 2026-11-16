# Despliegue en Linux / Proxmox (Docker)

1. Copiá el proyecto al servidor (o cloná el repo).
2. Creá el archivo `.env` a partir de `.env.example` y cambiá `POSTGRES_PASSWORD`.
3. Levantá los servicios:

```bash
docker compose up -d --build
```

4. Creá el usuario dueño (la primera vez):

```bash
docker compose exec app node -e "
process.env.DB_CLIENT='postgres';
" 2>/dev/null || true
docker compose exec app npx tsx src/server/cli.ts owner:create --user dueno --pass 'TuClaveSegura123'
```

Si la imagen de producción no incluye `tsx`, usá el contenedor de desarrollo o ejecutá migraciones con AUTO_MIGRATE=true (ya viene en true).

5. Abrí `http://IP-DEL-SERVIDOR:8080/login`

## Migrar más adelante a SQL Server (Windows)

1. En el `.env` del contenedor `app` cambiá:
   - `DB_CLIENT=mssql`
   - completá `MSSQL_SERVER`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD`
2. Reiniciá solo la app: `docker compose up -d app`
3. Corré migraciones contra SQL Server.

La aplicación sigue en Linux; solo cambia el destino de la base.
