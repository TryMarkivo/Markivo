#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-time bootstrap for a fresh GCP Compute Engine Ubuntu 22.04 VM.
# Installs Docker + Compose plugin and prepares the host to run the Markivo
# production stack (backend + frontend + Caddy). Run as the default user:
#   bash gcp-bootstrap.sh
#
# NOTE: this handles the OS only. You must ALSO open ports 80 and 443 in GCP's
# VPC firewall (that cannot be done from inside the VM) — see the
# `gcloud compute firewall-rules create` command in DEPLOY.md.
# ---------------------------------------------------------------------------
set -euo pipefail

echo "==> Updating packages"
sudo apt-get update -y

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo apt-get install -y docker-compose-plugin
sudo usermod -aG docker "$USER" || true
sudo systemctl enable --now docker

echo "==> Done. Log out/in (or 'newgrp docker') so group membership applies."
echo "    Then clone the repo, set backend/.env, and deploy with:"
echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
