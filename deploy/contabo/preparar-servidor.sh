#!/usr/bin/env bash
# Prepara un VPS nuevo de Contabo (Ubuntu 22.04/24.04) para correr la API.
# Ejecutar UNA vez como root:
#   curl -fsSL https://raw.githubusercontent.com/<usuario>/bolt_procure_backend/main/deploy/contabo/preparar-servidor.sh | bash -s -- <url-del-repo>
#   (o copiarlo al servidor y correr: bash preparar-servidor.sh <url-del-repo>)
set -euo pipefail

REPO_URL="${1:?Uso: preparar-servidor.sh <url-git-del-backend>}"
USUARIO="${USUARIO:-procurex}"
DESTINO="${DESTINO:-/opt/procurex}"

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root"; exit 1; }

echo "→ Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades

echo "→ Actualizaciones de seguridad automáticas"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "→ Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "→ Usuario de despliegue: $USUARIO"
if ! id "$USUARIO" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$USUARIO"
fi
usermod -aG docker "$USUARIO"
# Reutiliza las llaves SSH de root para entrar como el usuario de despliegue.
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o "$USUARIO" -g "$USUARIO" "/home/$USUARIO/.ssh"
  install -m 600 -o "$USUARIO" -g "$USUARIO" /root/.ssh/authorized_keys "/home/$USUARIO/.ssh/authorized_keys"
fi

echo "→ Firewall: solo SSH, HTTP y HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
# Docker publica puertos por fuera de ufw; en el compose solo Caddy publica 80/443.

echo "→ fail2ban para SSH"
systemctl enable --now fail2ban

echo "→ Swap de 2 GB (la compilación de la imagen la agradece)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "→ Código en $DESTINO"
if [ ! -d "$DESTINO/.git" ]; then
  git clone "$REPO_URL" "$DESTINO"
fi
chown -R "$USUARIO:$USUARIO" "$DESTINO"

cat <<MSG

✓ Servidor listo.
Siguientes pasos (como $USUARIO):
  ssh $USUARIO@<ip-del-servidor>
  cd $DESTINO/deploy/contabo
  cp .env.example .env && nano .env
  ./desplegar.sh
MSG
