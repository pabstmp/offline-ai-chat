# Documento de Requisitos — Reranking com Cross-Encoder no RAG

## Introdução

Esta feature adiciona uma etapa de **reranking** ao pipeline RAG do Offline AI Chat. Atualmente, o retriever seleciona chunks usando cosine similarity sobre vetores de embedding (bi-encoder), o que é eficiente mas impreciso: a similaridade semântica entre query e chunk é calculada de forma independente, sem considerar a interação direta entre os dois textos.

Um **cross-encoder** resolve isso: recebe o par `(query, chunk)` concatenado e produz um score de relevância muito mais preciso, pois o modelo pode atender a ambos os textos simultaneamente. O tradeoff é custo — cross-encoders são lentos demais para varrer o índice inteiro, por isso o padrão da indústria é **retrieve-then-rerank**: o bi-encoder recupera um conjunto candidato amplo (ex: top-20), e o cross-encoder reordena esse conjunto para selecionar os K mais relevantes (ex: top-5) que serão enviados ao LLM.

O escopo cobre:

- Novo módulo `modules/rag/reranker.js` que chama um endpoint de cross-encoder via API OpenAI-compatible (LM Studio ou endpoint dedicado).
- Integração no `manager.js` como etapa opcional pós-retrieval, sem quebrar o fluxo existente quando desativado.
- Configuração no schema (`rag.reranking`) com campos para habilitar, modelo, endpoint alternativo e tamanho do conjunto candidato.
- UI na aba RAG de Configurações para expor os controles de reranking.
- Degradação graciosa: se o reranker falhar ou estiver desativado, o pipeline continua com os resultados do retriever original.

---

## Glossário

- **Reranker**: módulo `modules/rag/reranker.js` responsável por chamar o cross-encoder e reordenar chunks candidatos.
- **Cross_Encoder**: modelo de linguagem que recebe um par `(query, chunk)` e retorna um score de relevância. Diferente do bi-encoder (embedding), o cross-encoder processa os dois textos juntos, produzindo scores mais precisos.
- **Bi_Encoder**: modelo de embedding existente (`embedder.js`) que gera vetores independentes para query e chunks. Usado na etapa de retrieval inicial.
- **Candidate_Set**: conjunto de chunks retornados pelo retriever (Bi_Encoder + `topK`) antes do reranking. Tipicamente maior que o `finalK` para dar margem ao Reranker.
- **Rerank_Score**: score de relevância produzido pelo Cross_Encoder para um par `(query, chunk)`. Substitui o cosine score na ordenação final quando reranking está ativo.
- **Final_K**: número de chunks enviados ao LLM após reranking. Configurável, menor ou igual ao tamanho do Candidate_Set.
- **Retriever**: módulo `modules/rag/retriever.js` existente, responsável pela etapa de busca por cosine similarity.
- **Manager**: módulo `modules/rag/manager.js` existente, facade do pipeline RAG com pubsub.
- **RAG_Config**: objeto `store.rag` no schema v2, que será estendido com o sub-objeto `reranking`.
- **Settings_RAG_Panel**: painel de configurações RAG na aba Workspace/RAG em `modules/ui/settings/workspace.js`.
- **Reranking_Endpoint**: URL base do servidor que expõe o Cross_Encoder. Pode ser o mesmo servidor LM Studio ou um endpoint dedicado. Quando vazio, usa o servidor ativo da conexão.
- **RAG_Pill**: indicador visual no composer (`#ragPill`) que exibe o estado do pipeline RAG.

---

## Requisitos

### Requisito 1: Módulo Reranker

**User Story:** Como desenvolvedor, quero um módulo isolado de reranking, para que a lógica de cross-encoder seja testável e substituível sem afetar o restante do pipeline RAG.

#### Critérios de Aceitação

1. THE Reranker SHALL exportar uma função `rerank({ query, chunks, config, signal })` que recebe a query do usuário, o Candidate_Set e a configuração de reranking, e retorna um array de chunks reordenados por Rerank_Score decrescente.
2. WHEN `config.rerankModel` está definido e `config.rerankEnabled` é `true`, THE Reranker SHALL chamar o endpoint `/v1/chat/completions` (ou equivalente cross-encoder) com pares `(query, chunk.text)` para obter os Rerank_Scores.
3. THE Reranker SHALL truncar `chunk.text` para no máximo 512 tokens estimados (aproximação: 512 × 4 = 2048 caracteres) antes de enviar ao Cross_Encoder, para evitar overflow de contexto.
4. THE Reranker SHALL preservar todos os campos originais de cada chunk (incluindo `id`, `path`, `fileId`, `chunkIdx`, `text`, `lineStart`, `lineEnd`, `score`, `_reason`) no objeto retornado, adicionando o campo `rerankScore` com o valor retornado pelo Cross_Encoder.
5. WHEN o `signal` de abort é acionado durante o reranking, THE Reranker SHALL interromper chamadas pendentes e lançar um erro com mensagem `"Reranking cancelado"`.
6. IF o Cross_Encoder retornar um erro HTTP ou resposta malformada para um chunk específico, THEN THE Reranker SHALL atribuir `rerankScore: -Infinity` a esse chunk e continuar processando os demais sem lançar exceção.
7. THE Reranker SHALL retornar os chunks ordenados por `rerankScore` decrescente, com empates resolvidos pelo `score` original (cosine similarity) como critério secundário.
8. FOR ALL Candidate_Sets de entrada com N chunks, THE Reranker SHALL retornar exatamente N chunks na saída (propriedade de completude — nenhum chunk é descartado pelo Reranker, apenas reordenado).

