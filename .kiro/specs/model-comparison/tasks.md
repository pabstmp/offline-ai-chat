# Plano de Implementação: Comparação de Modelos Lado a Lado

## Visão Geral

Implementar o modo de comparação lado a lado criando dois novos módulos (`modules/ui/comparison-helpers.js` e `modules/ui/comparison.js`), modificando `app.js`, `index.html` e `styles.css` para integrar o `Comparison_Manager` ao ciclo de vida da aplicação. As funções puras de `comparison-helpers.js` são testáveis via Node.js e cobrem as cinco propriedades de corretude definidas no design.

## Tarefas

- [ ] 1. Criar `modules/ui/comparison-helpers.js` com as quatro funções puras
  - Criar o arquivo `modules/ui/comparison-helpers.js` como ES module (sem dependências de DOM)
  - Implementar `buildComparisonPayloads({ prompt, modelA, modelB, profile, samplingOverride })`: constrói dois payloads de completion onde `messages` e `sampling` são idênticos e apenas o campo `model` difere; reutiliza a lógica de `buildSamplingPayload` de `api.js`
  - Implementar `groupModelsByServer(models, servers, modelToServerId)`: agrupa model IDs por servidor; quando há um único servidor, retorna um grupo sem cabeçalho; quando há múltiplos, usa `serverNickname` como label; cada modelo aparece em exatamente um grupo
  - Implementar `resolveServerForModel(modelId, servers, modelToServerId)`: retorna o objeto servidor mapeado para o `modelId` ou `null` se não encontrado
  - Implementar `buildConversationFromComparison({ prompt, response, model, profileId, serverId })`: retorna um objeto `Conversation` com exatamente 2 mensagens (`role: "user"` e `role: "assistant"`), sem campo `reasoning`, com `id` prefixado por `"conv-"` e `title` truncado em 40 chars
  - _Requirements: 2.1, 2.2, 3.1, 3.3, 3.4, 5.2, 5.4, 6.3, 8.3_

