# Plano de Implementação: Exportação de Conversas

## Visão Geral

Implementar o módulo `modules/exporter.js` com funções puras para geração de arquivos Markdown e HTML, integrar ao menu de contexto da sidebar e ao handler `onAction` do `app.js`, e adicionar testes de propriedade e de exemplo ao arquivo de testes existente.

## Tarefas

- [ ] 1. Criar o módulo `modules/exporter.js` com funções de sanitização e nome de arquivo
  - Criar o arquivo `modules/exporter.js` como ES module
  - Implementar `sanitizeTitle(title)`: lowercase, remoção de acentos via NFD, substituição de espaços/separadores por hífens, remoção de caracteres inválidos em Windows/macOS/Linux (`\ / : * ? " < > |` e controles), colapso de hífens consecutivos, remoção de hífens no início/fim, limite de 80 chars, fallback `"conversa"` para resultado vazio
  - Implementar `buildFilename(sanitized, date, ext)`: compõe `{sanitized}-{YYYY-MM-DD}.{ext}` usando a data fornecida (default `new Date()`)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 2. Implementar geração de conteúdo Markdown
  - [ ] 2.1 Implementar `generateMarkdown(conv)` em `modules/exporter.js`
    - Título como `# {título}` na primeira linha
    - Metadados como bloco de citação `>` com data formatada (`DD/MM/YYYY`) e modelo; usar `"(data desconhecida)"` se `createdAt` ausente e `"(não especificado)"` se `model` ausente
    - Separador `---` entre cabeçalho e mensagens
    - Cada mensagem como `## Você` (role `user`) ou `## Assistente` (role `assistant`) seguido do conteúdo
    - Extração de conteúdo: string direta ou, para arrays multimodal, concatenar partes `type === "text"` e substituir partes de imagem por `[imagem]`
    - Omitir campo `reasoning` de todas as mensagens
    - Conversa sem mensagens: retornar apenas cabeçalho e metadados, sem seções `##`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 1.8_

  - [ ]* 2.2 Escrever teste de propriedade P3: Título como heading no Markdown
    - **Property 3: Título da conversa aparece como heading no Markdown**
    - **Validates: Requirements 1.2**
    - Gerador: `fc.record({ title: fc.string({ minLength: 1 }), messages: fc.array(...), createdAt: fc.integer(), model: fc.string() })`
    - Verificar que a primeira linha não-vazia do output é `# {conv.title}`

  - [ ]* 2.3 Escrever teste de propriedade P4: Metadados no Markdown
    - **Property 4: Metadados aparecem no Markdown para qualquer conversa**
    - **Validates: Requirements 1.3**
    - Gerador: `fc.record({ createdAt: fc.integer({ min: 0 }), model: fc.string({ minLength: 1 }), ... })`
    - Verificar que o output contém o modelo e uma data formatada em bloco `>`

  - [ ]* 2.4 Escrever teste de propriedade P5: Headings corretos por role no Markdown
    - **Property 5: Cada mensagem aparece com o heading correto no Markdown**
    - **Validates: Requirements 1.4**
    - Gerador: `fc.array(fc.record({ role: fc.constantFrom("user", "assistant"), content: fc.string(), id: fc.string() }))`
    - Verificar que `## Você` aparece para cada mensagem `user` e `## Assistente` para cada `assistant`

  - [ ]* 2.5 Escrever teste de propriedade P6: Campo reasoning nunca exportado (Markdown)
    - **Property 6: Campo reasoning nunca aparece no conteúdo exportado**
    - **Validates: Requirements 1.8**
    - Gerador: conversas com `reasoning: fc.string({ minLength: 1 })` em cada mensagem
    - Verificar que o valor de `reasoning` não aparece no output de `generateMarkdown`

- [ ] 3. Checkpoint — Verificar funções de Markdown
  - Garantir que todos os testes de `generateMarkdown` passam; tirar dúvidas antes de continuar.

