# Documento de Requisitos — Prompt Library UI

## Introdução

Esta feature entrega uma **UI completa para gerenciar a biblioteca de prompts** do Offline AI Chat. Hoje o schema já persiste `advanced.promptLibrary[]` e a UI de configurações expõe um CRUD básico (id, nome, corpo, botão de exclusão), mas sem busca, sem tags, sem visualização prévia e sem uma forma ergonômica de inserir prompts no composer.

O escopo cobre:

- Painel dedicado de gerenciamento dentro da aba "Avançado" das configurações, com CRUD completo (criar, editar, deletar, duplicar).
- Busca/filtro por nome, tags e conteúdo do corpo do prompt.
- Suporte a tags para organização, com filtro por tag.
- Visualização prévia do corpo do prompt antes de inserir.
- Inserção no composer via slash command (`/id`) — já funciona parcialmente — e via **Prompt Picker** (modal dedicado acessível por botão no composer e por atalho de teclado).
- Validação de unicidade de `id` e comprimento mínimo de nome e corpo.
- Integração com o schema existente sem quebrar compatibilidade: o campo `tags` já existe no schema default mas não é editável na UI atual.

O que **não** está no escopo: sincronização remota, importação/exportação individual de prompts (o backup geral de configurações já cobre isso), e ordenação manual por drag-and-drop.

---

## Glossário

- **Prompt**: objeto `{ id: string, name: string, body: string, tags: string[] }` armazenado em `advanced.promptLibrary[]` no localStorage.
- **Prompt_Library**: array de Prompts em `store.get("advanced.promptLibrary")`, gerenciado pelo Store_Module.
- **Prompt_Manager_Panel**: seção da aba "Avançado" nas configurações que substitui o CRUD básico atual, implementada em `modules/ui/settings/advanced.js`.
- **Prompt_Picker**: modal flutuante (elemento `<dialog>`) que lista Prompts com busca e permite inserção no Composer, acessível via botão no composer e via atalho de teclado.
- **Composer**: área de entrada de texto do chat, implementada em `modules/ui/composer.js`.
- **Slash_Overlay**: dropdown de autocompletar que aparece no Composer quando o usuário digita `/`, já implementado em `modules/ui/composer.js`.
- **Store_Module**: módulo `modules/store.js` — Proxy reativo + pubsub que persiste no localStorage com debounce de 250ms.
- **Settings_Drawer**: drawer de configurações fullscreen, implementado em `modules/ui/settings.js`.
- **Tag**: string sem espaços que categoriza um Prompt, armazenada em `Prompt.tags[]`.
- **Tag_Filter**: controle de filtro por Tag no Prompt_Manager_Panel e no Prompt_Picker.
- **Body_Preview**: área de visualização somente-leitura do `Prompt.body` antes da inserção.

---

## Requisitos

### Requisito 1: CRUD completo de prompts no painel de configurações

**User Story:** Como usuário, quero criar, editar, duplicar e deletar prompts salvos diretamente nas configurações, para que eu possa manter minha biblioteca organizada sem precisar editar JSON manualmente.

#### Critérios de Aceitação

1. THE Prompt_Manager_Panel SHALL exibir todos os Prompts da Prompt_Library em uma lista, mostrando `name`, `id` e as Tags de cada Prompt.
2. WHEN o usuário clica em "+ Novo prompt", THE Prompt_Manager_Panel SHALL adicionar um novo Prompt com `id` gerado automaticamente no formato `p-{timestamp}`, `name` vazio, `body` vazio e `tags: []`, e abrir o formulário de edição inline para esse Prompt.
3. WHEN o usuário edita o campo `name` de um Prompt, THE Prompt_Manager_Panel SHALL atualizar o valor em tempo real no Store_Module a cada evento `change`.
4. WHEN o usuário edita o campo `body` de um Prompt, THE Prompt_Manager_Panel SHALL atualizar o valor em tempo real no Store_Module a cada evento `change`.
5. WHEN o usuário edita o campo `id` de um Prompt e o novo valor já existe em outro Prompt da Prompt_Library, THE Prompt_Manager_Panel SHALL exibir uma mensagem de erro inline "ID já em uso" e SHALL NOT persistir o valor duplicado no Store_Module.
6. WHEN o usuário clica no botão de duplicar um Prompt, THE Prompt_Manager_Panel SHALL criar uma cópia com `id` no formato `{id}-copy-{timestamp}`, mesmo `name` com sufixo " (cópia)", mesmo `body` e mesmas `tags`, e adicioná-la ao final da Prompt_Library.
7. WHEN o usuário clica no botão de deletar um Prompt, THE Prompt_Manager_Panel SHALL remover o Prompt da Prompt_Library no Store_Module e re-renderizar a lista sem o item removido.
8. IF o campo `name` de um Prompt estiver vazio ao perder o foco, THEN THE Prompt_Manager_Panel SHALL exibir uma mensagem de erro inline "Nome obrigatório" e SHALL NOT persistir o valor vazio.
9. IF o campo `body` de um Prompt estiver vazio ao perder o foco, THEN THE Prompt_Manager_Panel SHALL exibir uma mensagem de erro inline "Corpo obrigatório" e SHALL NOT persistir o valor vazio.
10. THE Prompt_Manager_Panel SHALL persistir todas as alterações válidas via Store_Module, que as salva no localStorage com debounce de 250ms.

