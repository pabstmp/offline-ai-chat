# Plano de Implementação: Multimodal (Visão)

## Visão Geral

Completar e formalizar o suporte a mensagens multimodais com imagens no Offline AI Chat. A infraestrutura parcial já existe — `composer-helpers.js` exporta `buildImageMessageContent` e `validateImageSize`, `composer.js` tem estado `pendingImage` e botão de upload, e `chat.js` já renderiza partes `image_url` em `setBodyContent`. Esta implementação adiciona drag-and-drop, detecção de VLMs, indicador visual de suporte, CSS necessário e testes das propriedades de corretude.

## Tarefas

- [ ] 1. Adicionar `isLikelyVisionModel` ao `modules/model-catalog.js`
  - Exportar a função `isLikelyVisionModel(modelIdOrName)` → boolean
  - Detectar por correspondência case-insensitive dos padrões: `gemma-?4`, `llava`, `bakllava`, `moondream`, `minicpm-?v`, `qwen-?vl`, `internvl`, `phi-?3-?vision`, `pixtral`, `nemotron-?omni`, `\bvision\b`, `multimodal`
  - Retornar `false` para `null`, `undefined` ou string vazia
  - _Requisitos: 6.1, 6.5_

  - [ ]* 1.1 Escrever property test para `isLikelyVisionModel` (Property 4)
    - **Property 4: Detecção de VLM é case-insensitive**
    - **Validates: Requisitos 6.1, 6.5**
    - Gerar strings com padrões VLM em case aleatório → deve retornar `true`
    - Gerar strings sem nenhum padrão VLM → deve retornar `false`

- [ ] 2. Completar `modules/ui/composer.js` — drag-and-drop e indicador visual
  - [ ] 2.1 Implementar `initDropZone(messagesElement)` e exportar
    - Adicionar listeners `dragover`, `dragleave` e `drop` no elemento `#messages`
    - `dragover`: verificar se o arquivo arrastado é imagem (`event.dataTransfer.items[0].type`); se sim, exibir overlay `#drop-zone-overlay` com texto "Solte a imagem aqui"; chamar `event.preventDefault()`
    - `dragleave`: remover overlay quando o cursor sair da área
    - `drop`: chamar `handleImageFile(file)` se o arquivo for imagem; ignorar silenciosamente se não for; remover overlay
    - O overlay deve ter `role="region"` e `aria-label="Área para soltar imagem"`
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.4_

  - [ ] 2.2 Implementar `updateVisionIndicator(isVisionModel)` e exportar
    - Adicionar/remover classe CSS `vision-warning` no botão `#imageUploadButton`
    - Atualizar `title` do botão: sem aviso quando VLM, com aviso `"Este modelo pode não suportar imagens"` quando não-VLM
    - _Requisitos: 6.2, 6.3_

  - [ ] 2.3 Garantir que `clearComposer()` chama `clearPendingImage()` explicitamente
    - Verificar que a função existente `clearComposer` já invoca `clearPendingImage()`; se não, adicionar a chamada
    - _Requisitos: 7.5, 8.6_

- [ ] 3. Atualizar `app.js` — integrar detecção de VLM, Drop_Zone e toast de aviso
  - [ ] 3.1 Importar `isLikelyVisionModel` de `modules/model-catalog.js` e `updateVisionIndicator`, `initDropZone` de `modules/ui/composer.js`
    - Adicionar as importações necessárias no bloco de imports do `app.js`
    - _Requisitos: 6.1, 6.2, 6.3_

  - [ ] 3.2 Implementar `refreshVisionIndicator()` e conectar aos pontos de atualização
    - Criar função `refreshVisionIndicator()` que lê `profile.defaultModel`, chama `isLikelyVisionModel(model)` e chama `updateVisionIndicator(isVision)`
    - Chamar `refreshVisionIndicator()` ao final de `loadModels()`, `refreshChips()` e no `store.subscribe("activeProfileId", ...)`
    - _Requisitos: 6.2, 6.3_

  - [ ] 3.3 Registrar listener para `composer:image-error` e exibir toast
    - Adicionar `document.addEventListener("composer:image-error", (e) => toast(e.detail.message, "error"))` na inicialização do app
    - _Requisitos: 1.4, 1.5, 8.5_

  - [ ] 3.4 Adicionar toast de aviso ao enviar imagem com modelo não-VLM
    - Em `submitMessage`, após obter `pendingImg`, verificar `!isLikelyVisionModel(model)` e exibir `toast("O modelo selecionado pode não suportar imagens. A mensagem será enviada assim mesmo.", "warn", 5000)`
    - _Requisitos: 6.4_

  - [ ] 3.5 Adicionar validação `isSafeImageDataUrl` antes de incluir Image_Part no payload
    - Implementar função local `isSafeImageDataUrl(url)` → `typeof url === "string" && url.startsWith("data:image/")`
    - Verificar a data URL antes de chamar `buildImageMessageContent`; descartar silenciosamente se inválida
    - _Requisitos: 7.4_

  - [ ] 3.6 Inicializar Drop_Zone após `initChat`
    - Chamar `initDropZone(elements.messages)` na sequência de inicialização do app, após `initChat`
    - _Requisitos: 2.1_

- [ ] 4. Checkpoint — Verificar fluxo de upload e envio
  - Garantir que `npm run check` não reporta erros de sintaxe nos arquivos modificados.
  - Verificar manualmente (ou via teste) que: botão de upload abre file picker, imagem válida gera preview, imagem inválida dispara toast de erro, envio com imagem constrói payload correto e limpa `pendingImage`.

