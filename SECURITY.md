# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Offline AI Chat, **please do not open a public issue**.

Instead, report it privately by opening a [GitHub Security Advisory](https://github.com/pabstmp/offline-ai-chat/security/advisories/new), or by emailing the maintainer directly via the address listed on the GitHub profile [@pabstmp](https://github.com/pabstmp).

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof-of-concept
- Affected version(s) / commit(s)
- Suggested mitigation if you have one

You should expect an initial response within **7 days**. Confirmed vulnerabilities will be fixed in a timely manner and disclosed publicly after a fix is released.

## Scope

In-scope:

- The Node proxy (`server.js`) — particularly its filesystem endpoints (`/api/fs/*`), path-traversal protection, and rate-limiting
- The frontend modules under `modules/` — particularly anything handling untrusted text or rendering Markdown
- The Docker build and `docker-compose.yml` (default permissions, exposed surface)

Out-of-scope:

- Vulnerabilities in upstream dependencies — please report those to the respective project (`pdfjs-dist`, `tesseract.js`, `@napi-rs/canvas`).
- Issues that require a malicious LM Studio server or local privilege escalation already in place — the threat model assumes the user controls the LM Studio they're proxying to.
- Issues that depend on the user disabling browser security (e.g., loading `index.html` via `file://` instead of through the server).

## Threat model (short)

Offline AI Chat is intended for **single-user, local-network deployments**. It does **not** authenticate requests to its own HTTP server — it assumes that anyone who can reach the bound port (`0.0.0.0:8080` by default) is trusted. If you expose this app to a hostile network, **do not** rely on its current defenses.

If you need a multi-user or LAN-shared deployment:

1. Set `WORKSPACE_ROOTS` to a tight whitelist (read-only mounts).
2. Put the app behind a reverse proxy with authentication (Caddy, Cloudflare Tunnel, Tailscale, etc.).
3. Bind to `127.0.0.1` and tunnel through the auth layer instead of exposing `0.0.0.0`.
