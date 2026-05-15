# Plano de Implementação: Prompt Library UI

## Visão Geral

Implementação da UI completa para gerenciar a biblioteca de prompts do Offline AI Chat. O trabalho envolve: (1) soft migration no schema para garantir `tags` como array, (2) refatoração do `Prompt_Manager_Panel` em `settings/advanced.js` com busca, filtro por tag, chips editáveis e preview, (3) novo módulo `prompt-picker.js` com `<dialog>` modal acessível, (4) integração no `composer.js` com botão e atalho de teclado, e (5) testes de propriedade e de exemplo no arquivo de testes existente.

## Tarefas

- [ ] 1. Soft migration no schema e funções puras exportáveis
  - Em `modules/schema.js`, adicionar soft migration em `loadAndMigrate()` para garantir que todo prompt em `advanced.promptLibrary` tenha `tags: []` quando o campo estiver ausente
  - Também garantir que `advanced.promptLibrary` não-array seja substituído pelo default
  - Adicionar `promptPicker` ao `defaultKeymap()` com chord `"Ctrl+Shift+L"` (evita conflito com `nextProfile: "Ctrl+Shift+P"`)
  - Exportar as funções puras de `modules/ui/settings/advanced.js` (criar o arquivo com as funções antes de refatorar o painel): `filterPrompts(library, query, activeTag)`, `normalizeTag(raw)`, `isIdUnique(library, id, excludeIndex)`, `isNonEmpty(value)`
  - Exportar `truncatePreview(body, maxChars)` de `modules/ui/prompt-picker.js` (criar o arquivo com essa função antes do restante do módulo)
  - _Requirements: 2.2, 7.3, 1.5, 1.8, 1.9_

- [ ] 2. Testes de propriedade e de exemplo para as funções puras
  - [ ] 2.1 Adicionar testes de exemplo para `filterPrompts`, `normalizeTag`, `isIdUnique`, `isNonEmpty` e `truncatePreview` em `tests/feature-improvements.test.js`
    - `filterPrompts([], "qualquer", null)` retorna `[]`
    - `filterPrompts(library, "", null)` retorna todos os prompts
    - `filterPrompts(library, "EXPLAIN", null)` retorna prompts com "explain" em qualquer campo (case-insensitive)
    - `normalizeTag("  Dev  ")` retorna `"dev"`
    - `normalizeTag("Full Stack")` retorna `"fullstack"`
    - `isIdUnique([{id:"a"},{id:"b"}], "a", 1)` retorna `false`
    - `isIdUnique([{id:"a"},{id:"b"}], "a", 0)` retorna `true`
    - `isNonEmpty("")` retorna `false`, `isNonEmpty("   ")` retorna `false`, `isNonEmpty("texto")` retorna `true`
    - `truncatePreview("a".repeat(400), 300)` retorna `"a".repeat(300) + "…"`
    - `truncatePreview("curto", 300)` retorna `"curto"` sem reticências
    - _Requirements: 3.2, 3.6, 2.2, 1.5, 1.8, 1.9, 4.7_

  - [ ]* 2.2 Escrever property test para Property 1: Correção do filtro textual
    - **Property 1: Correção do filtro textual** — todo Prompt retornado por `filterPrompts(L, q, null)` contém `q` (case-insensitive) em `name`, `id` ou `body`
    - Gerador: `fc.array(fc.record({id, name, body, tags}))` + `fc.string()`
    - **Validates: Requirements 3.2, 3.6, 4.4**
    - `// Feature: prompt-library-ui, Property 1: correção do filtro textual`

  - [ ]* 2.3 Escrever property test para Property 2: Completude do filtro textual
    - **Property 2: Completude do filtro textual** — nenhum Prompt que contenha `q` em `name`, `id` ou `body` é excluído
    - Mesmo gerador da Property 1
    - **Validates: Requirements 3.2, 3.6**
    - `// Feature: prompt-library-ui, Property 2: completude do filtro textual`

  - [ ]* 2.4 Escrever property test para Property 3: Filtro por tag
    - **Property 3: Filtro por tag** — todo Prompt retornado por `filterPrompts(L, "", t)` contém `t` em `tags`
    - Gerador: `fc.array(fc.record(...))` + `fc.string()` (tag)
    - **Validates: Requirements 2.7, 4.10**
    - `// Feature: prompt-library-ui, Property 3: filtro por tag retorna apenas prompts com a tag`

  - [ ]* 2.5 Escrever property test para Property 4: Normalização de tags
    - **Property 4: Normalização de tags** — `normalizeTag(raw) === raw.toLowerCase().replace(/\s+/g, "")`
    - Gerador: `fc.string()`
    - **Validates: Requirements 2.2**
    - `// Feature: prompt-library-ui, Property 4: normalização de tags`

  - [ ]* 2.6 Escrever property test para Property 7: Validação de campos obrigatórios
    - **Property 7: Validação de campos obrigatórios** — `isNonEmpty(s.trim())` retorna `false` para qualquer string composta só de whitespace
    - Gerador: `fc.stringMatching(/^\s*$/)`
    - **Validates: Requirements 1.8, 1.9**
    - `// Feature: prompt-library-ui, Property 7: validação de campos obrigatórios rejeita strings vazias/whitespace`

  - [ ]* 2.7 Escrever property test para Property 8: Unicidade de id
    - **Property 8: Unicidade de id** — `isIdUnique(L, L[j].id, i)` retorna `false` para qualquer `j !== i`
    - Gerador: `fc.array(fc.record({id,...}), {minLength:2})` com ids únicos
    - **Validates: Requirements 1.5**
    - `// Feature: prompt-library-ui, Property 8: unicidade de id`

  - [ ]* 2.8 Escrever property test para Property 12: Preview truncado a 300 caracteres
    - **Property 12: Preview truncado** — `truncatePreview(body, 300)` retorna os primeiros 300 chars + `"…"` quando `body.length > 300`
    - Gerador: `fc.string({minLength:301})`
    - **Validates: Requirements 4.7**
    - `// Feature: prompt-library-ui, Property 12: preview truncado a 300 caracteres`

