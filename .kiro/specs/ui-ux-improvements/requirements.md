# Requirements Document

## Introduction

Este documento especifica seis melhorias de UX/UI para o **Offline AI Chat**, um cliente web self-hosted para LM Studio construído em Vanilla JS puro (ES modules, sem build step, sem frameworks). As melhorias visam substituir interações nativas do browser (`prompt()`) por experiências inline, adicionar feedback visual durante e após operações, e tornar a busca e as sugestões mais inteligentes e contextuais.

As seis melhorias são:
1. Busca semântica no histórico de conversas
2. Editor inline de mensagem (substituição do `prompt()` nativo)
3. Indicador de progresso de geração (tokens/s e tempo decorrido)
4. Chips de sugestão dinâmicos e contextuais ao perfil ativo
5. Feedback visual ao copiar código ("Copiado ✓" temporário)
6. Rename inline no sidebar (substituição do `prompt()` nativo)

---

## Glossary

- **Sidebar**: Painel lateral esquerdo (`#sidebar`) que exibe o histórico de conversas, o campo de busca e os botões de ação.
- **History_Search**: Campo de busca textual (`#historySearch`) no Sidebar.
- **Semantic_Search**: Busca por similaridade semântica usando vetores de embedding, em contraste com busca por substring de texto.
- **Embedding_Model**: Modelo de linguagem configurado em `store.rag.embeddingModel`, usado para gerar vetores de embedding para RAG.
- **Conversation**: Objeto `{ id, title, messages[], profileId, createdAt, updatedAt }` persistido via `conversationStore`.
- **Message_Bubble**: Elemento `<article class="msg">` que representa uma mensagem individual no chat.
- **Inline_Editor**: Campo de edição que aparece diretamente dentro do Message_Bubble, sem abrir diálogos nativos do browser.
- **Markdown_Preview**: Renderização visual do conteúdo markdown ao lado ou abaixo do campo de edição.
- **Streaming**: Modo de geração em que tokens chegam incrementalmente via Server-Sent Events, processados por `appendStreamingDelta`.
- **Generation_Stats**: Métricas de geração: tokens por segundo (tok/s) e tempo decorrido em segundos.
- **Usage**: Objeto `{ prompt_tokens, completion_tokens, ... }` retornado pela API ao final da geração.
- **Empty_State**: Tela exibida quando não há mensagens (`#emptyState`), contendo chips de sugestão.
- **Suggestion_Chip**: Botão `.suggestion-chip` no Empty_State que preenche o composer com um prompt pré-definido.
- **Active_Profile**: Perfil selecionado em `store.activeProfileId`, com `systemPrompt`, `name` e `icon`.
- **Code_Block**: Elemento `<pre>` com botão `.code-copy` gerado pelo renderer de markdown em `modules/markdown.js`.
- **Copy_Button**: Botão `.code-copy` dentro de um Code_Block.
- **History_Item**: Elemento `.history-item` no Sidebar que representa uma Conversation.
- **Inline_Rename**: Campo `<input>` que substitui o título do History_Item para edição direta, sem diálogo nativo.
- **RAG**: Retrieval-Augmented Generation — sistema de busca semântica sobre documentos indexados.
- **Embedder**: Módulo `modules/rag/embedder.js` que gera vetores de embedding via API.
- **ConversationStore**: API de persistência em `modules/storage.js` (`conversationStore.list()`, `.get()`, `.upsert()`).

---

## Requirements

### Requirement 1: Busca Semântica no Histórico de Conversas

**User Story:** Como usuário, quero buscar conversas por conceito ou intenção (não apenas por texto exato), para que eu encontre conversas relevantes mesmo quando não lembro as palavras exatas usadas.

#### Acceptance Criteria

1. WHEN o usuário digita no History_Search e o Embedding_Model está configurado em `store.rag.embeddingModel`, THE Sidebar SHALL oferecer busca semântica como alternativa à busca textual existente.

2. WHEN o usuário digita no History_Search e o Embedding_Model não está configurado ou `store.rag.enabled` é `false`, THE Sidebar SHALL executar apenas a busca textual existente, sem degradação de funcionalidade.

3. WHEN a busca semântica está ativa e o usuário digita uma query com 3 ou mais caracteres, THE Sidebar SHALL exibir um indicador visual de carregamento enquanto os embeddings são computados.

4. WHEN a busca semântica retorna resultados, THE Sidebar SHALL ordenar as Conversations por score de similaridade decrescente e exibir apenas as que superam um limiar mínimo de relevância.

