# Implementation Plan: Feature Improvements — Offline AI Chat

## Overview

Implementação das 9 melhorias de funcionalidade para o Offline AI Chat em Vanilla JS puro (ES modules). Cada tarefa edita arquivos existentes, exporta funções puras testáveis e usa apenas APIs nativas do browser. Os testes são executados com `node tests/feature-improvements.test.js` (sem browser).

## Tasks

- [x] 1. Criar arquivo de testes e extrair funções puras — R1 (Backup)
  - [x] 1.1 Criar `tests/feature-improvements.test.js` com imports de `fast-check` e estrutura base de asserções
    - Criar o arquivo com `import fc from "fast-check"` e helper `assert(condition, msg)` para testes de exemplo
    - _Requirements: 1.2, 1.4, 1.5, 1.6_

  - [x] 1.2 Extrair e exportar funções puras de backup em `modules/ui/settings/behavior.js`
    - Exportar `backupFilename(date)`, `mergeConversations(existing, imported)` e `validateBackupFile(parsed)`
    - As funções devem ser exportadas com `export function` para serem importáveis pelo test runner Node.js
    - _Requirements: 1.2, 1.4, 1.5_

  - [x]* 1.3 Escrever property test — Property 1: backup filename matches date pattern
    - **Property 1: Backup filename matches date pattern**
    - **Validates: Requirements 1.2**

  - [x]* 1.4 Escrever property test — Property 2: conversation merge preserves existing and adds only absent
    - **Property 2: Conversation merge preserves existing and adds only absent**
    - **Validates: Requirements 1.4, 1.6**

  - [x]* 1.5 Escrever property test — Property 3: backup validation rejects non-arrays and arrays without id
    - **Property 3: Backup validation rejects non-arrays and arrays without id**
    - **Validates: Requirements 1.5**

- [x] 2. Implementar UI de backup em `modules/ui/settings/behavior.js`
  - Adicionar seção "Backup de conversas" com botões "Exportar tudo" e "Importar backup" em `panelBehavior()`
  - "Exportar tudo": chama `conversationStore.list()`, serializa para JSON, dispara download via `URL.createObjectURL` + `<a download>` com nome gerado por `backupFilename()`
  - "Importar backup": cria `<input type="file" accept=".json">`, lê com `FileReader`, valida com `validateBackupFile`, faz merge com `mergeConversations`, persiste via `conversationStore.upsert` em loop, exibe toast de sucesso/erro e chama `refreshSidebar()`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 3. Checkpoint — Testar R1
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extrair funções puras de fork e implementar R2 (Fork de Conversa)
  - [x] 4.1 Exportar funções puras de fork em `modules/ui/chat-helpers.js`
    - Exportar `forkMessagesAt(messages, messageId)` e `createFork(sourceConv, messages)`
    - _Requirements: 2.2, 2.3, 2.5_

  - [x]* 4.2 Escrever property test — Property 4: fork slice is a prefix ending at the target message
    - **Property 4: Fork slice is a prefix ending at the target message**
    - **Validates: Requirements 2.2**

  - [x]* 4.3 Escrever property test — Property 5: fork creation produces correct metadata and does not mutate source
    - **Property 5: Fork creation produces correct metadata and does not mutate source**
    - **Validates: Requirements 2.3, 2.5**

  - [x] 4.4 Adicionar botão "Continuar daqui" em `modules/ui/chat.js`
    - No array de ações de `renderMessage`, adicionar `["fork", "Continuar daqui"]` apenas quando `message.role === "assistant"`
    - O botão dispara `onAction({ action: "fork", messageId: message.id, message })`
    - _Requirements: 2.1_

  - [x] 4.5 Tratar `action === "fork"` em `app.js`
    - Em `handleMessageAction`, chamar `forkMessagesAt`, `createFork`, `conversationStore.upsert`, `refreshSidebar` e `loadConversation` com a nova conversa
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

