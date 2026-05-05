# Design Document — Feature Improvements

## Overview

Este documento descreve o design técnico das 9 melhorias de funcionalidade para o **Offline AI Chat**. O projeto é Vanilla JS puro com ES modules nativos, sem build step e sem dependências no client. Todas as melhorias devem ser implementadas editando os arquivos existentes, respeitando os padrões de código já estabelecidos.

As 9 melhorias são:
1. Backup completo de conversas (exportar/importar JSON)
2. Fork de conversa (continuar a partir de qualquer ponto)
3. Comparação A/B de respostas (dois perfis lado a lado)
4. Suporte a imagens no composer (multimodal)
5. Templates de conversa (reutilizar contextos)
6. Indicador de indexação RAG no topbar
7. Atalho para alternar servidores (dropdown no StatusPill)
8. Persistência de scroll por conversa (em memória)
9. Modo de foco por mensagem (overlay fullscreen)

---

## Architecture

O projeto segue uma arquitetura de módulos ES com um orquestrador central (`app.js`) que conecta os módulos de UI, storage e API. Não há framework reativo — o estado é gerenciado pelo `createStore` (Proxy + pubsub) em `modules/store.js`.

```
app.js (orquestrador)
├── modules/ui/chat.js          — renderização de mensagens
├── modules/ui/sidebar.js       — histórico, busca, ações de conversa
├── modules/ui/composer.js      — textarea, slash commands, token count
├── modules/ui/settings/        — painéis de configuração por aba
│   ├── behavior.js             — R1: botões de backup
│   └── advanced.js             — R5: seção de templates
├── modules/storage.js          — conversationStore (LS + IDB)
├── modules/rag/manager.js      — facade RAG com pubsub
└── modules/schema.js           — defaults, migração, validação
```

### Princípios de design para as melhorias

- **Sem novas dependências no client**: toda lógica usa APIs nativas do browser (FileReader, URL.createObjectURL, Clipboard API, etc.)
- **Preferir editar arquivos existentes**: cada melhoria se encaixa no módulo mais próximo
- **Lógica pura extraída para funções testáveis**: funções de transformação de dados são exportadas separadamente para permitir testes com `node tests/arquivo.test.js`
- **CSS tokens existentes**: novos elementos usam apenas variáveis CSS já definidas em `styles.css`

---

## Components and Interfaces

### R1 — Backup Completo de Conversas

**Módulo afetado:** `modules/ui/settings/behavior.js`

Duas novas funções puras exportadas de um helper (ou inline no painel):

```js
// Gera o nome do arquivo de backup para uma data
export function backupFilename(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `offline-ai-backup-${y}-${m}-${d}.json`;
}

// Merge de conversas: preserva existentes, adiciona apenas ausentes por id
export function mergeConversations(existing, imported) {
  const existingIds = new Set(existing.map((c) => c.id));
  const toAdd = imported.filter((c) => !existingIds.has(c.id));
  return { merged: [...existing, ...toAdd], added: toAdd.length, skipped: imported.length - toAdd.length };
}

// Valida se o conteúdo importado é um array de conversas com id
export function validateBackupFile(parsed) {
  if (!Array.isArray(parsed)) return { valid: false, reason: "não é um array" };
  if (parsed.length > 0 && typeof parsed[0].id !== "string") return { valid: false, reason: "itens sem campo id" };
  return { valid: true };
}
```

O painel `panelBehavior()` ganha uma nova seção "Backup de conversas" com os dois botões. O botão "Exportar tudo" usa `URL.createObjectURL` + `<a download>`. O botão "Importar backup" usa `<input type="file" accept=".json">` + `FileReader`.

### R2 — Fork de Conversa

**Módulos afetados:** `modules/ui/chat.js`, `app.js`

Funções puras para a lógica de fork:

```js
// Retorna o prefixo de messages até o id fornecido (inclusive)
export function forkMessagesAt(messages, messageId) {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return [...messages];
  return messages.slice(0, idx + 1);
}

// Cria o objeto de nova conversa derivada, sem mutar a original
export function createFork(sourceConv, messages) {
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `${sourceConv.title || "(sem título)"} (fork)`,
    profileId: sourceConv.profileId,
    serverId: sourceConv.serverId,
    model: sourceConv.model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: messages.map((m) => ({ ...m })), // cópia rasa de cada mensagem
  };
}
```