- [ ] 5. Adicionar CSS para preview de imagem, drop zone e indicador visual em `styles.css`
  - Adicionar estilos para `.composer-image-preview` (container do preview acima da textarea)
  - Adicionar estilos para `.composer-image-preview img` (`max-width: 100%`, `max-height: 120px`, `border-radius: var(--r-md)`, `display: block`)
  - Adicionar estilos para `.composer-image-preview-remove` (botão × de remoção, posicionado absolutamente no canto superior direito do preview)
  - Adicionar estilos para `.drop-zone-overlay` (overlay semitransparente sobre `#messages` com texto centralizado, `z-index` adequado, borda tracejada)
  - Adicionar estilos para `#imageUploadButton.vision-warning svg` (`color: var(--warn)`) para indicar modelo não-VLM
  - _Requisitos: 4.2, 4.6, 2.2, 6.3_

- [ ] 6. Verificar e ajustar renderização de imagens em `modules/ui/chat.js`
  - Confirmar que `setBodyContent` já renderiza `image_url` parts com `max-width: 100%`, `max-height: 300px`, `border-radius: var(--r-md)` e `display: block`
  - Confirmar que Text_Parts são renderizados como markdown após as imagens
  - Confirmar que o modo streaming exibe imagens imediatamente e texto em `<pre class="streaming">`
  - Ajustar quaisquer detalhes que não estejam conforme os requisitos 4.1–4.6
  - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 7. Adicionar testes de propriedade e exemplos em `tests/feature-improvements.test.js`
  - [ ] 7.1 Importar `isLikelyVisionModel` de `../modules/model-catalog.js`
    - Adicionar import no bloco de imports do arquivo de testes
    - _Requisitos: 6.1, 6.5_

  - [ ]* 7.2 Escrever property test para `isLikelyVisionModel` (Property 4)
    - **Property 4: Detecção de VLM é case-insensitive**
    - **Validates: Requisitos 6.1, 6.5**
    - Gerar strings com padrões VLM em case aleatório (ex: `"LLAVA"`, `"Gemma-4"`, `"qwen-VL"`) → deve retornar `true`
    - Gerar strings sem padrões VLM (ex: `"llama-3"`, `"mistral"`, `"phi-4-mini"`) → deve retornar `false`

  - [ ]* 7.3 Escrever property test para validação combinada de tipo MIME e tamanho (Property 3)
    - **Property 3: Validação combinada de tipo MIME e tamanho**
    - **Validates: Requisitos 1.4, 1.5, 7.6**
    - Para qualquer par `(mimeType, sizeBytes)`: aceito iff `mimeType ∈ { "image/png", "image/jpeg", "image/gif", "image/webp" }` AND `sizeBytes <= 10 * 1024 * 1024`

  - [ ]* 7.4 Estender Property 8 existente para cobrir `text = ""` (Property 1 — extensão)
    - **Property 1 (extensão): buildImageMessageContent com texto vazio**
    - **Validates: Requisito 3.3**
    - Adicionar caso `fc.constant("")` para `text` e verificar que `Text_Part.text === ""`

  - [ ]* 7.5 Escrever property test para `isSafeImageDataUrl` (Property 5)
    - **Property 5: Segurança da data URL antes do envio**
    - **Validates: Requisito 7.4**
    - Para qualquer string `url`: retorna `true` iff começa com `"data:image/"`

  - [ ]* 7.6 Escrever testes de exemplo para comportamentos de UI
    - Verificar que `buildImageMessageContent("", "abc", "image/png")` retorna `Text_Part` com `text === ""`
    - Verificar que `validateImageSize(10 * 1024 * 1024)` retorna `true` (exatamente no limite)
    - Verificar que `isLikelyVisionModel("gemma-4-26b")` retorna `true`
    - Verificar que `isLikelyVisionModel("llama-3.1-8b")` retorna `false`
    - Verificar que `isLikelyVisionModel(null)` retorna `false`
    - Verificar que `isLikelyVisionModel("LLAVA-1.6")` retorna `true` (case-insensitive)
    - _Requisitos: 6.1, 6.5, 3.3, 1.5_

- [ ] 8. Checkpoint final — Garantir que todos os testes passam
  - Executar `npm test` e garantir que todos os testes (unit, PBT e hardening) passam sem falhas.
  - Executar `npm run check` para validar sintaxe de todos os arquivos modificados.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia requisitos específicos para rastreabilidade
- Properties 8 e 9 (já em `tests/feature-improvements.test.js`) cobrem `buildImageMessageContent` e `validateImageSize` — não duplicar
- `composer-helpers.js`, a lógica de `pendingImage` em `composer.js`, o botão de upload e o fluxo de envio em `app.js` já estão implementados — as tarefas acima completam o que falta
- `setBodyContent` em `chat.js` já suporta `content` array com `image_url` — verificar conformidade com os requisitos antes de ajustar
- `recomputeHistoryTokens` em `app.js` já trata `content` array corretamente (filtra `Text_Parts`) — nenhuma alteração necessária
- O schema já aceita `content` como string ou array — nenhuma migração necessária
- O drag-and-drop de imagens deve ser independente do `modules/workspace/dragdrop.js` — verificar tipo do arquivo antes de processar