- [ ] 3. Checkpoint — Rodar testes e validar funções puras
  - Garantir que todos os testes passem com `npm test`. Perguntar ao usuário se houver dúvidas antes de continuar.

- [ ] 4. Refatorar `modules/ui/settings/advanced.js` — Prompt_Manager_Panel completo
  - [ ] 4.1 Adicionar campo de busca textual e Tag_Filter acima da lista de prompts
    - Campo `<input type="text">` com placeholder "Buscar prompt…"; atualiza `searchQuery` a cada `input` e re-renderiza a lista
    - Tag_Filter: chips de todas as tags únicas da library; clique ativa/desativa `activeTagFilter`; chip ativo com `aria-pressed="true"`
    - Quando busca + tag filter resultam em zero prompts, exibir "Nenhum prompt encontrado"
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 2.6, 2.7, 2.8_

  - [ ] 4.2 Refatorar cards de prompt com chips de tag editáveis e validação inline
    - Cada card exibe: `id` (mono), `name`, botão Duplicar, botão ×
    - Campo de tags: chips `[tag ×]` + input para nova tag (Enter ou `,` adiciona; normaliza com `normalizeTag`; ignora duplicatas e tags < 2 chars)
    - Validação inline: `name` vazio ao blur → `<span class="field-error">Nome obrigatório</span>`, não persiste; `id` duplicado ao blur → `<span class="field-error">ID já em uso</span>`, não persiste; `body` vazio ao blur → `<span class="field-error">Corpo obrigatório</span>`, não persiste
    - Botão Duplicar: cria cópia com `id: "{id}-copy-{Date.now()}"`, `name: "{name} (cópia)"`, mesmo `body` e `tags`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 4.3 Adicionar Body_Preview abaixo do textarea de cada prompt
    - `<div class="body-preview">` atualiza em tempo real conforme o usuário digita no `body` (evento `input`)
    - Quando `body` vazio: exibir placeholder "O corpo do prompt aparecerá aqui…" com classe `body-preview-placeholder`
    - Máximo 5 linhas visíveis (`max-height: calc(5 * 1.5em)`), scroll vertical se exceder
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 5. Criar `modules/ui/prompt-picker.js` — Prompt_Picker como `<dialog>` modal
  - [ ] 5.1 Implementar estrutura do dialog e funções `initPromptPicker` / `openPromptPicker` / `closePromptPicker`
    - `initPromptPicker()`: cria o `<dialog class="prompt-picker">` com header (search input), tag chips, lista (`role="listbox"`), preview lateral e estado vazio; anexa ao `document.body`; chama apenas uma vez
    - `openPromptPicker({ store, onSelect })`: lê `store.get("advanced.promptLibrary")`, renderiza lista filtrada, chama `dialog.showModal()`, foca no campo de busca
    - `closePromptPicker()`: chama `dialog.close()`
    - Estado vazio (library vazia): exibe `.prompt-picker-empty` com link "Adicione nas configurações → Avançado" que chama `openSettings("advanced")`
    - Fechar ao clicar no backdrop: `dialog.addEventListener("click", e => { if (e.target === dialog) closePromptPicker(); })`
    - _Requirements: 4.1, 4.2, 4.8, 4.9_

  - [ ] 5.2 Implementar busca, filtro por tag e navegação por teclado no Prompt_Picker
    - Campo de busca: filtra lista em tempo real usando `filterPrompts` (reutiliza a função pura de `advanced.js`)
    - Tag chips: filtro por tag com mesmo comportamento do Prompt_Manager_Panel
    - Navegação: `ArrowDown`/`ArrowUp` move `selectedIndex` (circular); `Enter` confirma; `Escape` fecha; `Tab` move foco entre elementos focáveis do dialog
    - Item selecionado recebe `aria-selected="true"`; lista atualiza ao mover seleção
    - _Requirements: 4.3, 4.4, 4.5, 4.10_

  - [ ] 5.3 Implementar Body_Preview lateral e inserção no composer
    - Painel `.prompt-picker-preview` (220px, `aria-live="polite"`) exibe `truncatePreview(prompt.body, 300)` do item selecionado
    - Ao confirmar seleção (clique ou Enter): `closePromptPicker()` → chama `onSelect(prompt.body)`
    - Busca sem resultados: exibir "Nenhum prompt encontrado" dentro da lista
    - _Requirements: 4.6, 4.7_

