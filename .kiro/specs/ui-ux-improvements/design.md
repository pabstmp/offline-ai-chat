# Design Document — UI/UX Improvements

## Overview

Este documento descreve o design técnico para as seis melhorias de UX/UI do **Offline AI Chat**. O projeto é uma SPA em Vanilla JS puro com ES modules nativos, sem build step e sem dependências no cliente. Todas as melhorias devem respeitar essas restrições e integrar-se ao design system existente (tokens CSS em `styles.css`).

As seis melhorias são:

1. **Busca Semântica no Histórico** — busca por similaridade vetorial sobre títulos e mensagens das conversas, com fallback gracioso para busca textual.
2. **Editor Inline de Mensagem** — substituição do fluxo de edição atual por um `<textarea>` inline com preview de markdown em tempo real.
3. **Indicador de Progresso de Geração** — exibição de tok/s e tempo decorrido durante streaming, integrado à linha `.msg-stats` existente.
4. **Chips de Sugestão Dinâmicos** — chips do empty state gerados dinamicamente a partir do `systemPrompt` do perfil ativo.
5. **Feedback Visual ao Copiar Código** — estado "Copiado ✓" temporário no botão `.code-copy` com cor de sucesso.
6. **Rename Inline no Sidebar** — substituição do `prompt()` nativo por um `<input>` inline no item do histórico.

---

## Architecture

O projeto segue uma arquitetura modular com separação clara entre camadas:

```
app.js (orquestrador)
├── modules/ui/chat.js        — renderização de mensagens e streaming
├── modules/ui/sidebar.js     — histórico, busca, ações de conversa
├── modules/ui/composer.js    — textarea, token count, slash commands
├── modules/markdown.js       — renderer markdown + code blocks
├── modules/rag/embedder.js   — geração de embeddings via API
├── modules/rag/retriever.js  — cosine similarity (topK)
└── modules/storage.js        — conversationStore (LS + IDB)
```

**Princípio de modificação mínima**: cada melhoria edita apenas os arquivos diretamente responsáveis pela funcionalidade. Nenhum novo arquivo de módulo é criado — as mudanças são incrementais nos arquivos existentes.

**Fluxo de dados para busca semântica:**

```
historySearch input
  → debounce 400ms
  → [se embeddingModel configurado] embedQuery(query) → Float32Array
  → dot product contra vetores em memória (conversationVectors Map)
  → filtrar por threshold → ordenar por score → renderList()
  → [fallback] busca textual existente
```

---

## Components and Interfaces

### 1. Busca Semântica no Histórico (`modules/ui/sidebar.js`)

**Mudanças no módulo:**

```javascript
// Novo estado interno
let conversationVectors = new Map(); // id → Float32Array
let semanticAbortController = null;
let embedConfig = null; // { baseUrl, apiKey, model } — injetado via initSidebar

// Nova função exportada
export function setEmbedConfig(cfg) { embedConfig = cfg; }

// Modificação em initSidebar: aceitar embedConfig nas opts
// Modificação em refreshSidebar: reconstruir conversationVectors quando necessário
// Modificação em renderList: branch semântico vs textual
```

**Interface de inicialização (chamada em `app.js`):**

```javascript
initSidebar({
  elements, store, conversationStore,
  onSelect, onNew, onAction,
  getEmbedConfig: () => ({           // getter lazy — lê do store no momento da busca
    baseUrl: normalizeBaseUrl(getActiveServer().baseUrl),
    apiKey: getActiveServer().apiKey,
    model: store.get('rag.embeddingModel'),
  }),
});
```

**Indexação lazy de conversas:**

Ao invés de indexar todas as conversas na inicialização (custoso), a indexação ocorre sob demanda:
- Quando o usuário digita no campo de busca com 3+ caracteres
- Apenas conversas ainda não indexadas (não presentes em `conversationVectors`) são processadas
- O texto indexado por conversa é: `conv.title + '\n' + conv.messages.map(m => m.content).join('\n')`

**Indicador de modo semântico:**

Um atributo `data-search-mode="semantic"|"text"` é adicionado ao `#historySearch`. O CSS usa esse atributo para exibir um ícone de "sparkle" via `::after` pseudo-element.

**Threshold de relevância:** `0.35` (cosine similarity normalizada). Conversas com score abaixo são filtradas.

---

