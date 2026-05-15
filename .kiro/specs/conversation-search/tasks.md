# Plano de Implementação: Busca Full-Text em Conversas

## Visão Geral

Implementar o módulo `modules/search.js` com índice invertido em memória, integrar a busca full-text na sidebar (substituindo o filtro `lowercase contains`), adicionar highlight e barra de navegação de ocorrências no chat, e conectar tudo em `app.js` com atualização incremental do índice.

## Tarefas

- [ ] 1. Criar o módulo `modules/search.js` com funções puras
  - Criar o arquivo `modules/search.js` como ES module
  - Implementar `tokenize(text)`: lowercase, NFD + strip combining chars (U+0300–U+036F), split por não-alfanuméricos, descartar tokens com length < 2
  - Implementar `countOccurrences(content, terms)`: conta ocorrências totais de todos os terms no conteúdo normalizado
  - Implementar `generateSnippet(content, terms)`: snippet de até 120 chars centrado na primeira ocorrência, com marcadores `==termo==`, reticências `…` quando truncado
  - Exportar as três funções como funções puras (sem estado, sem efeitos colaterais)
  - _Requisitos: 2.1, 2.2, 2.3, 2.4, 4.2, 4.3, 4.6_

  - [ ]* 1.1 Escrever testes de exemplo para `tokenize`
    - `tokenize("")` retorna `[]`
    - `tokenize("Olá mundo")` retorna `["ola", "mundo"]` (acento removido)
    - `tokenize("a b c")` retorna `[]` (todos com length < 2)
    - _Requisitos: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 1.2 Escrever property test para `tokenize` — Property 1: Normalização case-insensitive
    - **Property 1: Normalização case-insensitive do Tokenizer**
    - **Validates: Requirements 2.1, 2.5**
    - Gerador: `fc.string()`; verificar `tokenize(s)` deep-equals `tokenize(s.toUpperCase())`
    - Tag: `// Feature: conversation-search, Property 1: Normalização case-insensitive`

  - [ ]* 1.3 Escrever property test para `tokenize` — Property 2: Idempotência
    - **Property 2: Idempotência do Tokenizer**
    - **Validates: Requirements 2.6**
    - Gerador: `fc.string()`; verificar `tokenize(tokenize(s).join(" "))` deep-equals `tokenize(s)`
    - Tag: `// Feature: conversation-search, Property 2: Idempotência do Tokenizer`

  - [ ]* 1.4 Escrever property test para `tokenize` — Property 3: Terms alfanuméricos com length >= 2
    - **Property 3: Terms contêm apenas caracteres alfanuméricos e têm comprimento mínimo 2**
    - **Validates: Requirements 2.3, 2.4**
    - Gerador: `fc.string()`; verificar que todos os terms satisfazem `/^[a-z0-9]{2,}$/`
    - Tag: `// Feature: conversation-search, Property 3: Terms alfanuméricos`

  - [ ]* 1.5 Escrever testes de exemplo para `generateSnippet`
    - `generateSnippet("hello world foo", ["world"])` retorna string contendo `==world==`
    - Snippet não excede 120 caracteres (sem contar marcadores `==`)
    - Snippet com truncamento adiciona `…` no início e/ou fim
    - _Requisitos: 4.2, 4.3_

  - [ ]* 1.6 Escrever property test para `generateSnippet` — Property 9: Fidelidade do snippet
    - **Property 9: Fidelidade do snippet (texto entre marcadores é substring do original)**
    - **Validates: Requirements 4.6**
    - Gerador: `fc.string()` + `fc.array(fc.string())`; verificar que texto entre `==` é substring do original normalizado
    - Tag: `// Feature: conversation-search, Property 9: Fidelidade do snippet`

