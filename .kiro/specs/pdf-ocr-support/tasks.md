# Plano de Implementação: pdf-ocr-support

## Visão Geral

A maior parte da infraestrutura de OCR já está implementada no codebase (`server.js`, `upload.js`, `fsbridge.js`, `indexer.js`, `schema.js`, `settings/workspace.js`). As tarefas focam nas lacunas reais identificadas no design:

1. **Toasts de feedback OCR** após upload de PDFs (Req 8) — ausentes em `workspace.js`, `upload.js` e `dragdrop.js`
2. **Propagação de `ocrEnabled`** para `readFiles` e `dragdrop.js` (Req 5.1)
3. **Soft migration** de `ocrEnabled` em `loadAndMigrate()` (Req 7.5)
4. **Metadados OCR em `setSourceMeta`** no indexer (Req 9.3)
5. **Testes de propriedade** para as 14 propriedades de correção do design

---

## Tasks

- [ ] 1. Adicionar soft migration de `ocrEnabled` em `schema.js`
  - Em `loadAndMigrate()`, após carregar o schema v2, verificar se `target.workspace.ocrEnabled === undefined` e definir como `false`
  - Garantir que instalações existentes sem o campo não quebrem ao carregar configurações
  - _Requirements: 7.5_

- [ ] 2. Propagar `ocrEnabled` para o fluxo de upload direto
  - [ ] 2.1 Atualizar `readFiles` em `modules/workspace/upload.js` para aceitar `opts` e passar `ocr: !!opts?.ocr` para `extractPdfFile`
    - Atualmente `readFiles` chama `extractPdfFile(f)` sem opts — precisa passar `opts.ocr`
    - Assinatura: `readFiles(fileList, maxBytes, onSkipped, opts = {})`
    - _Requirements: 5.1_

  - [ ] 2.2 Atualizar `pickFiles` em `modules/workspace/upload.js` para aceitar e repassar `opts`
    - `pickFiles` chama `readFiles` — precisa repassar `opts` (incluindo `ocr`)
    - _Requirements: 5.1_

  - [ ] 2.3 Atualizar o handler do `attachButton` em `modules/ui/workspace.js` para passar `ocr: !!ws.ocrEnabled` ao chamar `upload.pickFiles`
    - Ler `ws.ocrEnabled` do store antes de chamar `pickFiles`
    - _Requirements: 5.1_

- [ ] 3. Adicionar toasts de feedback OCR após upload em `modules/ui/workspace.js`
  - Após `upload.pickFiles` retornar, iterar sobre `files` e emitir toasts conforme o design:
    - `ocrApplied && pagesOcred > 0` → `toast("OCR aplicado em N página(s) de \"nome\".", "info", 5000)`
    - `ocrApplied && pagesOcred === 0` → `toast("OCR aplicado em \"nome\" mas nenhum texto foi reconhecido.", "warn", 5000)`
    - `ocrLikelyNeeded` → `toast("\"nome\" parece ser um PDF escaneado. Habilite OCR em Configurações → Workspace para extrair o texto.", "warn", 6000)`
  - Emitir no máximo um toast por arquivo PDF (verificar `file.meta?.kind === "pdf"`)
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 4. Propagar `ocrEnabled` para o fluxo de drag-and-drop
  - [ ] 4.1 Atualizar `bindDragDrop` em `modules/workspace/dragdrop.js` para aceitar `ocr` em opts e repassar para `extractPdfFile`
    - Atualmente `walkEntry` chama `extractPdfFile(file)` sem opts
    - Adicionar `ocr` ao objeto de opts passado para `walkEntry`
    - _Requirements: 5.1_

  - [ ] 4.2 Atualizar o handler de drag-and-drop em `modules/ui/workspace.js` para passar `ocr: !!ws.ocrEnabled` ao chamar `dragdrop.bindDragDrop`
    - _Requirements: 5.1_

- [ ] 5. Adicionar metadados OCR em `setSourceMeta` no indexer
  - Em `modules/rag/indexer.js`, na fase 6 (meta), incluir `ocrApplied` e `ocrNeededCount` na chamada a `setSourceMeta`:
    ```js
    ocrApplied: ocredFiles.length > 0,
    ocrNeededCount: ocrNeededFiles.length,
    ```
  - _Requirements: 9.3_

- [ ] 6. Checkpoint — verificar sintaxe e testes existentes
  - Rodar `npm run check` para validar sintaxe de todos os arquivos modificados
  - Rodar `npm test` para garantir que os testes existentes continuam passando
  - Garantir que nenhuma mudança quebrou o comportamento existente

