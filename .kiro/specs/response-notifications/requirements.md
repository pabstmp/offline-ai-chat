# Requirements Document

## Introduction

A feature de **Notificações de Resposta** permite ao Offline AI Chat alertar o usuário quando o modelo terminar de gerar uma resposta, especialmente quando a aba do browser está em segundo plano ou a janela está minimizada. O mecanismo utilizado é a **Web Notifications API** nativa do browser, que exibe notificações no nível do sistema operacional.

A feature é completamente **opt-in**: o app nunca solicita permissão de notificação sem ação explícita do usuário, e o usuário pode revogar ou desativar as notificações a qualquer momento nas configurações do app. Nenhum dado de conversa é transmitido para servidores externos — o conteúdo da notificação é composto inteiramente no browser.

## Glossary

- **Notification_Manager**: módulo client-side (`modules/notifications.js`) responsável por solicitar permissão, verificar o estado atual e disparar notificações via Web Notifications API.
- **Notification_Permission**: estado retornado por `Notification.permission` — pode ser `"default"` (não decidido), `"granted"` (concedido) ou `"denied"` (negado).
- **Background_Tab**: condição em que `document.visibilityState === "hidden"`, indicando que a aba do browser não está visível para o usuário.
- **Response_Completion**: evento disparado quando o streaming de uma resposta do assistente é finalizado com sucesso (sem erro), correspondente à chamada de `finalizeAssistant` em `modules/ui/chat.js`.
- **Settings_Behavior**: painel "Comportamento" nas configurações do app (`modules/ui/settings/behavior.js`), onde preferências de interação são agrupadas.
- **Store**: estado reativo global gerenciado por `modules/store.js`, persistido em `localStorage["offline-ai-chat:v2"]`.

## Requirements

### Requirement 1: Controle de permissão opt-in

**User Story:** Como usuário, quero decidir explicitamente se o app pode me enviar notificações, para que minha privacidade e preferências de sistema sejam respeitadas.

#### Acceptance Criteria

1. THE Notification_Manager SHALL verificar o valor de `Notification.permission` antes de qualquer tentativa de exibir uma notificação.
2. WHEN o usuário ativa a opção de notificações nas configurações pela primeira vez, THE Notification_Manager SHALL chamar `Notification.requestPermission()` para solicitar permissão ao browser.
3. IF `Notification.permission` for `"denied"`, THEN THE Notification_Manager SHALL NOT chamar `Notification.requestPermission()` novamente.
4. IF o browser não suportar a Web Notifications API (`"Notification" not in window`), THEN THE Notification_Manager SHALL registrar o estado como não suportado e não exibir nenhum controle de ativação nas configurações.
5. WHEN `Notification.requestPermission()` retornar `"denied"`, THE Notification_Manager SHALL atualizar o Store para desativar as notificações e exibir uma mensagem informativa ao usuário via toast indicando que a permissão foi negada pelo browser.
6. WHEN `Notification.requestPermission()` retornar `"granted"`, THE Notification_Manager SHALL atualizar o Store para registrar o estado `"granted"` e ativar as notificações.

---

### Requirement 2: Configuração de notificações no painel de Comportamento

**User Story:** Como usuário, quero ativar e desativar as notificações de resposta diretamente nas configurações do app, para que eu possa controlar esse comportamento sem precisar acessar as configurações do browser.

#### Acceptance Criteria

1. THE Settings_Behavior SHALL exibir um controle de ativação (checkbox ou toggle) para notificações de resposta, visível apenas quando o browser suportar a Web Notifications API.
2. WHEN o controle de notificações estiver desativado e o usuário o ativar, THE Settings_Behavior SHALL acionar o fluxo de solicitação de permissão descrito no Requirement 1.
3. WHEN o controle de notificações estiver ativado e o usuário o desativar, THE Settings_Behavior SHALL atualizar o Store para desativar as notificações sem revogar a permissão do browser.
4. IF `Notification.permission` for `"denied"`, THE Settings_Behavior SHALL exibir o controle de notificações como desativado e não-interativo, acompanhado de um texto explicativo indicando que a permissão foi bloqueada no browser.
5. THE Store SHALL persistir a preferência de notificações do usuário no campo `behavior.notifications` com os valores `"enabled"` ou `"disabled"`, com valor padrão `"disabled"`.
6. WHEN o app for carregado, THE Notification_Manager SHALL ler o campo `behavior.notifications` do Store e restaurar o estado de notificações sem solicitar permissão novamente.