- [ ] 2. Implementar o `Search_Engine` (estado e operações de índice) em `modules/search.js`
  - Declarar `invertedIndex` (`Map<term, Map<convId, { count, messageIdxs }>>`) e `convMeta` (`Map<convId, { title, messages }>`) como estado em memória do módulo
  - Implementar `notifyUpsert(conv)`: remove entradas antigas do convId, re-indexa título e todas as mensagens com `role` `"user"` ou `"assistant"`, trata `content` null/undefined/vazio silenciosamente, extrai texto de `content` array (multimodal) pegando apenas partes `type: "text"`
  - Implementar `notifyRemove(convId)`: remove todas as entradas do `invertedIndex` e `convMeta` para o convId
  - Implementar `isSearchReady()`: retorna boolean indicando se o índice inicial foi construído
  - Implementar `initSearch(store)`: chama `store.list()`, itera conversas chamando `notifyUpsert` para cada uma, seta flag de pronto; em caso de erro loga `[Search] Erro ao inicializar índice: <msg>` e inicializa com índice vazio
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 2.1 Escrever property test — Property 4: Consistência pós-escrita (upsert → search)
    - **Property 4: Consistência pós-escrita (upsert → search)**
    - **Validates: Requirements 1.2, 7.1, 7.5**
    - Gerador: `fc.record` com conv com pelo menos uma mensagem não-vazia; após `notifyUpsert(conv)`, `search(q, [conv])` com term presente SHALL incluir conv
    - Tag: `// Feature: conversation-search, Property 4: Consistência pós-escrita`

  - [ ]* 2.2 Escrever property test — Property 5: Remoção limpa o índice
    - **Property 5: Remoção limpa o índice**
    - **Validates: Requirements 1.3**
    - Gerador: `fc.record` com conv; após `notifyUpsert` + `notifyRemove`, `search(q, [])` SHALL retornar array vazio
    - Tag: `// Feature: conversation-search, Property 5: Remoção limpa o índice`

  - [ ]* 2.3 Escrever testes de exemplo para `initSearch` com store que lança erro
    - Após `initSearch` com store que lança erro: `isSearchReady()` retorna `true` e `search()` retorna `[]`
    - _Requisitos: 7.4_

- [ ] 3. Implementar `search(query, allConversations)` em `modules/search.js`
  - Implementar o algoritmo AND implícito: tokenizar query, intersectar posting lists por convId, calcular score (soma de ocorrências de todos os terms), gerar até 2 snippets das mensagens com maior densidade
  - Quando `terms.length === 0`: retornar `allConversations` mapeadas para `SearchResult` sem snippets (lista completa)
  - Quando título contém o term mas nenhuma mensagem contém: gerar snippet a partir do título (role `"title"`, messageIdx `-1`)
  - Ordenar resultados por `score` decrescente
  - Retornar `SearchResult[]` com shape `{ convId, title, snippets: [{ role, text, messageIdx }], score }`
  - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.4_

  - [ ]* 3.1 Escrever property test — Property 6: Correção AND implícito
    - **Property 6: Correção dos resultados de busca (AND implícito)**
    - **Validates: Requirements 3.1, 3.6**
    - Gerador: `fc.array(conv)` + `fc.string()`; toda conversa retornada SHALL conter todos os terms da query
    - Tag: `// Feature: conversation-search, Property 6: Correção AND implícito`

  - [ ]* 3.2 Escrever property test — Property 7: Ordenação por score decrescente
    - **Property 7: Ordenação por score decrescente**
    - **Validates: Requirements 3.2**
    - Gerador: `fc.array(conv)` + `fc.string()`; verificar `results[i].score >= results[i+1].score` para todo `i` válido
    - Tag: `// Feature: conversation-search, Property 7: Ordenação por score`

  - [ ]* 3.3 Escrever property test — Property 8: Limite de snippets por resultado
    - **Property 8: Limite de snippets por resultado**
    - **Validates: Requirements 4.1**
    - Gerador: `fc.array(conv)` + `fc.string()`; verificar `result.snippets.length <= 2` para todo resultado
    - Tag: `// Feature: conversation-search, Property 8: Limite de snippets`

  - [ ]* 3.4 Escrever testes de exemplo para `search`
    - `search("", allConvs)` retorna todas as conversas
    - `search("xyz_inexistente", allConvs)` retorna `[]`
    - _Requisitos: 3.3, 3.4_

- [ ] 4. Checkpoint — Verificar módulo `search.js` isolado
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [ ] 5. Integrar `Search_Engine` na `sidebar.js`
  - Adicionar estado `let searchEngine = null` e `let searchDebounceTimer = null` no topo do módulo
  - Exportar `setSearchEngine(engine)` para receber referência ao módulo search
  - Modificar o handler de `input` do `historySearch`: adicionar debounce de 150ms para busca full-text, manter prioridade da busca semântica (3+ chars + embedding configurado), usar `searchEngine.search()` quando disponível e `isSearchReady()` for true, fallback para `renderList()` com `lowercase contains` quando índice não está pronto
  - Implementar `renderSearchResults(results)`: renderiza lista de `SearchResult[]` com título + snippets, exibe "Sem resultados" quando array vazio, define `data-search-mode="fulltext"` no campo
  - Implementar `renderSearchItem(result)`: cria item de lista com título e snippets abaixo
  - Implementar `renderSnippetText(snippetText, container)`: divide por `/(==.+?==)/g`, cria nós de texto e `<mark>` alternados — sem `innerHTML` com conteúdo não-sanitizado
  - Modificar `initSidebar` para aceitar `searchEngine` nas opções e repassar para `setSearchEngine`
  - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 5.1 Escrever testes de exemplo para comportamento da sidebar
    - Sidebar exibe "Sem resultados" quando `search()` retorna `[]`
    - _Requisitos: 5.4_

