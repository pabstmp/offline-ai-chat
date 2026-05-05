# Requirements Document

## Introduction

Este documento especifica 9 melhorias de funcionalidade e qualidade de vida para o **Offline AI Chat** — cliente web self-hosted para LM Studio, construído em Vanilla JS puro (ES modules), sem build step e sem frameworks. O storage usa localStorage + IndexedDB via `conversationStore`. O backend é um proxy Node 18+ simples. As melhorias cobrem: backup completo de conversas, fork de conversa, comparação A/B de respostas, suporte a imagens no composer, templates de conversa, indicador de indexação RAG no topbar, atalho para alternar servidores, persistência de scroll por conversa e modo de foco por mensagem.

---

## Glossary

- **App**: A aplicação Offline AI Chat como um todo.
- **Conversation**: Objeto `{ id, title, profileId, serverId, model, createdAt, updatedAt, messages[] }` persistido via `conversationStore`.
- **ConversationStore**: Módulo `modules/storage.js` que expõe `list`, `get`, `upsert`, `remove` e `clear` sobre localStorage/IndexedDB.
- **Composer**: Área de entrada de mensagem (`#chatForm`) com textarea, botões de ação e barra inferior.
- **Message**: Objeto `{ id, role, content, ts }` dentro de `Conversation.messages`.
- **Profile**: Configuração de inferência com system prompt, modelo padrão e parâmetros de sampling.
- **Server**: Entrada em `connection.servers` com `id`, `nickname`, `baseUrl`, `apiKey`.
- **RAG_Manager**: Módulo `modules/rag/manager.js` com pubsub (`subscribe`/`notify`) para eventos de indexação.
- **Topbar**: Cabeçalho fixo (`header.topbar`) com chips de perfil, modelo, status pill e botões de ação.
- **StatusPill**: Botão `#statusPill` no Topbar que exibe o estado da conexão com o servidor ativo.
- **Sidebar**: Painel lateral `#sidebar` com histórico de conversas e busca.
- **Settings_Drawer**: Modal de configurações `#settingsDrawer` com abas (Servidor, Comportamento, Avançado, etc.).
- **Template**: Objeto `{ id, name, systemPrompt, messages[] }` que representa uma conversa pré-populada reutilizável.
- **Fork**: Nova conversa criada a partir de um subconjunto do histórico de uma conversa existente.
- **AB_Comparison**: Exibição lado a lado de duas respostas do assistente para a mesma mensagem do usuário.
- **Focus_Modal**: Overlay de tela cheia que exibe o conteúdo de uma única mensagem.
- **Image_Attachment**: Imagem codificada em base64 enviada como `content` com `type: "image_url"` na API OpenAI-compatible.
- **RAG_Indexing_Indicator**: Elemento visual animado no Topbar que sinaliza indexação RAG em andamento.
- **Scroll_Position_Cache**: Mapa em memória (`Map<conversationId, scrollTop>`) que preserva a posição de scroll por conversa durante a sessão.

---

## Requirements

### Requirement 1: Backup Completo de Conversas

**User Story:** Como usuário, quero exportar todas as minhas conversas em um único arquivo JSON e importá-las de volta sem perder as existentes, para que eu possa fazer backup e restaurar meu histórico completo.

#### Acceptance Criteria

1. THE Settings_Drawer SHALL exibir um botão "Exportar tudo" na aba Comportamento, na seção de backup de conversas.
2. WHEN o usuário clica em "Exportar tudo", THE App SHALL coletar todas as conversas via `conversationStore.list()` e disparar o download de um arquivo JSON nomeado `offline-ai-backup-{YYYY-MM-DD}.json` contendo o array completo de conversas.
3. THE Settings_Drawer SHALL exibir um botão "Importar backup" na aba Comportamento, adjacente ao botão "Exportar tudo".
4. WHEN o usuário clica em "Importar backup" e seleciona um arquivo JSON válido, THE App SHALL fazer merge das conversas importadas com as existentes, preservando conversas já presentes e adicionando apenas as ausentes (identificadas por `id`).
5. WHEN o arquivo selecionado não é um JSON válido ou não contém um array de conversas, THE App SHALL exibir um toast de erro descritivo sem alterar o storage existente.
6. WHEN a importação é concluída com sucesso, THE App SHALL exibir um toast de sucesso indicando quantas conversas foram adicionadas e quantas já existiam, e SHALL atualizar o Sidebar.