### 2. Editor Inline de Mensagem (`modules/ui/chat.js`)

**Mudanças no módulo:**

```javascript
// Novo estado interno
let activeEditor = null; // { node, body, originalContent, textarea, preview }

// Nova função interna
function openInlineEditor(node, body, message) { ... }
function closeInlineEditor(save) { ... }
```

**Estrutura DOM do editor inline:**

```html
<!-- Substitui o conteúdo de .msg-body durante edição -->
<div class="msg-editor">
  <textarea class="msg-editor-textarea">conteúdo original</textarea>
  <div class="msg-editor-preview"><!-- renderMarkdown em tempo real --></div>
  <div class="msg-editor-actions">
    <button class="btn btn-sm btn-secondary" data-act="cancel">Cancelar</button>
    <button class="btn btn-sm btn-primary" data-act="save">Salvar</button>
  </div>
</div>
```

**Integração com `onAction`:**

O handler `edit` existente em `renderMessage` chama `openInlineEditor`. O `onAction` em `app.js` não precisa mudar para o fluxo de edição — a lógica de salvar/cancelar é encapsulada em `chat.js`. Apenas ao salvar, `onAction({ action: 'edit-save', messageId, content: newContent })` é disparado para que `app.js` persista a mudança na conversa.

**Preview em tempo real:**

```javascript
textarea.addEventListener('input', () => {
  preview.replaceChildren(renderMarkdown(textarea.value));
});
```

**Atalhos de teclado:**

```javascript
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeInlineEditor(false); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeInlineEditor(true); }
});
```

---

### 3. Indicador de Progresso de Geração (`modules/ui/chat.js` + `app.js`)

**Abordagem:** Um elemento `<div class="msg-progress">` é inserido dentro do `.msg-body` durante o streaming, acima do conteúdo. Ao finalizar, é removido e os dados são incorporados ao `.msg-stats` existente.

**Novo elemento DOM durante streaming:**

```html
<div class="msg-progress" aria-live="polite">
  <span class="msg-progress-time">0s</span>
  <span class="msg-progress-tps"></span>
</div>
```

**Interface de controle (novas funções exportadas em `chat.js`):**

```javascript
export function startGenerationTimer(body) {
  // Cria o elemento .msg-progress, inicia setInterval de 1s
  // Retorna handle { stop, getElapsed, getTokenCount, setTokenCount }
}

export function stopGenerationTimer(handle) {
  // Para o interval, remove .msg-progress
}
```

**Integração em `app.js` (`submitMessage`):**

```javascript
const timerHandle = startGenerationTimer(assistantBody);
// ... durante streaming:
timerHandle.setTokenCount(estimatedTokens);
// ... ao finalizar:
stopGenerationTimer(timerHandle);
finalizeAssistant(assistantBody, content, false, reasoning, { usage, finishReason, elapsed: timerHandle.getElapsed() });
```

**Cálculo de tok/s:**

```javascript
const tps = tokenCount / (elapsedMs / 1000);
```

O `tokenCount` durante streaming é estimado via `estimateTokens(fullContent)` (já disponível em `markdown.js`). Ao finalizar, se `usage.completion_tokens` estiver disponível, o valor final usa o dado real da API.

---

### 4. Chips de Sugestão Dinâmicos (`app.js`)

**Abordagem:** A função `refreshChips()` existente em `app.js` é expandida para também atualizar os chips do empty state. Os chips estáticos no `index.html` são removidos e substituídos por geração dinâmica.

**Catálogo de sugestões:**

