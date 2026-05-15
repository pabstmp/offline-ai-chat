# Documento de Requisitos — Function Calling / Tools

## Introdução

Esta feature expõe a capacidade de **function calling** (também chamada de *tool use*) da API OpenAI-compatible do LM Studio na interface do Offline AI Chat. Modelos que suportam tools (ex: Llama 3.1, Mistral, Qwen 2.5, Hermes) podem solicitar a execução de funções definidas pelo usuário durante uma conversa. A UI passa as definições de ferramentas no payload, detecta respostas `finish_reason: tool_calls`, executa as ferramentas disponíveis no lado do cliente (ou exibe o resultado para o usuário confirmar), e devolve os resultados ao modelo para que ele produza a resposta final.

O escopo inicial cobre:

- Gerenciamento de ferramentas built-in (busca na web via proxy, execução de JavaScript sandbox, data/hora atual).
- Gerenciamento de ferramentas customizadas definidas pelo usuário (nome, descrição, parâmetros JSON Schema, implementação JS).
- Ciclo completo de tool call: envio → detecção → execução → devolução ao modelo → resposta final.
- Renderização de tool calls e resultados no histórico de mensagens.
- Configuração por perfil (quais ferramentas ficam ativas).

---

## Glossário

- **Tool_Manager**: módulo `modules/tools/manager.js` responsável por registrar, listar e executar ferramentas.
- **Tool_Registry**: estrutura em memória (e persistida no schema) que mapeia nome de ferramenta → definição + implementação.
- **Tool_Definition**: objeto JSON Schema compatível com a spec OpenAI (`{ name, description, parameters: { type: "object", properties, required } }`).
- **Tool_Call**: objeto retornado pelo modelo indicando que ele quer executar uma ferramenta (`{ id, type: "function", function: { name, arguments } }`).
- **Tool_Result**: objeto enviado de volta ao modelo com o resultado da execução (`{ role: "tool", tool_call_id, content }`).
- **Tool_Executor**: função JS que recebe os argumentos parseados e retorna uma string com o resultado.
- **Tool_Cycle**: sequência completa de uma rodada de tool use: envio com tools → recebimento de tool_calls → execução → envio de tool results → resposta final.
- **Sandbox**: ambiente de execução isolado para ferramentas JS customizadas do usuário (usando `Function` constructor com timeout).
- **Chat_Module**: módulo `modules/ui/chat.js` responsável pela renderização de mensagens.
- **API_Module**: módulo `modules/api.js` responsável pela comunicação com o LM Studio.
- **App_Module**: arquivo `app.js` que orquestra o fluxo de envio de mensagens.
- **Schema_Module**: módulo `modules/schema.js` que define defaults e migrações do storage.
- **Settings_UI**: módulo `modules/ui/settings.js` que renderiza o drawer de configurações.
- **Profile**: configuração de perfil do usuário conforme definido no Schema_Module.
- **Composer**: área de entrada de texto do usuário (`modules/ui/composer.js`).

---

## Requisitos

### Requisito 1: Definição e persistência de ferramentas

**User Story:** Como usuário, quero definir ferramentas (built-in e customizadas) que o modelo pode chamar, para que eu possa estender as capacidades do assistente sem sair da interface.

#### Critérios de Aceitação

1. THE Tool_Registry SHALL armazenar ferramentas com os campos: `id` (string única), `name` (identificador snake_case), `description` (string), `parameters` (JSON Schema object), `implementation` (string JS ou identificador built-in), `enabled` (boolean), `builtIn` (boolean).
2. THE Schema_Module SHALL incluir uma chave `tools` nos defaults com as ferramentas built-in pré-cadastradas e `enabled: false` por padrão.
3. WHEN o usuário salva uma ferramenta customizada, THE Tool_Manager SHALL validar que `name` contém apenas caracteres `[a-z0-9_]` e tem entre 1 e 64 caracteres.
4. IF o campo `name` de uma ferramenta customizada já existir no Tool_Registry, THEN THE Tool_Manager SHALL retornar um erro descritivo sem sobrescrever a ferramenta existente.
5. WHEN o usuário exclui uma ferramenta customizada, THE Tool_Manager SHALL remover a ferramenta do Tool_Registry e persistir o estado atualizado.
6. THE Schema_Module SHALL migrar configurações existentes sem `tools` adicionando a chave com os defaults sem sobrescrever dados do usuário.

---

### Requisito 2: Ferramentas built-in

**User Story:** Como usuário, quero ferramentas prontas para uso comum (data/hora, busca na web, execução de código), para que eu não precise implementar funcionalidades básicas do zero.

#### Critérios de Aceitação

