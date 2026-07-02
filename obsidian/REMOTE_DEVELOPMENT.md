# Remote Development

Chatsundere supports local development and remote cross-device development as
separate profiles. The primary cross-device workflow is HTTPS over a Tailnet
hostname or a development domain. Localhost and ADB reverse remain useful
fallbacks, but they are not the ordinary phone workflow.

## Profiles

### Local Desktop

Use this when everything runs on the developer machine:

```bash
./scripts/setup-dev.sh
./scripts/configure-dev-access.sh local
docker compose -f infra/compose.dev.yml up -d
pnpm dev
```

Open:

- `http://localhost:3000` - user-client
- `http://localhost:3000/admin` - admin-client through the user-client dev proxy
- `http://localhost:5174` - admin-client directly
- `http://localhost:3100` - auth-service
- `http://localhost:3200` - sync-service
- `http://localhost:3300` - proxy-service

The local profile binds app servers to `127.0.0.1`. It also keeps
`DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL`, and `AUTH_JWKS_URL` on
localhost because those are internal service-to-service connections.

### Tailnet HTTPS

Use this for normal PC and phone testing against a remote development machine:

```bash
./scripts/setup-dev.sh
./scripts/configure-dev-access.sh tailnet --host <tailscale-magicdns-or-dev-domain>
pnpm dev:tailnet
```

Then open the same HTTPS host on both devices:

- PC: `https://<tailscale-magicdns-or-dev-domain>/`
- Phone: `https://<tailscale-magicdns-or-dev-domain>/`

The helper defaults Tailnet bind addresses to `0.0.0.0` because remote access is
explicitly opt-in. Prefer a Tailscale interface address or a local reverse proxy
bind when practical:

```bash
./scripts/configure-dev-access.sh tailnet \
  --host <tailscale-magicdns-or-dev-domain> \
  --bind-host <tailscale-interface-ip>
```

If your reverse proxy exposes the services on distinct origins, pass the exact
public URLs:

```bash
./scripts/configure-dev-access.sh tailnet \
  --host <tailscale-magicdns-or-dev-domain> \
  --user-origin https://<app-host> \
  --admin-origin https://<app-host> \
  --auth-url https://<auth-host> \
  --sync-url https://<sync-host> \
  --proxy-url https://<proxy-host>
```

`CORS_ALLOWED_ORIGINS` is written as exact origins only. It never uses `*`.
Add `--include-localhost` only when you deliberately want to keep the local/ADB
browser route enabled while testing the Tailnet profile.

### HTTPS Termination

Chatsundere requires Web Crypto and IndexedDB. Localhost is a secure browser
context, but plain HTTP on a Tailnet IP or hostname is not a normal secure
context. A URL like `http://100.x.x.x:3000` is useful only to prove routing and
firewall reachability; full functionality requires localhost or HTTPS.

Supported Tailnet HTTPS options:

- Tailscale Serve with the server's MagicDNS HTTPS hostname.
- An existing HTTPS reverse proxy, such as Traefik, Caddy, or nginx.

Do not bypass the runtime crypto checks. If `crypto.subtle` is unavailable, the
client should show the missing API rather than `UNKNOWN`.

## Canonical Auth URL

`apps/auth-service/.env` contains:

```text
API_BASE_URL=<public-auth-url>/auth
```

This value is security-sensitive. It is used as the JWT audience binding and
the OPAQUE server identity. It must match the canonical public HTTPS auth URL
clients use. One running auth-service cannot safely pretend to have two
different canonical identities. After changing `API_BASE_URL`, restart the
auth-service before testing login, join, recovery, or pairing flows.

Do not change these local internal URLs for a single-machine VPS deployment:

- `DATABASE_URL`
- `TEST_DATABASE_URL`
- `REDIS_URL`
- `AUTH_JWKS_URL`

## Android Fallbacks

ADB reverse is a debugging workaround, not the normal workflow. Use it only for
quick local development, Android-specific debugging, or when Tailnet HTTPS is
temporarily broken.

### ADB With Everything On The PC

Run the local profile, then:

```bash
adb reverse tcp:3000 tcp:3000
adb reverse tcp:3100 tcp:3100
adb reverse tcp:3200 tcp:3200
adb reverse tcp:3300 tcp:3300
```

Open on the phone:

```text
http://localhost:3000
```

### ADB With Chatsundere On A Remote VPS

`adb reverse` forwards to the machine running `adb`, not directly to the VPS.
Create SSH local forwards from the PC to the VPS first:

```bash
ssh -N \
  -p <SSH_PORT> \
  -L 3000:127.0.0.1:3000 \
  -L 3100:127.0.0.1:3100 \
  -L 3200:127.0.0.1:3200 \
  -L 3300:127.0.0.1:3300 \
  <user>@<tailscale-host>
```

Then run the same `adb reverse` commands on the PC and open
`http://localhost:3000` on the phone. This mode uses the local profile because
the browser reaches every service through localhost.

PuTTY equivalent:

- Open Connection -> SSH -> Tunnels.
- Add local source ports `3000`, `3100`, `3200`, and `3300`.
- Use destinations `127.0.0.1:3000`, `127.0.0.1:3100`,
  `127.0.0.1:3200`, and `127.0.0.1:3300`.

## Firewall Principle

Allow development app ports only on the Tailnet interface when you are using
Tailnet development. Do not open development ports to Anywhere. Keep PostgreSQL
and Redis inaccessible externally.

The repository scripts do not alter UFW or firewall state.

## Troubleshooting

Blank page:
Check the browser console for missing workspace `dist` exports. Run
`pnpm build:packages`, then restart `pnpm dev`.

Runtime failure lists `crypto.subtle`:
You are probably on a non-local HTTP origin. Use localhost or HTTPS.

Connection refused:
Confirm the service is running, the profile bind host is correct, and the
firewall allows the port on the intended interface.

CORS rejection:
Check `apps/auth-service/.env`. `CORS_ALLOWED_ORIGINS` must contain the exact
browser origin, including scheme and port. Do not use `*`.

Wrong auth canonical URL:
Check `API_BASE_URL`. It must match the public auth URL plus `/auth`. Restart
auth-service after changing it.

Direct Tailnet HTTP:
Use it only as a routing diagnostic. It can show that the server is reachable,
but it may fail Web Crypto and cannot be the normal phone workflow.