- [ ] 2. Adicionar testes de propriedade e de exemplo para `comparison-helpers.js`
  - [ ] 2.1 Adicionar seção `── Model Comparison ──` em `tests/feature-improvements.test.js`
    - Importar as quatro funções de `../modules/ui/comparison-helpers.js`
    - _Requirements: 3.1, 3.3, 3.4, 6.3, 8.3_

  - [ ]* 2.2 Escrever teste de propriedade P1: Payloads compartilham conteúdo e diferem apenas no modelo
    - **Property 1: Payloads de comparação compartilham conteúdo e diferem apenas no modelo**
    - **Validates: Requirements 3.1, 3.3**
    - Gerador: `fc.record({ prompt: fc.string(), modelA: fc.string({ minLength: 1 }), modelB: fc.string({ minLength: 1 }), profile: fc.record({ systemPrompt: fc.string(), sampling: fc.record({}) }), samplingOverride: fc.record({}) })`
    - Verificar que `payloadA.messages` deep-equals `payloadB.messages`; `payloadA.model !== payloadB.model` (quando `modelA !== modelB`); parâmetros de sampling idênticos em ambos

  - [ ]* 2.3 Escrever teste de propriedade P2: Agrupamento de modelos é completo e correto
    - **Property 2: Agrupamento de modelos por servidor é completo e correto**
    - **Validates: Requirements 2.1, 2.2**
    - Gerador: `fc.array(fc.string({ minLength: 1 }))` para models + `fc.array(fc.record({ id: fc.string({ minLength: 1 }), nickname: fc.string() }))` para servers + mapa `modelId → serverId`
    - Verificar que todo modelo da lista aparece em exatamente um grupo; cada modelo está no grupo do servidor mapeado; nenhum modelo aparece em mais de um grupo

  - [ ]* 2.4 Escrever teste de propriedade P3: Resolução de servidor é determinística
    - **Property 3: Resolução de servidor para modelo é determinística**
    - **Validates: Requirements 3.4**
    - Gerador: `fc.string()` para modelId + `fc.array(fc.record({ id: fc.string({ minLength: 1 }), nickname: fc.string() }))` para servers + mapa `modelId → serverId`
    - Verificar que chamadas repetidas com o mesmo input retornam o mesmo servidor; o servidor retornado é o que está mapeado no `modelToServerId`

  - [ ]* 2.5 Escrever teste de propriedade P4: Conversa criada contém exatamente o par prompt + resposta
    - **Property 4: Conversa criada por "Usar esta resposta" contém exatamente o par prompt + resposta**
    - **Validates: Requirements 6.3, 8.3**
    - Gerador: `fc.record({ prompt: fc.string(), response: fc.string(), model: fc.string(), profileId: fc.string(), serverId: fc.string() })`
    - Verificar que `messages.length === 2`; `messages[0].role === "user"` e `messages[0].content === prompt`; `messages[1].role === "assistant"` e `messages[1].content === response`; nenhuma mensagem tem campo `reasoning`; `id` começa com `"conv-"`

  - [ ]* 2.6 Escrever teste de propriedade P5: AbortControllers são independentes entre painéis
    - **Property 5: Abort controllers são independentes entre painéis**
    - **Validates: Requirements 5.2, 5.4**
    - Criar dois `new AbortController()` e verificar que chamar `.abort()` em um não altera `.aborted` do outro (teste de exemplo, sem gerador fc — a propriedade é estrutural)

  - [ ] 2.7 Escrever testes de exemplo para as quatro funções puras
    - `buildComparisonPayloads`: prompt vazio produz `content: ""`; `modelA === modelB` é permitido; `samplingOverride` com `max_tokens: null` omite o campo
    - `groupModelsByServer`: lista vazia retorna array vazio; único servidor retorna um grupo; modelo sem mapeamento vai para grupo com `serverId: null`
    - `resolveServerForModel`: model ID não encontrado retorna `null`; modelo mapeado para segundo servidor retorna o segundo servidor
    - `buildConversationFromComparison`: `response` vazia produz `content: ""`; `prompt` com mais de 40 chars trunca `title`; nenhuma mensagem tem campo `reasoning`; `id` começa com `"conv-"`
    - _Requirements: 3.1, 3.3, 3.4, 6.3, 8.3_

- [ ] 3. Checkpoint — Verificar funções puras e testes
  - Executar `npm test` e confirmar que todos os testes de `comparison-helpers.js` passam; tirar dúvidas antes de continuar.

- [ ] 4. Criar `modules/ui/comparison.js` — estado interno e API pública
  - Criar o arquivo `modules/ui/comparison.js` como ES module
  - Declarar o estado interno efêmero: `isActive`, `store`, `onUseResponse`, `onClose`, `sessionState` (conforme interface `ComparisonSession` do design)
  - Implementar `initComparison(opts)`: recebe `{ store, elements, onUseResponse, onClose }`; valida presença de `#comparisonView` e `#compareToggle` no DOM (loga aviso e retorna sem inicializar se ausentes); popula `modelToServerId` carregando modelos de cada servidor configurado
  - Implementar `openComparison()`: não faz nada se já ativo; substitui área de mensagens pela `Comparison_View`; pré-seleciona o modelo ativo do perfil corrente no painel esquerdo; atualiza `aria-pressed` do `#compareToggle`
  - Implementar `closeComparison(force)`: se `force=false` e há geração em andamento, exibe `confirm()` antes de fechar; aborta todos os `AbortController`s ativos; limpa `sessionState`; chama `onClose()`; atualiza `aria-pressed`
  - Implementar `isComparisonActive()`: retorna `isActive`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.3, 2.5_