1. THE Tool_Manager SHALL incluir uma ferramenta built-in `get_current_datetime` que retorna a data e hora atual no formato ISO 8601 com timezone do browser.
2. THE Tool_Manager SHALL incluir uma ferramenta built-in `web_search` que recebe `{ query: string }` e retorna os resultados via endpoint proxy `/api/tools/web-search` no servidor Node.
3. THE Tool_Manager SHALL incluir uma ferramenta built-in `run_javascript` que recebe `{ code: string }` e executa o código em um Sandbox com timeout de 5000ms, retornando o valor de retorno serializado como string.
4. WHEN a ferramenta `web_search` é chamada, THE Tool_Manager SHALL enviar a query ao endpoint `/api/tools/web-search` e retornar os resultados como string JSON com campos `title`, `url` e `snippet` por resultado.
5. IF a execução da ferramenta `run_javascript` exceder 5000ms, THEN THE Tool_Manager SHALL interromper a execução e retornar a string `"Erro: timeout de execução (5000ms) excedido"`.
6. IF a ferramenta `run_javascript` lançar uma exceção, THEN THE Tool_Manager SHALL capturar o erro e retornar a string `"Erro: <mensagem do erro>"` sem propagar a exceção.
7. WHERE a ferramenta `web_search` está habilitada, THE Settings_UI SHALL exibir um aviso informando que buscas na web são roteadas pelo servidor proxy local.

---

### Requisito 3: Configuração de ferramentas por perfil

**User Story:** Como usuário, quero controlar quais ferramentas ficam ativas em cada perfil, para que diferentes assistentes tenham capacidades distintas sem interferência mútua.

#### Critérios de Aceitação

1. THE Settings_UI SHALL exibir uma aba ou seção "Ferramentas" dentro das configurações de perfil, listando todas as ferramentas do Tool_Registry com toggle de habilitação individual.
2. WHEN o usuário habilita ou desabilita uma ferramenta em um perfil, THE Schema_Module SHALL persistir a lista de IDs de ferramentas ativas em `profile.tools` (array de strings).
3. THE App_Module SHALL incluir no payload da requisição apenas as Tool_Definitions das ferramentas com `enabled: true` no perfil ativo.
4. WHEN nenhuma ferramenta está habilitada no perfil ativo, THE App_Module SHALL omitir o campo `tools` do payload, mantendo comportamento idêntico ao atual.
5. THE Settings_UI SHALL exibir o número de ferramentas ativas no chip de perfil da topbar quando pelo menos uma ferramenta estiver habilitada.

---

### Requisito 4: Ciclo de tool call — detecção e execução

**User Story:** Como usuário, quero que o assistente execute ferramentas automaticamente quando o modelo as solicitar, para que a conversa flua sem interrupções manuais.

#### Critérios de Aceitação

1. WHEN a resposta do modelo contém `finish_reason: "tool_calls"` e `message.tool_calls` não vazio, THE App_Module SHALL iniciar um Tool_Cycle sem exibir a mensagem de tool_calls como resposta final ao usuário.
2. THE App_Module SHALL executar cada Tool_Call da lista `message.tool_calls` em paralelo usando `Promise.all`, respeitando a ordem dos IDs para montar os Tool_Results.
3. WHEN um Tool_Call referencia uma ferramenta não registrada no Tool_Registry, THE Tool_Manager SHALL retornar a string `"Erro: ferramenta '<name>' não encontrada"` como Tool_Result sem interromper o ciclo.
4. WHEN todos os Tool_Results estão disponíveis, THE App_Module SHALL enviar uma nova requisição ao modelo com o histórico completo incluindo a mensagem `assistant` com `tool_calls` e as mensagens `tool` com os resultados.
5. THE App_Module SHALL limitar o Tool_Cycle a no máximo 5 iterações consecutivas por mensagem do usuário, retornando erro ao usuário se o limite for atingido.
6. IF o AbortController do usuário for acionado durante um Tool_Cycle, THEN THE App_Module SHALL interromper o ciclo imediatamente e exibir o conteúdo parcial acumulado até aquele ponto.

---

### Requisito 5: Modo de confirmação manual

**User Story:** Como usuário, quero poder revisar e aprovar cada tool call antes da execução, para que eu tenha controle sobre ações que o modelo solicita.

#### Critérios de Aceitação