Em `chat.js`, o botão "Continuar daqui" é adicionado ao array de ações apenas para mensagens `role === "assistant"`. O evento dispara `onAction({ action: "fork", messageId, message })`.

Em `app.js`, `handleMessageAction` trata `action === "fork"`: chama `forkMessagesAt`, `createFork`, `conversationStore.upsert`, `refreshSidebar` e `loadConversation`.

### R3 — Comparação A/B de Respostas

**Módulos afetados:** `modules/ui/chat.js`, `app.js`

O botão "Regenerar" existente passa a abrir um mini-menu inline (similar ao `openMenu` do sidebar) com duas opções. A lógica de filtragem de perfis é uma função pura:

```js
// Retorna todos os perfis exceto o ativo
export function getAlternativeProfiles(profiles, activeProfileId) {
  return profiles.filter((p) => p.id !== activeProfileId);
}
```

A substituição de mensagem no histórico é uma função pura:

```js
// Substitui o conteúdo de uma mensagem por id, sem mutar o array original
export function replaceMessageContent(messages, messageId, newContent) {
  return messages.map((m) =>
    m.id === messageId ? { ...m, content: newContent } : m
  );
}
```

O layout A/B é renderizado como um `<div class="ab-comparison">` com dois filhos `.ab-col`. Cada coluna tem um cabeçalho com o nome do perfil e um botão "Usar esta". Ao clicar, `replaceMessageContent` é chamado, o histórico é atualizado e o layout A/B é removido do DOM.

A geração da resposta alternativa usa o mesmo `requestCompletion` de `app.js`, mas com o payload do perfil alternativo e sem adicionar a resposta ao histórico até o usuário escolher.

### R4 — Suporte a Imagens no Composer

**Módulos afetados:** `modules/ui/composer.js`, `app.js`, `index.html`

Funções puras para a lógica de imagem:

```js
// Valida o tamanho do arquivo (limite: 10 MB)
export function validateImageSize(sizeBytes, limitBytes = 10 * 1024 * 1024) {
  return sizeBytes <= limitBytes;
}

// Constrói o content array OpenAI-compatible para mensagem com imagem
export function buildImageMessageContent(text, base64Data, mimeType) {
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
  ];
}
```

O estado da imagem é mantido em `composer.js` como variável de módulo `let pendingImage = null` (estrutura `{ base64, mimeType, name }`). O preview é um `<div class="composer-image-preview">` inserido acima do textarea, com um botão "×" para remover.

Em `app.js`, `submitMessage` verifica se há `pendingImage` e chama `buildImageMessageContent` para construir o `content` da mensagem do usuário. A mensagem renderizada no chat exibe a imagem via `<img src="data:...">` quando `content` é um array.

### R5 — Templates de Conversa

**Módulos afetados:** `modules/ui/settings/advanced.js`, `modules/ui/sidebar.js`, `app.js`

Chave de storage: `offline-ai-chat:templates:v1`

Funções puras:

```js
// Cria um objeto Template a partir de uma conversa
export function createTemplate(conv, name, systemPrompt) {
  return {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    systemPrompt,
    messages: (conv.messages || []).map((m) => ({ ...m })),
    createdAt: Date.now(),
  };
}

// Inicializa uma nova conversa a partir de um template
export function initConversationFromTemplate(template, baseConv) {
  return {
    ...baseConv,
    messages: (template.messages || []).map((m) => ({ ...m })),
    _templateSystemPrompt: template.systemPrompt,
  };
}

// Remove um template do array por id
export function removeTemplate(templates, id) {
  return templates.filter((t) => t.id !== id);
}
```

O storage de templates é gerenciado por um helper simples:

```js
const TEMPLATES_KEY = "offline-ai-chat:templates:v1";
export const templateStore = {
  list: () => { try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]"); } catch { return []; } },
  save: (templates) => localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)),
};
```

