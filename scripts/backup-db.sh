#!/usr/bin/env bash
# Respaldo lógico de la base de datos (esquema public) en formato custom de pg_dump.
#
# Uso:  DATABASE_URL=postgresql://... ./scripts/backup-db.sh [carpeta_destino]
#
# - Usa la conexión DIRECTA de Supabase (puerto 5432), no el pooler de transacciones.
# - Si BACKUP_PASSPHRASE está definida, el archivo se cifra con GPG (AES256) y
#   se borra la copia sin cifrar.
# - BACKUP_RETENCION_DIAS (por defecto 30) borra respaldos locales más viejos.
set -euo pipefail

: "${DATABASE_URL:?Define DATABASE_URL (conexión directa, puerto 5432)}"
DESTINO="${1:-backups}"
RETENCION_DIAS="${BACKUP_RETENCION_DIAS:-30}"
mkdir -p "$DESTINO"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVO="$DESTINO/procurex-$STAMP.dump"

echo "→ Respaldando esquema public en $ARCHIVO"
pg_dump "$DATABASE_URL" --format=custom --schema=public --no-owner --no-privileges --file="$ARCHIVO"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE" --output "$ARCHIVO.gpg" "$ARCHIVO"
  rm -f "$ARCHIVO"
  ARCHIVO="$ARCHIVO.gpg"
fi

TAMANO="$(du -h "$ARCHIVO" | cut -f1)"
echo "✓ Respaldo listo: $ARCHIVO ($TAMANO)"

find "$DESTINO" -name 'procurex-*.dump*' -type f -mtime "+$RETENCION_DIAS" -print -delete | sed 's/^/  borrado por retención: /' || true
