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

Offline AI Chat is intended for **single-user local use by default** and **controlled LAN deployments when explicitly hardened**.

Native Node binds to `127.0.0.1` by default. When the server is bound to a LAN address (`HOST=0.0.0.0`, `::`, or a non-loopback IP), the server automatically tightens two risky surfaces:

1. `/api/fs/*` requires `WORKSPACE_ROOTS`; unrestricted filesystem roots are blocked unless `ALLOW_UNRESTRICTED_WORKSPACE=true` is explicitly set.
2. The LM Studio proxy allows loopback only unless `ALLOWED_LM_HOSTS` is configured.

For a company or LAN-shared deployment:

1. Prefer the assisted flow: `npm run lan:setup` then `npm run lan:up`.
2. Set `APP_AUTH_PASSWORD` or `APP_AUTH_TOKEN` to enable built-in Basic Auth.
3. Set `WORKSPACE_ROOTS` to a tight whitelist and mount those folders read-only.
4. Set `ALLOWED_LM_HOSTS` to the exact LM Studio hosts/ports the proxy may reach.
5. Put the app behind your normal reverse proxy/VPN/SSO layer when possible.
6. Avoid mounting a full workstation drive in shared deployments.

Do not expose an unauthenticated instance to a hostile network.
