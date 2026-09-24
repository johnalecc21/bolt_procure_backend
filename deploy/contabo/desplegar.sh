#!/usr/bin/env bash
# Despliega (o actualiza) la API en el servidor. Ejecutar desde deploy/contabo
# como el usuario de despliegue:  ./desplegar.sh [rama]   (por defecto: main)
set -euo pipefail
cd "$(dirname "$0")"

RAMA="${1:-main}"
[ -f .env ] || { echo "Falta .env — copia .env.example a .env y complétalo."; exit 1; }
set -a; . ./.env; set +a
: "${API_DOMAIN:?Define API_DOMAIN en .env}"

echo "→ Trayendo $RAMA"
git -C ../.. fetch --quiet origin "$RAMA"
git -C ../.. checkout --quiet "$RAMA"
git -C ../.. pull --quiet --ff-only origin "$RAMA"
echo "  $(git -C ../.. log -1 --format='%h %s')"

echo "→ Construyendo la imagen"
docker compose build --pull api

echo "→ Arrancando (las migraciones corren al iniciar la API)"
docker compose up -d --remove-orphans

echo "→ Esperando a que la API responda"
for i in $(seq 1 40); do
  estado="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo desconocido)"
  if [ "$estado" = "healthy" ]; then
    echo "✓ API saludable — https://$API_DOMAIN/health"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done

echo "✗ La API no quedó saludable. Últimos logs:"
docker compose logs --tail=80 api
exit 1
