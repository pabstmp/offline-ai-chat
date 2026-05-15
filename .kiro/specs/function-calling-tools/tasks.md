# Plano de Implementação: Function Calling / Tools

## Visão Geral

Implementar suporte completo a function calling (tool use) na interface do Offline AI Chat. A implementação segue a arquitetura vanilla JS do projeto: novo módulo `modules/tools/manager.js`, modificações em `app.js`, `modules/api.js`, `modules/ui/chat.js`, `modules/ui/settings/tools.js`, `modules/schema.js` e `server.js`.

## Tarefas

- [ ] 1. Atualizar schema e migrações para suporte a tools
  - Adicionar chave `tools` em `defaults()` em `modules/schema.js` com as 3 ferramentas built-in (`get_current_datetime`, `web_search`, `run_javascript`), todas com `enabled: false`
  - Adicionar campo `tools: []` (array de IDs) em cada perfil dentro de `DEFAULT_PROFILES`
  - Adicionar sub-objeto `advanced.tools: { requireConfirmation: false }` em `defaults()`
  - Adicionar as 3 soft migrations em `loadAndMigrate()`: `target.tools`, `profile.tools` e `advanced.tools`
  - _Requisitos: 1.1, 1.2, 1.6, 3.2, 5.4_

- [ ] 2. Criar módulo `modules/tools/manager.js`
  - [ ] 2.1 Implementar funções de registro e CRUD de ferramentas
    - Criar `registerBuiltIns()` que popula o registry em memória com as 3 built-ins
    - Criar `listTools()` → `Tool[]`
    - Criar `getToolDefinitions(enabledIds)` → array de OpenAI `Tool_Definition` (apenas ferramentas com `enabled: true` cujo ID está em `enabledIds`)
    - Criar `addCustomTool(toolDef)` → `{ ok, error? }` com validação de nome e duplicata
    - Criar `removeCustomTool(id)` → `{ ok, error? }`
    - Criar `validateToolName(name)` → boolean (regex `/^[a-z0-9_]{1,64}$/`)
    - Criar `validateParametersSchema(schema)` → `{ ok, error? }`
    - _Requisitos: 1.1, 1.3, 1.4, 1.5, 7.2_

  - [ ]* 2.2 Escrever property test para `validateToolName` (Property 1)
    - **Property 1: Validação de nome de ferramenta**
    - **Validates: Requisito 1.3**

  - [ ]* 2.3 Escrever property test para duplicata preserva registry (Property 2)
    - **Property 2: Detecção de duplicata preserva o registry**
    - **Validates: Requisito 1.4**

  - [ ]* 2.4 Escrever property test para remoção precisa (Property 3)
    - **Property 3: Remoção de ferramenta é precisa**
    - **Validates: Requisito 1.5**

  - [ ] 2.5 Implementar execução de ferramentas e Sandbox
    - Criar `runInSandbox(code, args, timeoutMs=5000)` com `new Function` bloqueando `window`, `document`, `fetch`, `XMLHttpRequest`
    - Criar `serializeToolResult(value)` → string (objeto/array → `JSON.stringify`; primitivo → `String()`; `undefined`/`null` → `"(sem resultado)"`)
    - Criar `executeTool(toolCall, registry)` → string: despacha para built-in ou Sandbox, captura erros e timeout
    - Implementar built-in `get_current_datetime`: retorna `new Date().toISOString()` com offset do browser
    - Implementar built-in `run_javascript`: chama `runInSandbox` com timeout 5000ms
    - Implementar built-in `web_search`: faz `fetch("/api/tools/web-search", { method: "POST", body: JSON.stringify({ query }) })` e retorna resultado como string JSON
    - _Requisitos: 2.1, 2.2, 2.3, 2.5, 2.6, 7.3, 7.5, 7.6_

  - [ ]* 2.6 Escrever property test para ISO 8601 de `get_current_datetime` (Property 4)
    - **Property 4: Formato ISO 8601 da ferramenta get_current_datetime**
    - **Validates: Requisito 2.1**

  - [ ]* 2.7 Escrever property test para captura de erros no Sandbox (Property 5)
    - **Property 5: Captura de erros no Sandbox**
    - **Validates: Requisito 2.6**

  - [ ]* 2.8 Escrever property test para bloqueio de globals proibidos (Property 6)
    - **Property 6: Bloqueio de globals proibidos no Sandbox**
    - **Validates: Requisito 7.5**

  - [ ]* 2.9 Escrever property test para serialização de resultado (Property 7)
    - **Property 7: Serialização do resultado de ferramenta customizada**
    - **Validates: Requisito 7.6**

  - [ ] 2.10 Implementar `buildToolsPayload(profile, store)` e `buildToolResultMessages`
    - Criar `buildToolsPayload(profile, store)` → `Tool_Definition[]` ou `undefined` (omite quando nenhuma ferramenta habilitada)
    - Criar `buildToolResultMessages(assistantMsg, toolResults)` → array de mensagens `[assistantMsg, ...toolMsgs]`
    - _Requisitos: 3.3, 3.4, 4.4_

  - [ ]* 2.11 Escrever property test para filtragem de tools habilitadas (Property 8)
    - **Property 8: Filtragem de ferramentas habilitadas no payload**
    - **Validates: Requisitos 3.3, 3.4**

  - [ ]* 2.12 Escrever property test para `buildToolResultMessages` (Property 10)
    - **Property 10: Construção das mensagens de Tool_Result**
    - **Validates: Requisito 4.4**

  - [ ]* 2.13 Escrever property test para `validateParametersSchema` (Property 11)
    - **Property 11: Validação de JSON Schema de parâmetros**
    - **Validates: Requisito 7.2**

