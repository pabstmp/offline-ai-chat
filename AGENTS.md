# AGENTS.md

Referência pra sessões com Codex / agentes de IA. Não é documentação pro usuário final (essa é o `GUIDE.md`).

---

## O que é

**Offline AI Chat** — cliente web pra LM Studio remoto via API OpenAI-compatible. Vanilla JS (sem build, ES modules nativos), proxy Node, deps mínimas.

## Stack

| Camada | Tech |
|---|---|
| Frontend | Vanilla JS (ES modules), CSS tokens, zero deps no client |
| Backend | Node 18+ (`http`, `fs`, `path`, `crypto`, `pdfjs-dist`) |
| Persistência | localStorage + IndexedDB |
| Deploy | Docker (`docker-compose.yml`) ou nativo |
| Testes | Playwright via Node script (em `/tmp`) |

**Deps externas server-side**: `pdfjs-dist` (PDF), `tesseract.js` (OCR), `@napi-rs/canvas` (render PDF pra OCR). Client segue zero deps.

## Como rodar

```powershell
# Native (recomendado pra dev local — vê o disco do Windows direto)
node server.js

# Docker (em prod ou pra padronizar)
docker compose up -d --build
```

Servidor em `http://localhost:8080`. Não há build step.

## Estrutura de arquivos

```
/index.html              shell HTML (~250 linhas)
/styles.css              tokens light+dark + componentes (~1200 linhas)
/app.js                  entry, orquestra módulos
/server.js               proxy + endpoints fs + pdfjs
/sw.js                   service worker (cache-first shell)
/manifest.webmanifest    PWA
/package.json            dep pdfjs-dist
/Dockerfile + docker-compose.yml

/modules/                ES modules (browser-side)
  store.js               Proxy + pubsub (estado reativo)
  schema.js              Defaults + migrate v1→v2 + soft migrations
  storage.js             localStorage + IndexedDB wrapper (4 stores)
  api.js                 Cliente fetch + parse SSE + thinking model support
  markdown.js            Renderer zero-deps (tables, code blocks, etc.)
  theme.js               Aplica appearance no DOM
  shortcuts.js           Engine de atalhos + captura
  hardware.js            Detecção via WebGL + table de GPUs
  model-catalog.js       ~25 modelos curados + isLikelyThinkingModel()
  ui/
    chat.js              Mensagens, ações, streaming, reasoning block
    composer.js          Auto-resize, slash, token estimator
    sidebar.js           Histórico
    settings.js          Drawer 8 abas (~1500 linhas)
    palette.js           Command palette
    workspace.js         File tree + context panel
    toasts.js
  workspace/             4 backends de contexto
    upload.js            FileReader + PDF base64
    dragdrop.js          webkitGetAsEntry
    fsapi.js             showDirectoryPicker + IDB handle
    fsbridge.js          Cliente /api/fs/*
    context.js           Gerenciador de contexto (não-RAG)
  rag/
    chunker.js           Code-aware text split
    embedder.js          Batch + L2 normalize
    store.js             Wrapper IDB pra embeddings
    retriever.js         Cosine + diversification + first-chunk hybrid
    indexer.js           Pipeline list→read→chunk→embed→save
    manager.js           Facade com pubsub
```

---

## Endpoints do `server.js`

| Path | Método | O que faz |
|---|---|---|
| `/api/models` | POST | Proxy GET `/v1/models` |
| `/api/chat/completions` | POST | Proxy POST `/v1/chat/completions` (suporta SSE) |
| `/api/embeddings` | POST | Proxy POST `/v1/embeddings` |
| `/api/fs/list` | POST | Lista pasta (com path traversal guard) |
| `/api/fs/read` | POST | Lê arquivo de texto |
| `/api/fs/read-pdf` | POST | Lê PDF + extração layout-aware |
| `/api/fs/search` | POST | Busca recursiva texto |
| `/api/extract-pdf` | POST | Extrai PDF de base64 (pra upload do client) |
| `/api/lm/models-info` | POST | Proxy `/api/v0/models` (LM Studio extended) |
| `/api/lm/load-model` | POST | Proxy `/api/v1/models/load` (carrega com ctx custom) |
| `/api/lm/unload-model` | POST | Proxy `/api/v1/models/unload` |
| `/*` | GET | Static com ETag + Cache-Control |

Auto-translate de paths Windows → `/host/c/...` quando rodando em container Linux (ver `translateWindowsPath` em `server.js`).