### Requisito 2: Estratégia de chamada ao Cross_Encoder

**User Story:** Como usuário, quero que o reranking seja eficiente e não bloqueie a resposta por tempo excessivo, para que a melhoria de qualidade não prejudique a experiência de uso.

#### Critérios de Aceitação

1. THE Reranker SHALL enviar os pares `(query, chunk)` ao Cross_Encoder em lotes de no máximo `config.rerankBatchSize` pares por requisição (padrão: 8), para respeitar limites de contexto do modelo.
2. WHEN `config.rerankBatchSize` não está definido ou é menor que 1, THE Reranker SHALL usar o valor padrão de 8 pares por lote.
3. THE Reranker SHALL processar os lotes sequencialmente (não em paralelo), para evitar sobrecarga no LM Studio que processa um modelo por vez.
4. WHEN o Candidate_Set contém mais de `config.candidateK` chunks, THE Reranker SHALL processar apenas os primeiros `config.candidateK` chunks (já ordenados por cosine score) e ignorar os demais.
5. WHEN `config.candidateK` não está definido ou é menor que `config.finalK`, THE Reranker SHALL usar `config.finalK * 3` como valor de `candidateK`, garantindo margem mínima para o reranking ser útil.

### Requisito 3: Integração no pipeline RAG (Manager)

**User Story:** Como usuário, quero que o reranking seja aplicado automaticamente após o retrieval quando configurado, para que eu receba chunks mais relevantes sem precisar alterar meu fluxo de trabalho.

#### Critérios de Aceitação

1. WHEN `ragConfig.reranking.enabled` é `true` e `ragConfig.reranking.rerankModel` está definido, THE Manager SHALL chamar o Reranker após o Retriever e antes de retornar os resultados para `app.js`.
2. THE Manager SHALL passar ao Retriever `k = config.reranking.candidateK` (ou `finalK * 3` como fallback) quando reranking está ativo, para garantir um Candidate_Set suficientemente amplo.
3. AFTER reranking, THE Manager SHALL truncar o resultado para os primeiros `config.reranking.finalK` chunks ordenados por `rerankScore`.
4. WHEN `ragConfig.reranking.enabled` é `false` ou `ragConfig.reranking.rerankModel` está vazio, THE Manager SHALL executar o pipeline original sem chamar o Reranker, mantendo comportamento idêntico ao atual.
5. IF o Reranker lançar uma exceção (falha de rede, timeout, modelo não carregado), THEN THE Manager SHALL registrar o erro no console, emitir um toast de aviso com a mensagem `"Reranking falhou: <motivo>. Usando ordem original."` e retornar os resultados do Retriever sem reranking.
6. THE Manager SHALL incluir no objeto de resultado o campo `_rerankApplied: boolean` indicando se o reranking foi efetivamente executado, para uso em debug e no RAG_Pill.
7. WHEN `store.advanced.debugMode` é `true`, THE Manager SHALL registrar no console o tempo de execução do reranking, o número de chunks no Candidate_Set e o número de chunks no resultado final.

### Requisito 4: Configuração no Schema

**User Story:** Como usuário, quero configurar o reranking de forma persistente, para que minhas preferências sejam mantidas entre sessões sem precisar reconfigurar.

#### Critérios de Aceitação

1. THE RAG_Config SHALL incluir um sub-objeto `reranking` com os campos: `enabled` (boolean, padrão `false`), `rerankModel` (string, padrão `""`), `rerankEndpoint` (string, padrão `""`), `candidateK` (number, padrão `20`), `finalK` (number, padrão `5`), `rerankBatchSize` (number, padrão `8`).
2. THE Schema SHALL incluir o sub-objeto `reranking` no retorno de `defaults()` dentro do objeto `rag`, para que novas instalações recebam os valores padrão sem migração.
3. WHEN `loadAndMigrate()` carrega uma configuração existente sem o campo `rag.reranking`, THE Schema SHALL adicionar o sub-objeto `reranking` com os valores padrão sem sobrescrever os demais campos de `rag` (soft migration).
4. THE Schema SHALL validar que `reranking.finalK` é menor ou igual a `reranking.candidateK`; IF `finalK > candidateK`, THEN THE Schema SHALL ajustar `candidateK` para `finalK * 3` durante a soft migration.
5. FOR ALL objetos de configuração válidos `cfg`, serializar e desserializar `cfg.rag.reranking` SHALL produzir um objeto equivalente ao original (propriedade de round-trip de serialização JSON).

