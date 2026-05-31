# Guia do Offline AI Chat

Manual de uso completo. Cobre cada tela, cada parâmetro, cada fluxo. Pensado pra você consultar quando esquecer alguma coisa no futuro.

> **TL;DR**: clica na engrenagem (canto superior direito) ou aperta `Ctrl+,` pra abrir tudo. `Ctrl+K` abre paleta de comandos.

---

## Sumário

1. [Conceitos](#1-conceitos)
2. [Como rodar](#2-como-rodar)
3. [Tela principal](#3-tela-principal)
4. [Configurações — visão geral](#4-configurações--visão-geral)
5. [Aba: Servidor](#5-aba-servidor)
6. [Aba: Modelo & Sampling](#6-aba-modelo--sampling)
7. [Aba: Aparência](#7-aba-aparência)
8. [Aba: Comportamento](#8-aba-comportamento)
9. [Aba: Perfis](#9-aba-perfis)
10. [Aba: Atalhos](#10-aba-atalhos)
11. [Aba: Workspace (contexto de código)](#11-aba-workspace-contexto-de-código)
12. [Aba: Avançado](#12-aba-avançado)
12.1. [Aba: Tarefas (agendamentos)](#121-aba-tarefas-agendamentos)
13. [Histórico de conversas](#13-histórico-de-conversas)
14. [Composer (campo de mensagem)](#14-composer-campo-de-mensagem)
15. [Command Palette](#15-command-palette)
16. [Atalhos de teclado](#16-atalhos-de-teclado)
17. [Troubleshooting](#17-troubleshooting)
18. [Backup, export e import](#18-backup-export-e-import)
19. [Privacidade e segurança](#19-privacidade-e-segurança)
20. [Arquitetura interna (referência)](#20-arquitetura-interna-referência)

---

## 1. Conceitos

| Termo | O que é |
|---|---|
| **LM Studio** | App desktop que roda modelos LLM localmente. Expõe um servidor HTTP compatível com a API da OpenAI |
| **Offline AI Chat** | Este app. Cliente web que fala com o LM Studio via API |
| **Servidor** | Endereço onde o LM Studio está rodando (ex: `http://localhost:1234/v1` ou `http://192.168.1.x:1234/v1` se em outra máquina da LAN) |
| **Modelo** | Arquivo do LLM carregado no LM Studio (ex: `llama-3.1-8b`) |
| **Perfil** | Conjunto de configurações pré-definidas: system prompt + sampling params + modelo padrão |
| **Sampling** | Parâmetros que controlam como o modelo gera texto (temperature, top_p, etc.) |
| **Workspace** | Pasta do seu projeto que você expõe pro LLM ler como contexto |
| **Contexto** | Os arquivos atualmente "anexados" que serão injetados na próxima mensagem |

---

## 2. Como rodar

### Opção A — Native Node (recomendado pra uso local)

```powershell
cd C:\Users\<seu-usuario>\Documents\offline-ai
node server.js
```

Acessa `http://localhost:8080`. Pra parar: `Ctrl+C`.

Pra deixar permanente, cria `start.ps1`:
```powershell
node server.js
```

### Opção B — Docker

```powershell
docker compose up -d --build
```

Pra parar: `docker compose down`.

Diferença prática: Docker isola o filesystem (não enxerga sua pasta do Windows direto). Pra usar Workspace com Docker, precisa montar volume no `docker-compose.yml`. Pra simplicidade, native é melhor.

### Publicar em LAN / servidor da companhia

Para uso compartilhado, use o modo assistido. Ele pergunta URL do LM Studio, pasta compartilhada, porta e senha, e gera `.env.lan` automaticamente:

```powershell
npm run lan:setup
npm run lan:up
npm run lan:logs
```

Depois abra `http://IP_DO_SERVIDOR:8080`, faca login com a senha mostrada pelo wizard e configure **Configuracoes -> Servidor** com a URL do LM Studio indicada no final.

Regras importantes:
- Sem `APP_AUTH_PASSWORD`/`APP_AUTH_TOKEN`, qualquer pessoa que alcance a porta consegue abrir o app.
- Sem `WORKSPACE_ROOTS`, endpoints `/api/fs/*` ficam bloqueados quando `HOST` expoe LAN.
- Sem `ALLOWED_LM_HOSTS`, o proxy em LAN so fala com `localhost`/loopback.
- Em companhia, prefira colocar atras de reverse proxy/VPN/SSO e montar so pastas necessarias em modo read-only.

Modo manual tambem existe: copie `.env.lan.example` para `.env.lan`, edite os campos e rode `npm run lan:up`.

### Pré-requisitos do LM Studio

1. Abrir o LM Studio na máquina servidor (pode ser a mesma)
2. Carregar um modelo
3. Ativar o servidor OpenAI-compatible (porta padrão `1234`)
4. Habilitar acesso pela rede local
5. Liberar porta `1234` no firewall, se necessário

---

## 3. Tela principal

```
┌─────────────────────────────────────────────────────────────────┐
│ ☰ [Offline AI]    [perfil] [modelo] [● status]   📁 🔍 ⚙       │ ← topbar
├─────────────────────────────────────────────────────────────────┤
│ + Nova conversa │                                               │
│ Buscar...       │           [empty state ou mensagens]          │
│                 │                                               │
│ HOJE            │                                               │
│ • conversa A    │                                               │
│ • conversa B    │                                               │
│                 ├───────────────────────────────────────────────┤
│ ESTA SEMANA     │ [📎  contexto: 0 arquivos          ]         │
│ • conversa C    │ ┌─────────────────────────────────────────┐   │
│                 │ │ Digite sua mensagem...                  │   │
│                 │ │                                         │   │
│                 │ │ [📎] ~0 tok ⏎enviar ⇧⏎linha [Enviar]    │   │
│                 │ └─────────────────────────────────────────┘   │
└─────────────────┴───────────────────────────────────────────────┘
   sidebar (260px)                   chat panel (resto)
```

### Topbar (cima, 52px)

| Elemento | Função |
|---|---|
| `☰` | Mostra/esconde sidebar do histórico |
| **Offline AI** | Brand, sem ação |
| **chip de perfil** | Mostra o perfil ativo. Click → abre Configurações na aba Perfis |
| **chip de modelo** | Mostra o modelo padrão do perfil. Click → abre aba Modelo |
| **● status** | Cor indica estado da conexão. Click → abre aba Servidor |
| `📁` | Abre/fecha a sidebar de Workspace (árvore de arquivos) |
| `🔍` | Abre Command Palette |
| `⚙` | Abre Configurações |

### Sidebar (esquerda, 260px)

- **+ Nova conversa**: começa do zero (a conversa atual fica salva)
- **Buscar conversas...**: filtra por título e conteúdo
- **Lista**: agrupada por "Hoje", "Esta semana", "Anterior". Hover mostra menu (`⋮`) com Renomear, Exportar JSON, Exportar Markdown, Excluir

### Chat panel (centro)

- **Mensagens**: bubble do usuário à direita (cor de destaque), bubble do assistente à esquerda (cinza)
- **Hover na mensagem**: aparecem ações (Copiar, Regenerar [só assistente], Editar, Excluir)
- **Code blocks**: botão "Copiar" no canto superior direito ao passar o mouse
- **Auto-scroll**: rola pra baixo automaticamente. Se você rolar pra cima, trava o auto-scroll e mostra botão `↓ Novas mensagens`

---

## 4. Configurações — visão geral

Abrir: engrenagem (canto superior direito) ou `Ctrl+,`.

Modal fullscreen com 8 abas no rail à esquerda:

1. **Servidor** — endereços do LM Studio
2. **Modelo & Sampling** — modelo ativo + parâmetros de inferência
3. **Aparência** — tema, cor, fonte, densidade
4. **Comportamento** — Enter envia, persistir conversas, etc.
5. **Perfis** — CRUD de perfis (presets)
6. **Atalhos** — reconfigurar teclas
7. **Workspace** — fontes de contexto de código
8. **Avançado** — slash commands, prompt library, debug, backup

Fechar: `X` no canto, click fora do modal, ou `Esc`.

---

## 5. Aba: Servidor

Lista de servidores LM Studio que você cadastrou. Pode ter vários (ex: um na sua máquina, outro num desktop com GPU mais forte).

### Campos por servidor

| Campo | O que é |
|---|---|
| **Apelido** | Nome amigável (ex: "Desktop GPU", "Notebook") |
| **URL** | Endereço completo do LM Studio. Aceita: `localhost:1234`, `http://localhost:1234/v1`, `192.168.1.x:1234` (LAN). Se não tiver `/v1`, adiciona automaticamente |
| **API key (opcional)** | Normalmente vazio no LM Studio. Use só se você configurou autenticação |
| **Timeout (ms)** | Quanto tempo esperar antes de desistir. Default 60000 (1 min) |
| **Retry count** | Quantas vezes tentar de novo se falhar. Default 0 |

### Botões

- **Testar conexão**: chama `/models` e mostra latência. Não muda o servidor ativo
- **Ativar e conectar**: marca como ativo + recarrega lista de modelos
- **Excluir**: remove o servidor (precisa ter pelo menos 1)
- **+ Adicionar servidor**: cria um novo registro vazio

### Como saber se conectou

- Status pill no topbar fica **verde** (`Conectado`)
- Toast aparece: `OK · N modelo(s) · Xms`
- Lista de modelos enche na aba Modelo

---

## 6. Aba: Modelo & Sampling

Configura o **perfil ativo**. Mudanças aqui afetam o perfil atual, não os outros.

### Modelo padrão deste perfil

- **Dropdown**: lista os modelos retornados pelo servidor. Click `↻` recarrega
- **Ou ID livre**: campo de texto pra digitar o nome direto (útil quando o servidor tá offline mas você sabe o ID)
- **System prompt**: instrução base que sempre é enviada como `role: system`. Define a personalidade/comportamento

### Parâmetros de inferência

Cada parâmetro tem: **checkbox + slider + valor**.

- **Checkbox marcado** = inclui no payload enviado
- **Checkbox desmarcado** = não envia, servidor usa seu default

| Param | O que faz | Range típico |
|---|---|---|
| `temperature` | Aleatoriedade. Baixo = determinístico, alto = criativo | 0–2 (default 0.7) |
| `top_p` | Nucleus sampling. Considera só os tokens cuja probabilidade cumulativa ≤ p | 0.8–1.0 |
| `top_k` | Considera só os top K tokens | 20–100 |
| `min_p` | Considera só tokens com probabilidade ≥ min_p × top | 0.01–0.1 |
| `repeat_penalty` | Penaliza repetição. >1 reduz repetição | 1.0–1.3 |
| `presence_penalty` | Penaliza tokens já presentes | -2 a 2 |
| `frequency_penalty` | Penaliza tokens frequentes | -2 a 2 |
| `max_tokens` | Tamanho máximo da resposta | 256–4096 |
| `seed` | Reproducibilidade. Mesmo seed = mesma resposta | qualquer int |
| `n` | Quantas respostas gerar em paralelo | 1–4 |

### Stop sequences

Strings que, se aparecerem no output, fazem o modelo parar imediatamente. Uma por linha. Útil pra evitar que o modelo "continue" indefinidamente em formatos específicos (ex: `\nUser:` evita continuar fingindo o user).

### response_format

- **Texto**: resposta livre (default)
- **JSON object**: força o modelo a retornar JSON válido. Suporte depende do modelo

### Botão "Resetar parâmetros para padrão"

Volta tudo pros defaults. Não afeta system prompt nem modelo.

---

## 7. Aba: Aparência

### Tema

- **Sistema**: segue claro/escuro do OS
- **Claro**: força tema claro
- **Escuro**: força tema escuro

### Cor de destaque

8 presets (indigo, azul, ciano, verde, laranja, vermelho, rosa, roxo) + color picker custom. Aplica em: botões primários, links, foco, bubbles do user, badges ativos.

### Densidade

Multiplica o spacing geral:
- **Compacta** (0.85x): mais compacto, cabe mais coisa
- **Normal** (1x): default
- **Espaçosa** (1.18x): mais ar, mais legível

### Tamanho da fonte

13–18px. Afeta a tipografia toda do app (UI + mensagens).

### Raio dos cantos

0–20px. 0 = retangular, 20 = bem arredondado.

### Fonte UI / Fonte código

Inputs livres aceitando qualquer `font-family` CSS. Vazio = sistema. Exemplos:
- UI: `"Inter", system-ui, sans-serif`
- Código: `"JetBrains Mono", monospace`

### Modos

- **Zen mode**: esconde a sidebar do histórico. Atalho `Ctrl+\`
- **Ambient glow**: dois gradientes coloridos decorativos no fundo (off por default — custa um pouco mais de GPU)
- **Animação reduzida**:
  - **Automático**: respeita `prefers-reduced-motion` do OS
  - **Sempre reduzido**: zera todas animações
  - **Sempre completo**: força animações mesmo se o OS pediu reduzido

---

## 8. Aba: Comportamento

### Tecla de envio

- **Enter envia · Shift+Enter quebra linha** (default)
- **Ctrl/Cmd+Enter envia**: útil se você costuma escrever mensagens longas com várias linhas

### Travar auto-scroll quando rolar para cima

Se on (default): quando você rolar pra cima, o auto-scroll pausa e aparece botão `↓ Novas mensagens`. Se off: sempre rola pra baixo automaticamente.

### Persistir conversas em localStorage/IndexedDB

Se on (default): conversas ficam salvas e aparecem no histórico. Se off: conversa some ao recarregar.

### Confirmar antes de excluir

Pergunta antes de deletar conversa, mensagem, perfil ou servidor.

### Zona de perigo: "Limpar todo o storage"

**Apaga tudo** — configurações, conversas, perfis, IndexedDB. Não tem volta.

---

## 9. Aba: Perfis

Perfis são presets completos: system prompt + modelo padrão + sampling. Útil pra alternar entre usos (ex: assistente geral, documentos, marketing, financeiro, code reviewer).

### Perfis padrão

- **Assistente pessoal**: uso geral, respostas diretas e organização de ideias.
- **Developer full-stack**: implementação, arquitetura, debugging e tradeoffs técnicos.
- **Analista de documentos**: leitura de PDFs, RAG, comparação de fontes e extração de fatos.
- **Code reviewer**: revisão crítica de bugs, segurança, regressões e testes ausentes.
- **Gerente de marketing**: posicionamento, campanhas, público-alvo, canais e métricas.
- **Redator**: textos claros, naturais e persuasivos em português.
- **Analista financeiro**: receitas, custos, margens, variações, projeções e riscos.

### Card de perfil

- **Ícone** (emoji): visual no topbar e no chip de perfil
- **Nome**: mostrado em todo lugar
- **System prompt**: instrução base do perfil
- **Botões**:
  - **Ativar**: torna esse o perfil em uso
  - **Duplicar**: cria cópia com sufixo "(cópia)"
  - **Exportar**: baixa JSON com tudo do perfil
  - **Excluir**: remove (precisa ter pelo menos 1)

### + Novo perfil

Cria um perfil em branco com defaults. Você ajusta nome, ícone, prompt e sampling depois (a aba Modelo & Sampling sempre edita o perfil ATIVO).

### Importar JSON

Carrega um perfil exportado. Útil pra compartilhar configurações entre máquinas/pessoas.

### Como criar um perfil bom

1. Pensa no caso de uso ("quero revisar PRs de Python")
2. Escreve um system prompt específico (ver exemplos abaixo)
3. Escolhe modelo e sampling adequado:
   - Tarefas determinísticas (código, fatos): temperature 0.2–0.4, top_p 0.9
   - Tarefas criativas (escrita, brainstorming): temperature 0.8–1.0
4. Salva e ativa

### Exemplos de system prompt

**Code reviewer:**
> Você é um revisor de código sênior. Foque em: bugs, race conditions, segurança, performance e legibilidade. Cite linhas específicas. Não sugira melhorias estéticas se a lógica está correta. Responda em português.

**Gerente de marketing:**
> Voc? ? um gerente de marketing pragm?tico. Ajude a definir posicionamento, p?blico-alvo, oferta, mensagens-chave, campanhas, canais, calend?rio editorial, m?tricas e pr?ximos passos.

**Analista financeiro:**
> Voc? ? um analista financeiro. Analise valores, receitas, custos, margens, varia??es, proje??es e riscos usando apenas os dados fornecidos quando houver documentos ou tabelas no contexto.

---

## 10. Aba: Atalhos

Tabela com cada ação e seu chord atual. Botão "Reconfigurar" abre captura — pressiona qualquer combinação e ela vira o novo atalho.

### Defaults

| Ação | Chord | Onde funciona |
|---|---|---|
| Enviar mensagem | `Enter` | Composer |
| Nova linha | `Shift+Enter` | Composer |
| Nova conversa | `Ctrl+N` | Global |
| Toggle histórico | `Ctrl+B` | Global |
| Configurações | `Ctrl+,` | Global |
| Paleta | `Ctrl+K` | Global |
| Focar composer | `Ctrl+L` | Global |
| Parar geração | `Esc` | Global (durante streaming) |
| Próximo perfil | `Ctrl+Shift+P` | Global |
| Modo zen | `Ctrl+\` | Global |
| Anexar arquivo | `Ctrl+U` | Global |
| Quick open | `Ctrl+P` | Global (workspace) |
| Sidebar workspace | `Ctrl+Shift+E` | Global |

### Resetar atalhos para padrão

Volta todos pros defaults.

### Conflitos

Se você setar um chord que conflita com o navegador (ex: `Ctrl+T` abre nova aba), o navegador ganha. Evita esses.

---

## 11. Aba: Workspace (contexto de código)

A função mais poderosa. Permite que o LLM "leia" arquivos do seu projeto.

### Como funciona

Você conecta uma **fonte** (pasta), navega na árvore, clica em arquivos pra adicionar ao contexto. Esses arquivos são injetados como prefixo na próxima mensagem dentro de um bloco `<workspace_context>`.

### Quatro tipos de fonte

#### A) Server-side (qualquer pasta do seu disco)

**Quando usar**: rodando `node server.js` localmente. Funciona em qualquer browser. **Recomendado.**

1. Workspace → **🖧 Conectar pasta do servidor**
2. Cola o path absoluto: `C:\Users\<seu-usuario>\Documents\meu-projeto`
3. Pronto

O servidor (Node) acessa a pasta com as permissões do seu usuário do OS. Path traversal (`..`) é bloqueado.

#### B) File System Access API (Chrome/Edge)

**Quando usar**: navegador moderno (Chrome 86+, Edge 86+).

1. Workspace → **📂 Selecionar pasta (FS API)**
2. Browser abre seletor nativo
3. Aprova permissão de leitura
4. Handle persistido em IndexedDB — só re-aprovar permissão após reload

#### C) Drag-and-drop

**Quando usar**: rápido, sem configurar. Funciona em qualquer browser.

1. Arrasta a pasta inteira pra janela do browser
2. Vai aparecer overlay "Solte arquivos ou pastas aqui"
3. Solta

Aplica os filtros de `Ignorar padrões` automaticamente (skip `node_modules`, `.git`, binários).

#### D) Upload (botão 📎)

**Quando usar**: anexar 1–N arquivos avulsos.

1. Click 📎 no composer
2. Seletor abre, escolhe arquivos
3. Adicionados ao contexto

### Configurações da aba Workspace

#### Limites & filtros

- **Tamanho máximo por arquivo (KB)**: arquivos maiores são pulados (default 256)
- **Tamanho máximo total (KB)**: soma de todos no contexto (default 4096 = 4 MB)
- **Ignorar padrões**: nomes exatos (`node_modules`) ou globs simples (`*.png`). Um por linha

### Sidebar de árvore (ícone 📁 do topbar)

Aparece à direita quando você clica no 📁. Mostra:
- **Dropdown**: trocar entre fontes cadastradas
- **Busca**: digita query e Enter — busca full-text (server-side apenas)
- **Árvore**: pastas expansíveis (lazy load), arquivos clicáveis

Clicar num arquivo: adiciona ao contexto.

### Painel de contexto (acima do composer)

Quando há arquivos no contexto:

```
📁 Contexto: 4 arquivos · ~3.2k tok / 4096   [Manter em todas] [Limpar]
  Server: src/auth.ts                820 tok  [×]
  Server: src/routes/login.ts       1.1k tok  [×]
```

- **Cor da borda**: branca (ok), amarela (>70% do limite), vermelha (passou do limite)
- **× por arquivo**: remove só esse
- **Limpar**: zera o contexto
- **"Manter em todas"** (toggle): se on, o bloco é injetado em CADA mensagem da conversa. Se off (default), só na próxima — depois é limpo automaticamente

### Slash commands de workspace

Digita no composer:
- `/include src/auth.ts` → adiciona arquivo ao contexto e envia
- `/clear-context` → limpa o contexto

### Como o conteúdo é enviado

A última mensagem do usuário fica:

```
<workspace_context>
Arquivos do projeto incluídos no contexto desta mensagem:

[arquivo: src/auth.ts]
... conteúdo do arquivo ...
[fim]

[arquivo: src/routes/login.ts]
... conteúdo ...
[fim]
</workspace_context>

Pergunta do usuário: revisa esses dois arquivos pra mim
```

Visível em DevTools → Network → request `/api/chat/completions` → request body.

---

## 12. Aba: Avançado

### Geração

- **Streaming**: tokens aparecem conforme o modelo gera (default on). Off: espera resposta completa
- **Modo debug**: loga `{ baseUrl, payload }` no console do browser antes de cada request

### Slash commands

Triggers que substituem texto antes de enviar.

Padrões:
- `/code` → "Explique este código:"
- `/fix` → "Identifique problemas e proponha correções neste código:"
- `/test` → "Escreva testes unitários para:"

Exemplo de uso: digita `/fix function login() {...}` no composer → na hora de enviar, vira `Identifique problemas e proponha correções neste código: function login() {...}`.

Você pode adicionar/remover/editar.

### Prompt library

Snippets nomeados que aparecem no autocompletar de `/` no composer. Útil pra prompts longos que você usa toda hora.

```
id: explain
nome: Explicar
body: Explique passo a passo, em português, com exemplos:
```

Ao digitar `/explain` e aceitar, o body substitui o texto.

### Backup

- **Exportar configurações**: baixa um JSON com TUDO (servidores, perfis, atalhos, aparência, workspace, etc.). Não inclui conversas
- **Importar configurações**: carrega um JSON. Recarrega a página depois

---

## 12.1 Aba: Tarefas (agendamentos)

Tarefas que rodam **no servidor**, em horário marcado, mesmo com o navegador fechado. A vitrine é o **boletim de busca web**: o servidor pesquisa termos que você definiu, pede pra um modelo resumir, e salva um markdown datado que você lê depois.

> ⚠️ **Precisa ser ligado no servidor.** Por segurança, o motor vem **desligado**. Você configura tudo pela aba, mas nada dispara até definir `CRON_ENABLED=true` (e `FS_WRITE_ROOTS`) nas variáveis de ambiente / `docker-compose.yml`. A própria aba mostra o snippet quando está desligado.

### Por que "conexões" separadas?

As tarefas rodam sem o navegador, então **não enxergam** o servidor de chat que você configurou no localStorage. Por isso você cria uma **Conexão LLM** própria pra elas:

- Aponte pro **LM Studio local** (`http://localhost:1234/v1`) — funciona se ele estiver ligado no horário da tarefa.
- Ou pra um **endpoint sempre-online** tipo OpenRouter — recomendado pra boletim de madrugada (LM Studio costuma estar desligado às 8h). Botão **"Copiar do servidor de chat"** pré-preenche a partir do seu servidor atual.
- A API key fica salva no servidor. Pra não deixar segredo em texto, preencha **"API key via env"** com o nome de uma variável de ambiente (ex: `OPENROUTER_KEY`) em vez da chave literal.

### Criando um boletim

1. Crie uma **Conexão LLM** (seção de cima).
2. **+ Nova tarefa** → tipo **Boletim de busca web**.
3. **Buscas**: uma por linha (ex: `novidades inteligência artificial`).
4. **Conexão / Modelo**: escolha a conexão e, opcional, um modelo específico.
5. **Pasta de saída**: uma das pastas liberadas em `FS_WRITE_ROOTS` (no Docker, `/app/data/output`). **Subpasta**: ex `boletins`.
6. **Frequência**: *Diariamente às 08:00*, *Semanalmente*, *De hora em hora*, ou **Avançado (cron)** pra expressão de 5 campos. Defina o **fuso horário** (ex: `America/Sao_Paulo`) pra "8h" ser 8h da sua região.
7. Marque **Ativa** e salve.

Use **Executar agora** pra testar sem esperar o horário, e **Ver resultado** pra ler o último boletim renderizado. Se marcou "Notificar", o app avisa quando um boletim novo fica pronto (precisa permitir notificações do navegador).

### Outras tarefas

- **Rotação de arquivos/logs**: trunca/arquiva arquivos que passaram de um tamanho (útil em deploy nativo que redireciona `stdout`/`stderr` pra arquivo, ou pra podar boletins antigos). No Docker os logs do container já são rotacionados pelo runtime — aqui serve pra limpar a pasta de saída.
- **Backup de estado do servidor**: copia o `cron-state.json` (suas tarefas/conexões) e arquivos que você listar, com gzip. ⚠️ Conversas, perfis e configurações ficam **no navegador** e não são vistas pelo servidor — pra essas, use **Avançado → Exportar configurações** e o backup do histórico (seção 18).

### Onde os arquivos ficam

Tudo é gravado **só** nas pastas de `FS_WRITE_ROOTS`. No Docker isso é o volume `cron-data` (`/app/data`), que sobrevive a restart. O mount do seu disco (`/host/c`) é somente-leitura de propósito — o app nunca escreve nele.

---

## 13. Histórico de conversas

### Salvamento automático

Toda conversa é salva ao terminar cada resposta (se "Persistir conversas" estiver on). Title é gerado dos primeiros 40 chars da primeira mensagem do usuário.

### Onde fica

`localStorage["offline-ai-chat:conversations:v1"]` até ~2 MB. Acima disso, o sistema migra automaticamente pra IndexedDB (`offline-ai/conversations`).

### Operações

Hover na conversa na sidebar → menu `⋮`:
- **Renomear**: edita o título manualmente
- **Exportar JSON**: baixa estrutura completa, importável de volta
- **Exportar Markdown**: baixa em formato `# title\n\n**Você**: ...\n\n**Assistente**: ...`
- **Excluir**: remove (com confirmação se "Confirmar antes de excluir" estiver on)

### Buscar

Campo no topo da sidebar. Filtra por:
- Título da conversa
- Conteúdo de qualquer mensagem (case-insensitive)

---

## 14. Composer (campo de mensagem)

### Auto-resize

A altura cresce conforme você digita, até 40% da altura da viewport. Depois disso, faz scroll interno.

### Token counter

`~N tok` mostra estimativa heurística (`length / 4`) somando o que você está digitando + todo o histórico. Cores:
- **Cinza** (ok): <6k tokens
- **Amarelo** (warn): 6–12k
- **Vermelho** (danger): >12k

Lembre que cada modelo tem context window próprio (4k, 8k, 32k, 128k...). Acima do limite, o servidor pode truncar ou rejeitar.

### Botões

- **📎**: abre upload de arquivos pro contexto
- **Parar**: aparece durante streaming. Aborta a geração
- **Enviar**: submete

### Slash commands no composer

Digite `/` no início da mensagem (ou após `\n`) → dropdown abre com:
- Slash commands cadastrados (aba Avançado)
- Snippets da Prompt library (aba Avançado)

Setas ↑↓ navegam, Enter ou Tab seleciona, Esc fecha.

### Paste de imagem (futuro)

Não implementado ainda. Modelos VLM suportam imagens via API, mas a UI ainda não.

---

## 15. Command Palette

`Ctrl+K` ou `Cmd+K` ou ícone 🔍 do topbar.

Busca fuzzy em tudo:
- Comandos do app (Nova conversa, Configurações: X, Toggle tema, etc.)
- Perfis disponíveis (ativa ao selecionar)
- Servidores cadastrados (ativa + reconecta)
- Modelos disponíveis no servidor ativo (define como modelo do perfil)

Setas ↑↓ navegam, Enter executa, Esc fecha.

---

## 16. Atalhos de teclado

Ver tabela completa em [Aba: Atalhos](#10-aba-atalhos).

Cheat sheet rápido:

```
Ctrl+K        Paleta de comandos
Ctrl+,        Configurações
Ctrl+N        Nova conversa
Ctrl+B        Toggle histórico
Ctrl+Shift+E  Toggle workspace
Ctrl+P        Quick open
Ctrl+U        Anexar arquivo
Ctrl+L        Focar composer
Ctrl+\        Modo zen
Esc           Parar geração / fechar modal
Enter         Enviar (no composer)
Shift+Enter   Nova linha
```

---

## 17. Troubleshooting

### "Falha na conexão" / "Não consegui acessar o LM Studio"

1. LM Studio está aberto?
2. Servidor OpenAI-compatible ativado no LM Studio?
3. Modelo carregado?
4. URL na aba Servidor está certa? Testa direto:
   ```powershell
   curl http://localhost:1234/v1/models
   ```
5. Firewall liberou a porta 1234?
6. Mesma rede (se servidor em outra máquina)?
7. LM Studio configurado pra aceitar conexões externas, não só localhost?

### Workspace: "WORKSPACE_ROOTS obrigatorio" / 403

Se o servidor esta exposto em LAN (`HOST=0.0.0.0`, `::` ou IP nao-loopback), configure `WORKSPACE_ROOTS` com as pastas permitidas. Em modo local (`127.0.0.1`), o servidor continua aceitando qualquer pasta conectada pela UI.

### Workspace: "relPath inválido" / 403

Você tentou um path traversal (`..`). Comportamento esperado.

### Workspace: "ENOENT no such file or directory"

Path digitado não existe ou seu usuário do OS não tem permissão de leitura.

### Streaming trava no meio

- Algum modelo grande demais pra GPU/RAM?
- LM Studio crashou? Verifica os logs do LM Studio
- Aborta com `Esc` e tenta de novo

### Tema escuro tem fundo branco em alguma tela

Cache antigo do service worker. `Ctrl+Shift+R` pra forçar refresh.

### Configurações sumiram

Você limpou cookies/localStorage do navegador. Backup é a única recuperação. Sempre exporta configurações de tempos em tempos via Avançado → Exportar configurações.

### "Service worker registration failed"

Normal se você abriu via `file://`. Funciona via HTTP (localhost). Não impacta o resto.

### O modelo não respeita um sampling param

Alguns modelos/runtimes ignoram parâmetros menos comuns (`min_p`, `repeat_penalty`). LM Studio com llama.cpp respeita a maioria. Se um param crítico está sendo ignorado, ative o **Modo debug** (Avançado) e olhe o payload no console — confirma que está sendo enviado. Se sim, o problema é no servidor, não no app.

---

## 18. Backup, export e import

### O que pode ser exportado

| Tipo | Como | Onde |
|---|---|---|
| **Configurações completas** | Avançado → Exportar configurações | JSON único |
| **Perfil individual** | Perfis → Exportar (no card) | JSON do perfil |
| **Conversa em JSON** | Sidebar → ⋮ → Exportar JSON | JSON da conversa |
| **Conversa em Markdown** | Sidebar → ⋮ → Exportar Markdown | `.md` legível |

### O que pode ser importado

- Configurações: Avançado → Importar configurações (JSON inteiro)
- Perfil: Perfis → Importar JSON (cria novo perfil)

### Backup recomendado

Exporta configurações **uma vez por mês** ou após mudanças grandes. Guarda em outro lugar (Drive, Dropbox).

Conversas raramente precisam de backup — ficam em localStorage/IDB que persiste até você limpar manualmente. Mas se você troca de máquina, exporta as importantes individualmente.

### Sem sync entre máquinas (ainda)

Cada navegador/máquina tem seu próprio storage. Pra usar o mesmo perfil em casa e no trabalho, exporta+importa manualmente.

---

## 19. Privacidade e segurança

### O que sai da sua máquina

**Apenas mensagens enviadas pro LM Studio**. Que pode estar:
- Rodando localmente (`localhost`) — não sai da máquina
- Rodando em outra máquina da sua rede LAN — sai só pra essa máquina
- Rodando num servidor remoto que você configurou — depende do servidor

### O que NÃO sai

- Configurações
- Perfis
- Conversas
- Histórico
- Arquivos do workspace

Tudo local em localStorage/IndexedDB.

### API key

Se o seu LM Studio tem auth, a key fica em localStorage. Limpa via Configurações → Comportamento → "Limpar todo o storage".

### Autenticacao do app

Para LAN, configure `APP_AUTH_PASSWORD` ou `APP_AUTH_TOKEN`. Isso ativa HTTP Basic Auth antes de servir a UI e antes de qualquer `/api/*`.

Fluxo recomendado com Docker:

```powershell
npm run lan:setup
npm run lan:up
```

Exemplo manual para Node nativo:

```powershell
$env:HOST="0.0.0.0"
$env:APP_AUTH_USER="offline-ai"
$env:APP_AUTH_PASSWORD="senha-longa-aqui"
$env:WORKSPACE_ROOTS="C:\Projetos\base-rag"
$env:ALLOWED_LM_HOSTS="localhost,192.168.1.50:1234"
node server.js
```

Em ambiente corporativo, use tambem reverse proxy/VPN/SSO. A auth embutida e uma camada simples para LAN, nao substitui controle de acesso corporativo completo.

### Path traversal

Workspace bloqueia `relPath` com `..`, paths absolutos no `relPath`, escape do `sourceRoot` e symlink que aponte para fora. Validação em `server.js:resolveSafePath`.

Quando `HOST` expoe LAN e `WORKSPACE_ROOTS` esta vazio, `/api/fs/*` fica bloqueado. Isso evita publicar leitura arbitraria de disco por acidente.

### Permissões do OS

O Node usa as permissões do seu usuário. Se você (como user do Windows) não consegue ler `C:\Windows\System32\config\SAM`, o app também não consegue, mesmo que você digite o path.

### Workspace: read-only

O servidor **só lê**, nunca escreve em arquivos do disco.

---

## 20. Arquitetura interna (referência)

Pra quando você quiser entender o código.

### Stack

- Vanilla JS com ES modules nativos (sem build)
- Node 18+ pro server (apenas `http`, `https`, `fs`, `path`, `crypto`)
- Zero deps no client
- Service worker pra cache do shell

### Arquivos

```
/index.html              Shell HTML
/styles.css              Tokens CSS + componentes
/app.js                  Entry, orquestra os módulos
/server.js               Proxy CORS + endpoints fs
/sw.js                   Service worker
/manifest.webmanifest    PWA manifest
/Dockerfile, docker-compose.yml
/modules/
  store.js               Proxy + pubsub (estado reativo)
  schema.js              Defaults + migração v1→v2
  storage.js             localStorage + IDB
  api.js                 Cliente fetch + parse SSE
  markdown.js            Mini-render markdown (zero deps)
  theme.js               Aplica appearance no DOM
  shortcuts.js           Engine de atalhos + captura
  ui/
    chat.js              Render mensagens, ações, scroll
    composer.js          Auto-resize, slash, tokens
    sidebar.js           Histórico
    settings.js          Drawer 8 abas
    palette.js           Command palette
    workspace.js         File tree, context panel
    toasts.js
  workspace/
    upload.js            FileReader
    dragdrop.js          webkitGetAsEntry
    fsapi.js             showDirectoryPicker + IDB
    fsbridge.js          Cliente /api/fs/*
    context.js           Gerenciador de contexto
```

### Endpoints do server

| Path | Método | O que faz |
|---|---|---|
| `/api/models` | POST | Proxy GET para `${baseUrl}/models` |
| `/api/chat/completions` | POST | Proxy POST para `${baseUrl}/chat/completions` (suporta streaming SSE) |
| `/api/fs/list` | POST | Lista entries de uma pasta |
| `/api/fs/read` | POST | Lê conteúdo de um arquivo |
| `/api/fs/search` | POST | Busca full-text recursiva |
| `/*` | GET | Static file server com ETag + cache headers |

### Schema do storage

```js
localStorage["offline-ai-chat:v2"] = {
  schemaVersion: 2,
  connection: { activeServerId, servers: [...] },
  appearance: { theme, accentColor, fontSize, ... },
  behavior: { submitOn, autoScrollLock, ... },
  activeProfileId,
  profiles: [{ id, name, icon, systemPrompt, sampling, ... }],
  keymap: { send, newChat, ... },
  advanced: { streaming, debugMode, slashCommands, promptLibrary },
  workspace: { sources, activeSourceId, ignorePatterns, ... }
}

localStorage["offline-ai-chat:conversations:v1"] = [
  { id, title, createdAt, updatedAt, profileId, serverId, model, messages: [...] }
]
```

### Variáveis de ambiente do server

| Var | Default | Descrição |
|---|---|---|
| `HOST` | `127.0.0.1` native, `0.0.0.0` Docker | Bind address |
| `PORT` | `8080` | Porta HTTP |
| `APP_AUTH_USER` | `offline-ai` | Usuario da auth Basic embutida |
| `APP_AUTH_PASSWORD` / `APP_AUTH_TOKEN` | _(vazio)_ | Liga auth Basic quando definido |
| `ALLOW_UNRESTRICTED_WORKSPACE` | auto | Override explicito para aceitar qualquer pasta mesmo em LAN |
| `ALLOWED_LM_HOSTS` | _(vazio)_ | Allowlist de hosts LM Studio. Vazio em LAN permite so loopback |
| `WORKSPACE_ROOTS` | _(vazio)_ | CSV de paths permitidos. Vazio = single-user local; bloqueado em LAN |
| `MAX_FILE_BYTES` | `262144` (256 KB) | Tamanho máximo de arquivo lido |
| `MAX_PDF_BYTES` | `33554432` (32 MB) | Tamanho maximo de PDF extraido |
| `MAX_BODY_BYTES` | `~1.4x MAX_PDF_BYTES` | Limite de body JSON para upload PDF em base64 |

---

## Onde olhar quando tiver dúvida

- README: visão geral e instalação
- **Este guia**: uso, parâmetros, troubleshooting
- Código: cada módulo tem comentários no topo explicando o que faz
- Console do browser: erros e (com debug on) payloads das requests
- Network tab: o que realmente foi enviado pro LM Studio
- LM Studio logs: erros do lado do servidor LLM

## Usando o OpenRouter (modelos na nuvem)

Além do LM Studio local, dá pra conectar o OpenRouter (https://openrouter.ai) e usar modelos na nuvem (Gemini, Claude, DeepSeek, Llama, etc.) — vários com tier gratuito.

1. Crie uma conta em openrouter.ai e gere uma API key (`sk-or-...`).
2. Em **Configurações → Servidor**, clique em **"+ Adicionar OpenRouter"**.
3. Cole sua API key no campo **API key (OpenRouter)**.
4. Em **Configurações → Perfis & Inferência**, escolha o **modelo padrão**. O seletor agrupa em:
   - 🎁 **Gratuitos** — custo zero.
   - 💰 **Pagos** — com preço por milhão de tokens (entrada / saída), ex.: `$0.15 / $0.60 p/ M`.
5. Pronto: chat e modo de comparação passam a usar o OpenRouter.

> Sua API key fica apenas no navegador (localStorage) e é enviada ao OpenRouter pelo proxy local — nunca a terceiros.
