#!/bin/sh
# Aplica las migraciones pendientes antes de arrancar la API. Con una sola
# instancia es seguro; Prisma además toma un candado en la base.
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "→ Aplicando migraciones"
  ./node_modules/.bin/prisma migrate deploy
fi
exec "$@"
