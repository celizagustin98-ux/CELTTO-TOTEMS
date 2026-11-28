#!/bin/sh
# Solo corre al crear la base por primera vez: habilita la conexión de replicación que usa
# pg_basebackup (copia base semanal) desde la red interna de docker.
echo "host replication ${POSTGRES_USER} samenet scram-sha-256" >> "$PGDATA/pg_hba.conf"
