# Documento de Requisitos — Multimodal (Visão)

## Introdução

Esta feature adiciona suporte a **envio de imagens no chat** do Offline AI Chat, permitindo que o usuário envie imagens junto com mensagens de texto para modelos com capacidade de visão (VLMs) como Gemma 4 e Nemotron Omni, já presentes no catálogo do projeto.

A API OpenAI-compatible suporta conteúdo multimodal via array de partes na mensagem do usuário, onde cada parte pode ser `{ type: "text", text: "..." }` ou `{ type: "image_url", image_url: { url: "data:mime;base64,..." } }`. O LM Studio repassa esse formato diretamente ao modelo carregado.

O escopo cobre:

- Upload de imagem via botão dedicado no composer (file picker).
- Upload de imagem via drag-and-drop direto na área do chat.
- Preview da imagem antes do envio com opção de remoção.
- Construção do payload multimodal compatível com a API OpenAI.
- Renderização de imagens no histórico de mensagens.
- Detecção de modelos com capacidade de visão para feedback contextual ao usuário.
- Validação de tipo e tamanho de arquivo no cliente.

A infraestrutura parcial já existe: `composer-helpers.js` exporta `buildImageMessageContent` e `validateImageSize`; `composer.js` tem estado `pendingImage` e botão de upload; `chat.js` já renderiza partes `image_url` em `setBodyContent`. Esta spec formaliza e completa essa implementação.

---

## Glossário

- **Composer**: área de entrada de texto e controles de envio (`modules/ui/composer.js`).
- **Composer_Helpers**: módulo de funções puras do Composer (`modules/ui/composer-helpers.js`), sem dependências de DOM.
- **Chat_Module**: módulo de renderização de mensagens (`modules/ui/chat.js`).
- **App_Module**: arquivo `app.js` que orquestra o fluxo de envio de mensagens.
- **Schema_Module**: módulo `modules/schema.js` que define defaults e migrações do storage.
- **Model_Catalog**: módulo `modules/model-catalog.js` com catálogo de modelos curados e funções de detecção.
- **VLM**: Vision Language Model — modelo com capacidade de processar imagens junto com texto.
- **Pending_Image**: estado transitório no Composer que armazena a imagem selecionada antes do envio (`{ base64, mimeType, name }`).
- **Image_Preview**: elemento visual no Composer que exibe a imagem selecionada com botão de remoção.
- **Multimodal_Content**: array OpenAI-compatible de partes de mensagem contendo texto e/ou imagem (`[{ type: "text", text }, { type: "image_url", image_url: { url } }]`).
- **Image_Part**: elemento do Multimodal_Content do tipo `{ type: "image_url", image_url: { url: "data:mime;base64,..." } }`.
- **Text_Part**: elemento do Multimodal_Content do tipo `{ type: "text", text: "..." }`.
- **Drop_Zone**: área do chat que aceita arquivos arrastados pelo usuário.
- **Vision_Indicator**: elemento visual na topbar ou no composer que indica se o modelo ativo suporta visão.

---

## Requisitos

### Requisito 1: Upload de imagem via botão no composer

**User Story:** Como usuário, quero clicar em um botão no composer para selecionar uma imagem do meu dispositivo, para que eu possa enviar imagens ao modelo de visão sem precisar arrastar arquivos.

#### Critérios de Aceitação

1. THE Composer SHALL exibir um botão de upload de imagem com ícone de câmera/imagem, acessível via teclado e com `aria-label` descritivo.
2. WHEN o usuário clica no botão de upload de imagem, THE Composer SHALL abrir um file picker nativo do browser aceitando os tipos `image/png`, `image/jpeg`, `image/gif` e `image/webp`.
3. WHEN o usuário seleciona um arquivo de imagem válido, THE Composer SHALL ler o arquivo via `FileReader.readAsDataURL` e armazenar o resultado no Pending_Image.
4. IF o arquivo selecionado não for do tipo `image/png`, `image/jpeg`, `image/gif` ou `image/webp`, THEN THE Composer SHALL descartar o arquivo e disparar o evento `composer:image-error` com mensagem descritiva.
5. IF o arquivo selecionado exceder 10 MB, THEN THE Composer SHALL descartar o arquivo e disparar o evento `composer:image-error` com a mensagem `"Imagem muito grande. Limite: 10 MB."`.
6. WHEN o Pending_Image é definido, THE Composer SHALL exibir o Image_Preview acima da textarea com a imagem em miniatura e um botão de remoção.
7. WHEN o usuário clica no botão de remoção do Image_Preview, THE Composer SHALL limpar o Pending_Image e remover o Image_Preview do DOM.
8. THE Composer SHALL permitir substituir uma imagem já selecionada clicando novamente no botão de upload, substituindo o Pending_Image e atualizando o Image_Preview.

---

### Requisito 2: Upload de imagem via drag-and-drop