O menu de contexto do sidebar (`openMenu` em `sidebar.js`) ganha a opção "Salvar como template". O botão "Nova conversa" em `app.js` verifica se há templates disponíveis; se sim, exibe um modal simples (similar ao `openMenu`) com a lista de templates e a opção "Em branco".

### R6 — Indicador de Indexação RAG no Topbar

**Módulos afetados:** `app.js`, `index.html`, `styles.css`

Um novo elemento é adicionado ao topbar em `index.html`:

```html
<button id="ragIndexingIndicator" class="rag-indexing-indicator hidden"
        type="button" title="Indexando… clique para ver detalhes"
        aria-label="Indexação RAG em andamento">
  <span class="rag-indexing-dot"></span>
</button>
```

A lógica de visibilidade é uma função pura:

```js
// Determina se o indicador deve estar visível dado o tipo de evento RAG
export function ragIndicatorShouldShow(eventKind) {
  return eventKind === "started" || eventKind === "progress";
}
```

Em `app.js`, após a inicialização, `rag.subscribe` é chamado com um handler que atualiza `hidden` do elemento conforme o evento. O clique abre `openSettings("workspace")`.

### R7 — Atalho para Alternar Servidores

**Módulos afetados:** `app.js`, `styles.css`

A lógica de navegação por teclado e visibilidade do dropdown são funções puras:

```js
// Determina se o dropdown deve ser exibido
export function shouldShowServerDropdown(servers) {
  return Array.isArray(servers) && servers.length > 1;
}

// Calcula o próximo índice de seleção com wrap
export function nextServerIndex(currentIndex, total, direction) {
  // direction: 1 (ArrowDown) ou -1 (ArrowUp)
  return (currentIndex + direction + total) % total;
}
```

O dropdown é criado dinamicamente (similar ao `openMenu` do sidebar) ao clicar no `#statusPill`. Cada item exibe o `nickname` do servidor e um indicador de ativo (checkmark). A seleção atualiza `connection.activeServerId` no store e chama `loadModels()`.

Se apenas um servidor está cadastrado, o clique no `#statusPill` mantém o comportamento atual e um `title` é adicionado dinamicamente: "Adicione servidores em Configurações → Servidor".

### R8 — Persistência de Scroll por Conversa

**Módulos afetados:** `app.js`, `modules/ui/chat.js`

O cache é um `Map` em memória em `app.js`:

```js
const scrollCache = new Map(); // conversationId → scrollTop
```

A lógica de decisão de auto-scroll é uma função pura:

```js
// Determina se deve rolar para o final baseado na distância ao bottom
export function shouldAutoScroll(scrollHeight, scrollTop, clientHeight, threshold = 64) {
  return (scrollHeight - scrollTop - clientHeight) <= threshold;
}

// Retorna a posição salva ou null se não houver
export function getScrollPosition(cache, conversationId) {
  return cache.has(conversationId) ? cache.get(conversationId) : null;
}
```

O listener de scroll em `#messages` é adicionado em `app.js` (não em `chat.js`) para ter acesso ao `runtime.currentConversation.id`. O debounce de 150ms usa a função `debounce` já existente em `modules/store.js`.

Ao carregar uma conversa (`loadConversation`), após `renderAllMessages`, o `scrollTop` é restaurado se presente no cache, ou `scrollToBottom()` é chamado.

### R9 — Modo de Foco por Mensagem

**Módulos afetados:** `modules/ui/chat.js`, `app.js`, `styles.css`

O modal é criado dinamicamente (não existe no HTML estático) para evitar poluição do DOM quando não está em uso:

```js
// Determina o overflow do body baseado no estado do modal
export function getBodyOverflowForModal(isOpen, previousOverflow = "") {
  return isOpen ? "hidden" : previousOverflow;
}
```

O botão "Foco" é adicionado ao array de ações em `chat.js`. O evento dispara `onAction({ action: "focus", messageId, message })`. Em `app.js`, `handleMessageAction` trata `action === "focus"` criando e exibindo o modal.