### Requisito 2: Gerenciamento de tags

**User Story:** Como usuário, quero adicionar e remover tags em cada prompt, para que eu possa organizar minha biblioteca por categoria e filtrar rapidamente.

#### Critérios de Aceitação

1. THE Prompt_Manager_Panel SHALL exibir as Tags de cada Prompt como chips visuais dentro do formulário de edição do Prompt.
2. WHEN o usuário digita uma tag no campo de tags e pressiona `Enter` ou `,`, THE Prompt_Manager_Panel SHALL adicionar a Tag ao array `Prompt.tags`, normalizada para lowercase e sem espaços, e limpar o campo de entrada.
3. WHEN o usuário clica no botão "×" de um chip de Tag, THE Prompt_Manager_Panel SHALL remover essa Tag do array `Prompt.tags` e atualizar o Store_Module.
4. IF o usuário tentar adicionar uma Tag que já existe no `Prompt.tags` do mesmo Prompt, THEN THE Prompt_Manager_Panel SHALL ignorar a adição sem exibir erro.
5. IF o usuário tentar adicionar uma Tag com comprimento menor que 2 caracteres após normalização, THEN THE Prompt_Manager_Panel SHALL ignorar a adição sem exibir erro.
6. THE Prompt_Manager_Panel SHALL exibir um Tag_Filter acima da lista de Prompts com todas as Tags únicas presentes na Prompt_Library.
7. WHEN o usuário seleciona uma Tag no Tag_Filter, THE Prompt_Manager_Panel SHALL exibir apenas os Prompts que contêm essa Tag em seu array `tags`.
8. WHEN o usuário clica na Tag ativa no Tag_Filter novamente, THE Prompt_Manager_Panel SHALL remover o filtro e exibir todos os Prompts.

### Requisito 3: Busca e filtro no painel de configurações

**User Story:** Como usuário, quero buscar prompts por nome, id ou conteúdo do corpo, para que eu possa encontrar rapidamente o prompt que preciso mesmo com uma biblioteca grande.

#### Critérios de Aceitação

1. THE Prompt_Manager_Panel SHALL exibir um campo de busca de texto acima da lista de Prompts.
2. WHEN o usuário digita no campo de busca, THE Prompt_Manager_Panel SHALL filtrar a lista exibindo apenas Prompts cujo `name`, `id` ou `body` contenha a string buscada (case-insensitive, sem normalização de acentos).
3. THE Prompt_Manager_Panel SHALL atualizar o filtro a cada keystroke sem debounce, pois a operação é síncrona e em memória.
4. WHEN o campo de busca está vazio, THE Prompt_Manager_Panel SHALL exibir todos os Prompts (respeitando o Tag_Filter ativo, se houver).
5. WHEN a combinação de busca textual e Tag_Filter ativo resulta em zero Prompts, THE Prompt_Manager_Panel SHALL exibir a mensagem "Nenhum prompt encontrado" no lugar da lista.
6. FOR ALL strings de busca `q` e Prompt_Library `L`, todo Prompt retornado pelo filtro SHALL conter `q` (case-insensitive) em pelo menos um dos campos `name`, `id` ou `body` (propriedade de correção do filtro).

### Requisito 4: Prompt Picker — modal de seleção e inserção

**User Story:** Como usuário, quero abrir um picker de prompts diretamente no composer, para que eu possa inserir qualquer prompt salvo no campo de texto sem precisar lembrar o slash command.

#### Critérios de Aceitação

1. THE Composer SHALL exibir um botão de ícone "📚" (ou equivalente SVG) na barra de ferramentas do composer, ao lado do botão de anexar arquivo.
2. WHEN o usuário clica no botão "📚" ou pressiona o atalho configurado (`Ctrl+Shift+P` por padrão), THE Prompt_Picker SHALL abrir como um elemento `<dialog>` modal com foco no campo de busca.
3. THE Prompt_Picker SHALL exibir todos os Prompts da Prompt_Library em uma lista com `name`, `id` (em fonte monoespaçada) e as Tags de cada Prompt.
4. WHEN o usuário digita no campo de busca do Prompt_Picker, THE Prompt_Picker SHALL filtrar a lista exibindo apenas Prompts cujo `name`, `id` ou `body` contenha a string buscada (case-insensitive).
5. THE Prompt_Picker SHALL suportar navegação por teclado: `ArrowDown`/`ArrowUp` para mover a seleção, `Enter` para confirmar, `Escape` para fechar sem inserir.
6. WHEN o usuário seleciona um Prompt no Prompt_Picker (via clique ou `Enter`), THE Prompt_Picker SHALL fechar o modal e THE Composer SHALL inserir o `body` do Prompt no campo de texto, substituindo qualquer conteúdo existente se o campo estiver vazio, ou adicionando em nova linha se já houver conteúdo.
7. THE Prompt_Picker SHALL exibir um Body_Preview do Prompt atualmente selecionado em um painel lateral ou inferior, mostrando os primeiros 300 caracteres do `body` com reticências se truncado.
8. WHEN a Prompt_Library está vazia, THE Prompt_Picker SHALL exibir a mensagem "Nenhum prompt salvo. Adicione prompts nas configurações → Avançado." com um link que abre as configurações na aba Avançado.
9. THE Prompt_Picker SHALL fechar quando o usuário clica fora do elemento `<dialog>` (no backdrop).
10. WHERE o Tag_Filter estiver disponível no Prompt_Picker, THE Prompt_Picker SHALL exibir chips de Tag para filtrar a lista, com o mesmo comportamento do Tag_Filter do Prompt_Manager_Panel.

