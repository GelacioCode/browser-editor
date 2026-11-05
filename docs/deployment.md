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
git clone https://github.com/GelacioCode/browser-editor.git ~/apps/viditor
cd ~/apps/viditor
cp deploy/.env.example deploy/.env
nano deploy/.env        # see below
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
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

```bash
cd ~/apps/viditor
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker image prune -f      # remove old image layers
```

## Notes

- **HTTPS is required.** The File System Access API and WebCodecs only work in secure contexts.
- The container runs read-only with all capabilities dropped except binding port 80, a 128 MB
  memory limit and rotated logs.
- There are no media endpoints, by design (guide §13). The VPS never receives footage.
- Rollback: `git checkout <previous-commit>` and re-run the compose command.