- [ ] 6. Adicionar highlight e barra de navegação em `chat.js`
  - Adicionar estado de busca no módulo: `activeSearchTerms`, `searchOccurrences`, `activeOccurrenceIdx`
  - Implementar `applySearchHighlight(terms)`: percorre todos os `.msg-body` com `TreeWalker` sobre `Text` nodes, encontra posições dos terms (normalizado), reconstrói nós substituindo ocorrências por `<mark class="search-highlight">`, coleta todos os `.search-highlight` em `searchOccurrences`, exibe barra de navegação se houver pelo menos 1 ocorrência; captura erros silenciosamente (highlight parcial é melhor que crash)
  - Implementar `clearSearchHighlight()`: remove todos os elementos `.search-highlight` do DOM (substituindo `<mark>` pelo seu `textContent`), oculta barra de navegação, reseta estado
  - Implementar `navigateSearchOccurrence(direction)`: navega +1/-1 de forma circular, aplica classe `active` na ocorrência atual, rola viewport até ela, atualiza contador `N de M`
  - Implementar `buildSearchNavBar(terms)`: cria `<div id="search-nav-bar">` com contador, botões ↑ ↓ e ✕, insere antes de `#messagesInner`; botão ✕ chama `clearSearchHighlight()`
  - Exportar `applySearchHighlight`, `clearSearchHighlight`, `navigateSearchOccurrence`
  - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 6.1 Escrever testes de exemplo para highlight e navegação
    - `clearSearchHighlight()` remove todos os elementos `.search-highlight` do DOM
    - Navegação circular: após última ocorrência, `navigateSearchOccurrence(1)` volta para a primeira
    - Barra de navegação não aparece quando conversa não tem ocorrências dos terms buscados
    - _Requisitos: 6.5, 6.6, 6.7_

- [ ] 7. Adicionar estilos CSS em `styles.css`
  - Adicionar seletores para barra de navegação de busca: `.search-nav-bar`, `.search-nav-count`, `.search-nav-btn`, `.search-nav-close`
  - Adicionar seletores para highlight: `mark.search-highlight` (background `var(--accent)`, color `var(--bg-0)`, border-radius 2px) e `mark.search-highlight.active` (outline 2px solid `var(--accent)`)
  - Adicionar seletores para snippet na sidebar: `.history-item-snippet` e `.history-item-snippet mark` (background `var(--accent-subtle)`, color `var(--fg-0)`)
  - Adicionar indicador de modo de busca: `#historySearch[data-search-mode="fulltext"]`
  - _Requisitos: 4.5, 6.2, 6.3_

- [ ] 8. Conectar tudo em `app.js`
  - Importar `initSearch`, `isSearchReady`, `search`, `notifyUpsert`, `notifyRemove` de `./modules/search.js`
  - Importar `applySearchHighlight`, `clearSearchHighlight` de `./modules/ui/chat.js`
  - Adicionar estado `let activeSearchTerms = []` no runtime
  - Chamar `await initSearch(conversationStore)` após `initSidebar`, passando `{ search, isSearchReady }` como `searchEngine` para `initSidebar`
  - Em `saveCurrentConversation`: chamar `notifyUpsert(c)` após `conversationStore.upsert(c)`
  - Em `deleteConversation` (ou onde a conversa é removida): chamar `notifyRemove(id)` após `conversationStore.remove(id)`
  - Em `loadConversation`: após `renderAllMessages`, se `activeSearchTerms.length > 0`, chamar `requestAnimationFrame(() => applySearchHighlight(activeSearchTerms))`
  - Capturar os terms da última busca full-text na sidebar via callback `onSearchTerms` (ou equivalente) e armazenar em `activeSearchTerms`; limpar `activeSearchTerms` e chamar `clearSearchHighlight()` quando busca for limpa
  - _Requisitos: 1.1, 1.2, 1.3, 5.1, 5.7, 6.1, 6.6, 7.1, 7.2_

- [ ] 9. Checkpoint final — Garantir que todos os testes passam
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia requisitos específicos para rastreabilidade
- Os testes PBT devem ser adicionados em `tests/feature-improvements.test.js`, seguindo o padrão existente com `runProperty` e `fc.assert`
- O índice invertido é mantido exclusivamente em memória — nenhuma alteração em `schema.js`, `localStorage` ou `IndexedDB`
- A busca semântica existente tem prioridade para queries com 3+ chars quando embedding está configurado — o `Search_Engine` não é chamado nesses casos
- O highlight usa `TreeWalker` sobre `Text` nodes para não quebrar elementos existentes como `<code>`, `<a>`, etc.
