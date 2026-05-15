# REVIEW_POSTPHASE4.md

**Revisor**: Claude Sonnet 4.6 (Engenheiro Sênior + Segurança)
**Data**: 2026-05-15
**Commit**: `2d42fe5` — "Phase 4: function calling tools, security hardening, and tool-call UX polish"
**Metodologia**: leitura direta dos arquivos + execução de `npm run check` e `npm test` (sem LM Studio).

---

## 1. Sumário dos 31 Findings

| ID | Título | Status | Arquivo:Linha | Observação |
|----|--------|--------|---------------|------------|
| SEC-01 | Sandbox `run_javascript` isola via iframe | ✅ Implementado | `modules/tools/manager.js:173-233` | `sandbox="allow-scripts"` sem `allow-same-origin`, nonce, postMessage, AbortSignal. Exatamente o patch sugerido. |
| LEAK-01 | `readStream` sem try/finally + buffer cap | ✅ Implementado | `modules/api.js:91,126,166-170` | `SSE_MAX_BUFFER_BYTES = 1<<20`, try/finally com `reader.cancel()`. |
| LEAK-02 | AbortController compartilhado no tool cycle | ⚠️ Parcial | `app.js:1083-1210` | O ciclo verifica `.signal.aborted` no início e a cada iteração (linhas 1090, 1106). Não usa `AbortSignal.any` por iteração como sugerido — um único controller cobre toda a árvore de calls. Cancel completo funciona; cancel por iteração individual ainda não. |
| LEAK-03 | Sandbox ignora `options.signal` | ✅ Implementado | `modules/tools/manager.js:173, 203, 210` | Signal passado para `runInSandbox`, listener `onAbort` devidamente implementado. |
| LEAK-04 | `renderToolCallBlock` cria bloco duplicado | ✅ Implementado | `modules/ui/chat.js:72-75`; `app.js:1110,1115,1132` | Função retorna referência; segunda chamada com `existingBlock` chama `updateToolCallBlock` in-place. |
| SEC-02 | URLs DDG sem validação de scheme | ✅ Implementado | `server.js:1374-1388` | `safeExtractDdgUrl()` decodifica `/l/?uddg=` e valida `http:`/`https:`, retorna null para outros schemes. |
| SEC-03 | Web search sem timeout no `https.get` | ✅ Implementado | `server.js:1259, 1365` | `req.setTimeout(10_000, ...)` aplicado tanto no Brave quanto no DDG. |
| SEC-04 | `/api/tools/web-search` fora do `rateLimited()` | ✅ Implementado | `server.js:1154-1156` | `handleToolsWebSearch` recebe `request` e chama `rateLimited(request)` na primeira linha. |
| QUAL-01 | `requireConfirmation` era stub | ✅ Implementado | `app.js:971-1003` | `confirmToolCall()` usa `<dialog>` nativo com `escapeHtml` nos args, `form method="dialog"`, showModal. |
| SCHEMA-01 | Soft migrations não recursivas | ✅ Implementado | `modules/schema.js:317-338` | `mergeMissing()` recursiva, 22 linhas, trata arrays como atômicos, deep-clone via JSON. |
| SCHEMA-02 | `validate()` aceita formas parcialmente corruptas | ✅ Implementado | `modules/schema.js:358-379` | Filtra servers com `.filter(s => s && typeof s.baseUrl === "string" && typeof s.id === "string")` e profiles com `.filter(p => p && p.sampling && typeof p.sampling === "object")`. |
| SCHEMA-03 | `migrate v1→v2` perde dados — toast informativo | ✅ Implementado | `modules/schema.js:386-389, app.js` | `migrationFlags.v1Migrated` setado; `app.js` exibe toast. |
| SCHEMA-04 | `loadAndMigrate` não persistia soft migrations | ✅ Implementado | `modules/schema.js:448-465` | `needsPersist` flag + `localStorage.setItem` condicional após todas as soft migrations. |
| RAG-01 | Chunks com dim errada vão pro ranking | ✅ Implementado | `modules/rag/retriever.js:26-36` | Chunks com dim errada são descartados com `continue`; se TODOS têm dim errado retorna `[]`. |
| PERF-01 | Editor inline re-renderiza a cada keystroke | ✅ Implementado | `modules/ui/chat.js:436-444` | Debounce de 120ms com `previewTimer`, comentário explícito. |
| PERF-02 | `populateModelSelect` via `window.runtime` stale | ✅ Implementado | `modules/ui/comparison.js:23,51`; `app.js:1889-1895` | Pull-based via callback `getModels: () => runtime.models`. Remove acoplamento a `window.runtime`. |
| PERF-03 | Reranker: comentário inconsistente | ✅ Implementado | `modules/rag/reranker.js:30-32` | Comentário agora diz "paralelo dentro de cada lote (Promise.all) e sequencial entre lotes". |
| PERF-04 | `cosine` em loop JS sem SIMD | N/A | `modules/rag/retriever.js` | Nit de futuro, não era item de correção obrigatória. Sem TODO adicionado — aceitável. |
| SEC-05 | CSP permite `'unsafe-inline'` em scripts | ⚠️ Parcial | `server.js:96-103` | SW registration movida para `app.js` (fix parcial correto). `'unsafe-inline'` ainda presente em `script-src`, mas agora com comentário explicando que é necessário para o srcdoc do iframe sandbox. O comentário é tecnicamente incorreto (ver Bug #1 abaixo). |
| SEC-06 | SSRF em modo local sem `ALLOWED_LM_HOSTS` | ✅ Implementado | `server.js:1114-1120` | `console.warn` em startup quando `ALLOWED_LM_HOSTS` está vazio em modo local — exatamente o patch sugerido. |
| LEAK-05 | `setTimeout` do Copiar em comparison não cancelado | ✅ Implementado | `modules/ui/comparison.js:196-203` | Implementação mudou: agora usa `toast("Resposta copiada", "success", 1500)` — o setTimeout foi eliminado inteiramente. |
| QUAL-02 | Listener `document.click` em menu regen pode ficar órfão | ✅ Implementado | `modules/ui/chat.js:351-376` | O item do menu agora chama `closeMenu()` explicitamente antes de despachar a ação (linha 372). |
| QUAL-03 | `rebuildModelServerMap` stub vazio | N/A | `modules/ui/comparison.js` | Função não existe no código atual — foi removida junto com a refatoração para pull-based. |
| QUAL-04 | Branch `renderToolCallBlock` cria bloco solto | ✅ Implementado | Ver LEAK-04 | Absorvido pela correção de LEAK-04. |
| NIT-1 | Mistura PT/EN em comentários | ⚠️ Parcial | vários | `modules/tools/manager.js` tem mix PT/EN (comentários EN em linha 196-215, PT no resto). Não crítico. |
| NIT-2 | `extractDelta` sem testes unit | ✅ Implementado | `tests/feature-improvements.test.js` | Suite `R-Review — api.js` cobre `extractDelta`, `extractFinishReason`, `extractToolCalls` + PBT. |
| NIT-3 | `parseDuckDuckGoHtml` regex frágil | ⚠️ Parcial | `server.js:1396-1425` | Parser reescrito como parser stateful (split por `result__body`). Mais robusto, mas ainda baseado em string matching do HTML. Não há log de falha silenciosa quando o markup muda. |
| NIT-4 | `defaults()` em 130 linhas sem quebrar | ⚠️ Parcial | `modules/schema.js:138-277` | Função ainda tem ~140 linhas. Sem extração de `defaultConnection()`, `defaultRag()`, etc. Nit de legibilidade, sem impacto funcional. |
| NIT-5 | `comparison.js` usa `textContent` em vez de toast | ✅ Corrigido | `modules/ui/comparison.js:199` | Agora usa `toast(...)`. |
| NIT-6 | `app.js` 1800+ linhas, RAG strategy inline | ⚠️ Parcial | `app.js` (~2070 linhas) | Arquivo cresceu com Phase 4. `detectQueryStrategy` ainda inline. Dívida técnica conhecida. |
| — | `rag.reranking.candidateK` nos defaults | ✅ Implementado | `modules/schema.js:270` | `candidateK: 20` presente em `rag.reranking` no `defaults()`. |

---

## 2. Bugs Novos Encontrados

### [MÉDIO] SEC-05 parcialmente resolvido — justificativa do `'unsafe-inline'` tecnicamente incorreta

**Arquivo**: `server.js:96-103`

**Problema**: O comentário afirma que `'unsafe-inline'` em `script-src` é necessário porque o srcdoc do iframe sandbox herda a CSP do parent. Isso é **incorreto**: um iframe com `sandbox="allow-scripts"` mas **sem** `allow-same-origin` tem uma origem opaca — ele **não herda a CSP do parent** e executa scripts inline livremente independente da diretiva `script-src` do parent. O `'unsafe-inline'` na CSP do parent afeta apenas scripts no documento principal (incluindo qualquer `<script>` inline em `index.html` ou injetado em runtime), não o iframe sandboxed.

**Impacto concreto**: Se há algum `<script>` inline em `index.html` além do que foi movido para `app.js`, ou se um XSS injetar HTML inline na página principal, a CSP não bloqueia. Com `app.js` sendo o único ponto de entrada de scripts e o SW registration tendo sido movido, é provável que `'unsafe-inline'` possa ser removido de `script-src` sem quebrar nada.

**Código atual**:
```js
// server.js:96-103
// script-src estrito: sem 'unsafe-inline'. O registro do service worker
// (único inline anterior) foi movido para app.js. Necessario `blob:` aqui
// porque o tool sandbox cria <iframe srcdoc=...> com <script> inline; o
// srcdoc herda a CSP do parent, então precisamos permitir scripts inline
// controlados pelo sandbox iframe. (comentário tecnicamente incorreto)
"script-src 'self' 'unsafe-inline'",
```

**Verificação sugerida**: auditar `index.html` e `app.js` para confirmar que não há nenhum `<script>` inline, e se confirmado, remover `'unsafe-inline'` de `script-src`.

---

### [BAIXO] LEAK-02 parcialmente resolvido — cancel por iteração individual ausente

**Arquivo**: `app.js:1083-1210`

**Problema**: O patch sugerido para LEAK-02 incluía um controller por iteração com `AbortSignal.any([iterCtrl.signal, runtime.abortController.signal])` para que o usuário pudesse cancelar apenas a iteração atual. O que foi implementado é um bail-out preguiçoso: antes de cada iteração e request, verifica se o signal global já está abortado. Isso funciona corretamente para o caso "usuário aperta Stop — tudo para". O caso de "cancelar só a iteração atual e manter resultado parcial" não foi implementado, mas é o comportamento que a UX atual implica (há apenas um botão Stop global).

**Impacto**: Baixo em termos de UX atual (sem botão de "cancelar esta tool específica"). Não é um bug — é uma simplificação consciente da superfície de controle, aceita pelo commitjá que o commit não promete o cancel por iteração.

---

### [BAIXO] NIT-3 persistente — sem log quando o parser DDG retorna zero resultados por mudança de markup

**Arquivo**: `server.js:1351-1358`

**Problema**: Quando `parseDuckDuckGoHtml` retorna array vazio, o erro lançado tem `code = "no-results"` — o que é indistinguível de "DDG não encontrou resultados para esta query" vs "DDG mudou o markup e o parser não extraiu nada". A UI mostra o mesmo CTA nos dois casos, mas o operador que olha os logs não consegue distinguir.

**Impacto**: Diagnóstico difícil em produção quando o DDG mudar o markup (o que acontece ocasionalmente).

**Patch sugerido**: logar o `html.slice(0, 500)` quando `starts.length === 0` (nenhum `result__body` encontrado) para distinguir "parse falhou" de "sem resultados reais".

---

### [BAIXO] Duplicate comment block em `parseDuckDuckGoHtml`

**Arquivo**: `server.js:1391-1399`

**Problema**: Dois blocos de comentário `/* Parser do HTML do DDG. ... */` consecutivos (linhas 1391-1394 e 1395-1399) descrevem a mesma função — o primeiro é o comentário antigo que ficou depois da reescrita, o segundo é o novo. Não afeta comportamento, mas é confuso.

---

## 3. Cobertura de Testes

O que a suite atual **cobre bem**:
- `extractDelta`, `extractToolCalls`, `extractFinishReason` com PBT e casos-edge (null, vazio, malformado).
- `mergeMissing` com exemplos e PBT de completude.
- Utilitários de backup, fork, A/B, imagens, templates, RAG indicator, server dropdown, scroll, modal, comparison helpers.
- Hardening de server: path traversal, WORKSPACE_ROOTS, LM proxy allowlist, Basic Auth, origin guard.

O que **falta** para dar confiança real:

1. **`runInSandbox` isolation** — não há nenhum teste que confirme que o iframe realmente não pode ler `localStorage`. Um teste unitário Node simulando o iframe com `jsdom` é inviável; um Playwright test seria o caminho:
   ```js
   // Playwright: injetar key no localStorage, pedir run_javascript para lê-lo
   // e verificar que o resultado não contém a key.
   ```

2. **`confirmToolCall` dialog** — sem teste que confirme que o modal bloqueia a execução quando `requireConfirmation = true` e o usuário cancela.

3. **`readStream` try/finally** — sem teste que confirme que o reader é liberado em abort. Viável com `ReadableStream` simulado + `AbortController` em Node 18.

4. **`safeExtractDdgUrl`** — sem nenhum teste unit verificando que `javascript:`, `data:`, `blob:`, e o decode do `/l/?uddg=` funcionam. Trivial de adicionar:
   ```js
   assert(safeExtractDdgUrl("javascript:alert(1)") === null);
   assert(safeExtractDdgUrl("https://duckduckgo.com/l/?uddg=https://example.com") === "https://example.com/");
   ```

5. **`handleToolsWebSearch` rate limit** — o security test suite não cobre o endpoint `/api/tools/web-search`, apenas os `/api/fs/*`.

6. **`validate()` com items corrompidos** — sem teste que confirme que um `null` em `servers[]` é descartado e não explode o boot.

7. **`reranker.js`** — sem nenhum teste de comportamento do reranker (incluindo o contrato "retorna N chunks mesmo com erros de rede").

---

## 4. Smoke E2E

| Teste | Método | Resultado | Observação |
|-------|--------|-----------|------------|
| `npm run check` | CLI (`node scripts/check.js`) | ✅ PASSOU | 34 arquivos JS validados, zero erros de sintaxe. |
| `npm test` (unit + PBT) | CLI (`node tests/feature-improvements.test.js`) | ✅ PASSOU | 110 testes, 0 falhas. Inclui cobertura dos findings R-Review (extractDelta, mergeMissing). |
| `npm test` (server hardening) | CLI (`node tests/security-server.test.js`) | ✅ PASSOU | 10 testes, 0 falhas. Path traversal, auth, origin guard, LM proxy, workspace whitelist. |
| Sandbox isolation (browser) | Não executado | N/A | Requer Playwright + LM Studio. Não cobertura automatizada hoje. |
| `requireConfirmation` dialog | Não executado | N/A | Requer browser. |
| `web_search` Brave + DDG | Não executado | N/A | Requer chaves/rede externa. |

---

## 5. Recomendação Final

**Pode ir para produção**, com as ressalvas abaixo listadas em ordem de prioridade.

Os 3 findings críticos originais (SEC-01, LEAK-01, QUAL-01) foram **corretamente implementados**. Os 7 altos foram todos corrigidos (6 totalmente, 1 parcialmente sem regressão). Os médios e baixos foram todos endereçados. Os 2 novos bugs encontrados são de severidade baixa/média.

### Ajustes prioritários (recomendados antes do próximo release):

1. **[MÉDIO] Auditar e remover `'unsafe-inline'` de `script-src`** (`server.js:103`): confirmar que `index.html` não tem nenhum `<script>` inline além do já migrado para `app.js`, e se confirmado, mudar para `"script-src 'self'"`. O comentário justificativo atual está errado e pode induzir a manter a diretiva relaxada desnecessariamente.

2. **[BAIXO] Adicionar testes unit para `safeExtractDdgUrl`** (`server.js:1376-1388`): 4–5 casos de teste em `tests/security-server.test.js` cobrem o caso de scheme injection e o decode do redirect DDG.

3. **[BAIXO] Adicionar rate-limit ao endpoint `/api/tools/web-search` no suite de segurança**: o endpoint está protegido no código mas o teste de hardening não o cobre — uma regressão futura pode passar despercebida.

4. **[BAIXO] Log diagnóstico em `parseDuckDuckGoHtml`** quando `starts.length === 0` (`server.js:~1407`): distingue "DDG mudou o markup" de "query sem resultados".

5. **[NIT] Remover o primeiro bloco de comentário duplicado** em `parseDuckDuckGoHtml` (`server.js:1391-1394`).