O modal tem a estrutura:
```html
<div class="focus-modal-overlay">
  <div class="focus-modal-content">
    <div class="focus-modal-header">
      <button class="btn btn-sm btn-secondary focus-modal-copy">Copiar</button>
      <button class="icon-button focus-modal-close">×</button>
    </div>
    <div class="focus-modal-body"><!-- markdown renderizado --></div>
  </div>
</div>
```

O atalho `F` sobre uma mensagem é registrado via listener de `keydown` no `#messages`, verificando se o `event.target.closest(".msg")` existe.

---

## Data Models

### Template

```js
{
  id: string,           // "tpl-{timestamp}-{random}"
  name: string,         // nome fornecido pelo usuário
  systemPrompt: string, // system prompt do perfil ativo no momento
  messages: Message[],  // cópia das mensagens da conversa
  createdAt: number,    // timestamp Unix ms
}
```

Persistido em `localStorage` sob `offline-ai-chat:templates:v1` como array JSON.

### Scroll Position Cache

```js
Map<conversationId: string, scrollTop: number>
```

Apenas em memória — não persistido. Descartado ao recarregar a página.

### Pending Image State (Composer)

```js
{
  base64: string,   // dados base64 sem o prefixo data:
  mimeType: string, // "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  name: string,     // nome original do arquivo
} | null
```

### AB Comparison State

```js
{
  messageId: string,       // id da mensagem do assistente sendo comparada
  originalContent: string, // conteúdo original
  alternativeContent: string | null, // conteúdo gerado com perfil alternativo
  alternativeProfileId: string,
}
```

Estado em memória em `app.js`, descartado após escolha ou cancelamento.

### RAG Indexing Indicator State

Derivado diretamente dos eventos do `rag.subscribe`. Não há estado adicional — o elemento DOM é mostrado/ocultado via `hidden`.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Backup filename matches date pattern

*For any* valid `Date` object, `backupFilename(date)` SHALL return a string matching the pattern `offline-ai-backup-YYYY-MM-DD.json` where YYYY, MM, DD correspond to the year, zero-padded month, and zero-padded day of the input date.

**Validates: Requirements 1.2**

---

### Property 2: Conversation merge preserves existing and adds only absent

*For any* two arrays of conversation objects (existing and imported), `mergeConversations(existing, imported)` SHALL return a result where: (a) all conversations from `existing` are present unchanged, (b) only conversations from `imported` whose `id` is not already in `existing` are added, and (c) `added + skipped === imported.length`.

**Validates: Requirements 1.4, 1.6**

---

### Property 3: Backup validation rejects non-arrays and arrays without id

*For any* value that is not an array, or is an array whose first element lacks a string `id` field, `validateBackupFile(value)` SHALL return `{ valid: false }`.

**Validates: Requirements 1.5**

---

### Property 4: Fork slice is a prefix ending at the target message

*For any* non-empty messages array and any `messageId` present in that array, `forkMessagesAt(messages, messageId)` SHALL return an array that is a prefix of `messages` ending at (and including) the message with that `id`, with length equal to `indexOf(messageId) + 1`.

**Validates: Requirements 2.2**

---

### Property 5: Fork creation produces correct metadata and does not mutate source

*For any* source conversation object and any messages array, `createFork(sourceConv, messages)` SHALL return a new object where: (a) `id !== sourceConv.id`, (b) `title` ends with `" (fork)"`, (c) `profileId`, `serverId`, and `model` equal those of `sourceConv`, and (d) `sourceConv` is deeply equal to its state before the call (no mutation).

**Validates: Requirements 2.3, 2.5**

---

### Property 6: Alternative profiles excludes the active profile

*For any* array of profiles and any `activeProfileId`, `getAlternativeProfiles(profiles, activeProfileId)` SHALL return an array containing all profiles where `id !== activeProfileId`, with no duplicates and no omissions of non-active profiles.

**Validates: Requirements 3.2**

---

### Property 7: Message replacement updates only the target message

*For any* messages array, any `messageId` present in that array, and any `newContent` string, `replaceMessageContent(messages, messageId, newContent)` SHALL return an array of the same length where the message with `messageId` has `content === newContent` and all other messages are unchanged (deep equality).

