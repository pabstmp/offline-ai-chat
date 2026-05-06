# Contributing

Thanks for considering a contribution. This is a small project — keep PRs focused and the project happy.

## Development setup

```bash
git clone https://github.com/pabstmp/offline-ai-chat.git
cd offline-ai-chat
npm install
node server.js
# open http://localhost:8080
```

You'll need an LM Studio instance running somewhere reachable (default: `http://localhost:1234/v1`). The first time you boot the app, point Settings → Servidor at it.

For OCR work specifically, the first run downloads ~17 MB of language packs from the tesseract.js CDN and caches them under `/tmp/tesseract-cache` (host) or `/app/.cache/tesseract` (Docker).

## Validate before submitting

```bash
npm run check     # syntax check on server + browser modules (Windows/Linux)
npm test          # unit/PBT + server hardening tests
```

Visual smoke tests still live as ad-hoc scripts in `/tmp/` using Playwright when needed (see [`CLAUDE.md`](./CLAUDE.md) → Testes).

## Style

- **No client-side dependencies.** The frontend is vanilla ES modules. New deps need a strong justification.
- **No build step.** If you can't ship it as `<script type="module">` directly, rethink it.
- **Two-space indent, semicolons, double quotes** — matches existing code.
- **Defaults to no comments.** Only comment the *why*, not the *what*.
- **PT-BR is fine** for user-facing strings and the `GUIDE.md`. The `README.md` is in English.

## Areas where contributions are welcome

- Additional language coverage for the RAG query intent classifier
- Better UI for the workspace file tree (especially nested folder browsing)
- Support for more local LLM backends beyond LM Studio (Ollama, llama.cpp, vLLM)
- Reranking layer (cross-encoder or BM25 hybrid) on top of the current embedding-only retrieval
- Better PDF table extraction (the current pdfjs layout-aware approach struggles with complex tables)
- Multimodal support (vision/audio) for VLM models loaded in LM Studio

## Pull request workflow

1. Open an issue first for non-trivial changes — saves time aligning on scope.
2. Branch from `main`, keep one logical change per PR.
3. Update `CHANGELOG.md` under `## [Unreleased]`.
4. Update `GUIDE.md` if user-facing behavior changes.
5. Update `CLAUDE.md` if internals change in a way maintainers should know.

## Code of conduct

Be kind. Disagree about the code, not about the people. The maintainer reserves the right to close discussions that turn unproductive.
