# Implementation Plan: UI/UX Improvements — Offline AI Chat

## Overview

Implementação incremental das seis melhorias de UX/UI em Vanilla JS puro (ES modules, sem build step). Cada melhoria edita apenas os arquivos diretamente responsáveis pela funcionalidade, seguindo o princípio de modificação mínima do design. Os testes usam **fast-check** para propriedades e Node.js nativo para testes unitários.

## Tasks

- [x] 1. Configurar ambiente de testes
  - Instalar `fast-check` como devDependency: `npm install --save-dev fast-check`
  - Criar `tests/` na raiz do projeto com um `package.json` de tipo `module`
  - Adicionar script `"test": "node --experimental-vm-modules node_modules/.bin/jest --testPathPattern=tests/"` ou equivalente com Node test runner nativo
  - Verificar que `fast-check` importa corretamente em um arquivo de teste de smoke test
  - _Requirements: todos (infraestrutura de testes)_

- [x] 2. Melhoria 5: Feedback visual ao copiar código (`modules/markdown.js`)
  - [x] 2.1 Atualizar o handler do `copyBtn` em `renderMarkdown` para exibir "Copiado ✓" por 2 segundos
    - Usar `navigator.clipboard.writeText(...).then(...)` para exibir feedback apenas em caso de sucesso
    - Adicionar classe `code-copy--success` e atributo `data-copying="true"` ao botão durante o feedback
    - Remover classe e atributo após 2000ms via `setTimeout`
    - Manter o comportamento de fallback existente quando `navigator.clipboard` não está disponível
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.2 Adicionar estilos CSS para o estado de feedback em `styles.css`
    - Adicionar regra `.code-copy--success` com `color: var(--success)` e `border-color: var(--success)`
    - Adicionar regra para manter `opacity: 1` enquanto `data-copying` estiver presente no botão
    - _Requirements: 5.4_

  - [ ]* 2.3 Escrever testes unitários para o feedback de cópia
    - Testar que após click o texto muda para "Copiado ✓" e volta para "Copiar" após 2s (com fake timers)
    - Testar que `navigator.clipboard` ausente não exibe feedback visual
    - _Requirements: 5.1, 5.3, 5.5_

  - [ ]* 2.4 Escrever property test para independência de estados entre code blocks
    - **Property 11: Estados de cópia são independentes entre code blocks**
    - **Validates: Requirements 5.6**

- [x] 3. Melhoria 6: Rename inline no sidebar (`modules/ui/sidebar.js` + `app.js`)
  - [x] 3.1 Implementar `handleRenameAction(conv, titleEl)` em `sidebar.js`
    - Criar `<input type="text" class="history-item-rename">` com o título atual pré-preenchido
    - Substituir o `titleEl` pelo input via `titleEl.replaceWith(input)`
    - Chamar `input.focus()` e `input.select()` imediatamente após inserção
    - Implementar `commit()`: salva se título não-vazio e diferente do original, chama `conversationStore.upsert(conv)`, dispara `onAction({ action: 'rename-done', conversation: conv })`, chama `refreshSidebar()`
    - Implementar `cancel()`: chama `refreshSidebar()` para restaurar o span original
    - Adicionar flag `committed` para evitar dupla persistência em blur após Enter
    - Tratar `keydown`: Enter → `commit()`, Escape → `cancel()`
    - Tratar `blur`: salva se título mudou e não está vazio, senão cancela
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 3.2 Interceptar a ação `'rename'` em `openMenu` dentro de `sidebar.js`
    - Modificar o listener do botão "Renomear" no menu de contexto para chamar `handleRenameAction` diretamente, passando o `titleEl` do item correspondente
    - Fechar o menu antes de abrir o input inline
    - _Requirements: 6.1_

  - [x] 3.3 Atualizar `handleSidebarAction` em `app.js` para remover o `prompt()` nativo
    - Remover o bloco `if (action === 'rename') { const next = prompt(...) ... }` existente
    - Adicionar handler para `'rename-done'`: se a conversa renomeada for a conversa ativa, atualizar o título em `runtime.currentConversation` sem recarregar a lista
    - _Requirements: 6.7, 6.8_

  - [x] 3.4 Adicionar estilos CSS para o input de rename inline em `styles.css`
    - Adicionar regra `.history-item-rename` com largura total, fundo transparente, borda de foco com `var(--accent)`, sem outline padrão
    - _Requirements: 6.9_

  - [ ]* 3.5 Escrever testes unitários para o rename inline
    - Testar que o input recebe foco e texto selecionado ao abrir
    - Testar que Enter salva e Escape cancela
    - Testar que título vazio não persiste
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

  - [ ]* 3.6 Escrever property test: rename preserva título ao cancelar
    - **Property 12: Inline rename preserva título original ao cancelar**
    - **Validates: Requirements 6.4**

  - [ ]* 3.7 Escrever property test: rename rejeita títulos vazios
    - **Property 13: Inline rename rejeita títulos vazios ou só whitespace**
    - **Validates: Requirements 6.6**

  - [ ]* 3.8 Escrever property test: rename persiste com updatedAt atualizado
    - **Property 14: Inline rename persiste o novo título com updatedAt atualizado**
    - **Validates: Requirements 6.7**

  - [ ]* 3.9 Escrever property test: input exibe título atual ao abrir
    - **Property 15: Inline rename exibe o título atual ao abrir**
    - **Validates: Requirements 6.1**