- [ ] 6. Integrar Prompt_Picker no `modules/ui/composer.js`
  - [ ] 6.1 Adicionar botão "📚" na barra de ferramentas do composer
    - Criar `addPromptPickerButton()`: botão `#promptPickerButton` com `aria-label="Abrir biblioteca de prompts"` e `title="Biblioteca de prompts (Ctrl+Shift+L)"`; inserir após `#imageUploadButton` com `insertAdjacentElement("afterend", btn)`
    - Ao clicar: `openPromptPicker({ store, onSelect: insertPromptBody })`
    - Chamar `addPromptPickerButton()` dentro de `initComposer()`
    - _Requirements: 4.1_

  - [ ] 6.2 Implementar `insertPromptBody` e registrar atalho de teclado
    - `insertPromptBody(body)`: se `elements.promptInput.value.trim()` vazio → `setComposerValue(body)`; senão → `setComposerValue(current + "\n" + body)`; depois `focusComposer()`
    - Registrar action `"promptPicker"` via `registerAction` de `shortcuts.js`; o chord padrão `"Ctrl+Shift+L"` já está no keymap default (adicionado na tarefa 1)
    - Chamar `initPromptPicker()` uma vez dentro de `initComposer()` (lazy init)
    - _Requirements: 4.2, 4.6_

