# Offline AI Chat

Self-hosted web client for [LM Studio](https://lmstudio.ai/) with **offline RAG**, **OCR for scanned PDFs**, and **multilingual embeddings** — all running on your own hardware.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/Node-18%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-compose-2496ED.svg?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Vanilla JS](https://img.shields.io/badge/Stack-Vanilla%20JS-F7DF1E.svg?logo=javascript&logoColor=black)](#stack)

> **Why?** Because you have an LLM running locally (gpt-oss, Qwen, DeepSeek, Gemma, Llama…) and the official LM Studio chat UI doesn't have RAG, OCR, custom profiles, multi-server switching, or the keyboard shortcuts you actually use. This is a tab in your browser that does.

📖 **Full user guide (PT-BR):** [`GUIDE.md`](./GUIDE.md) · **Dev notes:** [`CLAUDE.md`](./CLAUDE.md)

---

## Features

- **RAG over local files** — index folders of PDFs / code / docs, ask questions, get answers grounded in *your* content. Auto-detects whether your query needs comparative coverage (lists, totals, ranking) or a pointed lookup, and adjusts retrieval accordingly.
- **OCR for scanned PDFs** — `tesseract.js` + `@napi-rs/canvas` fallback when a PDF has no text layer. Pages are rendered to PNG and OCR'd transparently. Multilingual (`por+eng` by default, configurable).
- **State-of-the-art embeddings** — defaults to `Qwen3-Embedding-4B` (top MTEB multilingual). Easy to switch from the UI.
- **Profiles, servers, sampling** — multiple LM Studio endpoints, per-profile system prompt + sampling parameters (`temperature`, `top_p`, `top_k`, `min_p`, `max_tokens`, etc.).
- **Reasoning model support** — surfaces chain-of-thought in a collapsible block, auto-bumps `max_tokens` if a thinking model exhausts the budget.
- **LM Studio extended API** — load/unload models with custom context length straight from the Settings drawer.
- **Zero client-side dependencies** — vanilla JS modules, no build step. The server is one ~700-line `node server.js` proxy.
- **PWA** — installable, offline shell, service worker with network-first for JS modules.
- **Privacy by design** — nothing leaves your network. Conversations live in `localStorage` + `IndexedDB`. The server proxy only talks to your LM Studio.

---

## Quickstart

You need **Docker** (or Node 18+) and **LM Studio** with a model loaded and its OpenAI-compatible server running.

```bash
git clone https://github.com/pabstmp/offline-ai-chat.git
cd offline-ai-chat
docker compose up -d --build
```

Open <http://localhost:8080>.

### First-run setup

1. **Settings → Servidor**: point to your LM Studio.
   - Same machine: `http://localhost:1234/v1` (default).
   - LAN: `http://192.168.1.x:1234/v1` (replace `x`).
   - Ensure LM Studio is allowing connections from the network and the port is open in your firewall.
2. **Settings → Perfis & Inferência**: pick a chat model from the dropdown.
3. **(Optional) Settings → Workspace**: connect a folder, click **Indexar com RAG**, ask grounded questions.

### Without Docker

```bash
node server.js
# Open http://localhost:8080
```

> Don't open `index.html` directly via `file://` — the proxy at `/api/*` won't be there.

---

## Configuration

All settings persist in `localStorage` (schema versioned). Soft migrations run on app boot — old configs are automatically upgraded when defaults improve (e.g. `max_tokens 4096 → 12000` for thinking models).

### Environment variables

See [`.env.example`](./.env.example). The most useful:

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8080` | HTTP port |
| `WORKSPACE_ROOTS` | _(empty)_ | CSV of allowed absolute paths. Empty = single-user mode |
| `OCR_LANGS` | `por+eng` | Tesseract languages (e.g. `eng`, `por+eng+spa`) |
| `OCR_CACHE_DIR` | `/app/.cache/tesseract` | Where trained data files are cached |

### Workspace whitelist (multi-user / LAN deploy)

By default, single-user mode lets you connect any folder via the UI. To restrict access in shared deployments:

```yaml
# docker-compose.yml
environment:
  WORKSPACE_ROOTS: /workspace,/another-repo
volumes:
  - /path/to/your/project:/workspace:ro
```

Path traversal protection is always on regardless of this setting.

---

## Stack

- **Frontend:** Vanilla JS (ES modules), CSS tokens, zero dependencies
- **Backend:** Node 18+ (`http`, `fs`, `crypto`) + `pdfjs-dist` + `tesseract.js` + `@napi-rs/canvas`
- **Storage:** `localStorage` + `IndexedDB` (vector store for RAG embeddings)
- **Deploy:** Docker Compose or native Node

The server is a thin proxy: it forwards `/api/chat/completions`, `/api/embeddings`, `/api/models` to your LM Studio (handling SSE streaming), and exposes `/api/fs/*` for the filesystem-based RAG. It does PDF text extraction (layout-aware) and falls back to OCR when no text layer is present.

---

## Keyboard shortcuts (defaults)

| Action | Shortcut |
|---|---|
| Send | Enter |
| New line | Shift+Enter |
| New chat | Ctrl+N |
| Toggle history | Ctrl+B |
| Settings | Ctrl+, |
| Command palette | Ctrl+K |
| Focus composer | Ctrl+L |
| Stop generation | Esc |
| Next profile | Ctrl+Shift+P |
| Zen mode | Ctrl+\\ |
| Quick-open file | Ctrl+P |
| Toggle workspace | Ctrl+Shift+E |

All remappable in **Settings → Atalhos**.

---

## Privacy

- Nothing is sent to the cloud. The proxy only talks to your LM Studio.
- Conversations and settings live in your browser's `localStorage` / `IndexedDB`.
- The OCR language packs (~17 MB) are downloaded from the tesseract.js CDN on first use, then cached locally. After that, fully offline.
- Filesystem read endpoints (`/api/fs/*`) honor your OS permissions and are sandboxed against path traversal.

---

## Troubleshooting

**App loads but won't connect to LM Studio.**

```bash
curl http://localhost:1234/v1/models
```

If that fails: LM Studio's server isn't running, model isn't loaded, or you're hitting the wrong host/port. Replace `localhost` with the IP of the machine running LM Studio if it's on another box.

**Reasoning model returns empty content.** It exhausted `max_tokens` in its `<think>` block. The app auto-fixes this on the first occurrence — just resubmit the question. If it keeps happening, the bottleneck is **LM Studio's `n_ctx`** (loaded context length), not `max_tokens`. Use **Settings → Servidor** to load the model with a larger context.

**RAG drops files.** Comparative queries should cover all indexed files automatically. If your debug log (`Settings → Avançado → Modo debug`) shows `covering 5/7 files`, your charBudget can't fit the whole corpus and similarity-based fallback kicks in. Either re-index with smaller chunks (`Settings → Workspace → RAG → Avançado`) or load LM Studio with a larger `n_ctx`.

For deeper troubleshooting and the full feature reference, see [`GUIDE.md`](./GUIDE.md).

---

## Contributing

PRs welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md). For security issues, see [`SECURITY.md`](./SECURITY.md).

---

## License

MIT — see [`LICENSE`](./LICENSE).

Builds on [`pdfjs-dist`](https://mozilla.github.io/pdf.js/) (Apache 2.0), [`tesseract.js`](https://tesseract.projectnaptha.com/) (Apache 2.0), and [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) (MIT).