---

## Schema do storage

```js
localStorage["offline-ai-chat:v2"] = {
  schemaVersion: 2,
  connection: { activeServerId, servers: [{ id, nickname, baseUrl, apiKey, headers, timeoutMs, retry }] },
  appearance: { theme, accentColor, fontUI, fontMono, fontSize, density, radius, ambientGlow, zenMode, reducedMotion },
  behavior: { submitOn, autoScrollLock, persistConversations, confirmOnDelete },
  activeProfileId,
  profiles: [{ id, name, icon, systemPrompt, defaultModel, defaultServerId, sampling }],
  keymap: {...},
  advanced: { streaming, debugMode, promptLibrary[], slashCommands[] },
  workspace: { sources[], activeSourceId, ignorePatterns, maxFileBytes, maxTotalBytes },
  rag: { enabled, embeddingModel, autoStrategy, chunkChars, chunkOverlap, topK, maxPerFile, batchSize, activeForNextMessage },
  hardwareOverride: null | { ... },
}

localStorage["offline-ai-chat:conversations:v1"] = [
  { id, title, createdAt, updatedAt, profileId, serverId, model, messages: [{ role, content, reasoning?, ts, id }] }
]

// IndexedDB "offline-ai" v2
//   conversations:    keyPath "id"
//   handles:          FS API directory handles, keyPath "id"
//   embeddings:       chunks com vec Float32Array, index "by_source"
//   embedding_meta:   metadata por sourceId
```

---

## Decisões arquiteturais importantes

### 1. Reasoning models (Gemma 4, DeepSeek R1, Qwen 3, Phi-4)
LM Studio retorna `delta.reasoning_content` em SSE. `extractDelta` em `api.js` separa `{content, reasoning}`. O reasoning é renderizado num `<details>` colapsável "💭 Pensando..." durante streaming, depois "💭 Raciocínio (clique pra expandir)" colapsado. Reasoning **não vai pro histórico salvo** (só content) pra evitar inflar memória/contexto em mensagens subsequentes.

**Gotcha**: reasoning tokens **contam dentro de `max_tokens`**. Default ajustado pra `4096` (era `null`). Se ainda assim vier vazio com `finish_reason: length`, é Context Length do LM Studio insuficiente — não `max_tokens`.

### 2. RAG estratégia automática
`detectQueryStrategy` em `app.js` classifica pergunta em 3 modos:
- **comparative** (listar/comparar/máximo/etc) → topK alto, maxPerFile=2, **includeFirstPerFile=true**
- **summary** (resumir/explicar) → topK=8, maxPerFile=4
- **point** (lookup específico) → topK=5, maxPerFile=2

Usuário NÃO precisa configurar topK. Configs avançadas escondidas em `<details>`. Auto desativável via `rag.autoStrategy = false`.

**Hybrid retrieval**: pra `comparative`, sempre inclui `chunkIdx=0` de cada arquivo (resumo da página 1) + chunks similares. Resolveu o problema de chunks recuperados serem páginas finais sem totais.

### 3. PDF extraction layout-aware
`extractLayoutAwareText` em `server.js`: agrupa items pdfjs por coordenada Y (linhas), ordena por X (colunas), insere `\t` quando gap horizontal > 12pt. Preserva alinhamento de tabelas. Antes era `tc.items.join(" ")` que perdia tudo.

### 4. LM Studio API estendida
Endpoints `/api/v0/models` e `/api/v1/models/load` (não-OpenAI) permitem ver/setar context length em runtime. UI na aba Servidor mostra cards com `state`, `loaded_ctx`, `max_ctx`, botões `4k · 8k · 16k · 32k · Custom`.

### 5. Auto-translate de paths Windows
`translateWindowsPath` em `server.js`: quando o servidor está em Linux container e recebe `C:\Users\...`, traduz pra `/host/c/Users/...` ou `/mnt/c/Users/...`. `docker-compose.yml` monta `/mnt/c:/host/c:ro` por default.

### 6. WORKSPACE_ROOTS opcional
Pra deploy single-user local, não exige whitelist. Se `WORKSPACE_ROOTS` env vazio e `HOST` é loopback, aceita qualquer pasta. Em LAN, `/api/fs/*` bloqueia até configurar `WORKSPACE_ROOTS`. Path traversal guard sempre ativo.