5. WHEN a busca semântica está em execução e o usuário digita novamente antes de ela concluir, THE Sidebar SHALL cancelar a busca anterior e iniciar uma nova (debounce de 400ms).

6. IF a busca semântica falhar por erro de rede ou modelo indisponível, THEN THE Sidebar SHALL silenciosamente recair na busca textual existente, sem exibir erro ao usuário.

7. THE Sidebar SHALL indexar o conteúdo das Conversations para busca semântica usando os títulos e o texto das mensagens de cada Conversation.

8. WHEN a busca semântica está ativa, THE Sidebar SHALL exibir um indicador visual (ex.: ícone ou label) que diferencia o modo semântico do modo textual.

---

### Requirement 2: Editor Inline de Mensagem

**User Story:** Como usuário, quero editar uma mensagem diretamente no chat com preview de markdown, para que eu possa corrigir erros sem interromper o fluxo com diálogos nativos do browser.

#### Acceptance Criteria

1. WHEN o usuário clica no botão "Editar" de um Message_Bubble, THE Inline_Editor SHALL substituir o conteúdo renderizado do Message_Bubble por um `<textarea>` com o texto original da mensagem.

2. WHEN o Inline_Editor está aberto, THE Inline_Editor SHALL exibir um preview de markdown ao lado ou abaixo do `<textarea>`, atualizado em tempo real conforme o usuário digita.

3. WHEN o Inline_Editor está aberto, THE Inline_Editor SHALL exibir botões "Salvar" e "Cancelar" dentro do Message_Bubble.

4. WHEN o usuário clica em "Salvar" no Inline_Editor, THE Inline_Editor SHALL fechar e o Message_Bubble SHALL exibir o conteúdo atualizado renderizado em markdown.

5. WHEN o usuário clica em "Cancelar" no Inline_Editor, THE Inline_Editor SHALL fechar e o Message_Bubble SHALL restaurar o conteúdo original sem alterações.

6. WHEN o usuário pressiona `Escape` com o Inline_Editor aberto, THE Inline_Editor SHALL fechar e restaurar o conteúdo original (equivalente a "Cancelar").

7. WHEN o usuário pressiona `Ctrl+Enter` com o Inline_Editor aberto, THE Inline_Editor SHALL salvar as alterações (equivalente a "Salvar").

8. IF outro Inline_Editor já estiver aberto em outro Message_Bubble, THEN THE Inline_Editor SHALL fechar o editor anterior antes de abrir o novo.

9. THE Inline_Editor SHALL ser acessível via teclado: o `<textarea>` SHALL receber foco automaticamente ao abrir.

---

### Requirement 3: Indicador de Progresso de Geração

**User Story:** Como usuário, quero ver tokens por segundo e tempo decorrido durante a geração de uma resposta, para que eu tenha visibilidade do desempenho do modelo em tempo real.

#### Acceptance Criteria

1. WHEN o Streaming de uma resposta do assistente está em andamento, THE Generation_Stats SHALL exibir o tempo decorrido em segundos dentro do Message_Bubble do assistente, atualizado a cada segundo.

2. WHEN o Streaming está em andamento e pelo menos 1 token de conteúdo foi recebido, THE Generation_Stats SHALL exibir a taxa de tokens por segundo (tok/s) calculada como `completion_tokens_gerados / tempo_decorrido_segundos`.

3. WHEN o Streaming é finalizado (sucesso ou interrupção pelo usuário), THE Generation_Stats SHALL parar de atualizar e exibir os valores finais de tok/s e tempo total.

4. WHEN a geração é finalizada com sucesso e o objeto Usage está disponível, THE Generation_Stats SHALL incorporar os dados de Usage (prompt tokens, completion tokens) na linha de estatísticas já existente (`.msg-stats`), sem duplicar a exibição.

5. WHEN o Streaming está em andamento, THE Generation_Stats SHALL ser exibido em uma área visível dentro do Message_Bubble, sem sobrepor o conteúdo da resposta em geração.

6. IF o modelo não retornar dados de Usage ao final da geração, THEN THE Generation_Stats SHALL exibir apenas o tempo decorrido e a taxa estimada de tok/s, sem exibir campos ausentes.

---

### Requirement 4: Chips de Sugestão Dinâmicos e Contextuais

**User Story:** Como usuário, quero que os chips de sugestão na tela inicial reflitam o perfil ativo, para que as sugestões sejam relevantes ao contexto de uso atual.

#### Acceptance Criteria

1. WHEN o Empty_State é exibido, THE Empty_State SHALL renderizar Suggestion_Chips baseados no Active_Profile em vez de chips estáticos fixos no HTML.

