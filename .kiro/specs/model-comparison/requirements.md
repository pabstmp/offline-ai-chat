# Requirements Document

## Introduction

A feature de **Comparação de Modelos Lado a Lado** permite ao usuário enviar o mesmo prompt para dois modelos diferentes simultaneamente e visualizar as respostas em colunas paralelas, em tempo real via streaming. O objetivo é facilitar a avaliação comparativa de modelos — qualidade de resposta, velocidade, estilo — sem precisar alternar entre conversas ou reenviar o prompt manualmente.

O modo de comparação é acessado a partir da interface principal de chat. O usuário seleciona dois modelos (podendo ser de servidores diferentes), digita o prompt e dispara as duas requisições em paralelo. Cada coluna exibe o streaming independente do seu modelo, com indicadores de progresso, tempo e tokens por segundo. Ao final, o usuário pode copiar qualquer resposta ou iniciar uma conversa normal a partir de uma delas.

## Glossary

- **Comparison_View**: modo de interface que exibe duas colunas de resposta lado a lado, ativado pelo usuário a partir do chat principal.
- **Comparison_Panel**: cada uma das duas colunas da Comparison_View, associada a um modelo específico.
- **Comparison_Session**: estado efêmero de uma rodada de comparação — inclui o prompt enviado, os dois modelos selecionados e as respostas recebidas. Não é persistido no histórico de conversas.
- **Model_Selector**: controle de UI dentro de cada Comparison_Panel que permite ao usuário escolher o modelo a ser usado naquele painel.
- **Comparison_Composer**: área de entrada de texto compartilhada entre os dois painéis, de onde o prompt é enviado simultaneamente para ambos os modelos.
- **Stream_Controller**: instância de `AbortController` associada a cada Comparison_Panel, responsável por cancelar o streaming daquele painel individualmente.
- **Comparison_Manager**: módulo client-side (`modules/ui/comparison.js`) que orquestra a Comparison_View, os dois Stream_Controllers e a lógica de envio paralelo.
- **Server**: objeto de configuração de servidor `{ id, nickname, baseUrl, apiKey, timeoutMs }` conforme schema v2 do storage.
- **Profile**: objeto de perfil `{ id, name, systemPrompt, sampling }` conforme schema v2 do storage.

## Requirements

### Requirement 1: Ativar e desativar o modo de comparação

**User Story:** Como usuário, quero ativar um modo de comparação lado a lado a partir da interface de chat, para que eu possa avaliar dois modelos com o mesmo prompt sem sair da aplicação.

#### Acceptance Criteria

1. THE Comparison_View SHALL ser acessível a partir de um botão ou controle visível na topbar ou na área do composer do chat principal.
2. WHEN o usuário ativa o modo de comparação, THE Comparison_Manager SHALL substituir a área de mensagens do chat pela Comparison_View, mantendo a topbar e o composer visíveis.
3. WHEN o usuário desativa o modo de comparação, THE Comparison_Manager SHALL restaurar a visualização normal do chat, descartando o estado da Comparison_Session atual.
4. WHILE o modo de comparação estiver ativo e uma geração estiver em andamento, THE Comparison_Manager SHALL exibir confirmação antes de desativar o modo, para evitar perda de resposta em progresso.
5. THE Comparison_View SHALL ser responsiva: em viewports com largura inferior a 768px, THE Comparison_View SHALL empilhar os dois Comparison_Panels verticalmente em vez de exibi-los lado a lado.

---

### Requirement 2: Selecionar modelos para comparação

**User Story:** Como usuário, quero selecionar independentemente o modelo de cada painel de comparação, incluindo modelos de servidores diferentes, para que eu possa comparar qualquer combinação disponível.

#### Acceptance Criteria

1. THE Comparison_View SHALL exibir um Model_Selector em cada Comparison_Panel, listando todos os modelos disponíveis nos servidores configurados.
2. THE Model_Selector SHALL agrupar os modelos por servidor quando houver mais de um servidor configurado, exibindo o nickname do servidor como cabeçalho de grupo.
3. WHEN o usuário abre o Comparison_View pela primeira vez em uma sessão, THE Comparison_Manager SHALL pré-selecionar no painel esquerdo o modelo ativo do perfil corrente e deixar o painel direito sem seleção.
4. THE Model_Selector SHALL permitir que os dois painéis selecionem o mesmo modelo simultaneamente, sem restrição.
5. IF nenhum modelo estiver disponível em nenhum servidor configurado, THEN THE Comparison_Manager SHALL exibir uma mensagem de erro orientando o usuário a verificar a conexão com o servidor, em vez de exibir um Model_Selector vazio.
6. WHEN o usuário altera a seleção de modelo em um Comparison_Panel durante uma geração em andamento naquele painel, THE Comparison_Manager SHALL cancelar a geração em andamento naquele painel antes de aplicar a nova seleção.