```javascript
// Em app.js — constante local
const SUGGESTION_CATALOG = {
  dev: [
    { label: 'Revisar este código', prompt: 'Revise o código a seguir e aponte melhorias de qualidade, performance e segurança.' },
    { label: 'Escrever testes', prompt: 'Escreva testes unitários para o código a seguir, cobrindo casos de sucesso e de erro.' },
    { label: 'Explicar este erro', prompt: 'Explique o seguinte erro e sugira como corrigi-lo:' },
    { label: 'Refatorar função', prompt: 'Refatore a função a seguir para melhorar legibilidade e manutenibilidade.' },
    { label: 'Documentar código', prompt: 'Adicione documentação clara (JSDoc/docstring) ao código a seguir.' },
  ],
  general: [
    { label: 'Resumir um projeto', prompt: 'Resuma este projeto e sugira próximos passos.' },
    { label: 'Planejar estudos', prompt: 'Crie um plano objetivo para estudar IA local no meu desktop.' },
    { label: 'Escrever melhor', prompt: 'Me ajude a escrever uma resposta técnica curta e clara.' },
    { label: 'Brainstorm de ideias', prompt: 'Me ajude a gerar ideias criativas para o seguinte problema:' },
    { label: 'Analisar prós e contras', prompt: 'Liste os prós e contras da seguinte decisão:' },
  ],
};

const DEV_KEYWORDS = ['código', 'code', 'engenheiro', 'engineer', 'developer', 'desenvolvedor',
  'python', 'typescript', 'javascript', 'react', 'vue', 'angular', 'rust', 'go', 'java',
  'programação', 'programming', 'software', 'api', 'backend', 'frontend', 'fullstack'];
```

**Função de classificação:**

```javascript
function classifyProfile(profile) {
  if (!profile?.systemPrompt) return 'general';
  const lower = profile.systemPrompt.toLowerCase();
  return DEV_KEYWORDS.some(kw => lower.includes(kw)) ? 'dev' : 'general';
}

function getChipsForProfile(profile) {
  const category = classifyProfile(profile);
  const pool = SUGGESTION_CATALOG[category];
  // Seleciona 3 chips (índices fixos para consistência — sem randomização)
  return pool.slice(0, 3);
}
```

**Atualização do DOM:**

```javascript
function refreshSuggestionChips() {
  const profile = getActiveProfile();
  const chips = getChipsForProfile(profile);
  const container = elements.emptyState.querySelector('.suggestions');
  container.replaceChildren();
  for (const chip of chips) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggestion-chip';
    btn.dataset.prompt = chip.prompt;
    btn.textContent = chip.label;
    btn.addEventListener('click', () => {
      setComposerValue(chip.prompt);
      focusComposer();
    });
    container.appendChild(btn);
  }
}
```

`refreshSuggestionChips()` é chamada em `refreshChips()` e também quando o perfil ativo muda.

---

### 5. Feedback Visual ao Copiar Código (`modules/markdown.js`)

**Mudança mínima:** O handler do `copyBtn` em `renderMarkdown` é atualizado para:

```javascript
copyBtn.addEventListener('click', () => {
  if (!navigator.clipboard) return; // fallback: sem feedback visual
  navigator.clipboard.writeText(code.textContent || '').then(() => {
    copyBtn.textContent = 'Copiado ✓';
    copyBtn.classList.add('code-copy--success');
    copyBtn.dataset.copying = 'true'; // mantém visível via CSS
    setTimeout(() => {
      copyBtn.textContent = 'Copiar';
      copyBtn.classList.remove('code-copy--success');
      delete copyBtn.dataset.copying;
    }, 2000);
  });
});
```

**CSS adicional em `styles.css`:**

```css
.code-copy--success {
  color: var(--success);
  border-color: var(--success);
  opacity: 1; /* sobrescreve o opacity:0 do estado padrão */
}

/* Mantém visível enquanto no estado de feedback */
.msg-body pre:has(.code-copy[data-copying]) .code-copy {
  opacity: 1;
}
```

O estado de cada botão é completamente independente — cada `copyBtn` é uma closure separada com seu próprio `setTimeout`.

---

### 6. Rename Inline no Sidebar (`modules/ui/sidebar.js` + `app.js`)

**Mudança em `sidebar.js`:** A função `renderItem` é modificada para suportar o modo de edição inline. O `onAction` com `action: 'rename'` agora é interceptado internamente em `sidebar.js` antes de chegar ao `app.js`.

**Novo fluxo:**

```javascript
// Em sidebar.js — intercepta 'rename' antes de propagar
function handleRenameAction(conv, titleEl) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'history-item-rename';
  input.value = conv.title || '';
  
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  
  const commit = async () => {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== conv.title) {
      conv.title = newTitle;
      conv.updatedAt = Date.now();
      await conversationStore.upsert(conv);
      onAction({ action: 'rename-done', conversation: conv }); // notifica app.js
    }
    // Restaura o span de título (re-render do item)
    refreshSidebar();
  };
  
  const cancel = () => refreshSidebar(); // re-render restaura o span original
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  
  input.addEventListener('blur', () => {
    // blur sem Enter/Escape → salva se mudou e não está vazio
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== conv.title) commit();
    else cancel();
  });
}
```