- [x] 5. Extrair funções puras de A/B e implementar R3 (Comparação A/B)
  - [x] 5.1 Exportar funções puras de A/B em `modules/ui/chat-helpers.js`
    - Exportar `getAlternativeProfiles(profiles, activeProfileId)` e `replaceMessageContent(messages, messageId, newContent)`
    - _Requirements: 3.2, 3.6_

  - [x]* 5.2 Escrever property test — Property 6: alternative profiles excludes the active profile
    - **Property 6: Alternative profiles excludes the active profile**
    - **Validates: Requirements 3.2**

  - [x]* 5.3 Escrever property test — Property 7: message replacement updates only the target message
    - **Property 7: Message replacement updates only the target message**
    - **Validates: Requirements 3.6**

  - [x] 5.4 Modificar botão "Regenerar" em `modules/ui/chat.js` para abrir mini-menu A/B
    - Substituir o listener direto do botão "Regenerar" por um mini-menu inline com opções "Regenerar (mesmo perfil)" e "Comparar com outro perfil"
    - "Comparar com outro perfil" dispara `onAction({ action: "ab-start", messageId, message })`
    - _Requirements: 3.1_

  - [x] 5.5 Implementar fluxo A/B em `app.js`
    - Tratar `action === "ab-start"`: exibir seletor de perfil (usando `getAlternativeProfiles`), gerar resposta alternativa via `requestCompletion` sem adicionar ao histórico, renderizar layout `<div class="ab-comparison">` com duas colunas `.ab-col`
    - Tratar `action === "ab-choose"`: chamar `replaceMessageContent`, persistir via `conversationStore.upsert`, remover layout A/B do DOM
    - Tratar `action === "ab-cancel"`: remover layout A/B sem alterar histórico
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 5.6 Adicionar estilos CSS para layout A/B em `styles.css`
    - Adicionar `.ab-comparison` (display: grid, grid-template-columns: 1fr 1fr, gap), `.ab-col` e `.ab-col-header` usando tokens CSS existentes
    - _Requirements: 3.4_

- [x] 6. Checkpoint — Testar R2 e R3
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Extrair funções puras de imagem e implementar R4 (Suporte a Imagens)
  - [x] 7.1 Exportar funções puras de imagem em `modules/ui/composer-helpers.js`
    - Exportar `validateImageSize(sizeBytes, limitBytes)` e `buildImageMessageContent(text, base64Data, mimeType)`
    - _Requirements: 4.4, 4.7_

  - [x]* 7.2 Escrever property test — Property 8: image message content is a valid OpenAI-compatible array
    - **Property 8: Image message content is a valid OpenAI-compatible array**
    - **Validates: Requirements 4.4**

  - [x]* 7.3 Escrever property test — Property 9: image size validation enforces 10 MB limit
    - **Property 9: Image size validation enforces 10 MB limit**
    - **Validates: Requirements 4.7**

  - [x] 7.4 Adicionar estado de imagem pendente e UI de preview em `modules/ui/composer.js`
    - Adicionar variável de módulo `let pendingImage = null` e funções `getPendingImage()` / `clearPendingImage()`
    - Adicionar botão de upload de imagem na barra do composer (ícone de câmera, adjacente ao `#attachButton`)
    - Ao selecionar arquivo: validar tipo MIME (`image/png`, `image/jpeg`, `image/gif`, `image/webp`) e tamanho com `validateImageSize`; ler com `FileReader`; exibir `<div class="composer-image-preview">` com `<img>` e botão "×" acima do textarea
    - _Requirements: 4.1, 4.2, 4.3, 4.7_

  - [x] 7.5 Integrar imagem no envio de mensagem em `app.js`
    - Em `submitMessage`, verificar `getPendingImage()` e chamar `buildImageMessageContent` para construir o `content` da mensagem do usuário
    - Em `renderMessage` (ou `setBodyContent`) em `chat.js`, detectar quando `message.content` é array e renderizar `<img>` inline acima do texto
    - Após envio, chamar `clearPendingImage()` e remover o preview do DOM
    - _Requirements: 4.4, 4.5, 4.6_

  - [x] 7.6 Adicionar estilos CSS para preview de imagem em `styles.css`
    - Adicionar `.composer-image-preview` com layout flex, `.composer-image-preview img` com `max-width: 100%`, `max-height: 200px`, `border-radius: var(--r-md)` e botão de remoção
    - _Requirements: 4.3, 4.5_