- [x] 4. Checkpoint — Melhorias 5 e 6
  - Garantir que todos os testes das melhorias 5 e 6 passam. Verificar manualmente no browser que o botão "Copiar" exibe "Copiado ✓" e que o rename inline funciona sem `prompt()`. Perguntar ao usuário se há dúvidas antes de continuar.

- [x] 5. Melhoria 4: Chips de sugestão dinâmicos e contextuais (`app.js` + `index.html`)
  - [x] 5.1 Adicionar constante `SUGGESTION_CATALOG` e array `DEV_KEYWORDS` em `app.js`
    - Definir `SUGGESTION_CATALOG.dev` com 5 sugestões de desenvolvimento (label + prompt)
    - Definir `SUGGESTION_CATALOG.general` com 5 sugestões gerais (label + prompt)
    - Definir `DEV_KEYWORDS` com as palavras-chave listadas no design
    - _Requirements: 4.2, 4.3_

  - [x] 5.2 Implementar `classifyProfile(profile)` e `getChipsForProfile(profile)` em `app.js`
    - `classifyProfile`: retorna `'dev'` se `systemPrompt` contém alguma keyword, senão `'general'`; retorna `'general'` para perfil null ou sem `systemPrompt`
    - `getChipsForProfile`: retorna `pool.slice(0, 3)` do catálogo correspondente
    - _Requirements: 4.2, 4.3, 4.5, 4.6_

  - [x] 5.3 Implementar `refreshSuggestionChips()` em `app.js` e integrá-la ao fluxo existente
    - Criar função que lê `getActiveProfile()`, obtém chips via `getChipsForProfile`, reconstrói o DOM do `.suggestions` via `container.replaceChildren()`
    - Cada chip: `<button class="suggestion-chip" data-prompt="...">label</button>` com listener que chama `setComposerValue(chip.prompt)` e `focusComposer()`
    - Chamar `refreshSuggestionChips()` dentro de `refreshChips()` (já chamada ao trocar perfil)
    - Chamar `refreshSuggestionChips()` na inicialização do app
    - _Requirements: 4.1, 4.4, 4.7_

  - [x] 5.4 Remover os chips estáticos do `index.html`
    - Remover os três `<button class="suggestion-chip">` hardcoded dentro de `<div class="suggestions">`
    - Manter o `<div class="suggestions">` vazio para ser preenchido dinamicamente
    - _Requirements: 4.1_

  - [ ]* 5.5 Escrever testes unitários para chips dinâmicos
    - Testar que trocar perfil atualiza os chips sem reload
    - Testar que perfil null retorna chips `general`
    - Testar que click em chip preenche o composer com o prompt correto
    - _Requirements: 4.4, 4.5, 4.7_

  - [ ]* 5.6 Escrever property test: chips refletem a categoria do perfil
    - **Property 8: Chips refletem a categoria do perfil**
    - **Validates: Requirements 4.2, 4.3, 4.5**

  - [ ]* 5.7 Escrever property test: número de chips dentro dos limites
    - **Property 9: Número de chips dentro dos limites**
    - **Validates: Requirements 4.6**

  - [ ]* 5.8 Escrever property test: click em chip preenche o composer
    - **Property 10: Click em chip preenche o composer com o prompt correto**
    - **Validates: Requirements 4.7**

