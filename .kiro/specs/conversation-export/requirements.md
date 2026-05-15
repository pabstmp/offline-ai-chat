# Requirements Document

## Introduction

A feature de **Exportação de Conversas** permite ao usuário exportar qualquer conversa armazenada no Offline AI Chat para um arquivo local, nos formatos HTML formatado ou Markdown. O objetivo é facilitar o compartilhamento e o arquivamento de conversas sem depender de nenhum serviço externo — todo o processamento ocorre no browser, e o arquivo é salvo diretamente no dispositivo do usuário via download nativo.

O ponto de entrada principal é o menu de contexto de cada conversa na sidebar (já existente, com as entradas "Exportar JSON" e "Exportar Markdown"). Esta feature expande e formaliza esse comportamento, adicionando o formato HTML e garantindo qualidade, consistência e acessibilidade nos arquivos gerados.

## Glossary

- **Exporter**: módulo client-side (`modules/exporter.js`) responsável por gerar o conteúdo dos arquivos de exportação.
- **Conversation**: objeto `{ id, title, createdAt, updatedAt, profileId, model, messages[] }` armazenado em localStorage/IndexedDB conforme schema v1.
- **Message**: objeto `{ id, role, content, ts }` dentro de `Conversation.messages`. O campo `reasoning` não é exportado.
- **HTML Export**: arquivo `.html` auto-contido (sem dependências externas) que renderiza a conversa com estilos inline.
- **Markdown Export**: arquivo `.md` com a conversa formatada em Markdown puro, legível em qualquer editor.
- **Download**: mecanismo nativo do browser (`<a download>` + `URL.createObjectURL`) para salvar arquivo no dispositivo do usuário.
- **Sidebar_Menu**: menu de contexto de cada item de conversa na sidebar (`modules/ui/sidebar.js`).

## Requirements

### Requirement 1: Exportar conversa como Markdown

**User Story:** Como usuário, quero exportar uma conversa como arquivo Markdown, para que eu possa arquivá-la ou compartilhá-la em qualquer editor de texto ou plataforma que suporte Markdown.

#### Acceptance Criteria