### Requisito 5: Interface de Configuração (Settings)

**User Story:** Como usuário, quero configurar o reranking diretamente na interface de configurações, para que eu não precise editar arquivos ou o localStorage manualmente.

#### Critérios de Aceitação

1. THE Settings_RAG_Panel SHALL exibir uma seção "Reranking (Cross-Encoder)" com um checkbox "Ativar reranking" que controla `rag.reranking.enabled`.
2. WHEN `rag.reranking.enabled` é `false`, THE Settings_RAG_Panel SHALL ocultar os campos de configuração de reranking (`rerankModel`, `rerankEndpoint`, `candidateK`, `finalK`, `rerankBatchSize`) para não poluir a interface.
3. WHEN `rag.reranking.enabled` é `true`, THE Settings_RAG_Panel SHALL exibir um campo de texto "Modelo cross-encoder" vinculado a `rag.reranking.rerankModel`, com placeholder `"ex: cross-encoder/ms-marco-MiniLM-L-6-v2"`.
4. WHEN `rag.reranking.enabled` é `true`, THE Settings_RAG_Panel SHALL exibir um campo de texto "Endpoint do reranker (opcional)" vinculado a `rag.reranking.rerankEndpoint`, com placeholder `"Padrão: mesmo servidor ativo"`.
5. WHEN `rag.reranking.enabled` é `true`, THE Settings_RAG_Panel SHALL exibir controles numéricos para `candidateK` (label: "Candidatos para reranking", mín: 5, máx: 50) e `finalK` (label: "Chunks finais após reranking", mín: 1, máx: 20).
6. THE Settings_RAG_Panel SHALL impedir que o usuário defina `finalK` maior que `candidateK`, exibindo uma mensagem de validação inline `"Chunks finais deve ser ≤ candidatos"` e desabilitando o save enquanto inválido.
7. THE Settings_RAG_Panel SHALL exibir uma nota informativa estática: `"O modelo cross-encoder deve estar carregado no LM Studio. Modelos de embedding não funcionam como cross-encoder."`.

### Requisito 6: Indicação visual do reranking ativo

**User Story:** Como usuário, quero saber quando o reranking foi aplicado na última consulta RAG, para que eu possa entender por que os resultados podem ser diferentes do esperado.

#### Critérios de Aceitação

1. WHEN `rag.reranking.enabled` é `true` e `rag.reranking.rerankModel` está definido, THE RAG_Pill SHALL exibir o sufixo `"+ rerank"` no label, resultando em formato como `"RAG · 12 chunks + rerank"`.
2. WHEN o reranking foi configurado mas falhou na última consulta (campo `_rerankApplied: false` com reranking habilitado), THE RAG_Pill SHALL exibir o sufixo `"+ rerank ⚠"` e o `title` do pill SHALL incluir a mensagem `"Reranking falhou na última consulta — usando ordem por cosine similarity"`.
3. WHEN `rag.reranking.enabled` é `false`, THE RAG_Pill SHALL exibir o label sem sufixo de reranking, mantendo o comportamento atual.
4. WHEN `store.advanced.debugMode` é `true` e reranking foi aplicado, THE Manager SHALL registrar no console os top-3 chunks antes e depois do reranking com seus scores, para facilitar diagnóstico de qualidade.

### Requisito 7: Compatibilidade com estratégias existentes

**User Story:** Como usuário, quero que o reranking funcione corretamente com todas as estratégias de retrieval existentes (comparative, summary, point, exhaustive), para que eu não perca funcionalidades ao ativar o reranking.

#### Critérios de Aceitação

1. WHEN a estratégia detectada é `"exhaustive"` e o índice completo cabe no `charBudget`, THE Manager SHALL ignorar o reranking e retornar todos os chunks na ordem por arquivo, pois o reranking não agrega valor quando todos os chunks já são incluídos.
2. WHEN a estratégia detectada é `"comparative"` com `coverAllFiles: true`, THE Manager SHALL aplicar o reranking apenas sobre os chunks que excedem a cota mínima de cobertura por arquivo, preservando pelo menos 1 chunk por arquivo no resultado final independentemente do Rerank_Score.
3. WHEN a estratégia detectada é `"summary"` ou `"point"`, THE Manager SHALL aplicar o reranking normalmente sobre o Candidate_Set completo sem restrições adicionais.
4. THE Manager SHALL passar o `signal` de abort recebido em `retrieve()` para o Reranker, garantindo que o cancelamento de uma consulta RAG também cancele o reranking em andamento.
5. FOR ALL estratégias onde reranking é aplicado, o número de chunks no resultado final SHALL ser igual a `min(reranking.finalK, tamanho do Candidate_Set)` (propriedade de tamanho do resultado).