**Validates: Requirements 3.6**

---

### Property 8: Image message content is a valid OpenAI-compatible array

*For any* non-empty text string, non-empty base64 data string, and valid MIME type string, `buildImageMessageContent(text, base64Data, mimeType)` SHALL return an array of exactly two elements: `{ type: "text", text }` and `{ type: "image_url", image_url: { url: "data:<mimeType>;base64,<base64Data>" } }`.

**Validates: Requirements 4.4**

---

### Property 9: Image size validation enforces 10 MB limit

*For any* file size in bytes, `validateImageSize(sizeBytes)` SHALL return `true` if and only if `sizeBytes <= 10 * 1024 * 1024`.

**Validates: Requirements 4.7**

---

### Property 10: Template creation captures conversation data correctly

*For any* conversation object, name string, and systemPrompt string, `createTemplate(conv, name, systemPrompt)` SHALL return an object where `name` equals the provided name, `systemPrompt` equals the provided systemPrompt, `messages` is a deep copy of `conv.messages` (equal in content but not the same reference), and `id` is a non-empty string.

**Validates: Requirements 5.4**

---

### Property 11: Conversation initialized from template has correct messages and system prompt

*For any* template object and base conversation object, `initConversationFromTemplate(template, baseConv)` SHALL return an object where `messages` is deeply equal to `template.messages` and `_templateSystemPrompt` equals `template.systemPrompt`.

**Validates: Requirements 5.6**

---

### Property 12: Template removal eliminates exactly the target template

*For any* non-empty array of templates and any `id` present in that array, `removeTemplate(templates, id)` SHALL return an array of length `templates.length - 1` that contains no template with that `id`, and all other templates are present unchanged.

**Validates: Requirements 5.7**

---

### Property 13: RAG indicator visibility follows event kind

*For any* RAG event kind string, `ragIndicatorShouldShow(eventKind)` SHALL return `true` if and only if `eventKind === "started"` or `eventKind === "progress"`, and `false` for `"done"`, `"error"`, `"cleared"`, or any other value.

**Validates: Requirements 6.2, 6.5**

---

### Property 14: Server dropdown navigation wraps correctly and shows only for multiple servers

*For any* array of servers with `length > 1`, `shouldShowServerDropdown(servers)` SHALL return `true`; for any array with `length <= 1`, SHALL return `false`. Additionally, *for any* total server count `n > 0` and current index `i`, `nextServerIndex(i, n, 1)` SHALL return `(i + 1) % n` and `nextServerIndex(i, n, -1)` SHALL return `(i - 1 + n) % n`.

**Validates: Requirements 7.5, 7.6**

---

### Property 15: Scroll position cache returns stored value or null

*For any* `Map<string, number>` cache and any conversation id, `getScrollPosition(cache, id)` SHALL return the stored `scrollTop` value if the id is present in the cache, and `null` if it is not.

**Validates: Requirements 8.3, 8.4**

---

### Property 16: Auto-scroll decision is based on distance to bottom

*For any* `scrollHeight`, `scrollTop`, and `clientHeight` values, `shouldAutoScroll(scrollHeight, scrollTop, clientHeight)` SHALL return `true` if and only if `(scrollHeight - scrollTop - clientHeight) <= 64`.

**Validates: Requirements 8.5**

---

### Property 17: Body overflow is hidden when modal is open and restored when closed

*For any* previous overflow string, `getBodyOverflowForModal(true, previousOverflow)` SHALL return `"hidden"`, and `getBodyOverflowForModal(false, previousOverflow)` SHALL return `previousOverflow`.

**Validates: Requirements 9.6, 9.7**

---

## Error Handling

### R1 — Backup
- JSON inválido no import: capturado em `try/catch` do `JSON.parse`, toast de erro com mensagem descritiva, storage não alterado.
- Array sem campo `id`: detectado por `validateBackupFile`, toast de erro.
- Falha no `localStorage.setItem` durante merge: propagado para o `conversationStore.upsert` existente que já trata quota exceeded com fallback para IDB.