1. WHEN o usuário seleciona "Exportar Markdown" no Sidebar_Menu de uma conversa, THE Exporter SHALL gerar um arquivo `.md` e iniciar o download no browser do usuário.
2. THE Exporter SHALL incluir no arquivo Markdown o título da conversa como heading de nível 1 (`# título`).
3. THE Exporter SHALL incluir no arquivo Markdown os metadados da conversa (data de criação, modelo utilizado) como bloco de citação (`>`) logo após o título.
4. THE Exporter SHALL representar cada Message no arquivo Markdown com um heading de nível 2 indicando o papel (`## Você` ou `## Assistente`) seguido do conteúdo da mensagem.
5. THE Exporter SHALL preservar blocos de código presentes no conteúdo das mensagens com cercas de código Markdown (` ``` `).
6. THE Exporter SHALL nomear o arquivo gerado com o padrão `{título-sanitizado}-{YYYY-MM-DD}.md`, onde o título é convertido para kebab-case com caracteres não-alfanuméricos removidos.
7. IF a conversa não contiver nenhuma Message, THEN THE Exporter SHALL gerar o arquivo Markdown contendo apenas o cabeçalho e os metadados, sem seções de mensagem.
8. THE Exporter SHALL NOT incluir o campo `reasoning` de nenhuma Message no arquivo exportado.

---

### Requirement 2: Exportar conversa como HTML formatado

**User Story:** Como usuário, quero exportar uma conversa como arquivo HTML auto-contido, para que eu possa visualizá-la em qualquer browser com formatação fiel ao chat, sem precisar do aplicativo.

#### Acceptance Criteria

1. WHEN o usuário seleciona "Exportar HTML" no Sidebar_Menu de uma conversa, THE Exporter SHALL gerar um arquivo `.html` e iniciar o download no browser do usuário.
2. THE Exporter SHALL gerar um arquivo HTML auto-contido, sem referências a recursos externos (sem `<link>` para CDN, sem `<script src>` externo, sem fontes remotas).
3. THE Exporter SHALL incluir no arquivo HTML todos os estilos necessários para renderização dentro de um elemento `<style>` no `<head>`.
4. THE Exporter SHALL renderizar o conteúdo Markdown de cada Message como HTML (parágrafos, negrito, itálico, código inline, blocos de código, listas) dentro do arquivo exportado.
5. THE Exporter SHALL distinguir visualmente mensagens do usuário e do assistente no HTML gerado, usando classes CSS distintas (`msg-user` e `msg-assistant`).
6. THE Exporter SHALL incluir no `<head>` do arquivo HTML a meta tag `<meta charset="UTF-8">` e um `<title>` com o título da conversa.
7. THE Exporter SHALL incluir no arquivo HTML os metadados da conversa (data de criação, modelo utilizado) em um elemento de cabeçalho visível.
8. THE Exporter SHALL nomear o arquivo gerado com o padrão `{título-sanitizado}-{YYYY-MM-DD}.html`.
9. IF a conversa não contiver nenhuma Message, THEN THE Exporter SHALL gerar o arquivo HTML com cabeçalho e metadados, exibindo uma mensagem informativa "Nenhuma mensagem nesta conversa."
10. THE Exporter SHALL NOT incluir o campo `reasoning` de nenhuma Message no arquivo HTML exportado.
11. THE Exporter SHALL incluir no rodapé do arquivo HTML um texto indicando que o arquivo foi gerado pelo Offline AI Chat, sem links externos.

---

### Requirement 3: Ponto de entrada na Sidebar

**User Story:** Como usuário, quero acessar as opções de exportação diretamente pelo menu de contexto de cada conversa na sidebar, para que o fluxo de exportação seja rápido e não interrompa minha sessão atual.

#### Acceptance Criteria

1. THE Sidebar_Menu SHALL exibir a opção "Exportar Markdown" para toda conversa listada na sidebar.
2. THE Sidebar_Menu SHALL exibir a opção "Exportar HTML" para toda conversa listada na sidebar.
3. WHEN o usuário aciona uma opção de exportação no Sidebar_Menu, THE Sidebar_Menu SHALL fechar o menu de contexto antes de iniciar a exportação.
4. WHEN a exportação for concluída com sucesso, THE Exporter SHALL exibir uma notificação de sucesso via toast com o nome do arquivo gerado.
5. IF ocorrer um erro durante a geração ou download do arquivo, THEN THE Exporter SHALL exibir uma notificação de erro via toast descrevendo a falha, sem lançar exceção não tratada para o usuário.

---

### Requirement 4: Sanitização do nome do arquivo

**User Story:** Como usuário, quero que o nome do arquivo exportado seja válido em qualquer sistema operacional, para que eu possa salvá-lo sem erros de sistema de arquivos.

#### Acceptance Criteria

1. THE Exporter SHALL remover do título da conversa todos os caracteres inválidos em nomes de arquivo nos sistemas operacionais Windows, macOS e Linux antes de compor o nome do arquivo.
2. THE Exporter SHALL substituir espaços e separadores por hífens no nome do arquivo gerado.
3. THE Exporter SHALL limitar o nome do arquivo (sem extensão) a no máximo 80 caracteres.
4. IF o título da conversa for vazio ou resultar em string vazia após sanitização, THEN THE Exporter SHALL usar o valor `"conversa"` como nome base do arquivo.
5. THE Exporter SHALL garantir que o nome do arquivo gerado termine com a extensão correta (`.md` ou `.html`) correspondente ao formato solicitado.

---

### Requirement 5: Processamento local sem transmissão de dados

**User Story:** Como usuário, quero ter a garantia de que minhas conversas exportadas nunca são enviadas para nenhum servidor externo, para que minha privacidade seja preservada.

#### Acceptance Criteria

1. THE Exporter SHALL gerar o conteúdo do arquivo de exportação inteiramente no browser, sem realizar nenhuma requisição de rede durante o processo de exportação.
2. THE Exporter SHALL utilizar exclusivamente APIs nativas do browser (`Blob`, `URL.createObjectURL`, elemento `<a>` com atributo `download`) para entregar o arquivo ao usuário.
3. THE Exporter SHALL ler os dados da conversa exclusivamente do `conversationStore` local (localStorage/IndexedDB), sem consultar nenhum endpoint do servidor proxy.
