# Documento de Requisitos — Busca Full-Text em Conversas

## Introdução

Esta feature expande a busca de conversas no Offline AI Chat de um simples filtro `lowercase contains` no título para uma **busca full-text** que cobre o conteúdo completo das mensagens (papéis `user` e `assistant`). O objetivo é permitir que o usuário localize rapidamente conversas pelo que foi discutido, não apenas pelo título atribuído.

O escopo cobre:

- Indexação incremental do conteúdo das mensagens em um índice invertido mantido no lado do cliente (sem dependências externas, sem servidor).
- Busca por termos com suporte a múltiplas palavras (AND implícito), normalização de acentos e case-insensitive.
- Exibição de resultados com snippet de contexto destacando o trecho onde o termo foi encontrado.
- Navegação entre ocorrências dentro de uma conversa aberta.
- Integração transparente com o fluxo existente da sidebar: a busca semântica (quando configurada) continua disponível; a busca full-text é o fallback padrão quando não há modelo de embedding configurado.

---

## Glossário

- **Search_Engine**: módulo `modules/search.js` responsável por construir e consultar o índice invertido de conversas.
- **Inverted_Index**: estrutura de dados em memória que mapeia termos normalizados → lista de `{ convId, messageIdx, positions[] }`.
- **Snippet**: trecho de até 120 caracteres extraído do conteúdo de uma mensagem, centrado na primeira ocorrência do termo buscado, com o termo delimitado por marcadores para destaque visual.
- **Highlight**: marcação visual (elemento `<mark>`) aplicada ao Snippet para evidenciar o termo encontrado.
- **Search_Result**: objeto `{ convId, title, snippets: [{ role, text, messageIdx }], score }` retornado pelo Search_Engine.
- **Sidebar_Module**: módulo `modules/ui/sidebar.js` responsável pela lista de histórico e campo de busca.
- **Chat_Module**: módulo `modules/ui/chat.js` responsável pela renderização de mensagens.
- **Storage_Module**: módulo `modules/storage.js` que expõe `conversationStore` para acesso ao IndexedDB.
- **Conversation**: objeto `{ id, title, createdAt, updatedAt, profileId, serverId, model, messages[] }` armazenado no `conversationStore`.
- **Message**: objeto `{ role, content, ts, id }` dentro de `Conversation.messages`, onde `role` é `"user"` ou `"assistant"`.
- **Term**: palavra resultante da tokenização e normalização de uma string de busca ou de conteúdo de mensagem.
- **Tokenizer**: função pura que recebe uma string e retorna um array de Terms, aplicando lowercase, remoção de acentos (NFD + strip combining chars) e split por caracteres não-alfanuméricos.

---

## Requisitos

### Requisito 1: Indexação incremental de conversas

**User Story:** Como usuário, quero que o conteúdo das minhas conversas seja indexado automaticamente, para que a busca full-text funcione sem nenhuma ação manual da minha parte.

#### Critérios de Aceitação

1. THE Search_Engine SHALL construir o Inverted_Index em memória a partir de todas as Conversations disponíveis no `conversationStore` quando inicializado.
2. WHEN uma Conversation é criada ou atualizada, THE Search_Engine SHALL atualizar o Inverted_Index para essa Conversation sem reconstruir o índice completo.
3. WHEN uma Conversation é removida, THE Search_Engine SHALL remover todas as entradas do Inverted_Index associadas ao `convId` correspondente.
4. THE Search_Engine SHALL indexar o campo `content` de todas as Messages com `role` igual a `"user"` ou `"assistant"` dentro de cada Conversation.
5. THE Search_Engine SHALL indexar o campo `title` de cada Conversation como parte do mesmo índice, com peso equivalente ao conteúdo das mensagens.
6. WHEN o `content` de uma Message é `null`, `undefined` ou string vazia, THE Search_Engine SHALL ignorar essa Message durante a indexação sem lançar erro.
7. THE Search_Engine SHALL completar a indexação inicial de até 500 Conversations em menos de 500ms em hardware moderno (medido em benchmark síncrono sem I/O).

### Requisito 2: Tokenização e normalização