---

### Requirement 2: Fork de Conversa

**User Story:** Como usuário, quero criar uma nova conversa a partir de qualquer ponto do histórico de uma conversa existente, para que eu possa explorar caminhos alternativos sem alterar a conversa original.

#### Acceptance Criteria

1. THE Chat SHALL exibir um botão de ação "Continuar daqui" na barra de ações de cada mensagem do assistente, visível ao passar o mouse sobre a mensagem.
2. WHEN o usuário clica em "Continuar daqui" em uma mensagem do assistente, THE App SHALL criar uma nova Conversation com o histórico copiado desde o início até a mensagem clicada (inclusive).
3. THE App SHALL atribuir à nova Conversation um `id` único, `title` derivado do título original com sufixo " (fork)", `createdAt` e `updatedAt` com o timestamp atual, e os mesmos `profileId`, `serverId` e `model` da conversa original.
4. WHEN a nova Conversation é criada, THE App SHALL persistir a nova conversa via `conversationStore.upsert`, atualizar o Sidebar e carregar a nova conversa como conversa ativa.
5. THE App SHALL preservar a conversa original sem qualquer modificação após o fork.

---

### Requirement 3: Comparação A/B de Respostas

**User Story:** Como usuário, quero regenerar uma resposta do assistente usando um perfil diferente e comparar as duas respostas lado a lado, para que eu possa escolher a melhor resposta antes de continuar a conversa.

#### Acceptance Criteria

1. WHEN o usuário clica em "Regenerar" em uma mensagem do assistente, THE App SHALL exibir um menu com as opções "Regenerar (mesmo perfil)" e "Comparar com outro perfil".
2. WHEN o usuário seleciona "Comparar com outro perfil", THE App SHALL exibir um seletor de perfil listando todos os perfis disponíveis exceto o perfil ativo.
3. WHEN o usuário confirma o perfil alternativo, THE App SHALL gerar uma nova resposta usando o perfil selecionado para a mesma mensagem do usuário precedente, sem alterar o histórico da conversa.
4. WHEN ambas as respostas estão disponíveis (a original e a nova), THE Chat SHALL exibir as duas respostas lado a lado em um layout de duas colunas dentro da área de mensagens, com o perfil de origem identificado acima de cada coluna.
5. THE AB_Comparison SHALL exibir um botão "Usar esta" abaixo de cada resposta.
6. WHEN o usuário clica em "Usar esta" em uma das respostas, THE App SHALL substituir a mensagem do assistente no histórico pela resposta escolhida, remover o layout de comparação e persistir a conversa via `conversationStore.upsert`.
7. IF o usuário fechar a comparação sem escolher, THEN THE App SHALL manter a resposta original no histórico sem alteração.

---

### Requirement 4: Suporte a Imagens no Composer

**User Story:** Como usuário, quero anexar imagens ao composer e enviá-las para modelos multimodais, para que eu possa fazer perguntas sobre o conteúdo visual de imagens.

#### Acceptance Criteria