- [ ] 5. Implementar renderização da `Comparison_View` e `Model_Selector`
  - Implementar função interna `renderComparisonView()`: gera dinamicamente o DOM da `Comparison_View` conforme estrutura do design (`.comparison-panels`, dois `.comparison-panel[data-panel]`, `.comparison-composer`)
  - Implementar `Model_Selector` em cada painel: `<select>` com `<option>` simples quando há um servidor; `<optgroup>` por servidor (usando `groupModelsByServer`) quando há múltiplos; exibe mensagem de erro se nenhum modelo disponível (Requirement 2.5)
  - Pré-selecionar modelo ativo no painel esquerdo ao abrir; painel direito sem seleção inicial (Requirement 2.3)
  - Implementar troca de modelo durante geração: abortar `streamControllers[panelIdx]` antes de aplicar nova seleção (Requirement 2.6)
  - Implementar scroll independente em cada `.panel-body` via CSS `overflow-y: auto` (Requirement 4.5)
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 4.5, 4.6_

- [ ] 6. Implementar envio paralelo e streaming nos painéis
  - Implementar handler de envio no `Comparison_Composer`: valida que pelo menos um painel tem modelo; cria um `AbortController` por painel; dispara duas chamadas `requestCompletion` em paralelo (sem `await` sequencial); desabilita botão de envio enquanto qualquer painel está ocupado (Requirement 3.7)
  - Para cada painel: exibir nome do modelo como cabeçalho durante streaming (Requirement 4.6); usar `appendStreamingDelta` de `chat.js` para tokens incrementais (Requirement 4.1); usar `startGenerationTimer` / `stopGenerationTimer` de `chat.js` para indicador de progresso (Requirement 4.2)
  - Ao concluir streaming de um painel: chamar `finalizeAssistant` de `chat.js` com estatísticas de uso (Requirement 4.3); exibir bloco de raciocínio colapsável se `reasoning_content` presente (Requirement 4.4)
  - Tratar `finish_reason: length`: exibir conteúdo parcial + nota de truncamento no rodapé do painel (Requirement 7.2)
  - Painel sem modelo selecionado ao enviar: exibir erro inline naquele painel sem bloquear o outro (Requirement 3.5)
  - Limpar `Comparison_Composer` após envio bem-sucedido (Requirement 3.6)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.6, 7.2_

- [ ] 7. Implementar controles de cancelamento individual por painel
  - Adicionar botão "Parar" em cada `.panel-footer`: visível apenas durante streaming daquele painel (Requirement 5.1)
  - Handler do botão "Parar": chamar `streamControllers[panelIdx].abort()` sem afetar o outro painel (Requirement 5.2)
  - Ao cancelar: finalizar exibição com conteúdo parcial + indicador `.panel-interrupted` ("geração interrompida") (Requirement 5.3)
  - Adicionar botão `#comparisonStop` no `Comparison_Composer` para abortar ambos os painéis simultaneamente
  - Reabilitar botão de envio quando ambos os painéis concluírem ou forem cancelados (Requirement 5.5)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 8. Checkpoint — Verificar streaming e cancelamento
  - Garantir que envio paralelo, streaming incremental e cancelamento individual funcionam corretamente; tirar dúvidas antes de continuar.

- [ ] 9. Implementar ações pós-geração: "Copiar" e "Usar esta resposta"
  - Exibir botões "Copiar" e "Usar esta resposta" no `.panel-footer` após conclusão do streaming (Requirement 6.1, 6.3)
  - Handler "Copiar": chamar `navigator.clipboard.writeText(responseText)`; mudar texto do botão para "Copiado!" por ≥ 1500ms antes de restaurar; tratar ausência da API com `toast("Não foi possível copiar...", "warn")` e rejeição com `toast("Permissão de clipboard negada.", "error")` (Requirements 6.1, 6.2, 6.5)
  - Handler "Usar esta resposta": abortar streaming do outro painel se ativo (Requirement 6.4); chamar `buildConversationFromComparison` com prompt, resposta e modelo do painel selecionado; chamar `onUseResponse(novaConversa)` para persistir e carregar no chat principal; chamar `closeComparison(true)` (Requirements 6.3, 6.4, 8.3)
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 8.3_