- [x] 8. Extrair funções puras de templates e implementar R5 (Templates de Conversa)
  - [x] 8.1 Criar módulo `modules/templates.js` com funções puras e `templateStore`
    - Exportar `createTemplate(conv, name, systemPrompt)`, `initConversationFromTemplate(template, baseConv)`, `removeTemplate(templates, id)` e `templateStore` (com `list()` e `save(templates)`)
    - _Requirements: 5.4, 5.6, 5.7_

  - [x]* 8.2 Escrever property test — Property 10: template creation captures conversation data correctly
    - **Property 10: Template creation captures conversation data correctly**
    - **Validates: Requirements 5.4**

  - [x]* 8.3 Escrever property test — Property 11: conversation initialized from template has correct messages and system prompt
    - **Property 11: Conversation initialized from template has correct messages and system prompt**
    - **Validates: Requirements 5.6**

  - [x]* 8.4 Escrever property test — Property 12: template removal eliminates exactly the target template
    - **Property 12: Template removal eliminates exactly the target template**
    - **Validates: Requirements 5.7**

  - [x] 8.5 Adicionar seção "Templates de conversa" em `modules/ui/settings/advanced.js`
    - Adicionar seção listando templates com nome e botão "×" para exclusão; exclusão chama `removeTemplate`, `templateStore.save` e re-renderiza a seção
    - _Requirements: 5.1, 5.7_

  - [x] 8.6 Adicionar opção "Salvar como template" no menu de contexto do sidebar em `modules/ui/sidebar.js`
    - Em `openMenu`, adicionar `["save-template", "Salvar como template"]` no array de ações
    - O clique dispara `onAction({ action: "save-template", conversation: conv })`
    - _Requirements: 5.2_

  - [x] 8.7 Tratar ações de template em `app.js`
    - Tratar `action === "save-template"` em `handleSidebarAction`: exibir prompt com título da conversa como padrão, criar template com `createTemplate`, salvar com `templateStore.save`
    - Modificar `newConversation()`: se `templateStore.list()` retornar templates, exibir seletor (mini-menu) com opção "Em branco" e lista de templates; ao selecionar, chamar `initConversationFromTemplate`
    - _Requirements: 5.3, 5.4, 5.5, 5.6_

- [x] 9. Checkpoint — Testar R4 e R5
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Extrair função pura de RAG indicator e implementar R6 (Indicador RAG no Topbar)
  - [x] 10.1 Exportar função pura `ragIndicatorShouldShow` em `modules/app-helpers.js`
    - Exportar `ragIndicatorShouldShow(eventKind)` que retorna `true` apenas para `"started"` e `"progress"`
    - _Requirements: 6.2, 6.5_

  - [x]* 10.2 Escrever property test — Property 13: RAG indicator visibility follows event kind
    - **Property 13: RAG indicator visibility follows event kind**
    - **Validates: Requirements 6.2, 6.5**

  - [x] 10.3 Adicionar elemento `#ragIndexingIndicator` em `index.html` e estilos em `styles.css`
    - Adicionar `<button id="ragIndexingIndicator" class="rag-indexing-indicator hidden" type="button" title="Indexando… clique para ver detalhes" aria-label="Indexação RAG em andamento"><span class="rag-indexing-dot"></span></button>` próximo ao `#statusPill` no topbar
    - Adicionar `.rag-indexing-indicator` com animação de pulso e `.rag-indexing-dot` usando tokens CSS existentes
    - _Requirements: 6.1, 6.6_

  - [x] 10.4 Conectar `rag.subscribe` ao indicador em `app.js`
    - Adicionar `elements.ragIndexingIndicator` ao objeto `elements`
    - No handler `rag.subscribe` existente, usar `ragIndicatorShouldShow` para atualizar `hidden` do elemento
    - Adicionar listener de clique que chama `openSettings("workspace")`
    - _Requirements: 6.3, 6.4, 6.5_

- [x] 11. Extrair funções puras de servidor e implementar R7 (Atalho para Alternar Servidores)
  - [x] 11.1 Exportar funções puras de servidor em `modules/app-helpers.js`
    - Exportar `shouldShowServerDropdown(servers)` e `nextServerIndex(currentIndex, total, direction)`
    - _Requirements: 7.5, 7.6_

  - [x]* 11.2 Escrever property test — Property 14: server dropdown navigation wraps correctly and shows only for multiple servers
    - **Property 14: Server dropdown navigation wraps correctly and shows only for multiple servers**
    - **Validates: Requirements 7.5, 7.6**

  - [x] 11.3 Implementar dropdown de servidores em `app.js`
    - Modificar o listener de clique do `#statusPill`: se `shouldShowServerDropdown(servers)` for `true`, criar dropdown dinâmico (similar ao `openMenu` do sidebar) listando servidores com `nickname`, estado de conexão e checkmark no ativo
    - Navegação por teclado: ArrowDown/ArrowUp usam `nextServerIndex`, Enter seleciona, Escape fecha
    - Ao selecionar: atualizar `connection.activeServerId` no store, fechar dropdown, chamar `loadModels()`
    - Clicar fora fecha o dropdown sem alterar servidor
    - Se apenas um servidor: manter comportamento atual e definir `title` dinamicamente
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 11.4 Adicionar estilos CSS para dropdown de servidores em `styles.css`
    - Adicionar `.server-dropdown` com posicionamento absoluto, background, border, border-radius e box-shadow usando tokens existentes
    - Adicionar `.server-dropdown-item` com estados hover e `.server-dropdown-item.active` com checkmark
    - _Requirements: 7.2_

