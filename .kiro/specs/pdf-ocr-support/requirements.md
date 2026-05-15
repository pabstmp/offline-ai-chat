# Requirements Document

## Introduction

PDFs escaneados (digitalizações de documentos físicos) não possuem camada de texto extraível pelo pdfjs-dist. Atualmente o sistema extrai texto apenas de PDFs digitais; PDFs escaneados retornam conteúdo vazio ou quase vazio, tornando-os inúteis para RAG e contexto de workspace.

Esta feature adiciona suporte a OCR automático para PDFs escaneados no **Offline AI Chat**, aproveitando as dependências `tesseract.js` e `@napi-rs/canvas` já presentes no servidor. O sistema deve detectar automaticamente quando um PDF não possui texto extraível e aplicar OCR via Tesseract, sem exigir configuração manual do usuário. A feature cobre os dois fluxos de ingestão de PDF existentes: upload direto pelo cliente (`/api/extract-pdf`) e leitura via filesystem do servidor (`/api/fs/read-pdf`).

## Glossary

- **PDF_Extractor**: Componente server-side responsável por extrair texto de arquivos PDF usando pdfjs-dist.
- **OCR_Engine**: Componente server-side que renderiza páginas PDF em imagens e aplica reconhecimento óptico de caracteres via tesseract.js.
- **Canvas_Renderer**: Componente server-side que usa `@napi-rs/canvas` para renderizar páginas PDF em buffers PNG para o OCR_Engine.
- **PDF_Scanned**: PDF cujas páginas não possuem camada de texto extraível (texto extraído por pdfjs com menos de 10 caracteres por página).
- **PDF_Digital**: PDF com camada de texto nativa extraível pelo pdfjs-dist.
- **OCR_Threshold**: Heurística que determina se um PDF é escaneado: mais de 50% das páginas com menos de 10 caracteres extraídos.
- **Upload_Backend**: Módulo client-side `modules/workspace/upload.js` que envia PDFs ao servidor via `/api/extract-pdf`.
- **FSBridge_Backend**: Módulo client-side `modules/workspace/fsbridge.js` que solicita PDFs ao servidor via `/api/fs/read-pdf`.
- **OCR_Cache**: Diretório em disco (configurável via `OCR_CACHE_DIR`, padrão `/tmp/tesseract-cache`) onde o tesseract.js armazena os modelos de linguagem baixados.
- **OCR_Langs**: Lista de idiomas para o OCR, configurável via variável de ambiente `OCR_LANGS` (padrão `por+eng`).
- **ocrLikelyNeeded**: Flag booleana retornada pelo servidor quando um PDF foi processado sem OCR mas o OCR_Threshold indica que o documento é escaneado.
- **ocrApplied**: Flag booleana retornada pelo servidor indicando que OCR foi efetivamente executado em pelo menos uma página.
- **Workspace_Settings**: Aba de configurações do workspace na UI, acessível via `modules/ui/settings/workspace.js`.

---

## Requirements

### Requirement 1: Detecção automática de PDFs escaneados

**User Story:** Como usuário, quero que o sistema identifique automaticamente quando um PDF é escaneado, para que eu não precise configurar nada manualmente.

#### Acceptance Criteria

1. WHEN o PDF_Extractor processa um PDF, THE PDF_Extractor SHALL calcular a proporção de páginas com menos de 10 caracteres extraídos em relação ao total de páginas processadas.
2. WHEN a proporção de páginas sem texto extraível supera 50% do total de páginas processadas, THE PDF_Extractor SHALL definir `ocrLikelyNeeded` como `true` na resposta.
3. WHEN a proporção de páginas sem texto extraível é igual ou inferior a 50%, THE PDF_Extractor SHALL definir `ocrLikelyNeeded` como `false` na resposta.
4. THE PDF_Extractor SHALL incluir os campos `pagesEmpty`, `pagesWithText`, `ocrLikelyNeeded` e `ocrApplied` em toda resposta de extração de PDF, independentemente do modo de operação.
5. WHEN um PDF possui zero páginas processadas, THE PDF_Extractor SHALL definir `ocrLikelyNeeded` como `false` e `ocrApplied` como `false`.

---

### Requirement 2: Aplicação de OCR em páginas sem texto

**User Story:** Como usuário, quero que o sistema aplique OCR automaticamente nas páginas escaneadas, para que o conteúdo dos documentos digitalizados fique disponível para o chat e para o RAG.

#### Acceptance Criteria