**User Story:** Como usuário, quero arrastar uma imagem diretamente para a área do chat, para que eu possa enviar imagens de forma rápida sem precisar usar o file picker.

#### Critérios de Aceitação

1. THE Drop_Zone SHALL aceitar arquivos arrastados sobre a área de mensagens do chat (elemento `#messages`).
2. WHEN o usuário arrasta um arquivo sobre o Drop_Zone, THE Drop_Zone SHALL exibir um overlay visual indicando que o arquivo pode ser solto, com texto "Solte a imagem aqui".
3. WHEN o usuário solta um arquivo de imagem válido no Drop_Zone, THE Composer SHALL processar o arquivo com as mesmas validações de tipo e tamanho do Requisito 1.
4. WHEN o usuário solta um arquivo que não é imagem no Drop_Zone, THE Drop_Zone SHALL ignorar o arquivo silenciosamente sem exibir erro, pois o drag-drop existente de arquivos de texto/PDF continua funcionando normalmente.
5. WHEN o usuário arrasta um arquivo para fora do Drop_Zone sem soltar, THE Drop_Zone SHALL remover o overlay visual.
6. THE Drop_Zone SHALL funcionar independentemente do drag-drop de workspace existente em `modules/workspace/dragdrop.js`, sem interferir no fluxo de arquivos de contexto.

---

### Requisito 3: Construção do payload multimodal

**User Story:** Como desenvolvedor, quero que o payload enviado ao modelo siga o formato OpenAI-compatible para mensagens multimodais, para que modelos VLM recebam a imagem corretamente.

#### Critérios de Aceitação

1. WHEN o usuário envia uma mensagem com Pending_Image definido, THE App_Module SHALL construir o Multimodal_Content como array com um Text_Part e um Image_Part.
2. THE Composer_Helpers SHALL exportar a função `buildImageMessageContent(text, base64Data, mimeType)` que retorna um Multimodal_Content com Text_Part `{ type: "text", text }` seguido de Image_Part `{ type: "image_url", image_url: { url: "data:<mimeType>;base64,<base64Data>" } }`.
3. WHEN o usuário envia uma mensagem com Pending_Image definido e texto vazio, THE App_Module SHALL construir o Multimodal_Content com Text_Part contendo string vazia e Image_Part com a imagem.
4. WHEN o usuário envia uma mensagem sem Pending_Image, THE App_Module SHALL enviar o conteúdo como string simples, mantendo o comportamento atual sem regressão.
5. WHEN o App_Module constrói o Multimodal_Content, THE App_Module SHALL chamar `clearPendingImage()` no Composer após incluir a imagem na mensagem, independentemente do resultado do envio.
6. THE Composer_Helpers SHALL ser importável por Node.js (sem dependências de DOM) para permitir testes unitários da função `buildImageMessageContent`.

---

### Requisito 4: Renderização de imagens no histórico

**User Story:** Como usuário, quero ver as imagens que enviei no histórico da conversa, para que eu possa acompanhar o contexto visual da conversa.

#### Critérios de Aceitação

1. WHEN o Chat_Module renderiza uma mensagem com `content` do tipo array (Multimodal_Content), THE Chat_Module SHALL renderizar cada Image_Part como elemento `<img>` com `src` igual à data URL e `alt` descritivo.
2. THE Chat_Module SHALL renderizar imagens com `max-width: 100%` e `max-height: 300px` para não distorcer o layout da conversa.
3. WHEN o Chat_Module renderiza uma mensagem com Multimodal_Content, THE Chat_Module SHALL renderizar os Text_Parts como markdown normalmente, após as imagens.
4. WHEN o Chat_Module renderiza uma mensagem com Multimodal_Content durante streaming, THE Chat_Module SHALL exibir as imagens imediatamente e o texto em modo streaming (`<pre class="streaming">`).
5. WHEN o usuário carrega uma conversa salva que contém mensagens com Multimodal_Content, THE Chat_Module SHALL re-renderizar as imagens corretamente a partir dos dados armazenados.
6. THE Chat_Module SHALL renderizar imagens com `border-radius` consistente com o design system (`var(--r-md)`) e `display: block` para evitar espaçamento inline indesejado.

---

### Requisito 5: Persistência de mensagens com imagem

**User Story:** Como usuário, quero que conversas com imagens sejam salvas e recuperadas corretamente, para que eu não perca o histórico de conversas multimodais.

#### Critérios de Aceitação

