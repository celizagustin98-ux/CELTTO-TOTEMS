# Respaldos y recuperación

El `docker compose` incluye un servicio **`backup`** que funciona solo, sin intervención:

| Qué | Cuándo | Dónde |
|---|---|---|
| Copia completa (`pg_dump`) + verificación de que se puede leer | Todos los días a las `BACKUP_HOUR` (02 h por defecto) | volumen `celtto_backups` → `daily/` |
| Copia base (`pg_basebackup`) | Domingos | `base/` (se conservan 4) |
| Archivo continuo de cambios (WAL) | Permanente | `wal/` |
| Prueba de restauración real en una base temporal | El día 1 de cada mes | resultado en `status.json` |

- Las copias diarias se conservan `BACKUP_KEEP_DAYS` días (14 por defecto).
- El estado del último respaldo y de la última prueba de restauración se ve en **Panel → Monitoreo**.

## La clave de datos (`DATA_KEY`)

Los DNI y los secretos de doble factor se guardan **cifrados**. La clave está en la variable `DATA_KEY` del `.env`.
**Guardala en un lugar seguro, separado del servidor** (por ejemplo, un gestor de contraseñas de la institución).
Sin esa clave, una copia restaurada funciona, pero los DNI no se pueden leer ni buscar.

## Restaurar una copia diaria

```bash
docker compose stop app
docker compose exec backup sh /scripts/restore.sh                       # lista las copias
docker compose exec backup sh /scripts/restore.sh celtto-AAAAMMDD-HHMM.dump
docker compose start app
```

## Recuperar a un momento puntual (PITR)

Para volver la base a, por ejemplo, las 10:42 de hoy (antes de un borrado accidental):

1. Detené todo: `docker compose stop app db`.
2. Copiá la copia base más reciente anterior a ese momento (`base/AAAAMMDD/base.tar.gz`) a un volumen nuevo de datos y descomprimila.
3. Creá `recovery.signal` en la carpeta de datos y agregá a `postgresql.auto.conf`:
   ```
   restore_command = 'cp /backups/wal/%f %p'
   recovery_target_time = 'AAAA-MM-DD 10:42:00-03'
   ```
4. Iniciá `db` apuntando a ese volumen; al terminar la recuperación, iniciá `app`.

> En instalaciones creadas **antes** de esta versión, la copia base semanal necesita una regla de replicación.
> Agregala una vez: `docker compose exec db sh -c 'echo "host replication $POSTGRES_USER samenet scram-sha-256" >> $PGDATA/pg_hba.conf'`
> y reiniciá `db`. Las instalaciones nuevas la traen configurada (`pg-init/01-replication.sh`).

## Copia fuera del servidor

Los respaldos quedan en el mismo servidor. Para protegerte de una falla de disco o un ataque, copiá periódicamente
el volumen `celtto_backups` a otro equipo o a un almacenamiento externo (por ejemplo con `rclone` o `rsync` programado).