- [x] 6. Melhoria 2: Editor inline de mensagem (`modules/ui/chat.js` + `app.js`)
  - [x] 6.1 Adicionar estado `activeEditor` e implementar `openInlineEditor(node, body, message)` em `chat.js`
    - Declarar `let activeEditor = null` no escopo do módulo
    - `openInlineEditor`: se `activeEditor` não for null, fechar o editor anterior via `closeInlineEditor(false)` antes de abrir o novo
    - Criar estrutura DOM `.msg-editor` com `<textarea class="msg-editor-textarea">`, `<div class="msg-editor-preview">` e botões "Cancelar"/"Salvar"
    - Salvar `originalContent` no `activeEditor`
    - Chamar `textarea.focus()` após inserção no DOM
    - _Requirements: 2.1, 2.3, 2.8, 2.9_

  - [x] 6.2 Implementar `closeInlineEditor(save)` em `chat.js`
    - Se `save === true`: disparar `onAction({ action: 'edit-save', messageId, content: textarea.value })` e atualizar o `.msg-body` com `renderMarkdown(textarea.value)`
    - Se `save === false`: restaurar o `.msg-body` com o `originalContent` via `setBodyContent`
    - Limpar `activeEditor = null`
    - _Requirements: 2.4, 2.5_

  - [x] 6.3 Adicionar preview de markdown em tempo real no editor inline
    - Listener `input` no textarea: `preview.replaceChildren(renderMarkdown(textarea.value))`
    - Renderizar preview inicial com o conteúdo original ao abrir
    - _Requirements: 2.2_

  - [x] 6.4 Adicionar atalhos de teclado no editor inline
    - `keydown` no textarea: Escape → `closeInlineEditor(false)`, Ctrl+Enter / Cmd+Enter → `closeInlineEditor(true)`
    - _Requirements: 2.6, 2.7_

  - [x] 6.5 Conectar o handler `'edit'` existente em `renderMessage` ao `openInlineEditor`
    - Modificar o listener do botão "Editar" em `renderMessage` para chamar `openInlineEditor(node, body, message)` em vez de disparar `onAction`
    - _Requirements: 2.1_

  - [x] 6.6 Atualizar `handleSidebarAction` / `onAction` em `app.js` para tratar `'edit-save'`
    - Adicionar handler para `action === 'edit-save'`: encontrar a mensagem por `messageId` em `runtime.currentConversation.messages`, atualizar `content`, chamar `saveCurrentConversation()`
    - _Requirements: 2.4_

  - [x] 6.7 Adicionar estilos CSS para o editor inline em `styles.css`
    - `.msg-editor`: `display: flex; flex-direction: column; gap: var(--s-2); width: 100%`
    - `.msg-editor-textarea`: herda estilos do composer, `min-height: 80px; max-height: 40vh; resize: vertical`
    - `.msg-editor-preview`: `padding: var(--s-2) var(--s-3); background: var(--bg-2); border-radius: var(--r-md); min-height: 40px`
    - `.msg-editor-actions`: `display: flex; gap: var(--s-2); justify-content: flex-end`
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 6.8 Escrever testes unitários para o editor inline
    - Testar que clicar em "Editar" abre o textarea com o conteúdo original e foco
    - Testar que Ctrl+Enter salva e Escape cancela
    - Testar que botões "Salvar" e "Cancelar" estão presentes no DOM durante edição
    - _Requirements: 2.1, 2.3, 2.6, 2.7, 2.9_

  - [ ]* 6.9 Escrever property test: editor preserva conteúdo original ao cancelar
    - **Property 4: Editor inline preserva conteúdo original ao cancelar**
    - **Validates: Requirements 2.5, 2.6**

  - [ ]* 6.10 Escrever property test: editor exibe conteúdo original ao abrir
    - **Property 5: Editor inline exibe o conteúdo original ao abrir**
    - **Validates: Requirements 2.1**

  - [ ]* 6.11 Escrever property test: apenas um editor ativo por vez
    - **Property 6: Apenas um editor inline ativo por vez**
    - **Validates: Requirements 2.8**