**Mudança em `app.js`:** O `handleSidebarAction` remove o `prompt()` do caso `'rename'` — a lógica migra para `sidebar.js`. O `app.js` apenas reage ao `'rename-done'` para atualizar o título da conversa ativa se necessário.

---

## Data Models

### Vetores de Conversas (busca semântica)

```javascript
// Em memória apenas — não persistido
conversationVectors: Map<string, Float32Array>
// key: conversation.id
// value: vetor L2-normalizado gerado por embedQuery(textForConversation(conv))
```

**Texto indexado por conversa:**

```javascript
function textForConversation(conv) {
  const title = conv.title || '';
  const messages = (conv.messages || [])
    .slice(0, 20)                          // limita a 20 mensagens para não explodir o embedding
    .map(m => m.content || '')
    .join('\n');
  return `${title}\n${messages}`.slice(0, 4000); // limita a 4000 chars
}
```

### Estado do Editor Inline

```javascript
// Em memória — módulo chat.js
activeEditor: {
  node: HTMLElement,        // .msg article
  body: HTMLElement,        // .msg-body
  originalContent: string,  // conteúdo antes da edição
  textarea: HTMLTextAreaElement,
  preview: HTMLElement,
} | null
```

### Estado do Timer de Geração

```javascript
// Retornado por startGenerationTimer — não persistido
timerHandle: {
  stop: () => void,
  getElapsed: () => number,    // ms
  getTokenCount: () => number,
  setTokenCount: (n: number) => void,
}
```

---

## Correctness Properties

*Uma propriedade é uma característica ou comportamento que deve ser verdadeiro em todas as execuções válidas do sistema — essencialmente, uma declaração formal sobre o que o sistema deve fazer. Propriedades servem como ponte entre especificações legíveis por humanos e garantias de correção verificáveis por máquina.*

### Property 1: Ordenação e filtragem de resultados semânticos

*Para qualquer* array de resultados de busca semântica com scores associados e um threshold T, após aplicar a filtragem e ordenação: (a) todos os resultados retornados devem ter score >= T, e (b) os scores devem estar em ordem decrescente.

**Validates: Requirements 1.4**

---

### Property 2: Fallback para busca textual em caso de erro

*Para qualquer* erro lançado durante a busca semântica (erro de rede, modelo indisponível, embedding inválido), o sistema deve executar a busca textual existente e retornar resultados equivalentes à busca textual pura para a mesma query.

**Validates: Requirements 1.6**

---

### Property 3: Texto indexado contém título e mensagens

*Para qualquer* conversa com título e mensagens, o texto gerado para embedding (`textForConversation`) deve conter o título da conversa e o conteúdo de pelo menos uma mensagem.

**Validates: Requirements 1.7**

---

### Property 4: Editor inline preserva conteúdo original ao cancelar

*Para qualquer* mensagem com qualquer conteúdo, após abrir o editor inline, editar o texto e cancelar (via botão Cancelar ou tecla Escape), o conteúdo exibido no `.msg-body` deve ser idêntico ao conteúdo original antes da edição.

**Validates: Requirements 2.5, 2.6**

---

### Property 5: Editor inline exibe o conteúdo original ao abrir

*Para qualquer* mensagem, ao abrir o editor inline, o `<textarea>` deve conter exatamente o conteúdo original da mensagem (sem transformações).

**Validates: Requirements 2.1**

---

### Property 6: Apenas um editor inline ativo por vez

*Para qualquer* sequência de aberturas de editor inline em diferentes mensagens, ao abrir o editor em uma mensagem, qualquer editor previamente aberto em outra mensagem deve ser fechado — resultando em exatamente um editor ativo no DOM.

**Validates: Requirements 2.8**

---

### Property 7: Cálculo correto de tok/s

*Para qualquer* par (tokenCount, elapsedMs) com tokenCount >= 1 e elapsedMs > 0, o valor de tok/s calculado deve ser igual a `tokenCount / (elapsedMs / 1000)` com precisão de 1 casa decimal.

**Validates: Requirements 3.2**

---

### Property 8: Chips refletem a categoria do perfil