### 7. LAN hardening
Native Node usa `HOST=127.0.0.1` por default. Quando `HOST` expõe LAN (`0.0.0.0`, `::` ou IP não-loopback), o server bloqueia `/api/fs/*` se `WORKSPACE_ROOTS` estiver vazio e o proxy LM Studio só aceita loopback se `ALLOWED_LM_HOSTS` estiver vazio. `APP_AUTH_PASSWORD`/`APP_AUTH_TOKEN` liga Basic Auth para UI + API. Docker Compose local publica em `127.0.0.1:8080`; deploy LAN deve usar preferencialmente `npm run lan:setup` + `npm run lan:up`, que geram `.env.lan` e usam `docker-compose.lan.yml`.

---

## Gotchas conhecidos

### LM Studio
- **Default `n_ctx` = 4096**. Modelo claim 128k mas carrega só 4k. Use `/api/v1/models/load` com `context_length`.
- **Embedding endpoint exige modelo de embedding carregado**. Modelos de chat (Gemma 4) retornam erro "No models loaded" se chamados em `/v1/embeddings`.
- **Reasoning models** podem travar em meta-perguntas ("explique sua resposta") com `finish_reason: stop` + content vazio. Recomendar trocar pra modelo não-thinking.
- LM Studio aceita match parcial de model ID (ex: `nomic-embed-text-v1.5` casa com `text-embedding-nomic-embed-text-v1.5`). **Match exato é seguro** mas parcial às vezes funciona.

### Browser
- `navigator.deviceMemory` é **capado em 8GB** (privacidade).
- `WebGL.getParameter(UNMASKED_RENDERER_WEBGL)` pode estar mascarado em Firefox+RFP. Usar override manual.
- File System Access API (`showDirectoryPicker`) **só funciona em Chromium** (Chrome/Edge/Brave). Firefox: usar drag-drop ou server endpoint.
- Service worker cacheia o shell. **Sempre `Ctrl+Shift+R`** após mudanças no client.

### App
- Conversas antigas (anteriores ao bug fix de `assistantMsg.push`) **só têm perguntas do usuário, sem respostas**. Não dá pra recuperar.
- Chunks indexados ficam invalidados quando `chunkChars` muda. Re-indexar é necessário.
- Quando `embeddingModel` na config diverge do `meta.embeddingModel` da fonte indexada, `retrieve` rejeita com erro claro. Pill RAG mostra "modelo diferente".

---

## Comandos comuns

```bash
# Validar sintaxe de tudo
npm run check

# Rodar testes unit/PBT + hardening server
npm test

# Rebuild Docker (mais rápido que rebuild total)
docker compose up -d --build

# Logs do container
docker logs offline-ai-chat | tail -20

# Smoke test endpoints (precisa LM Studio em localhost:1234)
curl -s -X POST http://localhost:8080/api/models \
  -H "Content-Type: application/json" \
  -d '{"baseUrl":"http://localhost:1234/v1"}' | python3 -m json.tool

# Ver context length de cada modelo no LM Studio
curl -s -X POST http://localhost:8080/api/lm/models-info \
  -H "Content-Type: application/json" \
  -d '{"baseUrl":"http://localhost:1234/v1"}' | python3 -c "
import sys, json
for m in json.load(sys.stdin)['data']:
  print(f'  {m[\"id\"]}: state={m[\"state\"]} loaded={m.get(\"loaded_context_length\")} max={m.get(\"max_context_length\")}')
"
```

---

## Testes

Suite atual: `npm test` roda `tests/feature-improvements.test.js` (unit/PBT) e `tests/security-server.test.js` (hardening do server). Testes visuais/end-to-end seguem como scripts Playwright ad-hoc em `/tmp/*.js` quando necessário.

**Padrão**:
```js
const { chromium } = require('/tmp/node_modules/playwright');
const URL = 'http://localhost:8080';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Force config via localStorage
  await page.evaluate(() => {
    const cfg = JSON.parse(localStorage.getItem('offline-ai-chat:v2') || '{}');
    cfg.connection.servers[0].baseUrl = 'http://localhost:1234/v1';
    // ...
    localStorage.setItem('offline-ai-chat:v2', JSON.stringify(cfg));
  });
  await page.reload();
  // ...

  await page.screenshot({ path: '/tmp/test.png' });
  await b.close();
})();
```

**IMPORTANTE**: tests reais com LM Studio dependem de uma instância rodando (default `localhost:1234`, ou outro IP da LAN se você configurou). Mock via `page.route('**/api/models', ...)` quando isolar.