1. WHERE a configuração `tools.requireConfirmation` está habilitada, THE App_Module SHALL pausar o Tool_Cycle antes de executar cada Tool_Call e exibir um modal de confirmação com nome da ferramenta e argumentos formatados.
2. WHEN o usuário confirma a execução no modal, THE App_Module SHALL prosseguir com a execução da ferramenta e continuar o Tool_Cycle.
3. WHEN o usuário rejeita a execução no modal, THE App_Module SHALL enviar ao modelo um Tool_Result com o conteúdo `"Execução cancelada pelo usuário"` e continuar o ciclo com os demais Tool_Calls.
4. THE Settings_UI SHALL exibir um toggle "Confirmar antes de executar ferramentas" na seção de ferramentas, persistido em `advanced.tools.requireConfirmation`.
5. WHEN `tools.requireConfirmation` está desabilitado, THE App_Module SHALL executar todas as ferramentas automaticamente sem exibir modal.

---

### Requisito 6: Renderização de tool calls no histórico

**User Story:** Como usuário, quero ver no histórico da conversa quais ferramentas foram chamadas e seus resultados, para que eu entenda o raciocínio do assistente.

#### Critérios de Aceitação

1. THE Chat_Module SHALL renderizar cada Tool_Call como um bloco colapsável `<details>` com summary `🔧 <nome_da_ferramenta>(...)` antes da resposta final do assistente.
2. THE Chat_Module SHALL exibir dentro do bloco colapsável os argumentos da Tool_Call formatados como JSON com indentação de 2 espaços.
3. THE Chat_Module SHALL exibir o resultado da execução da ferramenta dentro do mesmo bloco colapsável, separado dos argumentos por um divisor visual.
4. WHEN o Tool_Cycle está em andamento, THE Chat_Module SHALL exibir um indicador de progresso "⚙ Executando ferramentas..." no lugar do bloco de typing padrão.
5. THE Chat_Module SHALL persistir os blocos de tool calls no histórico da conversa como parte da mensagem do assistente, usando o campo `tool_calls` na estrutura de mensagem salva.
6. WHEN uma mensagem do histórico contém `tool_calls`, THE Chat_Module SHALL re-renderizar os blocos colapsáveis ao carregar a conversa.

---

### Requisito 7: Ferramentas customizadas definidas pelo usuário

**User Story:** Como usuário avançado, quero criar minhas próprias ferramentas com código JavaScript, para que eu possa integrar o assistente com sistemas e dados específicos do meu contexto.

#### Critérios de Aceitação

1. THE Settings_UI SHALL exibir um formulário de criação de ferramenta customizada com campos: nome (snake_case), descrição, parâmetros (editor JSON Schema), e implementação (textarea JS).
2. WHEN o usuário submete o formulário de criação, THE Tool_Manager SHALL validar o JSON Schema dos parâmetros antes de salvar, retornando erro descritivo se o schema for inválido.
3. THE Tool_Manager SHALL executar ferramentas customizadas no Sandbox passando os argumentos parseados como primeiro parâmetro da função e capturando o valor de retorno.
4. THE Settings_UI SHALL exibir um botão "Testar ferramenta" que executa a ferramenta com argumentos de exemplo definidos pelo usuário e exibe o resultado em um painel inline.
5. WHEN o código de uma ferramenta customizada tenta acessar `window`, `document`, `fetch` ou `XMLHttpRequest`, THE Sandbox SHALL lançar um ReferenceError e THE Tool_Manager SHALL retornar o erro como Tool_Result.
6. THE Tool_Manager SHALL serializar o valor de retorno da ferramenta customizada como string: se for objeto/array, usa `JSON.stringify`; se for primitivo, usa `String()`; se for `undefined` ou `null`, retorna a string `"(sem resultado)"`.

---

### Requisito 8: Integração com o servidor proxy

**User Story:** Como desenvolvedor, quero que ferramentas que precisam de acesso à rede usem o servidor proxy Node existente, para que o cliente mantenha zero dependências externas e as requisições respeitem as políticas de segurança do servidor.

#### Critérios de Aceitação

1. THE App_Module SHALL implementar o endpoint `/api/tools/web-search` no servidor Node que recebe `{ query: string }` e retorna resultados de busca como array JSON.
2. WHEN o endpoint `/api/tools/web-search` recebe uma query vazia ou ausente, THE App_Module SHALL retornar HTTP 400 com `{ error: "query obrigatória" }`.
3. THE App_Module SHALL validar e sanitizar o parâmetro `query` no servidor antes de realizar a busca, rejeitando strings com mais de 500 caracteres com HTTP 400.
4. WHEN o servidor proxy não consegue completar a busca na web, THE App_Module SHALL retornar HTTP 502 com `{ error: "<mensagem descritiva>" }` para que o Tool_Manager possa repassar o erro ao modelo.
5. THE App_Module SHALL respeitar as configurações de `ALLOWED_LM_HOSTS` e autenticação existentes ao rotear requisições de ferramentas pelo servidor proxy.