---

### Requirement 3: Disparo de notificação ao concluir resposta em background

**User Story:** Como usuário, quero receber uma notificação do sistema quando o modelo terminar de gerar uma resposta enquanto estou em outra aba ou janela, para que eu saiba quando posso voltar ao chat.

#### Acceptance Criteria

1. WHEN uma Response_Completion ocorrer e `document.visibilityState` for `"hidden"` e `Notification.permission` for `"granted"` e `behavior.notifications` for `"enabled"`, THE Notification_Manager SHALL exibir uma notificação via `new Notification(...)`.
2. THE Notification_Manager SHALL usar como título da notificação o nome do app ("Offline AI Chat") e como corpo um texto fixo indicando que a resposta foi concluída (ex: "O modelo terminou de responder.").
3. THE Notification_Manager SHALL NOT incluir nenhum trecho do conteúdo da mensagem gerada no corpo da notificação.
4. WHEN o usuário clicar na notificação, THE Notification_Manager SHALL chamar `window.focus()` para trazer a aba do app para o primeiro plano e fechar a notificação.
5. THE Notification_Manager SHALL fechar automaticamente a notificação após 8 segundos caso o usuário não interaja com ela.
6. IF uma Response_Completion ocorrer enquanto `document.visibilityState` for `"visible"`, THE Notification_Manager SHALL NOT exibir notificação.
7. IF `Notification.permission` não for `"granted"` no momento da Response_Completion, THE Notification_Manager SHALL NOT tentar exibir notificação nem solicitar permissão.

---

### Requirement 4: Notificação única por resposta

**User Story:** Como usuário, quero receber no máximo uma notificação por resposta gerada, para que não seja inundado por alertas repetidos em sessões longas.

#### Acceptance Criteria

1. THE Notification_Manager SHALL manter no máximo uma notificação ativa por vez, descartando a notificação anterior antes de exibir uma nova.
2. WHEN uma nova Response_Completion ocorrer enquanto uma notificação anterior ainda estiver visível, THE Notification_Manager SHALL fechar a notificação anterior e exibir uma nova.
3. THE Notification_Manager SHALL NOT acumular notificações pendentes: se o usuário não interagiu com a notificação anterior, ela é substituída pela mais recente.

---

### Requirement 5: Compatibilidade e degradação graciosa

**User Story:** Como usuário em um browser que não suporta notificações, quero que o app continue funcionando normalmente sem erros, para que a ausência do recurso não afete minha experiência.

#### Acceptance Criteria

1. IF `"Notification" not in window`, THEN THE Notification_Manager SHALL operar em modo silencioso, sem lançar exceções e sem exibir controles de notificação na UI.
2. IF `Notification.requestPermission` não estiver disponível como função, THEN THE Notification_Manager SHALL tratar o browser como não suportado e operar em modo silencioso.
3. IF a criação de uma notificação via `new Notification(...)` lançar uma exceção, THEN THE Notification_Manager SHALL capturar o erro, registrá-lo no console e não propagar a exceção para o fluxo principal do app.
4. THE Notification_Manager SHALL funcionar corretamente nos browsers Chromium (Chrome, Edge, Brave) e Firefox nas versões que suportam a Web Notifications API.
5. WHERE o app estiver sendo acessado via HTTPS ou localhost, THE Notification_Manager SHALL operar normalmente, pois a Web Notifications API requer origem segura.

---

### Requirement 6: Integração com o schema de persistência

**User Story:** Como usuário, quero que minha preferência de notificações seja lembrada entre sessões, para que eu não precise reconfigurar o app toda vez que abrir o browser.

#### Acceptance Criteria

1. THE Store SHALL incluir o campo `behavior.notifications` no schema padrão (`modules/schema.js:defaults()`), com valor inicial `"disabled"`.
2. WHEN o schema for migrado de uma versão anterior que não contenha `behavior.notifications`, THE Store SHALL aplicar o valor padrão `"disabled"` sem sobrescrever outras preferências existentes.
3. THE Store SHALL persistir alterações em `behavior.notifications` via o mecanismo de debounce existente (250ms) em `debouncedPersist`.
4. THE Notification_Manager SHALL ler `behavior.notifications` exclusivamente do Store, sem acessar `localStorage` diretamente.