1. THE Composer SHALL exibir um botão de upload de imagem (ícone de câmera ou imagem) na barra inferior, adjacente ao botão de anexar arquivo existente.
2. WHEN o usuário clica no botão de upload de imagem, THE App SHALL abrir um seletor de arquivo aceitando apenas tipos `image/png`, `image/jpeg`, `image/gif` e `image/webp`.
3. WHEN o usuário seleciona uma imagem, THE App SHALL ler o arquivo como base64 via `FileReader` e exibir um preview da imagem acima do textarea do Composer, com um botão "×" para remover.
4. WHEN o usuário envia a mensagem com uma imagem anexada, THE App SHALL construir o campo `content` da mensagem do usuário como um array OpenAI-compatible: `[{ type: "text", text: "<texto do usuário>" }, { type: "image_url", image_url: { url: "data:<mime>;base64,<dados>" } }]`.
5. WHEN a mensagem com imagem é renderizada no chat, THE Chat SHALL exibir a imagem inline acima do texto da mensagem do usuário usando uma tag `<img>` com `max-width: 100%` e `border-radius` consistente com o design system.
6. WHEN a mensagem é enviada, THE App SHALL limpar o preview e o dado da imagem do estado do Composer.
7. IF o arquivo selecionado exceder 10 MB, THEN THE App SHALL exibir um toast de erro e não adicionar a imagem ao Composer.

---

### Requirement 5: Templates de Conversa

**User Story:** Como usuário, quero salvar conversas ou configurações iniciais como templates nomeados e usá-los ao criar novas conversas, para que eu possa reutilizar contextos frequentes sem reconfigurar manualmente.

#### Acceptance Criteria

1. THE Settings_Drawer SHALL exibir uma seção "Templates de conversa" na aba Avançado, listando todos os templates salvos com nome e botão de exclusão.
2. THE Sidebar SHALL exibir um botão "Salvar como template" no menu de contexto de cada conversa (ao lado de Renomear, Exportar, Excluir).
3. WHEN o usuário clica em "Salvar como template", THE App SHALL exibir um prompt solicitando o nome do template, com o título da conversa como valor padrão.
4. WHEN o usuário confirma o nome, THE App SHALL criar um Template com `id` único, `name` fornecido, `systemPrompt` do perfil ativo no momento da conversa e `messages` contendo todas as mensagens da conversa, e SHALL persistir o template em `localStorage` sob a chave `offline-ai-chat:templates:v1`.
5. WHEN o usuário cria uma nova conversa via botão "Nova conversa", THE App SHALL exibir um seletor de template (dropdown ou modal) listando todos os templates disponíveis, com opção "Em branco" selecionada por padrão.
6. WHEN o usuário seleciona um template e confirma, THE App SHALL inicializar a nova conversa com o `systemPrompt` do template aplicado ao perfil ativo e as `messages` do template pré-populadas no histórico.
7. WHEN o usuário exclui um template na aba Avançado, THE App SHALL remover o template do storage e atualizar a lista sem recarregar a página.

---

### Requirement 6: Indicador de Indexação RAG no Topbar

**User Story:** Como usuário, quero ver um indicador visual no topbar quando uma indexação RAG está em andamento, para que eu saiba que o sistema está processando sem precisar abrir as configurações.

#### Acceptance Criteria

1. THE Topbar SHALL exibir um elemento RAG_Indexing_Indicator (ícone animado com spinner ou pulso) próximo ao StatusPill quando uma indexação RAG está em andamento.
2. WHEN nenhuma indexação RAG está em andamento, THE Topbar SHALL ocultar o RAG_Indexing_Indicator.
3. WHEN o App é inicializado, THE App SHALL chamar `rag.subscribe` para receber eventos `started`, `progress`, `done` e `error` do RAG_Manager e atualizar a visibilidade do RAG_Indexing_Indicator conforme o estado.
4. WHEN o usuário clica no RAG_Indexing_Indicator, THE App SHALL abrir o Settings_Drawer na aba Workspace.
5. WHEN o evento `done` ou `error` é recebido do RAG_Manager, THE App SHALL ocultar o RAG_Indexing_Indicator.
6. WHILE uma indexação está em andamento, THE RAG_Indexing_Indicator SHALL exibir um tooltip com o texto "Indexando… clique para ver detalhes" ao receber foco ou hover.

---