---

### Requirement 3: Enviar prompt para ambos os modelos simultaneamente

**User Story:** Como usuário, quero digitar um prompt uma única vez e enviá-lo para os dois modelos ao mesmo tempo, para que a comparação seja justa e o fluxo seja eficiente.

#### Acceptance Criteria

1. THE Comparison_Composer SHALL aceitar texto de entrada e enviar o mesmo conteúdo para ambos os Comparison_Panels ao acionar o envio.
2. WHEN o usuário aciona o envio no Comparison_Composer, THE Comparison_Manager SHALL iniciar as duas requisições de completion em paralelo, sem aguardar a conclusão de uma para iniciar a outra.
3. THE Comparison_Manager SHALL usar o `systemPrompt` e os parâmetros de `sampling` do perfil ativo para ambas as requisições, substituindo apenas o modelo de cada painel.
4. THE Comparison_Manager SHALL usar o servidor associado ao modelo selecionado em cada painel para rotear cada requisição ao endpoint correto.
5. IF um dos dois Comparison_Panels não tiver modelo selecionado quando o usuário acionar o envio, THEN THE Comparison_Manager SHALL exibir uma mensagem de erro naquele painel solicitando a seleção de um modelo, sem bloquear o envio para o outro painel.
6. THE Comparison_Composer SHALL limpar o campo de texto após o envio bem-sucedido para ambos os painéis.
7. WHILE uma geração estiver em andamento em qualquer Comparison_Panel, THE Comparison_Composer SHALL desabilitar o botão de envio para evitar envios sobrepostos.

---

### Requirement 4: Exibir respostas em streaming lado a lado

**User Story:** Como usuário, quero ver as respostas dos dois modelos chegando em tempo real nas colunas paralelas, para que eu possa acompanhar o progresso e comparar o ritmo de geração de cada modelo.

#### Acceptance Criteria

1. WHEN uma requisição de completion com streaming for iniciada em um Comparison_Panel, THE Comparison_Panel SHALL exibir os tokens recebidos incrementalmente usando o mecanismo de `appendStreamingDelta` existente em `modules/ui/chat.js`.
2. THE Comparison_Panel SHALL exibir um indicador de progresso com tempo decorrido e tokens por segundo durante o streaming, usando o mecanismo de `startGenerationTimer` existente em `modules/ui/chat.js`.
3. WHEN o streaming de um Comparison_Panel for concluído, THE Comparison_Panel SHALL renderizar o conteúdo final em Markdown usando `finalizeAssistant` de `modules/ui/chat.js`, exibindo estatísticas de uso (tokens de prompt, tokens de completion, tempo total, tok/s).
4. IF o modelo selecionado em um Comparison_Panel for um modelo de raciocínio que retorna `reasoning_content`, THEN THE Comparison_Panel SHALL exibir o bloco de raciocínio colapsável acima da resposta, seguindo o mesmo padrão visual do chat principal.
5. THE Comparison_View SHALL permitir scroll independente em cada Comparison_Panel quando o conteúdo exceder a altura disponível.
6. WHILE o streaming estiver em andamento em um Comparison_Panel, THE Comparison_Panel SHALL exibir o nome do modelo sendo usado como cabeçalho daquele painel.

---

### Requirement 5: Controlar e cancelar gerações individualmente

**User Story:** Como usuário, quero poder parar a geração de um painel individualmente sem afetar o outro, para que eu possa interromper um modelo lento sem perder a resposta do outro.

#### Acceptance Criteria

