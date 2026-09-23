#!/usr/bin/env bash
# Simulacro de restauración: restaura un respaldo en una base de datos VACÍA de
# prueba y verifica que quedó utilizable. Hazlo al menos una vez al mes — un
# respaldo que nunca se ha restaurado no es un respaldo.
#
# Uso:  RESTORE_DATABASE_URL=postgresql://.../procurex_drill ./scripts/restore-drill.sh backups/procurex-XXXX.dump[.gpg]
#
# Opcional: SOURCE_DATABASE_URL para comparar el conteo de filas con la base original.
# NUNCA apuntes RESTORE_DATABASE_URL a producción: el script limpia el esquema public.
set -euo pipefail

ARCHIVO="${1:?Indica el archivo de respaldo}"
: "${RESTORE_DATABASE_URL:?Define RESTORE_DATABASE_URL (una base de prueba vacía)}"

if [[ "$RESTORE_DATABASE_URL" == *"supabase.co"* && "${PERMITIR_SUPABASE:-}" != "1" ]]; then
  echo "✗ RESTORE_DATABASE_URL apunta a Supabase. Usa un proyecto de prueba y exporta PERMITIR_SUPABASE=1 si es intencional." >&2
  exit 1
fi

INICIO=$(date +%s)
TMP=""
if [[ "$ARCHIVO" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?El respaldo está cifrado: define BACKUP_PASSPHRASE}"
  TMP="$(mktemp)"
  gpg --batch --yes --quiet --decrypt --passphrase "$BACKUP_PASSPHRASE" --output "$TMP" "$ARCHIVO"
  ARCHIVO="$TMP"
fi
trap '[ -n "$TMP" ] && rm -f "$TMP"' EXIT

echo "→ Restaurando en la base de prueba"
# The dump recreates the public schema itself.
psql "$RESTORE_DATABASE_URL" -q -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE;'
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-privileges --exit-on-error "$ARCHIVO"

TABLAS=(companies users requerimientos contratos proveedor_profiles homologaciones audit_log)
echo "→ Verificando tablas clave"
for t in "${TABLAS[@]}"; do
  n=$(psql "$RESTORE_DATABASE_URL" -tA -c "SELECT count(*) FROM \"$t\"")
  if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
    o=$(psql "$SOURCE_DATABASE_URL" -tA -c "SELECT count(*) FROM \"$t\"")
    estado=$([ "$n" -le "$o" ] && echo "ok" || echo "REVISAR")
    printf '  %-20s %8s filas (origen %s) %s\n' "$t" "$n" "$o" "$estado"
  else
    printf '  %-20s %8s filas\n' "$t" "$n"
  fi
done

ULTIMA=$(psql "$RESTORE_DATABASE_URL" -tA -c 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1')
echo "  última migración: $ULTIMA"
echo "✓ Restauración verificada en $(( $(date +%s) - INICIO ))s (tu RTO de base de datos para este tamaño)"
