# Plano de Implementação: Reranking com Cross-Encoder no RAG

## Visão Geral

Implementação incremental do pipeline retrieve-then-rerank no Offline AI Chat. O novo módulo `reranker.js` é criado de forma isolada, depois integrado ao `manager.js`, seguido das mudanças de schema, UI de configurações e atualização do RAG Pill em `app.js`. Cada etapa é validada antes de avançar.

## Tarefas

- [ ] 1. Criar `modules/rag/reranker.js` com a lógica de cross-encoder
  - Criar o arquivo `modules/rag/reranker.js` exportando a função `rerank({ query, chunks, config, embedConfig, signal })`
  - Implementar truncamento de `chunk.text` para no máximo 2048 caracteres antes de enviar ao cross-encoder
  - Implementar construção do prompt de scoring: `"Relevance score (0-10) for query: '{query}'\nDocument: '{text}'\nScore:"`
  - Implementar envio sequencial em lotes de `config.rerankBatchSize` (padrão 8) via `/v1/chat/completions`
  - Implementar parse do score numérico da resposta; atribuir `-Infinity` em caso de erro HTTP ou resposta malformada por chunk
  - Implementar ordenação final por `rerankScore` desc, desempate por `score` (cosine) desc
  - Implementar respeito ao `signal` de abort — lançar `Error("Reranking cancelado")` quando `signal.aborted`
  - Preservar todos os campos originais do chunk; adicionar apenas o campo `rerankScore`
  - Quando `config.candidateK` não definido ou menor que `config.finalK`, usar `config.finalK * 3` como candidateK efetivo
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 1.1 Escrever teste de propriedade — Propriedade 1: completude do reranker
    - **Propriedade 1: Para qualquer Candidate_Set com N chunks, o reranker retorna exatamente N chunks**
    - Usar `fc.array(chunkArbitrary, { minLength: 0, maxLength: 30 })` com mock do fetch
    - **Valida: Requisito 1.8**

  - [ ]* 1.2 Escrever teste de propriedade — Propriedade 2: ordenação por rerankScore com desempate
    - **Propriedade 2: Array retornado ordenado por `rerankScore` desc, empates por `score` desc**
    - Usar `fc.record({ rerankScore: fc.float(), score: fc.float() })` para chunks com scores arbitrários
    - **Valida: Requisitos 1.1, 1.7**

  - [ ]* 1.3 Escrever teste de propriedade — Propriedade 3: preservação de campos originais
    - **Propriedade 3: Todos os campos originais do chunk estão presentes no objeto de saída, com `rerankScore` adicionado**
    - Gerar chunks com campos arbitrários via `fc.record`
    - **Valida: Requisito 1.4**

  - [ ]* 1.4 Escrever teste de propriedade — Propriedade 4: truncamento de texto antes do cross-encoder
    - **Propriedade 4: O texto enviado ao cross-encoder nunca excede 2048 caracteres**
    - Usar `fc.string({ maxLength: 5000 })` para textos de comprimento variável
    - Verificar via spy/mock que o texto no payload da requisição tem no máximo 2048 chars
    - **Valida: Requisito 1.3**

  - [ ]* 1.5 Escrever teste de propriedade — Propriedade 5: degradação graciosa com -Infinity
    - **Propriedade 5: Chunk com erro HTTP recebe `rerankScore: -Infinity`; demais chunks do lote continuam processados**
    - Mock retorna erro para índices específicos do lote
    - **Valida: Requisito 1.6**

  - [ ]* 1.6 Escrever teste de propriedade — Propriedade 12: candidateK efetivo quando não definido
    - **Propriedade 12: Quando `candidateK` não definido ou menor que `finalK`, o candidateK efetivo é `finalK * 3`**
    - Usar `fc.integer({ min: 1, max: 20 })` para `finalK`
    - **Valida: Requisito 2.5**

  - [ ]* 1.7 Escrever testes unitários para `reranker.js`
    - Abort signal lança `"Reranking cancelado"`
    - `rerankBatchSize` padrão 8 quando não definido
    - Processamento sequencial de lotes (não paralelo)
    - _Requisitos: 1.5, 2.2, 2.3_

- [ ] 2. Checkpoint — Verificar reranker isolado
  - Garantir que todos os testes do reranker passam, perguntar ao usuário se houver dúvidas.