- [ ] 3. Checkpoint — Testar módulo tools/manager.js isoladamente
  - Garantir que todos os testes passam, verificar que `npm run check` não reporta erros de sintaxe.

- [ ] 4. Adicionar extração de tool_calls em `modules/api.js`
  - Adicionar `extractToolCalls(data)` → `ToolCall[]` ou `null`
  - Adicionar `extractFinishReason(data)` → string ou `null`
  - _Requisitos: 4.1_

  - [ ]* 4.1 Escrever property test para detecção de tool_calls (Property 9)
    - **Property 9: Detecção de tool_calls na resposta da API**
    - **Validates: Requisito 4.1**

- [ ] 5. Adicionar renderização de tool calls em `modules/ui/chat.js`
  - Adicionar `renderToolCallBlock(body, toolCall, result)`: cria `<details>` com summary `🔧 <nome>(...)`, exibe argumentos como JSON indentado e resultado separado por divisor visual
  - Adicionar `showToolProgress(body)`: substitui typing indicator por `"⚙ Executando ferramentas..."`
  - Adicionar `formatToolCallArgs(args)` → `JSON.stringify(args, null, 2)`
  - Atualizar `renderMessage` para re-renderizar blocos `tool_calls` ao carregar histórico (quando `message.tool_calls` presente)
  - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 5.1 Escrever property test para `formatToolCallArgs` (Property 12)
    - **Property 12: Formatação de argumentos de tool call**
    - **Validates: Requisito 6.2**

- [ ] 6. Implementar Tool_Cycle em `app.js`
  - [ ] 6.1 Adicionar funções auxiliares de detecção e construção de payload
    - Adicionar `isToolCallResponse(apiResponse)` → boolean
    - Adicionar `extractToolCalls(apiResponse)` → `ToolCall[]`
    - Adicionar `buildToolsPayload(profile)` que delega ao `Tool_Manager`
    - Incluir `tools` no payload de `submitMessage` quando `buildToolsPayload` retornar definições
    - _Requisitos: 3.3, 3.4, 4.1_

  - [ ] 6.2 Implementar `runToolCycle`
    - Criar `runToolCycle(messages, toolCalls, profile, server, abortController)` com limite de 5 iterações
    - Executar cada `tool_call` em paralelo com `Promise.all`
    - Montar mensagens `role: "tool"` com `tool_call_id` correto
    - Enviar nova requisição ao modelo com histórico completo incluindo tool results
    - Retornar `{ messages, finalContent, finalReasoning }` ao final
    - Exibir toast de erro se limite de 5 iterações for atingido
    - Respeitar `AbortController`: interromper ciclo imediatamente se acionado
    - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ] 6.3 Integrar `runToolCycle` no fluxo de `submitMessage`
    - Após receber resposta com `finish_reason: "tool_calls"`, chamar `showToolProgress` e iniciar `runToolCycle`
    - Renderizar blocos `renderToolCallBlock` para cada tool call executado
    - Persistir mensagens `assistant` (com `tool_calls`) e `tool` no histórico da conversa
    - Finalizar com `finalizeAssistant` após resposta final do modelo
    - _Requisitos: 4.1, 4.2, 4.4, 6.4, 6.5_