### Requirement 7: Atalho para Alternar Servidores

**User Story:** Como usuário, quero clicar no chip de status no topbar e ver um dropdown com todos os servidores cadastrados para trocar rapidamente de servidor sem abrir as configurações completas.

#### Acceptance Criteria

1. WHEN o usuário clica no StatusPill, THE App SHALL exibir um dropdown posicionado abaixo do StatusPill listando todos os servidores em `connection.servers`.
2. THE dropdown SHALL marcar o servidor ativo com um indicador visual (checkmark ou destaque) e exibir o `nickname` e o estado de conexão de cada servidor.
3. WHEN o usuário seleciona um servidor diferente no dropdown, THE App SHALL atualizar `connection.activeServerId` no store, fechar o dropdown e chamar `loadModels()` para conectar ao novo servidor imediatamente.
4. WHEN o usuário clica fora do dropdown, THE App SHALL fechar o dropdown sem alterar o servidor ativo.
5. THE dropdown SHALL ser acessível via teclado: setas para navegar entre servidores, Enter para selecionar, Escape para fechar.
6. IF apenas um servidor está cadastrado, THE StatusPill SHALL manter o comportamento atual (sem dropdown) e SHALL exibir um tooltip "Adicione servidores em Configurações → Servidor".

---

### Requirement 8: Persistência de Scroll por Conversa

**User Story:** Como usuário, quero que a posição de scroll de cada conversa seja lembrada durante a sessão, para que ao voltar a uma conversa já visitada eu retorne ao ponto onde estava lendo.

#### Acceptance Criteria

1. THE App SHALL manter um Scroll_Position_Cache em memória (não persistido em localStorage) mapeando `conversationId` para `scrollTop`.
2. WHEN o usuário rola o container de mensagens (`#messages`), THE App SHALL atualizar o Scroll_Position_Cache para a conversa ativa com o valor atual de `scrollTop`, com debounce de 150ms para evitar atualizações excessivas.
3. WHEN o usuário navega para uma conversa já presente no Scroll_Position_Cache, THE App SHALL restaurar o `scrollTop` do container de mensagens para o valor armazenado após a renderização das mensagens.
4. WHEN o usuário navega para uma conversa não presente no Scroll_Position_Cache, THE App SHALL rolar o container de mensagens para o final (comportamento atual).
5. WHEN uma nova mensagem é adicionada à conversa ativa e o usuário não está com scroll travado (distância ao final ≤ 64px), THE App SHALL rolar para o final e atualizar o Scroll_Position_Cache.

---

### Requirement 9: Modo de Foco por Mensagem

**User Story:** Como usuário, quero expandir uma mensagem individual em um overlay de tela cheia, para que eu possa ler e copiar respostas longas com código ou tabelas sem distrações.

#### Acceptance Criteria

1. THE Chat SHALL exibir um botão de ação "Foco" (ícone de expandir) na barra de ações de cada mensagem, visível ao passar o mouse sobre a mensagem.
2. WHEN o usuário clica em "Foco" ou pressiona `F` com o cursor sobre uma mensagem, THE App SHALL exibir o Focus_Modal com o conteúdo completo da mensagem renderizado em markdown.
3. THE Focus_Modal SHALL ocupar toda a viewport com um overlay semitransparente de fundo, conteúdo centralizado com `max-width: 900px`, scroll interno e botão "×" no canto superior direito.
4. WHEN o usuário pressiona `Escape` ou clica fora da área de conteúdo do Focus_Modal, THE App SHALL fechar o Focus_Modal.
5. THE Focus_Modal SHALL exibir um botão "Copiar" que copia o conteúdo bruto (markdown) da mensagem para a área de transferência.
6. WHILE o Focus_Modal está aberto, THE App SHALL impedir o scroll do documento principal (`body` com `overflow: hidden`).
7. WHEN o Focus_Modal é fechado, THE App SHALL restaurar o `overflow` do `body` ao valor anterior.