### R2 — Fork
- `messageId` não encontrado em `forkMessagesAt`: retorna cópia completa do array (comportamento seguro).
- Falha no `conversationStore.upsert`: toast de erro via `catch` em `handleMessageAction`.

### R3 — A/B Comparison
- Falha na geração da resposta alternativa: toast de erro, layout A/B removido, conversa original preservada.
- Usuário fecha o modal sem escolher: `action === "ab-cancel"` em `handleMessageAction` remove o layout sem alterar o histórico.

### R4 — Imagens
- Arquivo > 10 MB: `validateImageSize` retorna `false`, toast de erro, `pendingImage` permanece `null`.
- Tipo MIME não aceito: o `accept` do `<input>` filtra no browser; validação adicional no handler para robustez.
- `FileReader` falha: `onerror` handler exibe toast de erro.

### R5 — Templates
- `localStorage` cheio ao salvar template: `try/catch` com toast de aviso.
- Template com nome vazio: validação antes de criar, toast de erro.

### R6 — RAG Indicator
- Evento desconhecido do `rag.subscribe`: `ragIndicatorShouldShow` retorna `false` por padrão (safe).

### R7 — Server Dropdown
- `loadModels()` falha após troca de servidor: o handler existente já exibe toast de erro e atualiza o status pill.

### R8 — Scroll Cache
- `scrollTop` negativo ou NaN: `shouldAutoScroll` trata como distância grande (não auto-scroll), comportamento seguro.

### R9 — Focus Modal
- `renderMarkdown` lança exceção: capturado em `try/catch`, modal exibe o conteúdo bruto como fallback.
- Clipboard API não disponível: `navigator.clipboard.writeText` com `catch` que exibe toast de aviso.

---

## Testing Strategy

### Abordagem dual

Os testes seguem dois eixos complementares:

1. **Testes de propriedade** (property-based): validam as funções puras exportadas pelos módulos usando `fast-check` (já disponível como devDependency). Cada propriedade do design tem um teste correspondente.
2. **Testes de exemplo** (unit tests): validam comportamentos específicos, casos de borda e integrações entre módulos.

Todos os testes são executáveis com `node tests/<arquivo>.test.js` (sem browser, sem Playwright), pois testam apenas lógica pura desacoplada do DOM.

### Biblioteca de property-based testing

**`fast-check`** (já instalada como devDependency em `package.json`). Configuração mínima de 100 iterações por propriedade.

### Arquivo de testes

`tests/feature-improvements.test.js` — arquivo único para todas as 17 propriedades e testes de exemplo das 9 melhorias.

### Estrutura dos testes de propriedade

Cada teste de propriedade referencia a propriedade do design com um comentário:

```js
// Feature: feature-improvements, Property 1: backup filename matches date pattern
fc.assert(
  fc.property(fc.date(), (date) => {
    const name = backupFilename(date);
    return /^offline-ai-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name);
  }),
  { numRuns: 100 }
);
```

### Cobertura por requisito

| Req | Propriedades | Exemplos |
|-----|-------------|---------|
| R1  | P1, P2, P3  | botões presentes no painel |
| R2  | P4, P5      | fork carrega conversa ativa |
| R3  | P6, P7      | menu A/B aparece, layout dois colunas |
| R4  | P8, P9      | preview de imagem, limpeza após envio |
| R5  | P10, P11, P12 | seção templates no painel, menu sidebar |
| R6  | P13         | indicador visível/oculto por evento |
| R7  | P14         | dropdown aparece, seleção atualiza store |
| R8  | P15, P16    | scroll restaurado ao navegar |
| R9  | P17         | modal abre/fecha, overflow do body |

### Testes de exemplo (não-PBT)

Para os critérios classificados como EXAMPLE (UI presence, interações), os testes verificam a lógica de construção de DOM de forma isolada — por exemplo, testando que `createTemplate` retorna o objeto correto antes de qualquer persistência, ou que `mergeConversations` com arrays vazios retorna o esperado.

### Configuração de execução

```bash
node tests/feature-improvements.test.js
```

Sem flags adicionais. O arquivo usa `import` (ES modules) e `fast-check` via `node_modules`.