- [ ] 3. Estender `modules/schema.js` com `rag.reranking`
  - Adicionar sub-objeto `reranking` em `defaults()` dentro de `rag`: `{ enabled: false, rerankModel: "", rerankEndpoint: "", candidateK: 20, finalK: 5, rerankBatchSize: 8 }`
  - Adicionar soft migration em `loadAndMigrate()`: se `target.rag && !target.rag.reranking`, atribuir `defaults().rag.reranking`
  - Adicionar validação de invariante na soft migration: se `reranking.finalK > reranking.candidateK`, ajustar `candidateK = finalK * 3`
  - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 3.1 Escrever teste de propriedade — Propriedade 9: soft migration adiciona reranking ausente
    - **Propriedade 9: Para qualquer config sem `rag.reranking`, após `loadAndMigrate()` o campo está presente com defaults sem sobrescrever outros campos de `rag`**
    - Gerar configs arbitrárias com `rag` mas sem `rag.reranking` via `fc.record`
    - **Valida: Requisito 4.3**

  - [ ]* 3.2 Escrever teste de propriedade — Propriedade 10: correção de invariante finalK ≤ candidateK
    - **Propriedade 10: Quando `finalK > candidateK`, após soft migration `candidateK` é ajustado para `finalK * 3`**
    - Usar `fc.integer({ min: 1, max: 20 })` para `finalK` e `fc.integer({ min: 1, max: 19 })` para `candidateK` com filtro `finalK > candidateK`
    - **Valida: Requisito 4.4**

  - [ ]* 3.3 Escrever teste de propriedade — Propriedade 11: round-trip de serialização JSON
    - **Propriedade 11: `JSON.parse(JSON.stringify(cfg.rag.reranking))` produz objeto equivalente ao original**
    - Gerar objetos `reranking` válidos com `fc.record`
    - **Valida: Requisito 4.5**

  - [ ]* 3.4 Escrever testes unitários para `schema.js`
    - `defaults()` retorna `rag.reranking` com todos os campos e tipos corretos
    - Soft migration não sobrescreve campos existentes de `rag`
    - _Requisitos: 4.1, 4.2_

- [ ] 4. Integrar reranker em `modules/rag/manager.js`
  - Importar `rerank` de `./reranker.js`
  - Adicionar parâmetros opcionais `rerankConfig = null` e `signal = null` à função `retrieve()`
  - Quando `rerankConfig?.enabled && rerankConfig?.rerankModel` e não foi modo exhaustive: chamar `reranker.rerank()` com `candidateK` como `k` para o retriever
  - Passar `signal` para o reranker
  - Em caso de sucesso: retornar `{ chunks: reranked.slice(0, rerankConfig.finalK), _rerankApplied: true }`
  - Em caso de exceção do reranker: emitir `toast("Reranking falhou: <motivo>. Usando ordem original.", "warn")`, retornar `{ chunks: candidates.slice(0, rerankConfig.finalK || k), _rerankApplied: false }`
  - Quando reranking desabilitado ou `rerankModel` vazio: retornar `{ chunks: candidates, _rerankApplied: false }`
  - Quando modo exhaustive: ignorar reranking, retornar `{ chunks: sorted, _rerankApplied: false }`
  - Quando `coverAllFiles: true` (comparative): aplicar reranking apenas sobre chunks que excedem a cota mínima de cobertura por arquivo
  - Quando `debugMode: true`: registrar no console tempo de execução, tamanho do Candidate_Set e tamanho do resultado final; registrar top-3 chunks antes/depois com seus scores
  - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 4.1 Escrever teste de propriedade — Propriedade 6: tamanho do resultado final
    - **Propriedade 6: O número de chunks no resultado final é `min(reranking.finalK, tamanho do Candidate_Set)`**
    - Usar `fc.record({ finalK: fc.integer({min:1,max:20}), candidateK: fc.integer({min:1,max:50}) })` para configs
    - **Valida: Requisitos 3.3, 7.5**

  - [ ]* 4.2 Escrever teste de propriedade — Propriedade 7: fallback preserva resultados originais
    - **Propriedade 7: Quando o reranker lança exceção, o manager retorna os chunks originais sem modificação com `_rerankApplied: false`**
    - Mock do reranker que lança exceção aleatória
    - **Valida: Requisito 3.5**

  - [ ]* 4.3 Escrever teste de propriedade — Propriedade 8: `_rerankApplied` sempre presente
    - **Propriedade 8: Para qualquer chamada a `manager.retrieve()`, o resultado sempre inclui `_rerankApplied` como boolean**
    - Testar com reranking habilitado, desabilitado e em modo exhaustive
    - **Valida: Requisito 3.6**

  - [ ]* 4.4 Escrever testes unitários para `manager.js`
    - Reranker não é chamado quando `enabled=false` ou `rerankModel=""`
    - Reranker não é chamado em modo exhaustive
    - Signal é propagado para o reranker
    - _Requisitos: 3.4, 7.1, 7.4_

- [ ] 5. Checkpoint — Verificar pipeline RAG completo
  - Garantir que todos os testes do manager passam, perguntar ao usuário se houver dúvidas.

