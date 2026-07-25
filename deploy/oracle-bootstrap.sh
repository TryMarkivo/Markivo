#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-time bootstrap for a fresh Oracle Cloud "Always Free" Ubuntu 22.04 VM.
# Installs Docker, opens the OS firewall for HTTP/HTTPS, and prepares the host
# to run the Markivo production stack. Run as the default 'ubuntu' user:
#   bash oracle-bootstrap.sh
#
# NOTE: This handles the *OS* firewall only. You must ALSO open ports 80 and
# 443 in the OCI console: Networking -> your VCN -> Subnet -> Security List ->
# Add Ingress Rules (Source 0.0.0.0/0, TCP, dest ports 80 and 443). That cloud
# firewall cannot be changed over SSH.
# ---------------------------------------------------------------------------
set -euo pipefail

echo "==> Updating packages"
sudo apt-get update -y

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo apt-get install -y docker-compose-plugin iptables-persistent
sudo usermod -aG docker "$USER" || true
sudo systemctl enable --now docker

echo "==> Opening OS firewall for ports 80 and 443"
# Oracle's Ubuntu image ships iptables rules that reject inbound traffic except
# SSH. Insert ACCEPT rules for HTTP/HTTPS ahead of the REJECT, then persist.
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

echo "==> Done. Log out/in (or 'newgrp docker') so group membership applies."
echo "    Then deploy with:"
echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