*Para qualquer* perfil com `systemPrompt` contendo palavras-chave de desenvolvimento, `getChipsForProfile(profile)` deve retornar chips da categoria `dev`. *Para qualquer* perfil sem palavras-chave de desenvolvimento (incluindo perfil null ou sem systemPrompt), deve retornar chips da categoria `general`.

**Validates: Requirements 4.2, 4.3, 4.5**

---

### Property 9: Número de chips dentro dos limites

*Para qualquer* perfil (incluindo null, sem systemPrompt, com systemPrompt de dev, com systemPrompt geral), `getChipsForProfile(profile)` deve retornar entre 3 e 5 chips.

**Validates: Requirements 4.6**

---

### Property 10: Click em chip preenche o composer com o prompt correto

*Para qualquer* chip com `data-prompt`, após um click no chip, o valor do composer (`promptInput.value`) deve ser igual ao `data-prompt` do chip.

**Validates: Requirements 4.7**

---

### Property 11: Estados de cópia são independentes entre code blocks

*Para qualquer* N code blocks visíveis (N >= 2), clicar no botão de cópia de um code block não deve alterar o estado (`textContent`, `classList`, `dataset.copying`) dos botões dos outros code blocks.

**Validates: Requirements 5.6**

---

### Property 12: Inline rename preserva título original ao cancelar

*Para qualquer* conversa com qualquer título, após abrir o inline rename, editar o texto e pressionar Escape, o título da conversa deve ser idêntico ao título original.

**Validates: Requirements 6.4**

---

### Property 13: Inline rename rejeita títulos vazios ou só whitespace

*Para qualquer* string composta apenas de whitespace (incluindo string vazia), ao confirmar o inline rename com esse valor, o título da conversa deve permanecer inalterado.

**Validates: Requirements 6.6**

---

### Property 14: Inline rename persiste o novo título com updatedAt atualizado

*Para qualquer* conversa e qualquer novo título válido (não-vazio, não-whitespace), após confirmar o inline rename, `conversationStore.get(conv.id).title` deve ser igual ao novo título e `updatedAt` deve ser maior ou igual ao `updatedAt` anterior.

**Validates: Requirements 6.7**

---

### Property 15: Inline rename exibe o título atual ao abrir

*Para qualquer* conversa com qualquer título, ao abrir o inline rename, o `<input>` deve conter exatamente o título atual da conversa.

**Validates: Requirements 6.1**

---

## Error Handling

### Busca Semântica

| Cenário | Comportamento |
|---|---|
| `embedQuery` lança erro de rede | Silenciosamente executa busca textual; sem toast |
| Modelo de embedding não configurado | Executa busca textual diretamente; sem indicador semântico |
| `embedQuery` retorna vetor com dimensão diferente | Ignora o vetor; executa busca textual |
| Busca cancelada por nova digitação | `AbortController.abort()` no request anterior; sem erro visível |
| Conversa sem mensagens | `textForConversation` retorna apenas o título; indexação continua |

### Editor Inline

| Cenário | Comportamento |
|---|---|
| `onAction` lança erro ao salvar | Toast de erro; editor permanece aberto para nova tentativa |
| Mensagem deletada enquanto editor está aberto | `closeInlineEditor(false)` chamado pelo handler de delete |
| Streaming ativo na mesma mensagem | Botão "Editar" desabilitado enquanto `runtime.busy === true` |

### Timer de Geração

| Cenário | Comportamento |
|---|---|
| `stopGenerationTimer` chamado sem `startGenerationTimer` | No-op seguro |
| Streaming interrompido pelo usuário | `stopGenerationTimer` chamado no bloco `catch (AbortError)` |
| `usage` ausente ao finalizar | Exibe apenas tempo e tok/s estimado; sem campos ausentes |

### Rename Inline

| Cenário | Comportamento |
|---|---|
| `conversationStore.upsert` lança erro | Toast de erro; título não é atualizado no DOM |
| Blur disparado após Enter (double-commit) | Flag `committed` previne dupla persistência |
| Rename em conversa deletada concorrentemente | `upsert` cria nova entrada; `refreshSidebar` normaliza |

---

## Testing Strategy

### Abordagem Dual

Cada melhoria é coberta por dois tipos de teste complementares:

- **Testes unitários (exemplos)**: verificam comportamentos específicos, casos de borda e integrações entre componentes.
- **Testes de propriedade (PBT)**: verificam propriedades universais que devem valer para qualquer entrada válida.