1. THE Comparison_Panel SHALL exibir um botão "Parar" visível durante o streaming daquele painel.
2. WHEN o usuário aciona o botão "Parar" em um Comparison_Panel, THE Stream_Controller daquele painel SHALL cancelar a requisição SSE correspondente sem afetar o streaming do outro Comparison_Panel.
3. WHEN o streaming de um Comparison_Panel for cancelado pelo usuário, THE Comparison_Panel SHALL finalizar a exibição com o conteúdo parcial recebido até o momento, indicando visualmente que a geração foi interrompida.
4. THE Comparison_Manager SHALL manter um Stream_Controller independente para cada Comparison_Panel, de forma que o cancelamento de um não propague sinal de abort para o outro.
5. WHEN ambos os Comparison_Panels concluírem ou forem cancelados, THE Comparison_Composer SHALL reabilitar o botão de envio.

---

### Requirement 6: Copiar e aproveitar respostas

**User Story:** Como usuário, quero copiar a resposta de qualquer painel ou iniciar uma conversa normal a partir dela, para que eu possa aproveitar o resultado da comparação no meu fluxo de trabalho.

#### Acceptance Criteria

1. WHEN o streaming de um Comparison_Panel for concluído, THE Comparison_Panel SHALL exibir um botão "Copiar" que copia o conteúdo textual da resposta para a área de transferência do usuário.
2. WHEN o usuário aciona "Copiar" em um Comparison_Panel, THE Comparison_Panel SHALL exibir uma confirmação visual temporária (ex: texto do botão muda para "Copiado!") por no mínimo 1500ms antes de restaurar o estado original.
3. WHEN o streaming de um Comparison_Panel for concluído, THE Comparison_Panel SHALL exibir um botão "Usar esta resposta" que encerra o modo de comparação e cria uma nova conversa no chat principal contendo o prompt enviado e a resposta daquele painel.
4. WHEN o usuário aciona "Usar esta resposta" em um Comparison_Panel, THE Comparison_Manager SHALL cancelar qualquer streaming ainda em andamento no outro Comparison_Panel antes de sair do modo de comparação.
5. IF a API de área de transferência (`navigator.clipboard.writeText`) não estiver disponível no contexto atual, THEN THE Comparison_Panel SHALL exibir uma mensagem de erro via toast orientando o usuário a copiar manualmente.

---

### Requirement 7: Tratamento de erros por painel

**User Story:** Como usuário, quero que erros em um painel sejam exibidos naquele painel sem afetar o outro, para que uma falha de um modelo não impeça de ver a resposta do outro.

#### Acceptance Criteria

1. IF a requisição de completion de um Comparison_Panel falhar (erro de rede, timeout, erro HTTP), THEN THE Comparison_Panel SHALL exibir a mensagem de erro dentro daquele painel, sem exibir toast global e sem afetar o outro Comparison_Panel.
2. IF o modelo selecionado em um Comparison_Panel retornar `finish_reason: length`, THEN THE Comparison_Panel SHALL exibir o conteúdo parcial recebido e uma nota informativa indicando que a resposta foi truncada por limite de tokens.
3. IF a conexão com o servidor de um Comparison_Panel for perdida durante o streaming, THEN THE Comparison_Panel SHALL exibir o conteúdo parcial recebido até o momento e uma mensagem de erro indicando a interrupção da conexão.
4. THE Comparison_Manager SHALL garantir que um erro em qualquer Comparison_Panel não lance exceção não tratada que interrompa o funcionamento do outro painel ou da aplicação.

---

### Requirement 8: Histórico e persistência da sessão de comparação

**User Story:** Como usuário, quero entender claramente que sessões de comparação são temporárias e não poluem meu histórico de conversas, para que eu possa usar o modo de comparação livremente sem acumular entradas desnecessárias no histórico.

#### Acceptance Criteria

1. THE Comparison_Manager SHALL NOT persistir a Comparison_Session no `conversationStore` (localStorage/IndexedDB) ao término da comparação.
2. THE Comparison_Manager SHALL NOT exibir a Comparison_Session na sidebar de histórico de conversas durante ou após a sessão.
3. WHEN o usuário aciona "Usar esta resposta" em um Comparison_Panel, THE Comparison_Manager SHALL criar e persistir uma nova Conversation no `conversationStore` contendo apenas o par de mensagens (prompt do usuário + resposta do painel selecionado), sem incluir a resposta do outro painel.
4. WHEN o usuário recarrega a página enquanto o modo de comparação está ativo, THE Comparison_Manager SHALL inicializar a aplicação no modo de chat normal, descartando qualquer estado de Comparison_Session não persistido.