- [ ] 10. Implementar tratamento de erros por painel e degradação graciosa
  - Envolver cada loop de streaming em `try/catch`: exibir erro dentro do painel afetado (`.panel-error`) sem toast global e sem afetar o outro painel (Requirement 7.1)
  - Tratar perda de conexão durante streaming: exibir conteúdo parcial + mensagem de interrupção no painel afetado (Requirement 7.3)
  - Garantir que exceção em um painel não propaga para o outro nem para a aplicação (Requirement 7.4)
  - Degradação graciosa: se `requestCompletion` não estiver disponível, exibir toast de erro e não ativar o modo; se elementos DOM ausentes, `initComparison` loga aviso e retorna sem inicializar
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 11. Modificar `index.html`: adicionar botão de toggle e container da `Comparison_View`
  - Adicionar `<button id="compareToggle">` na topbar (após `#workspaceToggle`, antes de `#paletteButton`) com `aria-label="Comparar modelos"`, `aria-pressed="false"` e ícone SVG de duas colunas conforme design
  - Adicionar `<div id="comparisonView" class="comparison-view hidden" role="region" aria-label="Comparação de modelos">` como irmão de `<main class="chat">` no `app-body`
  - _Requirements: 1.1, 1.2_

- [ ] 12. Modificar `styles.css`: adicionar estilos da `Comparison_View`
  - Adicionar todos os seletores CSS definidos no design: `.comparison-view`, `.comparison-panels` (grid 2 colunas), `.comparison-panel`, `.panel-header`, `.panel-body`, `.panel-footer`, `.comparison-composer`, `#compareToggle[aria-pressed="true"]`, `.panel-interrupted`
  - Adicionar media query `@media (max-width: 767px)` para empilhar painéis verticalmente (`grid-template-columns: 1fr`) (Requirement 1.5)
  - Usar variáveis CSS existentes do projeto (`--line`, `--r-md`, `--s-2`, `--s-3`, `--accent`, `--fg-2`, `--fs-xs`) para consistência visual
  - _Requirements: 1.5_

- [ ] 13. Modificar `app.js`: inicializar e conectar o `Comparison_Manager`
  - Adicionar import de `{ initComparison, openComparison, closeComparison, isComparisonActive }` de `./modules/ui/comparison.js`
  - Adicionar `compareToggle: $("#compareToggle")` e `comparisonView: $("#comparisonView")` ao objeto `elements`
  - Chamar `initComparison({ store, elements, onUseResponse, onClose })` após `initChat`, `initComposer` e demais inicializações; implementar `onUseResponse` para persistir via `conversationStore.upsert`, chamar `refreshSidebar` e `loadConversation`; implementar `onClose` para restaurar visibilidade de `#messages` e `#chatForm`
  - Adicionar event listener em `elements.compareToggle`: chamar `closeComparison()` se ativo, `openComparison()` caso contrário
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.1, 8.2, 8.3, 8.4_

- [ ] 14. Checkpoint final — Garantir que todos os testes passam
  - Executar `npm test` e confirmar que todos os testes (incluindo os novos de `comparison-helpers.js`) passam sem erros; tirar dúvidas antes de encerrar.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia os requisitos específicos para rastreabilidade
- `comparison-helpers.js` deve ser puramente funcional (sem DOM, sem imports de módulos de UI) para ser testável via Node.js
- Os testes de propriedade devem ser adicionados em `tests/feature-improvements.test.js` seguindo o padrão existente (`runProperty` + `fc.assert`)
- A `Comparison_Session` é efêmera — nunca persistida no `conversationStore`; a única escrita em storage ocorre via `onUseResponse` ao acionar "Usar esta resposta"
- `appendStreamingDelta`, `finalizeAssistant`, `startGenerationTimer` e `stopGenerationTimer` são reutilizados de `modules/ui/chat.js` — não reimplementar
- O schema de storage (`modules/schema.js`) não precisa ser alterado