### Framework de PBT

**fast-check** (disponível via `node_modules` para testes — não é dependência do cliente). Configuração mínima: 100 iterações por propriedade.

```javascript
// Exemplo de tag de propriedade
// Feature: ui-ux-improvements, Property 1: Ordenação e filtragem de resultados semânticos
import fc from 'fast-check';
```

### Testes Unitários (Exemplos)

**Busca Semântica:**
- Sem modelo configurado → busca textual executada normalmente
- Query com 3+ chars e modelo configurado → indicador de carregamento visível
- Modo semântico ativo → atributo `data-search-mode="semantic"` presente no input

**Editor Inline:**
- Clicar em "Editar" → textarea com foco e conteúdo original
- Botões "Salvar" e "Cancelar" presentes no DOM durante edição
- `Ctrl+Enter` → mesmo resultado que clicar "Salvar"
- Foco automático no textarea ao abrir

**Timer de Geração:**
- Após 1s, 2s, 3s de streaming → tempo exibido atualizado
- Após finalizar → valores não mudam mais
- `usage` null → apenas tempo e tok/s na linha de stats

**Chips Dinâmicos:**
- Trocar perfil → chips atualizados sem reload
- Perfil null → chips padrão (general)

**Feedback de Cópia:**
- Click → texto muda para "Copiado ✓"; após 2s → volta para "Copiar"
- `navigator.clipboard` undefined → sem feedback visual de sucesso
- Durante os 2s → botão permanece visível independente de hover

**Rename Inline:**
- Abrir rename → input com foco e texto selecionado
- Renomear conversa ativa → título atualizado no item sem refresh completo

### Testes de Propriedade (PBT)

Cada propriedade listada na seção "Correctness Properties" deve ser implementada como um único teste de propriedade com `fc.assert(fc.property(...))`, mínimo 100 iterações.

**Geradores relevantes:**

```javascript
// Conversa arbitrária
const arbConversation = fc.record({
  id: fc.string({ minLength: 1 }),
  title: fc.string(),
  messages: fc.array(fc.record({
    role: fc.constantFrom('user', 'assistant'),
    content: fc.string(),
  }), { maxLength: 20 }),
  updatedAt: fc.integer({ min: 0 }),
});

// Score de similaridade
const arbScore = fc.float({ min: -1, max: 1 });

// Resultado de busca semântica
const arbSearchResult = fc.record({
  id: fc.string({ minLength: 1 }),
  title: fc.string(),
  score: arbScore,
});

// Perfil com systemPrompt
const arbProfile = fc.record({
  id: fc.string({ minLength: 1 }),
  name: fc.string(),
  systemPrompt: fc.option(fc.string(), { nil: undefined }),
});

// Par (tokenCount, elapsedMs) válido para tok/s
const arbTokenTime = fc.record({
  tokenCount: fc.integer({ min: 1, max: 100000 }),
  elapsedMs: fc.integer({ min: 1, max: 3600000 }),
});
```

**Configuração de cada teste:**

```javascript
fc.assert(
  fc.property(/* geradores */, (/* args */) => {
    // arrange + act + assert
  }),
  { numRuns: 100 }
);
```

### Cobertura por Requisito

| Requisito | Tipo de Teste | Propriedade/Exemplo |
|---|---|---|
| 1.4 Ordenação semântica | PBT | Property 1 |
| 1.6 Fallback em erro | PBT | Property 2 |
| 1.7 Texto indexado | PBT | Property 3 |
| 2.1 Conteúdo original no editor | PBT | Property 5 |
| 2.5/2.6 Cancelar restaura original | PBT | Property 4 |
| 2.8 Um editor por vez | PBT | Property 6 |
| 3.2 Cálculo tok/s | PBT | Property 7 |
| 4.2/4.3/4.5 Chips por categoria | PBT | Property 8 |
| 4.6 Número de chips | PBT | Property 9 |
| 4.7 Click preenche composer | PBT | Property 10 |
| 5.6 Estados independentes | PBT | Property 11 |
| 6.1 Input com título atual | PBT | Property 15 |
| 6.4 Escape cancela rename | PBT | Property 12 |
| 6.6 Rejeita título vazio | PBT | Property 13 |
| 6.7 Persiste com updatedAt | PBT | Property 14 |