- [ ] 6. Adicionar seção de reranking em `modules/ui/settings/workspace.js`
  - Criar função `buildRerankingSection()` dentro de `buildRagGlobalSection()`, após o bloco de configurações avançadas existente
  - Renderizar checkbox "Ativar reranking" vinculado a `rag.reranking.enabled`
  - Quando `enabled=false`: ocultar todos os campos de configuração de reranking
  - Quando `enabled=true`: exibir campo texto "Modelo cross-encoder" (`rag.reranking.rerankModel`, placeholder `"ex: cross-encoder/ms-marco-MiniLM-L-6-v2"`)
  - Quando `enabled=true`: exibir campo texto "Endpoint do reranker (opcional)" (`rag.reranking.rerankEndpoint`, placeholder `"Padrão: mesmo servidor ativo"`)
  - Quando `enabled=true`: exibir controles numéricos para `candidateK` (label: "Candidatos para reranking", mín: 5, máx: 50) e `finalK` (label: "Chunks finais após reranking", mín: 1, máx: 20)
  - Implementar validação inline: se `finalK > candidateK`, exibir mensagem `"Chunks finais deve ser ≤ candidatos"` e desabilitar save
  - Exibir nota informativa estática: `"O modelo cross-encoder deve estar carregado no LM Studio. Modelos de embedding não funcionam como cross-encoder."`
  - Usar os helpers DOM existentes (`field()`, `section()`, `checkbox()`, `sliderRow()`) seguindo o padrão do arquivo
  - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 6.1 Escrever teste de propriedade — Propriedade 13: validação de UI — finalK ≤ candidateK
    - **Propriedade 13: Para qualquer par `(finalK, candidateK)` onde `finalK > candidateK`, a validação retorna erro e impede o save**
    - Extrair a função de validação inline para ser testável de forma isolada
    - Usar `fc.integer({ min: 1, max: 20 })` para `finalK` e `fc.integer({ min: 1, max: 50 })` para `candidateK`
    - **Valida: Requisito 5.6**

  - [ ]* 6.2 Escrever testes unitários para `workspace.js` (settings)
    - Seção de reranking existe no DOM após `buildRerankingSection()`
    - Campos ficam ocultos quando `enabled=false`
    - _Requisitos: 5.1, 5.2_

- [ ] 7. Atualizar `app.js` — `tryRagRetrieve()` e `refreshRagPill()`
  - Em `tryRagRetrieve()`: passar `rerankConfig: ragCfg.reranking` e `signal: runtime.abortController?.signal` para `rag.retrieve()`
  - Em `tryRagRetrieve()`: desestruturar o resultado de `rag.retrieve()` como `{ chunks, _rerankApplied }` (o contrato mudou de Array para objeto)
  - Armazenar `_rerankApplied` em `runtime.lastRerankApplied` para uso no pill
  - Em `refreshRagPill()`: quando `rag.reranking.enabled === true && rag.reranking.rerankModel !== ""`, adicionar sufixo `"+ rerank"` ao label (ex: `"RAG · 12 chunks + rerank"`)
  - Quando reranking configurado mas `runtime.lastRerankApplied === false`: exibir sufixo `"+ rerank ⚠"` e `title` com `"Reranking falhou na última consulta — usando ordem por cosine similarity"`
  - Quando `rag.reranking.enabled === false`: manter label sem sufixo de reranking
  - _Requisitos: 3.6, 6.1, 6.2, 6.3_

  - [ ]* 7.1 Escrever teste de propriedade — Propriedade 14: RAG Pill sem sufixo quando reranking desabilitado
    - **Propriedade 14: Quando `rag.reranking.enabled === false`, o label do RAG Pill nunca contém a substring `"rerank"`**
    - Extrair a lógica de formatação do label para função pura testável
    - Usar `fc.record({ enabled: fc.constant(false), rerankModel: fc.string() })` para configs
    - **Valida: Requisito 6.3**

  - [ ]* 7.2 Escrever testes unitários para `app.js` (`refreshRagPill`)
    - Sufixo `"+ rerank"` aparece quando `enabled=true` e `rerankModel` definido
    - Sufixo `"+ rerank ⚠"` aparece quando `_rerankApplied=false` com reranking habilitado
    - _Requisitos: 6.1, 6.2_

- [ ] 8. Checkpoint final — Garantir que todos os testes passam
  - Rodar `npm test` e garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia requisitos específicos para rastreabilidade
- Os testes de propriedade usam `fast-check` com o padrão `runProperty` já estabelecido em `tests/feature-improvements.test.js`
- O contrato de retorno de `manager.retrieve()` muda de `Array` para `{ chunks: Array, _rerankApplied: boolean }` — a tarefa 7 depende da tarefa 4 estar completa
- Mocks do fetch/cross-encoder são necessários nos testes de propriedade para evitar dependência do LM Studio
- Zero deps no client: `reranker.js` usa apenas `fetch` nativo
