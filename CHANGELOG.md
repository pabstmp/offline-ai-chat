# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] — 2026-05-03

First public release.

### Added

- **OCR for scanned PDFs** via `tesseract.js` + `@napi-rs/canvas`. Pages with no text layer are rendered to PNG and recognized transparently. Multilingual (`por+eng` default).
- **Multilingual embeddings** — default model is now `Qwen3-Embedding-4B` (top MTEB multilingual). Soft migration from the previous `nomic-embed-text-v1.5` default.
- **LLM-based query intent classifier** — replaces hand-crafted regex. The chat model classifies each query as `comparative` / `summary` / `point` and the retriever adapts strategy automatically.
- **Exhaustive RAG mode** — when the full index fits within `charBudget` (100 KB), every chunk of every file is sent to the model for comparative queries. Falls back to `coverAllFiles` when the index is too large.
- **`coverAllFiles` retrieval** — guarantees at least one chunk per indexed file in comparative queries.
- **Auto-fix for thinking models** — when a reasoning model exhausts `max_tokens` in chain-of-thought, the app auto-doubles `max_tokens` and asks the user to resubmit.
- Settings drawer split into per-tab modules under `modules/ui/settings/` (was a single 1976-line file).
- "Hardware" tab with model recommendations based on detected VRAM/RAM.
- Network-first cache strategy in the service worker for `.js` modules — avoids serving stale bundles after deploys.
- `.env.example`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`.

### Changed

- Default `max_tokens` raised from `4096` → `12000` to handle reasoning models without `finish_reason=length`. Soft migration upgrades existing configs.
- Default `embeddingModel` changed from `nomic-embed-text-v1.5` → `text-embedding-qwen3-embedding-4b`.
- Default `DEFAULT_BASE_URL` changed from a LAN-specific IP to `http://localhost:1234/v1`.
- Tabs reordered and renamed: `Servidor` → `Perfis & Inferência` → `Hardware` → `Workspace` → `Aparência` → `Comportamento` → `Atalhos` → `Avançado`. Sampling parameters moved to `Perfis & Inferência` (where they're per-profile anyway).
- Embedder now retries on failure with exponential backoff, and shrinks batch size on repeated batch-level errors.

### Fixed

- LM Studio "unload model" was returning HTTP 400 — payload required `instance_id`, not `model`.
- Service worker would serve stale JS modules after deploys. Network-first for `.js` resolves it.
- Empty content from reasoning models is now diagnosed as either "exceeded `max_tokens`" or "exceeded `n_ctx`" with actionable guidance, instead of silently showing nothing.
- PDF extraction reports `pagesEmpty` and `ocrLikelyNeeded` so the indexer can warn the user when scanned PDFs were silently skipped (when OCR is off).

### Removed

- `behavior.autoScrollLock` setting (was orphaned — no consumer in code).
- `profiles[].defaultServerId` (was orphaned).
- The "Digitar ID manualmente" details element under embedding model picker (clutter — chips suffice).
