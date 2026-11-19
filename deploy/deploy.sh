#!/usr/bin/env bash
# Deploy the latest `main` on the VPS: fast-forward the checkout, rebuild and restart the container,
# then wait for its health check.
#
# Run by GitHub Actions through an SSH key that is restricted to this script (forced command, see
# docs/deployment.md), or by hand:  /opt/browser-editor/deploy/deploy.sh
#
# Everything is inside main() so bash parses the whole script before running it. `git merge` below
# may replace this very file.
set -euo pipefail

main() {
  local repo
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$repo"

  # One deploy at a time.
  exec 9>/tmp/viditor-deploy.lock
  if ! flock -n 9; then
    echo "Another deploy is already running." >&2
    exit 1
  fi

  echo "==> Updating $repo"
  git fetch --quiet origin main
  # Fast-forward only: refuses to run if someone edited tracked files on the server.
  git merge --ff-only --quiet origin/main
  echo "    now at $(git log -1 --format='%h %s')"

  echo "==> Building and restarting the container"
  docker compose -p viditor -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --remove-orphans

  echo "==> Waiting for the health check"
  local status=starting
  for _ in $(seq 1 45); do
    status="$(docker inspect -f '{{.State.Health.Status}}' viditor 2>/dev/null || echo missing)"
    [[ "$status" == healthy ]] && break
    sleep 2
  done

  docker image prune -f >/dev/null

  if [[ "$status" != healthy ]]; then
    echo "!! Container is '$status' after 90 s. Recent logs:" >&2
    docker logs --tail 50 viditor >&2 || true
    exit 1
  fi
  echo "==> Deployed $(git rev-parse --short HEAD). Container healthy."
}

main "$@"
