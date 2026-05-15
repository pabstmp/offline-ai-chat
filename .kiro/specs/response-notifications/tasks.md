# Plano de Implementação: Notificações de Resposta

## Visão Geral

Implementar o módulo `modules/notifications.js` com toda a lógica de permissão e disparo de notificações via Web Notifications API, integrar ao schema de persistência, expor controle no painel de Comportamento e conectar ao fluxo de finalização de resposta em `app.js`. A feature é 100% client-side, sem novos endpoints no servidor.

## Tarefas

- [ ] 1. Adicionar `behavior.notifications` ao schema de persistência
  - Adicionar o campo `notifications: "disabled"` ao objeto `behavior` em `defaults()` em `modules/schema.js`
  - Verificar que a soft migration em `loadAndMigrate()` já aplica `defaults()` como base — nenhuma migration explícita adicional é necessária, pois `{ ...defaults(), ...parsed }` já preenche o campo ausente com `"disabled"`
  - _Requirements: 6.1, 6.2, 6.3_

- [ ] 2. Criar o módulo `modules/notifications.js`
  - [ ] 2.1 Implementar as funções puras exportadas: `isSupported()`, `isBlocked()` e `shouldNotify(visibilityState, permission, notificationsPref)`
    - `isSupported()`: retorna `false` se `"Notification" not in window` ou se `Notification.requestPermission` não for função
    - `isBlocked()`: retorna `true` apenas quando `Notification.permission === "denied"` (retorna `false` se não suportado)
    - `shouldNotify(v, p, n)`: retorna `true` sse `v === "hidden" && p === "granted" && n === "enabled"` — função pura sem efeitos colaterais
    - _Requirements: 1.1, 1.3, 1.4, 3.1, 3.6, 3.7, 5.1, 5.2_

  - [ ]* 2.2 Escrever testes de exemplo para `isSupported()`, `isBlocked()` e `shouldNotify()`
    - Adicionar seção `R-Notifications — isSupported / isBlocked / shouldNotify` em `tests/feature-improvements.test.js`
    - Mockar `window.Notification` e `Notification.permission` para cada caso
    - Cobrir: API ausente, `requestPermission` não-função, `permission === "denied"`, `permission === "granted"`, `permission === "default"`
    - Cobrir todos os casos de `shouldNotify`: apenas a combinação `("hidden", "granted", "enabled")` retorna `true`
    - _Requirements: 1.1, 1.3, 1.4, 3.1, 3.6, 3.7_

  - [ ]* 2.3 Escrever teste de propriedade P1: condição de disparo é conjunção das três condições
    - **Property 1: Condição de disparo é conjunção das três condições**
    - **Validates: Requirements 3.1, 3.6, 3.7**
    - Usar `fc.string()` × 3 para gerar combinações arbitrárias de `visibilityState`, `permission` e `notificationsPref`
    - Verificar que `shouldNotify` retorna `true` sse os três valores são exatamente `"hidden"`, `"granted"` e `"enabled"`
    - Tag: `// Feature: response-notifications, Property 1: condição de disparo é conjunção das três condições`

  - [ ] 2.4 Implementar `initNotifications({ store, toastFn })` e `requestNotificationPermission()`
    - `initNotifications`: armazena referências a `_store` e `_toast`; não solicita permissão; apenas lê estado atual
    - `requestNotificationPermission()`: verifica `isSupported()` e `!isBlocked()` antes de chamar `Notification.requestPermission()`; atualiza `store.get("behavior").notifications` e chama `onChange` conforme resultado; exibe toast de aviso quando `"denied"`; retorna `"granted"` | `"denied"` | `"default"` | `"unsupported"`
    - Tratar o caso em que `requestPermission()` lança exceção (capturar, exibir toast de erro, retornar `"denied"`)
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 5.1, 5.2_

  - [ ]* 2.5 Escrever testes de exemplo para `requestNotificationPermission()`
    - Cobrir: retorna `"granted"` e atualiza store para `"enabled"`; retorna `"denied"` e store permanece `"disabled"` com toast; `Notification.permission === "denied"` antes de chamar — `requestPermission()` não é invocado; `isSupported() === false` retorna `"unsupported"`
    - _Requirements: 1.2, 1.3, 1.5, 1.6_

  - [ ] 2.6 Implementar `notifyResponseComplete()`
    - Verificar `isSupported()`, `_store !== null`, e chamar `shouldNotify(document.visibilityState, Notification.permission, store.get("behavior").notifications)`
    - Fechar `activeNotification` anterior (e limpar `autoCloseTimer`) antes de criar nova
    - Criar `new Notification("Offline AI Chat", { body: "O modelo terminou de responder.", icon: "/favicon.ico" })` dentro de `try/catch`
    - Configurar `n.onclick` para chamar `window.focus()` e `n.close()`; configurar `n.onclose` para limpar `activeNotification`
    - Configurar `autoCloseTimer = setTimeout(() => n.close(), 8000)`
    - Capturar qualquer exceção de `new Notification(...)` com `console.warn` sem propagar
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 5.3_

  - [ ]* 2.7 Escrever testes de exemplo para `notifyResponseComplete()`
    - Cobrir: `visibilityState === "visible"` → nenhuma `Notification` criada; `permission !== "granted"` → nenhuma criada; `notifications === "disabled"` → nenhuma criada; condições atendidas → `Notification` criada com título `"Offline AI Chat"`; auto-close após 8s; click chama `window.focus()` e `close()`
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 2.8 Escrever teste de propriedade P3: no máximo uma notificação ativa por vez
    - **Property 3: No máximo uma notificação ativa por vez**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Usar `fc.integer({ min: 2, max: 10 })` para número de chamadas consecutivas a `notifyResponseComplete()` com condições satisfeitas
    - Verificar que cada chamada fecha a notificação anterior antes de criar nova (mock de `Notification` que rastreia instâncias)
    - Tag: `// Feature: response-notifications, Property 3: no máximo uma notificação ativa por vez`

  - [ ]* 2.9 Escrever teste de propriedade P4: exceções do construtor Notification nunca propagam
    - **Property 4: Exceções do construtor Notification nunca propagam**
    - **Validates: Requirements 5.3**
    - Usar `fc.constantFrom(new Error(), new TypeError(), new DOMException())` para simular exceções do construtor
    - Verificar que `notifyResponseComplete()` nunca lança, independente do tipo de exceção
    - Tag: `// Feature: response-notifications, Property 4: exceções do construtor Notification nunca propagam`

  - [ ]* 2.10 Escrever teste de propriedade P2: conteúdo da mensagem nunca aparece na notificação
    - **Property 2: Conteúdo da mensagem nunca aparece na notificação**
    - **Validates: Requirements 3.2, 3.3**
    - Usar `fc.string()` para gerar conteúdo arbitrário de mensagem
    - Verificar que o corpo da notificação criada é sempre `"O modelo terminou de responder."`, independente do conteúdo gerado
    - Tag: `// Feature: response-notifications, Property 2: conteúdo da mensagem nunca aparece na notificação`