1. WHEN o PDF_Extractor processa uma página e o texto extraído pelo pdfjs possui menos de 10 caracteres, E o parâmetro `ocr` da requisição é `true`, THE OCR_Engine SHALL renderizar a página em um buffer PNG com escala 2.0 e aplicar reconhecimento de texto via tesseract.js.
2. WHEN o OCR_Engine reconhece texto com 10 ou mais caracteres em uma página, THE PDF_Extractor SHALL substituir o texto vazio da página pelo texto reconhecido pelo OCR_Engine.
3. WHEN o OCR_Engine é aplicado em pelo menos uma página, THE PDF_Extractor SHALL definir `ocrApplied` como `true` e incrementar o contador `pagesOcred` na resposta.
4. WHEN o parâmetro `ocr` da requisição é `false` ou ausente, THE PDF_Extractor SHALL processar o PDF sem invocar o OCR_Engine, independentemente do conteúdo das páginas.
5. WHEN o OCR_Engine falha em uma página específica (erro de renderização ou de reconhecimento), THE PDF_Extractor SHALL registrar o erro via `console.warn` e continuar o processamento das páginas restantes sem interromper a requisição.
6. WHEN o PDF_Extractor processa uma página com texto nativo suficiente (10 ou mais caracteres), THE OCR_Engine SHALL NOT ser invocado para essa página, mesmo que `ocr` seja `true`.

---

### Requirement 3: Configuração de idiomas do OCR

**User Story:** Como operador do sistema, quero configurar os idiomas do OCR via variável de ambiente, para que o reconhecimento funcione corretamente com documentos em diferentes idiomas.

#### Acceptance Criteria

1. THE OCR_Engine SHALL ler a variável de ambiente `OCR_LANGS` na inicialização do servidor para determinar os idiomas de reconhecimento.
2. WHEN `OCR_LANGS` não está definida ou está vazia, THE OCR_Engine SHALL usar `por+eng` como valor padrão de idiomas.
3. WHEN `OCR_LANGS` contém múltiplos idiomas separados por `+` (ex: `por+eng+spa`), THE OCR_Engine SHALL passar todos os idiomas ao tesseract.js na criação do worker.
4. THE OCR_Engine SHALL reutilizar o worker do tesseract.js entre requisições enquanto a configuração de idiomas não mudar, para evitar overhead de inicialização por requisição.
5. WHEN a configuração de idiomas muda entre requisições (ex: reinicialização do servidor com novo `OCR_LANGS`), THE OCR_Engine SHALL encerrar o worker anterior antes de criar um novo worker com os novos idiomas.

---

### Requirement 4: Cache de modelos do Tesseract

**User Story:** Como operador do sistema, quero que os modelos de linguagem do Tesseract sejam armazenados em cache em disco, para que o OCR funcione offline após o primeiro uso e não precise baixar os modelos a cada reinicialização.

#### Acceptance Criteria

1. THE OCR_Engine SHALL armazenar os modelos de linguagem do tesseract.js no diretório especificado pela variável de ambiente `OCR_CACHE_DIR`.
2. WHEN `OCR_CACHE_DIR` não está definida, THE OCR_Engine SHALL usar `/tmp/tesseract-cache` como diretório de cache padrão.
3. WHEN o diretório de cache não existe, THE OCR_Engine SHALL criar o diretório recursivamente antes de inicializar o worker do tesseract.js.
4. THE OCR_Engine SHALL configurar o tesseract.js com `cacheMethod: "readWrite"` para que os modelos sejam lidos do cache quando disponíveis e gravados no cache após o primeiro download.

---

### Requirement 5: Ativação de OCR no upload de PDFs pelo cliente

**User Story:** Como usuário, quero que PDFs escaneados enviados via upload sejam processados com OCR automaticamente quando a opção estiver habilitada, para que o conteúdo seja extraído corretamente.

#### Acceptance Criteria

1. WHEN o Upload_Backend envia um PDF ao endpoint `/api/extract-pdf`, THE Upload_Backend SHALL incluir o campo `ocr` no corpo da requisição com valor `true` quando OCR estiver habilitado nas configurações do workspace.
2. WHEN o servidor retorna `ocrLikelyNeeded: true` em uma resposta de extração sem OCR, THE Upload_Backend SHALL registrar essa informação no campo `meta.ocrLikelyNeeded` do objeto de arquivo retornado.
3. THE Upload_Backend SHALL incluir os campos `ocrApplied`, `ocrLikelyNeeded` e `pagesOcred` no objeto `meta` retornado para cada PDF processado.
4. WHEN o servidor retorna `ocrApplied: true`, THE Upload_Backend SHALL definir `meta.ocrApplied` como `true` no objeto de arquivo retornado.

---

### Requirement 6: Ativação de OCR na leitura de PDFs via filesystem

**User Story:** Como usuário, quero que PDFs escaneados lidos diretamente do filesystem do servidor também sejam processados com OCR, para que o RAG funcione corretamente com documentos digitalizados.

#### Acceptance Criteria