**User Story:** Como usuário, quero que a busca encontre resultados independentemente de maiúsculas, minúsculas ou acentuação, para que eu não precise lembrar a grafia exata do que foi discutido.

#### Critérios de Aceitação

1. THE Tokenizer SHALL converter toda string de entrada para lowercase antes de tokenizar.
2. THE Tokenizer SHALL normalizar a string para forma NFD e remover todos os caracteres da categoria Unicode "Combining Diacritical Marks" (U+0300–U+036F) antes de tokenizar.
3. THE Tokenizer SHALL dividir a string normalizada em Terms usando como delimitadores todos os caracteres que não sejam letras (`a-z`) ou dígitos (`0-9`).
4. THE Tokenizer SHALL descartar Terms com comprimento menor que 2 caracteres.
5. FOR ALL strings `s`, THE Tokenizer SHALL produzir o mesmo array de Terms para `s`, `s.toUpperCase()` e qualquer variação de acentuação de `s` (propriedade de idempotência de normalização).
6. FOR ALL strings `s`, aplicar o Tokenizer duas vezes SHALL produzir o mesmo resultado que aplicar uma vez: `tokenize(tokenize(s).join(" "))` SHALL ser equivalente a `tokenize(s)` (propriedade de idempotência).

### Requisito 3: Busca por termos múltiplos

**User Story:** Como usuário, quero buscar por múltiplas palavras e receber apenas conversas que contenham todas elas, para que eu possa refinar os resultados sem precisar de sintaxe especial.

#### Critérios de Aceitação

1. WHEN o usuário digita múltiplas palavras no campo de busca, THE Search_Engine SHALL retornar apenas Search_Results cujas Conversations contenham todos os Terms da query (semântica AND implícito).
2. THE Search_Engine SHALL retornar Search_Results ordenados por `score` decrescente, onde `score` é o número total de ocorrências de todos os Terms da query na Conversation.
3. WHEN a query contém apenas um Term, THE Search_Engine SHALL retornar todas as Conversations que contenham esse Term, ordenadas por `score`.
4. WHEN a query, após tokenização, resulta em zero Terms, THE Search_Engine SHALL retornar a lista completa de Conversations sem filtro (comportamento equivalente a busca vazia).
5. THE Search_Engine SHALL retornar resultados em menos de 50ms para um índice de até 500 Conversations com média de 20 mensagens cada.
6. FOR ALL queries `q` e conjuntos de Conversations `C`, toda Conversation retornada pelo Search_Engine SHALL conter pelo menos uma ocorrência de cada Term de `tokenize(q)` (propriedade de correção dos resultados).

### Requisito 4: Geração de snippets com destaque

**User Story:** Como usuário, quero ver um trecho do contexto onde minha busca foi encontrada, para que eu possa identificar rapidamente se a conversa é a que estou procurando sem precisar abri-la.

#### Critérios de Aceitação

1. THE Search_Engine SHALL gerar até 2 Snippets por Search_Result, priorizando as Messages com maior densidade de ocorrências dos Terms buscados.
2. THE Search_Engine SHALL extrair um Snippet de até 120 caracteres centrado na primeira ocorrência do Term na Message, adicionando reticências (`…`) no início e/ou fim quando o trecho for truncado.
3. THE Search_Engine SHALL delimitar cada ocorrência do Term dentro do Snippet com os marcadores `==` no início e `==` no fim (ex: `"…sobre ==machine learning== e redes…"`), para que o Sidebar_Module possa aplicar o Highlight sem depender de HTML no dado.
4. WHEN nenhuma Message da Conversation contém o Term buscado mas o `title` contém, THE Search_Engine SHALL gerar um Snippet a partir do título.
5. THE Sidebar_Module SHALL renderizar os Snippets substituindo os marcadores `==texto==` por elementos `<mark>texto</mark>` no DOM, sem usar `innerHTML` com conteúdo não-sanitizado.
6. FOR ALL Snippets gerados, o texto entre os marcadores `==` SHALL ser uma substring exata do conteúdo original da Message após normalização (propriedade de fidelidade do snippet).

### Requisito 5: Integração com a sidebar

**User Story:** Como usuário, quero que a busca full-text funcione no mesmo campo de busca que já existe na sidebar, para que eu não precise aprender uma nova interface.