- [ ] 3. Checkpoint — Verificar módulo de notificações
  - Garantir que todos os testes passam com `npm test`; verificar sintaxe com `npm run check`; perguntar ao usuário se houver dúvidas antes de prosseguir.

- [ ] 4. Integrar controle de notificações no painel de Comportamento
  - [ ] 4.1 Adicionar import de `isSupported`, `isBlocked` e `requestNotificationPermission` de `../notifications.js` em `modules/ui/settings/behavior.js`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 4.2 Adicionar checkbox de notificações em `panelBehavior()` após os checkboxes existentes e antes da seção de backup
    - Renderizar o controle apenas quando `notificationsSupported()` retornar `true` (Requirement 2.1)
    - Estado inicial: `notifPref === "enabled" && !blocked`
    - Quando ativado: chamar `requestNotificationPermission()`; se resultado não for `"granted"`, reverter o checkbox visualmente
    - Quando desativado: setar `b.notifications = "disabled"` e chamar `onChange()`
    - Quando `isBlocked()`: desabilitar o input (`input.disabled = true`) e adicionar parágrafo explicativo com classe `field-hint`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 1.5_

  - [ ]* 4.3 Escrever testes de exemplo para a lógica de estado do checkbox de notificações
    - Cobrir: `isSupported() === false` → controle não renderizado; `isBlocked() === true` → input desabilitado com hint; `notifPref === "enabled"` → checkbox marcado; `notifPref === "disabled"` → checkbox desmarcado
    - _Requirements: 2.1, 2.4_

- [ ] 5. Integrar `initNotifications` e `notifyResponseComplete` em `app.js`
  - [ ] 5.1 Adicionar import de `initNotifications` e `notifyResponseComplete` de `./modules/notifications.js` em `app.js`
    - _Requirements: 1.6, 3.1_

  - [ ] 5.2 Chamar `initNotifications({ store, toastFn: toast })` na inicialização de `app.js`, após `initToasts` e a criação do store
    - _Requirements: 1.6, 6.4_

  - [ ] 5.3 Chamar `notifyResponseComplete()` após `finalizeAssistant(...)` no fluxo de streaming bem-sucedido (`isError === false`)
    - Localizar o ponto em `app.js` onde `finalizeAssistant` é chamado com `isError === false` e adicionar a chamada imediatamente após
    - A chamada deve ocorrer apenas no caminho de sucesso — não em erros ou aborts
    - _Requirements: 3.1, 3.6_

- [ ] 6. Escrever testes de schema e soft migration
  - [ ]* 6.1 Escrever testes de exemplo para o schema
    - Verificar que `defaults().behavior.notifications === "disabled"`
    - Verificar que schema v2 sem `behavior.notifications` após `loadAndMigrate()` recebe o campo como `"disabled"`
    - Verificar que schema v2 com `behavior.notifications === "enabled"` após `loadAndMigrate()` preserva `"enabled"`
    - _Requirements: 6.1, 6.2_

  - [ ]* 6.2 Escrever teste de propriedade P5: soft migration preserva campos existentes e adiciona `notifications`
    - **Property 5: Soft migration preserva campos existentes e adiciona `notifications`**
    - **Validates: Requirements 6.1, 6.2**
    - Usar `fc.record(...)` para gerar objetos de schema v2 arbitrários sem o campo `behavior.notifications`
    - Verificar que após `loadAndMigrate()` o campo é `"disabled"` e todos os outros campos do objeto original permanecem inalterados
    - Tag: `// Feature: response-notifications, Property 5: soft migration preserva campos existentes e adiciona notifications`

- [ ] 7. Checkpoint final — Garantir que tudo está integrado
  - Executar `npm run check` para validar sintaxe de todos os arquivos modificados
  - Executar `npm test` para garantir que todos os testes passam
  - Perguntar ao usuário se houver dúvidas antes de encerrar.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia os requisitos específicos para rastreabilidade
- O módulo `notifications.js` exporta funções puras (`isSupported`, `isBlocked`, `shouldNotify`) separadas das funções com efeitos colaterais — isso facilita os testes sem necessidade de DOM real
- Os testes de propriedade devem ser adicionados ao arquivo existente `tests/feature-improvements.test.js`, seguindo o padrão já estabelecido com `runProperty` e `fc.assert`
- A feature é 100% client-side — nenhuma modificação em `server.js` é necessária