- [x] 12. Extrair funções puras de scroll e implementar R8 (Persistência de Scroll)
  - [x] 12.1 Exportar funções puras de scroll em `modules/app-helpers.js`
    - Exportar `shouldAutoScroll(scrollHeight, scrollTop, clientHeight, threshold)` e `getScrollPosition(cache, conversationId)`
    - _Requirements: 8.3, 8.4, 8.5_

  - [x]* 12.2 Escrever property test — Property 15: scroll position cache returns stored value or null
    - **Property 15: Scroll position cache returns stored value or null**
    - **Validates: Requirements 8.3, 8.4**

  - [x]* 12.3 Escrever property test — Property 16: auto-scroll decision is based on distance to bottom
    - **Property 16: Auto-scroll decision is based on distance to bottom**
    - **Validates: Requirements 8.5**

  - [x] 12.4 Implementar `scrollCache` e listeners em `app.js`
    - Declarar `const scrollCache = new Map()` em `app.js`
    - Adicionar listener de scroll em `elements.messages` com debounce de 150ms que salva `scrollTop` no `scrollCache` para a conversa ativa
    - Modificar `loadConversation`: após `renderAllMessages`, usar `getScrollPosition` para restaurar `scrollTop` ou chamar `scrollToBottom()`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 13. Checkpoint — Testar R6, R7 e R8
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Extrair função pura de modal e implementar R9 (Modo de Foco por Mensagem)
  - [x] 14.1 Exportar função pura `getBodyOverflowForModal` em `modules/ui/chat-helpers.js`
    - Exportar `getBodyOverflowForModal(isOpen, previousOverflow)` que retorna `"hidden"` quando `isOpen` é `true` e `previousOverflow` caso contrário
    - _Requirements: 9.6, 9.7_

  - [x]* 14.2 Escrever property test — Property 17: body overflow is hidden when modal is open and restored when closed
    - **Property 17: Body overflow is hidden when modal is open and restored when closed**
    - **Validates: Requirements 9.6, 9.7**

  - [x] 14.3 Adicionar botão "Foco" em `modules/ui/chat.js`
    - No array de ações de `renderMessage`, adicionar `["focus", "Foco"]` para todas as mensagens
    - O botão dispara `onAction({ action: "focus", messageId: message.id, message })`
    - _Requirements: 9.1_

  - [x] 14.4 Implementar Focus Modal em `app.js`
    - Tratar `action === "focus"` em `handleMessageAction`: criar dinamicamente o overlay `.focus-modal-overlay` com `.focus-modal-content`, `.focus-modal-header` (botão "Copiar" e botão "×"), `.focus-modal-body` (conteúdo renderizado com `renderMarkdown`)
    - Salvar `document.body.style.overflow` antes de abrir; usar `getBodyOverflowForModal` para aplicar `"hidden"` ao abrir e restaurar ao fechar
    - Fechar ao pressionar Escape ou clicar fora de `.focus-modal-content`
    - Botão "Copiar" usa `navigator.clipboard.writeText` com fallback de toast de aviso
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 14.5 Adicionar atalho de teclado `F` para foco em `app.js`
    - Adicionar listener de `keydown` em `elements.messages` que, ao pressionar `F` (sem modificadores), verifica `event.target.closest(".msg")` e dispara `handleMessageAction({ action: "focus", ... })` para a mensagem mais próxima
    - _Requirements: 9.2_

  - [x] 14.6 Adicionar estilos CSS para Focus Modal em `styles.css`
    - Adicionar `.focus-modal-overlay` (position fixed, inset 0, background overlay, z-index alto, display flex, align/justify center)
    - Adicionar `.focus-modal-content` (max-width 900px, width 100%, max-height 90vh, overflow-y auto, background var(--bg-1), border-radius var(--r-xl), display flex, flex-direction column)
    - Adicionar `.focus-modal-header` e `.focus-modal-body` com padding e scroll interno usando tokens existentes
    - _Requirements: 9.3_

- [x] 15. Checkpoint final — Executar todos os testes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia os requisitos específicos para rastreabilidade
- As funções puras devem ser exportadas com `export function` para serem importáveis pelo Node.js sem browser
- O arquivo de testes usa `import` (ES modules) — o `tests/package.json` já tem `"type": "module"`
- Executar testes: `node tests/feature-improvements.test.js`
- Property tests usam `fast-check` (já instalado como devDependency)
- Checkpoints garantem validação incremental a cada grupo de melhorias
- As funções puras de R6, R7 e R8 já estão exportadas em `modules/app-helpers.js` e os property tests já estão escritos em `tests/feature-improvements.test.js`; as tasks 10.1 e 12.1 precisam apenas confirmar que as exportações estão corretas antes de prosseguir com a implementação de UI