- [ ] 7. Checkpoint — Testar fluxo básico de tool call end-to-end
  - Garantir que `npm run check` passa sem erros de sintaxe em todos os arquivos modificados.

- [ ] 8. Implementar modo de confirmação manual em `app.js`
  - Criar modal de confirmação (DOM inline, sem dependências) com nome da ferramenta e argumentos formatados
  - Antes de executar cada `tool_call`, verificar `store.get("advanced.tools.requireConfirmation")`
  - Se habilitado: pausar ciclo, exibir modal; ao confirmar → executar; ao rejeitar → enviar `"Execução cancelada pelo usuário"` como Tool_Result
  - Se desabilitado: executar automaticamente sem modal
  - _Requisitos: 5.1, 5.2, 5.3, 5.5_

- [ ] 9. Adicionar endpoint `/api/tools/web-search` em `server.js`
  - Adicionar handler `handleToolsWebSearch(body, response)` em `handleApi`
  - Validar `query`: retornar HTTP 400 se ausente/vazia (`{ error: "query obrigatória" }`)
  - Validar comprimento: retornar HTTP 400 se `query.length > 500` (`{ error: "query excede 500 caracteres" }`)
  - Implementar `fetchWebSearchResults(query)` via DuckDuckGo Instant Answer API (sem chave de API)
  - Retornar HTTP 502 com `{ error: "<mensagem>" }` em caso de falha upstream
  - Respeitar `ALLOWED_LM_HOSTS` e autenticação existentes
  - _Requisitos: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 9.1 Escrever property test para validação de comprimento de query (Property 13)
    - **Property 13: Validação do comprimento da query no servidor**
    - **Validates: Requisito 8.3**

- [ ] 10. Criar painel de configuração `modules/ui/settings/tools.js`
  - [ ] 10.1 Implementar listagem e toggles de ferramentas
    - Criar `panelTools()` que renderiza seção "Ferramentas" no settings drawer
    - Listar todas as ferramentas do `Tool_Manager` com toggle de habilitação individual por perfil
    - Ao toglar, atualizar `profile.tools` (array de IDs) via `store` e persistir
    - Exibir aviso sobre proxy local quando `web_search` estiver habilitada
    - _Requisitos: 3.1, 3.2, 2.7_

  - [ ] 10.2 Implementar formulário de criação de ferramenta customizada
    - Campos: nome (snake_case), descrição, parâmetros (textarea JSON Schema), implementação (textarea JS)
    - Botão "Salvar": validar nome e schema antes de chamar `addCustomTool`; exibir toast de erro descritivo em caso de falha
    - Botão "Testar ferramenta": executar com argumentos de exemplo e exibir resultado inline
    - Botão "Excluir" em ferramentas customizadas existentes: chamar `removeCustomTool` e re-renderizar lista
    - _Requisitos: 7.1, 7.2, 7.4, 1.3, 1.4, 1.5_

- [ ] 11. Integrar painel de tools no drawer de settings (`modules/ui/settings.js`)
  - Adicionar entrada `{ id: "tools", label: "Ferramentas", icon: "🔧" }` no array `TABS`
  - Importar e chamar `panelTools()` no switch de renderização de painéis
  - Atualizar chip de perfil na topbar para exibir contagem de ferramentas ativas quando ≥ 1 ferramenta habilitada
  - _Requisitos: 3.1, 3.5_

- [ ] 12. Checkpoint final — Garantir que todos os testes passam
  - Executar `npm test` e garantir que todos os testes (unit, PBT e hardening) passam sem falhas.
  - Executar `npm run check` para validar sintaxe de todos os arquivos.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia requisitos específicos para rastreabilidade
- O design usa JavaScript vanilla (ES modules) — sem dependências no client
- Testes de propriedade usam **fast-check** (já presente em `tests/package.json`)
- O Sandbox com `new Function` é suficiente para ferramentas definidas pelo próprio usuário — não expor execução de código de terceiros
- Ferramentas built-in ficam `enabled: false` por padrão, garantindo zero mudança de comportamento para usuários existentes
- O campo `tools` é omitido do payload quando nenhuma ferramenta está habilitada (compatibilidade total com modelos sem suporte a tools)