### Requisito 5: Inserção via slash command

**User Story:** Como usuário, quero digitar `/id-do-prompt` no composer e ver o prompt aparecer no autocompletar, para que eu possa inserir prompts rapidamente sem tirar as mãos do teclado.

#### Critérios de Aceitação

1. WHEN o usuário digita `/` seguido de caracteres no Composer, THE Slash_Overlay SHALL exibir Prompts da Prompt_Library cujo `id` começa com o texto digitado após `/`, além dos slash commands existentes.
2. THE Slash_Overlay SHALL exibir cada Prompt com seu `id` em fonte monoespaçada e seu `name` como descrição secundária, visualmente diferenciado dos slash commands simples (ex: ícone "📚" ou label "prompt").
3. WHEN o usuário seleciona um Prompt no Slash_Overlay (via `Tab`, `Enter` ou clique), THE Composer SHALL substituir o texto `/id` pelo `body` do Prompt seguido de um espaço.
4. THE Slash_Overlay SHALL exibir no máximo 8 itens combinados (slash commands + prompts da library), priorizando correspondências exatas de prefixo antes de correspondências parciais.
5. FOR ALL valores de `id` de Prompt `p` na Prompt_Library, digitar `/{p.id}` no Composer e confirmar no Slash_Overlay SHALL resultar no `body` de `p` sendo inserido no Composer (propriedade de round-trip slash → body).

### Requisito 6: Visualização prévia no painel de configurações

**User Story:** Como usuário, quero ver uma prévia formatada do corpo do prompt antes de confirmar a inserção, para que eu saiba exatamente o que será enviado ao modelo.

#### Critérios de Aceitação

1. THE Prompt_Manager_Panel SHALL exibir um Body_Preview abaixo do campo `body` de cada Prompt em edição, mostrando o conteúdo atual do campo `body` como texto simples (sem renderização Markdown).
2. WHEN o campo `body` está vazio, THE Body_Preview SHALL exibir o placeholder "O corpo do prompt aparecerá aqui…" em cor secundária.
3. THE Body_Preview SHALL atualizar em tempo real conforme o usuário digita no campo `body`, sem debounce.
4. THE Body_Preview SHALL exibir no máximo 5 linhas de texto, com scroll vertical se o conteúdo exceder esse limite, para não expandir excessivamente o painel.

### Requisito 7: Consistência e integridade dos dados

**User Story:** Como usuário, quero que minha biblioteca de prompts seja sempre consistente, para que eu não perca dados nem encontre prompts corrompidos.

#### Critérios de Aceitação

1. THE Store_Module SHALL persistir a Prompt_Library no localStorage via o mecanismo existente de debounce de 250ms sempre que qualquer Prompt for criado, editado ou removido.
2. WHEN a aplicação é inicializada, THE Store_Module SHALL carregar a Prompt_Library do localStorage e disponibilizá-la via `store.get("advanced.promptLibrary")` antes de qualquer renderização de UI que dependa dela.
3. IF o valor de `advanced.promptLibrary` no localStorage for inválido (não-array), THEN THE Store_Module SHALL substituí-lo pelo valor default `[{ id: "explain", ... }, { id: "review", ... }]` definido em `schema.js` sem lançar erro.
4. THE Prompt_Manager_Panel SHALL refletir imediatamente qualquer alteração feita na Prompt_Library via Store_Module, sem necessidade de recarregar a página.
5. FOR ALL sequências de operações de criação seguidas de leitura, um Prompt criado via Prompt_Manager_Panel SHALL estar disponível no Slash_Overlay e no Prompt_Picker na mesma sessão sem recarregar a página (propriedade de consistência entre componentes).
6. FOR ALL Prompts `p` na Prompt_Library, `p.id` SHALL ser uma string não-vazia, `p.name` SHALL ser uma string não-vazia, `p.body` SHALL ser uma string não-vazia, e `p.tags` SHALL ser um array (invariante de integridade do Prompt).