2. WHEN o Active_Profile contém palavras-chave de desenvolvimento de software no `systemPrompt` (ex.: "código", "engenheiro", "developer", "python", "typescript", "react"), THE Empty_State SHALL exibir Suggestion_Chips com prompts de desenvolvimento (ex.: "Revisar este código", "Escrever testes", "Explicar este erro").

3. WHEN o Active_Profile não contém palavras-chave de desenvolvimento, THE Empty_State SHALL exibir Suggestion_Chips com prompts gerais (ex.: "Resumir um projeto", "Planejar estudos", "Escrever melhor").

4. WHEN o Active_Profile muda (usuário troca de perfil), THE Empty_State SHALL atualizar os Suggestion_Chips imediatamente, sem recarregar a página.

5. WHEN o Empty_State é exibido e o Active_Profile não existe ou não tem `systemPrompt`, THE Empty_State SHALL exibir os Suggestion_Chips padrão (comportamento equivalente ao atual).

6. THE Empty_State SHALL exibir entre 3 e 5 Suggestion_Chips por vez, selecionados de um conjunto maior de sugestões por perfil.

7. WHEN o usuário clica em um Suggestion_Chip, THE Empty_State SHALL preencher o composer com o `data-prompt` do chip (comportamento existente preservado).

---

### Requirement 5: Feedback Visual ao Copiar Código

**User Story:** Como usuário, quero ver uma confirmação visual quando copio um bloco de código, para que eu saiba que a cópia foi bem-sucedida sem precisar verificar a área de transferência.

#### Acceptance Criteria

1. WHEN o usuário clica no Copy_Button de um Code_Block, THE Copy_Button SHALL exibir o texto "Copiado ✓" por 2 segundos antes de retornar ao texto original "Copiar".

2. WHEN o usuário clica no Copy_Button, THE Copy_Button SHALL permanecer visível durante os 2 segundos de feedback, independentemente de o mouse ter saído do Code_Block.

3. WHEN os 2 segundos de feedback expiram, THE Copy_Button SHALL retornar ao estado original (texto "Copiar" e visibilidade controlada por hover do Code_Block).

4. WHEN o Copy_Button está no estado de feedback ("Copiado ✓"), THE Copy_Button SHALL ter aparência visual diferenciada (ex.: cor de sucesso) para reforçar o feedback positivo.

5. IF a API `navigator.clipboard` não estiver disponível, THEN THE Copy_Button SHALL manter o comportamento de fallback existente sem exibir o feedback visual de sucesso.

6. WHEN múltiplos Code_Blocks estão visíveis, THE Copy_Button de cada Code_Block SHALL gerenciar seu próprio estado de feedback de forma independente.

---

### Requirement 6: Rename Inline no Sidebar

**User Story:** Como usuário, quero renomear uma conversa diretamente no sidebar sem diálogos nativos do browser, para que a experiência de renomeação seja fluida e integrada à interface.

#### Acceptance Criteria

1. WHEN o usuário seleciona "Renomear" no menu de contexto de um History_Item, THE Sidebar SHALL substituir o título do History_Item por um Inline_Rename (`<input type="text">`) com o título atual pré-preenchido.

2. WHEN o Inline_Rename é aberto, THE Inline_Rename SHALL receber foco automaticamente e selecionar todo o texto para facilitar a substituição.

3. WHEN o usuário pressiona `Enter` com o Inline_Rename focado, THE Sidebar SHALL salvar o novo título, fechar o Inline_Rename e atualizar o History_Item com o novo título.

4. WHEN o usuário pressiona `Escape` com o Inline_Rename focado, THE Sidebar SHALL fechar o Inline_Rename e restaurar o título original sem alterações.

5. WHEN o Inline_Rename perde o foco (`blur`) sem que o usuário tenha pressionado `Enter` ou `Escape`, THE Sidebar SHALL salvar o novo título se ele for diferente do original e não estiver vazio.

6. IF o usuário confirmar um título vazio (apenas espaços), THEN THE Sidebar SHALL manter o título original sem alterações.

7. WHEN o título é salvo via Inline_Rename, THE Sidebar SHALL persistir a alteração via `conversationStore.upsert()` e atualizar o `updatedAt` da Conversation.

8. WHEN o título é salvo via Inline_Rename e a Conversation renomeada é a conversa atualmente ativa, THE Sidebar SHALL refletir o novo título sem recarregar a lista completa.

9. THE Inline_Rename SHALL ser acessível via teclado: o `<input>` SHALL ser o único elemento interativo visível no History_Item durante a edição.