#### Critérios de Aceitação

1. THE Sidebar_Module SHALL usar o Search_Engine para filtrar conversas quando o campo `historySearch` contém um termo com 2 ou mais caracteres e nenhum modelo de embedding está configurado.
2. WHEN o campo `historySearch` é limpo, THE Sidebar_Module SHALL restaurar a lista completa de Conversations agrupada por data, sem nenhum Snippet visível.
3. THE Sidebar_Module SHALL exibir os Search_Results com o título da Conversation seguido dos Snippets correspondentes, substituindo a exibição padrão de apenas título.
4. WHEN a busca retorna zero Search_Results, THE Sidebar_Module SHALL exibir a mensagem "Sem resultados" no lugar da lista.
5. THE Sidebar_Module SHALL atualizar os resultados de busca em tempo real a cada keystroke, com debounce de 150ms para evitar recálculo excessivo.
6. WHEN o Search_Engine ainda não terminou a indexação inicial e o usuário digita uma busca, THE Sidebar_Module SHALL exibir a lista filtrada pelo mecanismo `lowercase contains` existente como fallback temporário.
7. WHERE um modelo de embedding está configurado e o termo tem 3 ou mais caracteres, THE Sidebar_Module SHALL usar a busca semântica existente em vez do Search_Engine, mantendo o comportamento atual inalterado.

### Requisito 6: Navegação entre ocorrências dentro de uma conversa

**User Story:** Como usuário, quero navegar entre as ocorrências do termo buscado dentro de uma conversa aberta, para que eu possa localizar rapidamente a mensagem relevante sem rolar manualmente.

#### Critérios de Aceitação

1. WHEN o usuário abre uma Conversation a partir de um Search_Result, THE Chat_Module SHALL aplicar Highlight em todas as ocorrências dos Terms buscados nas mensagens renderizadas.
2. THE Chat_Module SHALL exibir uma barra de navegação de busca com controles "anterior" (↑) e "próximo" (↓) e um contador no formato `N de M` quando há pelo menos uma ocorrência destacada.
3. WHEN o usuário clica em "próximo", THE Chat_Module SHALL rolar a viewport até a próxima ocorrência destacada e marcá-la como ocorrência ativa com estilo visual distinto.
4. WHEN o usuário clica em "anterior", THE Chat_Module SHALL rolar a viewport até a ocorrência anterior destacada e marcá-la como ocorrência ativa.
5. WHEN o usuário navega além da última ocorrência usando "próximo", THE Chat_Module SHALL retornar à primeira ocorrência (navegação circular).
6. WHEN o usuário fecha a barra de navegação ou limpa o campo de busca na sidebar, THE Chat_Module SHALL remover todos os Highlights e ocultar a barra de navegação.
7. IF a Conversation aberta não contém nenhuma ocorrência dos Terms buscados, THEN THE Chat_Module SHALL não exibir a barra de navegação.

### Requisito 7: Persistência e consistência do índice

**User Story:** Como usuário, quero que o índice de busca reflita sempre o estado atual das minhas conversas, para que resultados desatualizados não me levem a conversas erradas.

#### Critérios de Aceitação

1. THE Search_Engine SHALL reconstruir o índice de uma Conversation específica sempre que `conversationStore.upsert` for chamado com essa Conversation.
2. WHEN a aplicação é inicializada, THE Search_Engine SHALL construir o Inverted_Index completo a partir dos dados do `conversationStore` antes de aceitar a primeira consulta.
3. THE Search_Engine SHALL manter o Inverted_Index exclusivamente em memória, sem persistir em localStorage ou IndexedDB, aceitando a reconstrução a cada inicialização como tradeoff de simplicidade.
4. IF o `conversationStore` retornar um erro durante a inicialização do índice, THEN THE Search_Engine SHALL registrar o erro no console e inicializar com um índice vazio, permitindo que a aplicação continue funcionando.
5. FOR ALL sequências de operações `upsert(conv)` seguidas de `search(q)`, se `conv` contém o Term `t` de `q`, então `search(q)` SHALL incluir `conv` nos resultados (propriedade de consistência pós-escrita).