---

## Padrões de código

### Vanilla JS (sem framework)
- ES modules nativos. `<script type="module">` no HTML.
- Browser carrega `app.js` que importa `modules/*.js`.
- `package.json` na raiz é `commonjs` (pro server). `modules/package.json` é `module` (pros browser modules).

### Async/await everywhere
Sem callbacks aninhados. `async function` com `try/catch` pra erros visíveis ao usuário via `toast()`.

### Estado reativo
`createStore(initial)` em `store.js` é Proxy + pubsub. Mudanças disparam `subscribe` callbacks. Persistência debounced (250ms).

### Sem framework de UI
Funções que retornam DOM elements. Helpers em `settings.js`: `field()`, `section()`, `button()`, `checkbox()`, `card()`, `sliderRow()`. Manualmente cria `document.createElement`, anexa, etc.

### Toasts pra erros user-facing
`import { toast } from './ui/toasts.js'` → `toast(msg, "error" | "warn" | "success" | "info", durationMs)`.

---

## Histórico de iterações principais

1. **Refator vanilla** — saída de single-file pra ES modules
2. **Dark-first design** — paleta repensada, tokens
3. **Drawer fullscreen** — settings tipo macOS preferences
4. **8 abas de configuração** com CRUD de servidores/perfis
5. **Workspace com 4 backends** (upload/dragdrop/fsapi/server)
6. **PDF support** via pdfjs-dist server-side
7. **RAG** completo (chunker, embedder, store, retriever, manager)
8. **Recomendador de modelo** + hardware detection + catalog ~25 modelos
9. **Reasoning models** (Gemma 4, etc.) com bloco `<details>` separado
10. **Auto-detect query strategy** (comparative/summary/point)
11. **Hybrid retrieval** (includeFirstPerFile=true em comparative)
12. **LM Studio extended API** — load models com ctx custom direto da UI
13. **Bugfix crítico**: `assistantMsg` agora é pushed em `currentConversation.messages`. Antes respostas não eram salvas (só perguntas)
14. **Auto-translate paths Windows → /host/c**

---

## TODOs / limitações conhecidas

- Sem reranking (usa só cosine similarity raw). MMR/cross-encoder seriam upgrades.
- PDF extraction via pdfjs perde estrutura de tabela quando OCR (PDFs escaneados). Tabula/Camelot seria melhor.
- Sem function calling / tools (LM Studio suporta mas UI não expõe).
- Sem multimodal (vision/audio) mesmo com modelos VLM (gemma-4 e nemotron-omni).
- Conversas em IDB sem busca full-text indexada (só lowercase contains).
- Service worker pode entregar versão velha — sempre testar com `Ctrl+Shift+R` em dev.
- Stop sequences enviadas como array; alguns servidores não respeitam todos.
- Reasoning de modelos thinking não é re-enviado em mensagens subsequentes (decisão consciente — economiza tokens).

---

## Como adicionar feature nova

1. **Schema mudou?** → atualizar `modules/schema.js:defaults()` + soft migration em `loadAndMigrate()`.
2. **Novo endpoint server?** → adicionar handler em `server.js:handleApi`. Sempre validar input. Path traversal guard se mexe em fs.
3. **Nova UI em settings?** → adicionar aba em `TABS` array em `modules/ui/settings.js` + `panelXxx()` function.
4. **Mudou contrato de API?** → atualizar `modules/api.js`.
5. **Mudou estrutura de mensagem?** → atualizar `modules/ui/chat.js:renderMessage` + `finalizeAssistant`.
6. **Test**: criar `/tmp/test.js` com Playwright. Screenshot final pra confirmar visual.
7. **Doc**: atualizar `GUIDE.md` (user-facing) e AGENTS.md (este).

---

## Coisas que NÃO fazer

- ❌ Adicionar deps no client (manter zero deps).
- ❌ Build step (Vite/Webpack/etc.). Vanilla ES modules suficiente.
- ❌ Bibliotecas de UI (React/Vue/etc.). Tudo manual.
- ❌ Hardcode de IDs de modelo. Sempre usar `/v1/models` ou catálogo curado.
- ❌ Inferir além do que está no contexto RAG (system prompt RAG é estrito).
- ❌ Mexer em `--no-verify`, `--force-push`, etc. sem ordem explícita do usuário.
- ❌ Criar arquivos novos sem necessidade. Editar > criar.