- [ ] 4. Implementar geração de conteúdo HTML
  - [ ] 4.1 Implementar funções internas `escapeHtml(str)` e `renderMarkdownToHtml(md)` em `modules/exporter.js`
    - `escapeHtml`: escapar `&`, `<`, `>`, `"`, `'`
    - `renderMarkdownToHtml`: converter Markdown para string HTML via substituições de regex (sem DOM); suportar blocos de código (` ``` `), headings `#`/`##`/`###`, negrito `**`, itálico `*`/`_`, código inline, listas não-ordenadas (`-`), listas ordenadas (`1.`), parágrafos
    - _Requirements: 2.4_

  - [ ] 4.2 Implementar `generateHtml(conv)` em `modules/exporter.js`
    - `<!DOCTYPE html>` + `<html lang="pt-BR">` com `<meta charset="UTF-8">`, `<meta name="viewport">` e `<title>{título escapado}</title>` no `<head>`
    - Todos os estilos em `<style>` no `<head>` — sem `<link>` externo, sem `<script src>` externo, sem fontes remotas
    - Cabeçalho visível com título e metadados (data e modelo)
    - Cada mensagem em `<div class="msg msg-user">` ou `<div class="msg msg-assistant">` com `<div class="msg-role">` e `<div class="msg-body">` contendo o conteúdo renderizado via `renderMarkdownToHtml`
    - Conversa sem mensagens: exibir `<p class="empty-state">Nenhuma mensagem nesta conversa.</p>`
    - Rodapé com `<p>Gerado pelo Offline AI Chat</p>` sem links externos
    - Omitir campo `reasoning` de todas as mensagens
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 2.10, 2.11_

  - [ ]* 2.6 Escrever teste de propriedade P6 (HTML): Campo reasoning nunca exportado
    - **Property 6: Campo reasoning nunca aparece no conteúdo exportado (HTML)**
    - **Validates: Requirements 2.10**
    - Verificar que o valor de `reasoning` não aparece no output de `generateHtml`

  - [ ]* 4.3 Escrever teste de propriedade P7: HTML auto-contido
    - **Property 7: HTML gerado é auto-contido (sem recursos externos)**
    - **Validates: Requirements 2.2, 2.3**
    - Gerador: `fc.record(conv)` com conteúdo arbitrário
    - Verificar que o output não contém `src="http`, `href="http`, `src="https`, `href="https`

  - [ ]* 4.4 Escrever teste de propriedade P8: Classes CSS corretas por role no HTML
    - **Property 8: Classes CSS corretas por role no HTML**
    - **Validates: Requirements 2.5**
    - Gerador: `fc.array(fc.record({ role: fc.constantFrom("user", "assistant"), content: fc.string(), id: fc.string() }))`
    - Verificar que `msg-user` aparece para cada mensagem `user` e `msg-assistant` para cada `assistant`

  - [ ]* 4.5 Escrever teste de propriedade P9: Head do HTML com charset e title
    - **Property 9: Head do HTML contém charset e title para qualquer conversa**
    - **Validates: Requirements 2.6**
    - Gerador: `fc.record({ title: fc.string(), messages: fc.array(...), ... })`
    - Verificar que o output contém `<meta charset="UTF-8">` e um `<title>` com o título da conversa escapado

- [ ] 5. Checkpoint — Verificar funções de HTML
  - Garantir que todos os testes de `generateHtml` passam; tirar dúvidas antes de continuar.

- [ ] 6. Implementar `triggerDownload` e `exportConversation`
  - [ ] 6.1 Implementar `triggerDownload(content, filename, mimeType)` em `modules/exporter.js`
    - Criar `Blob` com o conteúdo e mimeType fornecidos
    - Criar URL de objeto via `URL.createObjectURL`
    - Criar elemento `<a>` com `download = filename` e `href = objectUrl`, clicar programaticamente e revogar a URL
    - _Requirements: 5.2_

  - [ ] 6.2 Implementar `exportConversation(conv, format, toastFn)` em `modules/exporter.js`
    - Envolver toda a lógica em `try/catch` — nunca propagar exceção
    - Chamar `sanitizeTitle`, `buildFilename`, `generateMarkdown` ou `generateHtml` conforme `format`
    - Chamar `triggerDownload` com o mimeType correto (`text/markdown;charset=utf-8` ou `text/html;charset=utf-8`)
    - Chamar `toastFn(msg, "success")` com o nome do arquivo gerado em caso de sucesso
    - Chamar `toastFn(msg, "error")` com a mensagem de erro em caso de falha
    - _Requirements: 1.1, 2.1, 3.4, 3.5, 5.1, 5.2, 5.3_

  - [ ]* 6.3 Escrever teste de propriedade P1: Sanitização produz apenas caracteres válidos
    - **Property 1: Sanitização produz apenas caracteres válidos em nomes de arquivo**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - Gerador: `fc.string()` incluindo unicode e caracteres especiais
    - Verificar que o output satisfaz `/^[a-z0-9][a-z0-9-]{0,79}$|^conversa$/`

  - [ ]* 6.4 Escrever teste de propriedade P2: Nome do arquivo termina com extensão e contém data
    - **Property 2: Nome do arquivo termina com a extensão correta e contém a data**
    - **Validates: Requirements 1.6, 2.8, 4.5**
    - Gerador: `fc.string()` + `fc.date()` + `fc.constantFrom("md", "html")`
    - Verificar que o output termina com `.{ext}` e contém a data no formato `YYYY-MM-DD`

  - [ ]* 6.5 Escrever teste de propriedade P10: Toast de sucesso contém o nome do arquivo
    - **Property 10: Toast de sucesso contém o nome do arquivo gerado**
    - **Validates: Requirements 3.4**
    - Gerador: `fc.record(conv)` + mock de `toastFn`
    - Verificar que `toastFn` é chamada com kind `"success"` e mensagem contendo o nome do arquivo com extensão correta

- [ ] 7. Integrar exporter na sidebar e no app.js
  - [ ] 7.1 Modificar `modules/ui/sidebar.js`: adicionar "Exportar HTML" ao menu de contexto
    - Na função `openMenu`, adicionar `["export-html", "Exportar HTML"]` na lista de ações, após `"export-md"` e antes de `"delete"`
    - O menu já chama `menu.remove()` antes de `onAction`, satisfazendo o fechamento automático
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 7.2 Modificar `app.js`: importar `exportConversation` e conectar ao handler `onAction`
    - Adicionar `import { exportConversation } from "./modules/exporter.js";` no bloco de imports
    - No handler `onAction` da sidebar (onde `export-json` já é tratado), adicionar os casos `export-md` e `export-html`: buscar a conversa via `conversationStore.get(conversation.id)` e chamar `exportConversation(conv, "md", toast)` ou `exportConversation(conv, "html", toast)`
    - Remover qualquer lógica ad-hoc de exportação Markdown que já exista em `app.js`
    - _Requirements: 1.1, 2.1, 3.4, 3.5_

- [ ] 8. Adicionar testes de exemplo ao arquivo de testes existente
  - Adicionar uma seção `── Conversation Export ──` em `tests/feature-improvements.test.js`
  - Importar `sanitizeTitle`, `buildFilename`, `generateMarkdown`, `generateHtml` de `../modules/exporter.js`
  - Testes de exemplo para `sanitizeTitle`: `""` → `"conversa"`, `"   "` → `"conversa"`, `"???"` → `"conversa"`, `"Olá Mundo!"` → `"ola-mundo"`, `"C:/path\\file"` → `"c-path-file"`, `"a".repeat(100)` → 80 chars, `"--título--"` não começa nem termina com hífen
  - Testes de exemplo para `generateMarkdown`: conversa com `messages: []` não contém `## Você` nem `## Assistente`; mensagem com bloco de código preserva cercas; mensagem com `reasoning` não inclui o valor no output; mensagem com `content` array multimodal inclui `[imagem]`
  - Testes de exemplo para `generateHtml`: conversa com `messages: []` contém `"Nenhuma mensagem nesta conversa."`; output contém `<style>` no `<head>`; output contém `"Gerado pelo Offline AI Chat"`; output não contém `<link` com `href` externo; output não contém `<script src`
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 2.2, 2.3, 2.9, 2.11, 4.1, 4.2, 4.3, 4.4_

- [ ] 9. Checkpoint final — Garantir que todos os testes passam
  - Executar `npm test` e confirmar que todos os testes (incluindo os novos) passam sem erros; tirar dúvidas antes de encerrar.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia os requisitos específicos para rastreabilidade
- O módulo `exporter.js` deve ser puramente client-side — nenhuma requisição de rede durante exportação
- `triggerDownload` é a única função com efeito colateral de DOM; todas as demais são puras e testáveis
- Os testes de propriedade devem ser adicionados em `tests/feature-improvements.test.js` seguindo o padrão existente (`runProperty` + `fc.assert`)
- O handler `export-json` existente em `app.js` não deve ser alterado