- [ ] 7. Refinar Slash_Overlay em `modules/ui/composer.js`
  - Aplicar limite de 8 itens combinados em `handleSlashSuggestions`: `slashItems = all.filter(...).slice(0, 8)`
  - Adicionar ícone visual diferenciador para itens `kind === "library"`: inserir `span` com texto "📚" antes do label no `openSlashSuggestions`
  - Garantir que `getSlashCommands()` trate `promptLibrary` não-array como `[]`
  - _Requirements: 5.1, 5.2, 5.4_

- [ ] 8. Adicionar seletores CSS em `styles.css`
  - Adicionar os blocos CSS definidos no design: `.tag-chip`, `.tag-chip-remove`, `.tag-filter`, `.tag-filter-chip`, `.body-preview`, `.body-preview-placeholder`, `dialog.prompt-picker` e todos os seletores filhos (`.prompt-picker-header`, `.prompt-picker-search`, `.prompt-picker-tags`, `.prompt-picker-body`, `.prompt-picker-list`, `.prompt-picker-list-item`, `.prompt-picker-item-name`, `.prompt-picker-item-id`, `.prompt-picker-preview`, `.prompt-picker-empty`)
  - _Requirements: 4.2, 4.3, 2.1, 6.1_

- [ ] 9. Testes de propriedade adicionais e testes de exemplo de integração
  - [ ] 9.1 Adicionar testes de exemplo de integração em `tests/feature-improvements.test.js`
    - Soft migration: prompt sem `tags` recebe `tags: []` após `loadAndMigrate()` (importar e testar `loadAndMigrate` com mock de localStorage)
    - Soft migration: `advanced.promptLibrary` não-array é substituído pelo default
    - `filterPrompts` com busca vazia retorna todos os prompts
    - `filterPrompts` com tag ativa retorna apenas prompts com aquela tag
    - _Requirements: 7.2, 7.3_

  - [ ]* 9.2 Escrever property test para Property 5: Idempotência da adição de tag
    - **Property 5: Idempotência da adição de tag** — adicionar uma tag já presente não altera o array
    - Gerador: `fc.array(fc.string({minLength:1}), {minLength:1})` + selecionar tag existente
    - **Validates: Requirements 2.4**
    - `// Feature: prompt-library-ui, Property 5: idempotência da adição de tag`

  - [ ]* 9.3 Escrever property test para Property 6: Remoção de tag
    - **Property 6: Remoção de tag** — após remover tag `t`, o array resultante não contém `t`
    - Gerador: `fc.array(fc.string({minLength:1}), {minLength:1})`
    - **Validates: Requirements 2.3**
    - `// Feature: prompt-library-ui, Property 6: remoção de tag`

  - [ ]* 9.4 Escrever property test para Property 11: Limite de itens no Slash_Overlay
    - **Property 11: Limite do Slash_Overlay** — `getSlashCommands()` com library de mais de 8 prompts retorna no máximo 8 itens após filtro
    - Gerador: `fc.array(fc.record({id, name, body, tags}), {minLength:9})`
    - **Validates: Requirements 5.4**
    - `// Feature: prompt-library-ui, Property 11: limite de itens no Slash_Overlay`

- [ ] 10. Checkpoint final — Validar sintaxe e testes
  - Rodar `npm run check` para validar sintaxe de todos os arquivos JS
  - Rodar `npm test` para garantir que todos os testes passam
  - Perguntar ao usuário se houver dúvidas antes de encerrar.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- O design usa JavaScript vanilla (ES modules nativos) — sem build step, sem frameworks
- Todas as funções puras (`filterPrompts`, `normalizeTag`, `isIdUnique`, `isNonEmpty`, `truncatePreview`) devem ser exportadas para testabilidade
- O atalho `"Ctrl+Shift+L"` foi escolhido para evitar conflito com `nextProfile: "Ctrl+Shift+P"` já existente no keymap
- A soft migration em `schema.js` garante retrocompatibilidade com prompts salvos sem o campo `tags`
- Testes de propriedade usam `fast-check` (já disponível em `devDependencies`) com `numRuns: 100`
- Cada property test deve incluir o comentário `// Feature: prompt-library-ui, Property N: <texto>` para rastreabilidade