- [x] 7. Checkpoint — Melhorias 2, 4 e 6
  - Garantir que todos os testes das melhorias 2, 4 e 6 passam. Verificar no browser que chips mudam ao trocar perfil e que o editor inline abre/fecha corretamente. Perguntar ao usuário se há dúvidas antes de continuar.

- [x] 8. Melhoria 3: Indicador de progresso de geração (`modules/ui/chat.js` + `app.js`)
  - [x] 8.1 Implementar `startGenerationTimer(body)` em `chat.js`
    - Criar elemento `<div class="msg-progress" aria-live="polite">` com `<span class="msg-progress-time">0s</span>` e `<span class="msg-progress-tps"></span>`
    - Inserir o elemento no início do `body` (antes do conteúdo de streaming)
    - Iniciar `setInterval` de 1000ms que atualiza o tempo decorrido e recalcula tok/s
    - Retornar handle `{ stop, getElapsed, getTokenCount, setTokenCount }`
    - _Requirements: 3.1, 3.2, 3.5_

  - [x] 8.2 Implementar `stopGenerationTimer(handle)` em `chat.js`
    - Parar o `setInterval` via `clearInterval`
    - Remover o elemento `.msg-progress` do DOM
    - Ser no-op seguro se `handle` for null/undefined
    - _Requirements: 3.3_

  - [x] 8.3 Exportar `startGenerationTimer` e `stopGenerationTimer` de `chat.js`
    - Adicionar as funções às exportações do módulo
    - _Requirements: 3.1, 3.3_

  - [x] 8.4 Integrar o timer em `submitMessage` em `app.js`
    - Importar `startGenerationTimer` e `stopGenerationTimer` de `chat.js`
    - Chamar `startGenerationTimer(assistantBody)` logo após criar o placeholder do assistente
    - Durante o callback de streaming: chamar `timerHandle.setTokenCount(estimateTokens(full.content))`
    - Chamar `stopGenerationTimer(timerHandle)` antes de `finalizeAssistant` (tanto no bloco de sucesso quanto no `catch`)
    - Passar `elapsed: timerHandle.getElapsed()` no objeto `meta` de `finalizeAssistant`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 8.5 Atualizar `finalizeAssistant` em `chat.js` para incorporar `elapsed` na linha `.msg-stats`
    - Modificar `buildStatsLine(meta)` para incluir tempo decorrido e tok/s final quando `meta.elapsed` estiver disponível
    - Usar `usage.completion_tokens` para tok/s final se disponível; senão usar a estimativa do timer
    - Não duplicar campos já exibidos pelo timer
    - _Requirements: 3.4, 3.6_

  - [x] 8.6 Adicionar estilos CSS para o indicador de progresso em `styles.css`
    - `.msg-progress`: `display: flex; gap: var(--s-2); align-items: center; font-size: var(--fs-xs); font-family: var(--font-mono); color: var(--fg-2); margin-bottom: var(--s-2)`
    - `.msg-progress-tps`: mesma família e cor
    - _Requirements: 3.5_

  - [ ]* 8.7 Escrever testes unitários para o timer de geração
    - Testar que após 1s, 2s, 3s o tempo exibido é atualizado (com fake timers)
    - Testar que após `stopGenerationTimer` os valores não mudam mais
    - Testar que `usage` null resulta em apenas tempo e tok/s estimado na linha de stats
    - _Requirements: 3.1, 3.3, 3.6_

  - [ ]* 8.8 Escrever property test: cálculo correto de tok/s
    - **Property 7: Cálculo correto de tok/s**
    - **Validates: Requirements 3.2**