1. THE App_Module SHALL persistir mensagens com Multimodal_Content no `conversationStore` com o campo `content` como array, mantendo a estrutura `[{ type, text? }, { type, image_url? }]`.
2. WHEN uma conversa com mensagens de imagem é carregada do `conversationStore`, THE App_Module SHALL passar o `content` array diretamente para o Chat_Module sem transformação.
3. THE Schema_Module SHALL aceitar `content` como string ou array no tipo de mensagem, sem quebrar a migração de conversas existentes que usam `content` como string.
4. WHEN o App_Module calcula tokens do histórico para o estimador do Composer, THE App_Module SHALL extrair apenas os Text_Parts do Multimodal_Content para a estimativa, ignorando os Image_Parts.
5. IF o `conversationStore` contém mensagens com `content` array de uma versão anterior, THEN THE App_Module SHALL carregar e renderizar essas mensagens sem erro.

---

### Requisito 6: Detecção de modelos com capacidade de visão

**User Story:** Como usuário, quero receber feedback visual quando o modelo ativo suporta ou não suporta visão, para que eu saiba quando posso enviar imagens.

#### Critérios de Aceitação

1. THE Model_Catalog SHALL exportar a função `isLikelyVisionModel(modelIdOrName)` que retorna `true` para modelos com capacidade de visão conhecida (ex: `gemma-4`, `nemotron-omni`, `llava`, `bakllava`, `moondream`, `minicpm-v`, `qwen-vl`, `internvl`, `phi-3-vision`, `pixtral`).
2. WHEN o modelo ativo é identificado como VLM pelo `isLikelyVisionModel`, THE Composer SHALL exibir o botão de upload de imagem sem restrição visual.
3. WHEN o modelo ativo não é identificado como VLM, THE Composer SHALL exibir o botão de upload de imagem com indicação visual de aviso (ex: ícone com cor de alerta) e tooltip explicando que o modelo pode não suportar imagens.
4. WHEN o usuário tenta enviar uma mensagem com Pending_Image e o modelo ativo não é identificado como VLM, THE App_Module SHALL exibir um toast de aviso `"O modelo selecionado pode não suportar imagens. A mensagem será enviada assim mesmo."` e prosseguir com o envio.
5. THE Model_Catalog SHALL detectar modelos VLM por correspondência case-insensitive de padrões no ID ou nome do modelo, sem hardcode de IDs completos.

---

### Requisito 7: Validação e segurança no cliente

**User Story:** Como desenvolvedor, quero que a validação de imagens ocorra inteiramente no cliente antes do envio, para que payloads inválidos ou excessivamente grandes não sejam enviados ao servidor proxy.

#### Critérios de Aceitação

1. THE Composer_Helpers SHALL exportar a função `validateImageSize(sizeBytes, limitBytes)` que retorna `true` se `sizeBytes <= limitBytes` e `false` caso contrário, com `limitBytes` padrão de `10 * 1024 * 1024` (10 MB).
2. THE Composer SHALL validar o tipo MIME do arquivo usando `file.type` antes de iniciar a leitura com `FileReader`, rejeitando tipos não permitidos sem iniciar I/O.
3. THE Composer SHALL validar o tamanho do arquivo usando `file.size` antes de iniciar a leitura com `FileReader`, rejeitando arquivos acima do limite sem iniciar I/O.
4. WHEN o App_Module constrói o payload com Multimodal_Content, THE App_Module SHALL verificar que a data URL começa com `data:image/` antes de incluir o Image_Part, descartando silenciosamente se inválida.
5. THE Composer SHALL limpar o Pending_Image quando o Composer é limpo após o envio (`clearComposer`), garantindo que imagens não sejam reenviadas em mensagens subsequentes.
6. FOR ALL combinações de tipo MIME permitido e tamanho dentro do limite, `validateImageSize` e a verificação de tipo SHALL aceitar o arquivo; para qualquer tipo não permitido ou tamanho acima do limite, SHALL rejeitar.

---

### Requisito 8: Acessibilidade e experiência do usuário

**User Story:** Como usuário, quero que a feature de envio de imagens seja acessível e intuitiva, para que eu possa usá-la sem dificuldade independentemente de como interajo com a interface.

#### Critérios de Aceitação

1. THE Composer SHALL associar o botão de upload de imagem a um `aria-label` em português descrevendo a ação ("Anexar imagem").
2. THE Image_Preview SHALL incluir `alt` text descritivo na tag `<img>` ("Preview da imagem") e o botão de remoção SHALL ter `aria-label` ("Remover imagem").
3. WHEN o Image_Preview está visível, THE Composer SHALL manter o foco na textarea após a seleção da imagem para que o usuário possa digitar o texto da mensagem imediatamente.
4. THE Drop_Zone SHALL usar `role="region"` e `aria-label` descritivo para leitores de tela identificarem a área de drop.
5. WHEN o App_Module recebe o evento `composer:image-error`, THE App_Module SHALL exibir o erro via `toast(message, "error")` para que o usuário receba feedback visual imediato.
6. THE Composer SHALL permitir enviar uma mensagem contendo apenas uma imagem sem texto, sem bloquear o submit quando a textarea estiver vazia mas o Pending_Image estiver definido.