- [ ] 7. Escrever testes de propriedade para as propriedades de correção do design
  - Adicionar seção `pdf-ocr-support` em `tests/feature-improvements.test.js`
  - Importar as funções puras necessárias (extrair helpers testáveis se necessário)

  - [ ]* 7.1 Escrever teste de propriedade para Propriedade 1: threshold de detecção de PDF escaneado
    - **Property 1: ocrLikelyNeeded é true sse ocr=false E pagesEmpty/total > 0.5**
    - Gerador: `fc.array(fc.string({ maxLength: 200 }), { minLength: 0, maxLength: 50 })`
    - Testar a lógica: `!useOcr && pagesEmpty > 0 && pagesEmpty / maxPages > 0.5`
    - **Validates: Requirements 1.2, 1.3, 1.5**

  - [ ]* 7.2 Escrever teste de propriedade para Propriedade 2: invariante de campos na resposta
    - **Property 2: resposta sempre contém pagesEmpty, pagesWithText, ocrLikelyNeeded, ocrApplied com tipos corretos**
    - Testar que o mapeamento em `extractPdfFile` preserva tipos (boolean/number) mesmo com valores ausentes no servidor
    - **Validates: Requirement 1.4**

  - [ ]* 7.3 Escrever teste de propriedade para Propriedade 3: seleção correta de páginas para OCR
    - **Property 3: OCR é invocado exatamente nas páginas com text.trim().length < 10 quando ocr=true**
    - Mock de `ocrPage` para rastrear quais páginas foram chamadas
    - **Validates: Requirements 2.1, 2.6**

  - [ ]* 7.4 Escrever teste de propriedade para Propriedade 4: substituição de texto por resultado OCR
    - **Property 4: texto final da página é o texto OCR se ocrText.length >= 10, senão permanece vazio**
    - Gerador: `fc.string({ maxLength: 500 })` para ocrText
    - **Validates: Requirement 2.2**

  - [ ]* 7.5 Escrever teste de propriedade para Propriedade 5: contagem correta de pagesOcred e ocrApplied
    - **Property 5: pagesOcred === número de páginas onde OCR retornou text.length >= 10; ocrApplied === ocr=true foi passado**
    - **Validates: Requirement 2.3**

  - [ ]* 7.6 Escrever teste de propriedade para Propriedade 6: OCR nunca invocado quando ocr=false
    - **Property 6: com ocr=false, ocrPage nunca é chamada independente do conteúdo das páginas**
    - **Validates: Requirement 2.4**

  - [ ]* 7.7 Escrever teste de propriedade para Propriedade 7: resiliência a falhas de OCR por página
    - **Property 7: quando subconjunto aleatório de páginas falha no OCR, resultado contém todas as páginas e nenhuma exceção é propagada**
    - Gerador: `fc.array(fc.boolean(), { minLength: 1, maxLength: 20 })` para quais páginas falham
    - **Validates: Requirements 2.5, 10.3**

  - [ ]* 7.8 Escrever teste de propriedade para Propriedade 8: parsing de OCR_LANGS
    - **Property 8: string de idiomas separados por "+" com espaços extras resulta em array com idiomas não-vazios após trim**
    - Gerador: `fc.array(fc.string({ minLength: 2, maxLength: 5 }), { minLength: 1, maxLength: 5 }).map(langs => langs.join("+"))`
    - Testar a lógica: `str.split("+").map(s => s.trim()).filter(Boolean)`
    - **Validates: Requirement 3.3**

  - [ ]* 7.9 Escrever teste de propriedade para Propriedade 10: mapeamento correto de resposta no Upload_Backend
    - **Property 10: meta retornado por extractPdfFile reflete exatamente ocrApplied, ocrLikelyNeeded e pagesOcred do servidor com tipos corretos**
    - Mock de `fetch` para retornar respostas geradas pelo fast-check
    - Gerador: `fc.record({ ocrApplied: fc.boolean(), ocrLikelyNeeded: fc.boolean(), pagesOcred: fc.integer({ min: 0, max: 100 }) })`
    - **Validates: Requirements 5.2, 5.3, 5.4**

  - [ ]* 7.10 Escrever teste de propriedade para Propriedade 11: propagação de ocrEnabled para requisições
    - **Property 11: ocr enviado nas requisições é exatamente !!workspace.ocrEnabled para qualquer valor booleano/truthy/falsy**
    - **Validates: Requirements 5.1, 6.1, 9.1**

  - [ ]* 7.11 Escrever teste de propriedade para Propriedade 12: toasts de feedback com duração mínima
    - **Property 12: toast emitido para ocrLikelyNeeded=true ou ocrApplied=true tem durationMs >= 5000**
    - Testar a lógica de seleção de duração no handler de upload
    - **Validates: Requirement 8.4**

  - [ ]* 7.12 Escrever teste de propriedade para Propriedade 13: limite de 500 páginas com OCR
    - **Property 13: páginas processadas com OCR = min(numPages, 500) para qualquer numPages**
    - Gerador: `fc.integer({ min: 0, max: 1000 })` para numPages
    - Testar a lógica: `Math.min(numPages, 500)`
    - **Validates: Requirement 10.2**

  - [ ]* 7.13 Escrever teste de propriedade para Propriedade 14: lazy loading do OCR engine
    - **Property 14: com ocr=false, getCanvasLib e getTesseractWorker nunca são chamadas**
    - **Validates: Requirement 10.4**

- [ ] 8. Checkpoint final — rodar suite completa de testes
  - Rodar `npm run check` para validar sintaxe
  - Rodar `npm test` para confirmar que todos os testes (existentes + novos) passam
  - Garantir que nenhum teste de propriedade falha com o codebase atual

## Notas

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- As propriedades 9 (reutilização do worker Tesseract) e 14 (lazy loading) dependem de mocks de módulos Node — avaliar viabilidade no contexto do test runner atual (`node tests/feature-improvements.test.js`)
- O design documenta 14 propriedades; as tasks 7.1–7.13 cobrem as mais testáveis como funções puras ou com mocks simples de `fetch`
- Propriedade 9 (singleton do worker) é omitida das tasks pois requer mock de `import()` dinâmico — coberta indiretamente pela Propriedade 14
- Cada task referencia os requisitos específicos para rastreabilidade