- [x] 9. Melhoria 1: Busca semântica no histórico (`modules/ui/sidebar.js` + `app.js`)
  - [x] 9.1 Adicionar estado interno e função `setEmbedConfig` em `sidebar.js`
    - Declarar `let conversationVectors = new Map()` e `let semanticAbortController = null` e `let embedConfig = null`
    - Exportar `setEmbedConfig(cfg)` que atualiza `embedConfig`
    - Modificar `initSidebar` para aceitar `getEmbedConfig` nas opts e armazená-la
    - _Requirements: 1.1, 1.2_

  - [x] 9.2 Implementar `textForConversation(conv)` em `sidebar.js`
    - Concatenar título + conteúdo das primeiras 20 mensagens, limitado a 4000 chars
    - _Requirements: 1.7_

  - [x] 9.3 Implementar indexação lazy e busca semântica em `sidebar.js`
    - Modificar o listener do `historySearch` para: se query tem 3+ chars e `embedConfig` disponível, executar busca semântica com debounce de 400ms; senão executar busca textual
    - Implementar `semanticSearch(query)`: cancelar busca anterior via `AbortController`, exibir indicador de carregamento, indexar conversas não presentes em `conversationVectors`, calcular dot product, filtrar por threshold `0.35`, ordenar por score decrescente
    - Em caso de erro: silenciosamente executar busca textual (sem toast)
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [x] 9.4 Adicionar indicador visual de modo semântico em `sidebar.js` e `styles.css`
    - Adicionar atributo `data-search-mode="semantic"` ao `#historySearch` quando busca semântica estiver ativa
    - Adicionar atributo `data-search-mode="text"` quando em modo textual
    - Adicionar CSS: `#historySearch[data-search-mode="semantic"]::after` com ícone de sparkle (✦) via pseudo-element ou classe auxiliar
    - _Requirements: 1.8_

  - [x] 9.5 Integrar `getEmbedConfig` em `app.js` ao inicializar o sidebar
    - Modificar a chamada de `initSidebar` em `app.js` para passar `getEmbedConfig: () => ({ baseUrl: normalizeBaseUrl(getActiveServer().baseUrl), apiKey: getActiveServer().apiKey, model: store.get('rag.embeddingModel') })`
    - Importar `setEmbedConfig` de `sidebar.js` se necessário para atualizações dinâmicas
    - _Requirements: 1.1, 1.2_

  - [ ]* 9.6 Escrever testes unitários para a busca semântica
    - Testar que sem modelo configurado a busca textual é executada normalmente
    - Testar que com 3+ chars e modelo configurado o indicador de carregamento aparece
    - Testar que `data-search-mode="semantic"` é adicionado ao input no modo semântico
    - _Requirements: 1.2, 1.3, 1.8_

  - [ ]* 9.7 Escrever property test: ordenação e filtragem de resultados semânticos
    - **Property 1: Ordenação e filtragem de resultados semânticos**
    - **Validates: Requirements 1.4**

  - [ ]* 9.8 Escrever property test: fallback para busca textual em caso de erro
    - **Property 2: Fallback para busca textual em caso de erro**
    - **Validates: Requirements 1.6**

  - [ ]* 9.9 Escrever property test: texto indexado contém título e mensagens
    - **Property 3: Texto indexado contém título e mensagens**
    - **Validates: Requirements 1.7**

- [x] 10. Checkpoint final — Garantir que todos os testes passam
  - Executar todos os testes: `npm test` (ou equivalente configurado na tarefa 1)
  - Verificar no browser as seis melhorias integradas: busca semântica, editor inline, timer de geração, chips dinâmicos, feedback de cópia e rename inline
  - Garantir que nenhuma funcionalidade existente foi quebrada
  - Perguntar ao usuário se há dúvidas antes de encerrar.

## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia requisitos específicos para rastreabilidade
- A ordem das melhorias vai da mais simples (5 e 6) para a mais complexa (1), reduzindo risco
- Testes de propriedade validam invariantes universais com 100 iterações via fast-check
- Testes unitários validam comportamentos específicos e casos de borda
- O projeto usa Vanilla JS puro — nenhuma dependência de framework é introduzida no cliente