1. WHEN o FSBridge_Backend solicita um PDF ao endpoint `/api/fs/read-pdf`, THE FSBridge_Backend SHALL incluir o campo `ocr` no corpo da requisição com valor `true` quando OCR estiver habilitado nas configurações do workspace.
2. WHEN o endpoint `/api/fs/read-pdf` recebe uma requisição com `ocr: true`, THE PDF_Extractor SHALL aplicar OCR nas páginas sem texto extraível, seguindo os mesmos critérios do Requirement 2.
3. WHEN o endpoint `/api/fs/read-pdf` retorna `ocrLikelyNeeded: true` para uma requisição sem OCR, THE FSBridge_Backend SHALL propagar essa informação para o chamador.

---

### Requirement 7: Configuração de OCR nas preferências do workspace

**User Story:** Como usuário, quero ativar ou desativar o OCR nas configurações do workspace, para que eu tenha controle sobre quando o processamento adicional é aplicado.

#### Acceptance Criteria

1. THE Workspace_Settings SHALL exibir um controle de alternância (toggle) para habilitar ou desabilitar o OCR de PDFs escaneados.
2. WHEN o usuário ativa o toggle de OCR, THE Workspace_Settings SHALL persistir `workspace.ocrEnabled = true` no schema de configuração.
3. WHEN o usuário desativa o toggle de OCR, THE Workspace_Settings SHALL persistir `workspace.ocrEnabled = false` no schema de configuração.
4. THE Workspace_Settings SHALL exibir o toggle de OCR com o estado atual refletindo o valor de `workspace.ocrEnabled` armazenado.
5. WHEN `workspace.ocrEnabled` não está presente no schema (instalações existentes), THE Workspace_Settings SHALL tratar o valor como `false` (OCR desativado por padrão).

---

### Requirement 8: Feedback visual do OCR para o usuário

**User Story:** Como usuário, quero receber feedback sobre o resultado do processamento OCR de um PDF, para que eu saiba se o documento foi reconhecido corretamente ou se há limitações.

#### Acceptance Criteria

1. WHEN um PDF é processado com OCR e `ocrApplied` é `true`, THE Upload_Backend SHALL emitir uma notificação informativa indicando o número de páginas processadas via OCR (`pagesOcred`).
2. WHEN um PDF é processado sem OCR e `ocrLikelyNeeded` é `true`, THE Upload_Backend SHALL emitir uma notificação de aviso indicando que o documento parece ser escaneado e sugerindo habilitar OCR nas configurações do workspace.
3. WHEN um PDF é processado e `pagesOcred` é zero mas `ocrApplied` é `true`, THE Upload_Backend SHALL emitir uma notificação de aviso indicando que o OCR foi aplicado mas nenhum texto foi reconhecido.
4. THE Upload_Backend SHALL usar o sistema de toasts existente (`toast()`) para todas as notificações relacionadas ao OCR, com duração mínima de 5000ms para mensagens de aviso.

---

### Requirement 9: Compatibilidade com o pipeline RAG

**User Story:** Como usuário, quero que PDFs escaneados processados com OCR sejam indexados corretamente pelo RAG, para que o conteúdo reconhecido fique disponível para busca semântica.

#### Acceptance Criteria

1. WHEN o RAG indexer processa um PDF via `/api/fs/read-pdf`, THE RAG indexer SHALL passar `ocr: true` na requisição quando `workspace.ocrEnabled` for `true`.
2. WHEN o texto extraído de um PDF via OCR é retornado pelo servidor, THE RAG indexer SHALL processar esse texto com o mesmo pipeline de chunking e embedding aplicado a PDFs digitais.
3. WHEN o RAG indexer recebe uma resposta com `ocrApplied: true`, THE RAG indexer SHALL armazenar `ocrApplied: true` nos metadados da fonte indexada (`embedding_meta`).
4. WHEN o RAG indexer recebe uma resposta com `ocrLikelyNeeded: true` e `ocrApplied: false`, THE RAG indexer SHALL emitir um aviso via pubsub indicando que a fonte pode ter conteúdo incompleto por falta de OCR.

---

### Requirement 10: Validação e limites de segurança do OCR

**User Story:** Como operador do sistema, quero que o processamento OCR respeite os limites de tamanho e segurança existentes, para que o servidor não seja sobrecarregado por PDFs maliciosos ou excessivamente grandes.

#### Acceptance Criteria

1. THE PDF_Extractor SHALL aplicar OCR apenas em PDFs que já passaram pela validação de tamanho existente (`MAX_PDF_BYTES`, padrão 32 MB).
2. WHEN o PDF_Extractor processa um PDF com OCR habilitado, THE Canvas_Renderer SHALL limitar a renderização ao máximo de 500 páginas por documento (mesmo limite já aplicado à extração de texto).
3. WHEN o Canvas_Renderer falha ao criar o contexto de canvas para uma página, THE PDF_Extractor SHALL tratar a falha como página sem texto e continuar o processamento sem lançar exceção para o cliente.
4. THE OCR_Engine SHALL ser carregado de forma lazy (somente quando uma requisição com `ocr: true` é recebida), para que o servidor inicie rapidamente em deployments que não utilizam OCR.
