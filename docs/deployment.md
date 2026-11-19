# Deployment — viditor.samuelgelacio.io

The production artifact is a static site (`apps/web/dist`) served by a small Caddy container. TLS
and the public hostname are handled by the reverse proxy that already runs on the VPS (Traefik or
Caddy). The container publishes no ports to the internet and stores no user data. Disk use is
about 100 MB for the image plus capped logs (3 × 10 MB).

## 1. DNS

Create an `A` record (and an `AAAA` record if the VPS has IPv6):

```
viditor.samuelgelacio.io  →  <VPS public IP>
```

## 2. First deploy

```bash
ssh <you>@<vps>
git clone https://github.com/GelacioCode/browser-editor.git /opt/browser-editor
cd /opt/browser-editor
cp deploy/.env.example deploy/.env
nano deploy/.env        # see below
docker compose -p viditor -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

### `deploy/.env`

| Variable               | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `PROXY_NETWORK`        | The Docker network your proxy container is on (`docker network ls`)     |
| `VIDITOR_HOST`         | `viditor.samuelgelacio.io`                                              |
| `TRAEFIK_ENTRYPOINT`   | Traefik only: your HTTPS entrypoint name (often `websecure` or `https`) |
| `TRAEFIK_CERTRESOLVER` | Traefik only: your ACME resolver name (often `letsencrypt` or `le`)     |

To find the values on the VPS:

```bash
docker network ls
docker inspect <traefik-container> --format '{{json .Config.Cmd}}'   # look for entrypoints / certresolvers
```

## 3a. Traefik

Nothing else to do. The labels in `deploy/docker-compose.yml` register the router. Traefik requests
the certificate automatically.

## 3b. Caddy

Add the block from `deploy/Caddyfile.proxy-snippet` to your proxy's Caddyfile and reload Caddy:

```
viditor.samuelgelacio.io {
	encode zstd gzip
	reverse_proxy viditor:80
}
```

If Caddy runs on the host instead of in Docker, uncomment the `ports:` loopback mapping in
`docker-compose.yml` and use `reverse_proxy 127.0.0.1:8088`.

## 4. Verify

```bash
docker ps --filter name=viditor            # STATUS shows "healthy"
curl -sI https://viditor.samuelgelacio.io | grep -iE 'HTTP/|content-security-policy'
```

Then open the site in desktop Chrome or Edge. The welcome screen should appear without the
"browser can't run Viditor" diagnostics screen. Gear icon → **Browser diagnostics** shows the
encoder checks.

## Updating

Automatic (after the setup below): every push to `main` that passes all CI checks is deployed.

By hand, at any time:

```bash
/opt/browser-editor/deploy/deploy.sh
```

The script fast-forwards the checkout to `origin/main`, rebuilds and restarts the container, waits
for its health check, and prunes old images. It refuses to run if tracked files were edited on the
server.

## Automatic deploys (GitHub Actions)

The `Deploy to VPS` job in `.github/workflows/ci.yml` runs on pushes to `main` after lint,
typecheck, unit tests, browser tests and the Docker build have **all** passed. It SSHes in with a
dedicated key that the server only allows to run `deploy/deploy.sh` (an SSH forced command): no
shell, no port forwarding. The server's host key is pinned. Until the secrets below exist, the job
skips with a warning.

### One-time setup

**1. On the VPS**, create the deploy key and restrict it to the deploy script:

```bash
chmod +x /opt/browser-editor/deploy/deploy.sh
ssh-keygen -t ed25519 -N "" -C "viditor-github-deploy" -f /root/.ssh/viditor_deploy
echo "restrict,command=\"/opt/browser-editor/deploy/deploy.sh\" $(cat /root/.ssh/viditor_deploy.pub)" >> /root/.ssh/authorized_keys
```

Print the two values GitHub needs:

```bash
cat /root/.ssh/viditor_deploy                                   # → VPS_SSH_KEY (private key)
echo "187.127.114.35 $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"   # → VPS_KNOWN_HOSTS
```

**2. On GitHub** → repository → Settings → Secrets and variables → Actions → New repository
secret:

| Secret            | Value                                                    |
| ----------------- | -------------------------------------------------------- |
| `VPS_HOST`        | `187.127.114.35`                                         |
| `VPS_USER`        | `root`                                                   |
| `VPS_SSH_KEY`     | The whole private key, including the `BEGIN`/`END` lines |
| `VPS_KNOWN_HOSTS` | The `187.127.114.35 ssh-ed25519 AAAA…` line              |
| `VPS_PORT`        | Optional, only if SSH isn't on port 22                   |

Then delete the private key from the server (`rm /root/.ssh/viditor_deploy`). GitHub keeps
the only copy, and the public half stays in `authorized_keys`.

**3. Test it:** GitHub → Actions → the latest CI run → Re-run all jobs (or push any commit). The
`Deploy to VPS` job should end with `Deployed <commit>. Container healthy.`

To revoke: delete the line containing `viditor-github-deploy` from `/root/.ssh/authorized_keys`.

If the repository is private, the VPS checkout needs read access to pull. Use a read-only
[deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
for the clone. Never put a personal token in the remote URL.

## Notes

- **HTTPS is required.** The File System Access API and WebCodecs only work in secure contexts.
- The container runs read-only with all capabilities dropped except binding port 80, a 128 MB
  memory limit and rotated logs.
- There are no media endpoints, by design (guide §13). The VPS never receives footage.
- Rollback: `git revert` the bad commit and push (CI redeploys), or on the server `git checkout <previous-commit>` and re-run the compose command.
