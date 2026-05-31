/* Comparison helpers — pure functions for model comparison logic. */

/**
 * Constrói os dois payloads de completion para a sessão de comparação.
 * Ambos os payloads compartilham o mesmo systemPrompt, sampling e histórico de mensagens.
 *
 * @param {object} opts
 * @param {string} opts.prompt          - texto do usuário
 * @param {string} opts.modelA          - modelo do painel esquerdo
 * @param {string} opts.modelB          - modelo do painel direito
 * @param {object} opts.profile         - perfil ativo { systemPrompt, sampling }
 * @param {object} opts.samplingOverride - parâmetros de sampling já processados
 * @returns {{ payloadA: object, payloadB: object }}
 */
export function buildComparisonPayloads({ prompt, modelA, modelB, profile, samplingOverride }) {
  const common = {
    messages: [
      { role: "system", content: profile.systemPrompt || "" },
      { role: "user", content: prompt },
    ],
    ...samplingOverride,
    stream: true,
  };

  return {
    payloadA: { ...common, model: modelA },
    payloadB: { ...common, model: modelB },
  };
}

/**
 * Agrupa uma lista plana de model IDs por servidor.
 *
 * @param {string[]} models             - lista de model IDs
 * @param {object[]} servers            - lista de servidores { id, nickname, baseUrl }
 * @param {Map<string, string>} modelToServerId - mapeamento modelId → serverId
 * @returns {Array<{ serverId: string, serverNickname: string, models: string[] }>}
 */
export function groupModelsByServer(models, servers, modelToServerId) {
  if (!models || !models.length) return [];

  const groups = new Map();

  for (const m of models) {
    const mId = typeof m === "string" ? m : m.id;
    const sId = modelToServerId.get(mId);
    const server = servers.find((s) => s.id === sId) || servers[0];
    const sKey = server ? server.id : "unknown";

    if (!groups.has(sKey)) {
      groups.set(sKey, {
        serverId: sKey,
        serverNickname: server ? server.nickname : "Desconhecido",
        models: [],
      });
    }
    groups.get(sKey).models.push(m);
  }

  return Array.from(groups.values());
}

/**
 * Resolve qual servidor deve ser usado para um dado modelo.
 *
 * @param {string} modelId
 * @param {object[]} servers
 * @param {Map<string, string>} modelToServerId
 * @returns {object | null} servidor encontrado ou null
 */
export function resolveServerForModel(modelId, servers, modelToServerId) {
  const sId = modelToServerId.get(modelId);
  if (!sId) return servers[0] || null;
  return servers.find((s) => s.id === sId) || servers[0] || null;
}

/**
 * Constrói um objeto Conversation a partir do resultado de uma sessão de comparação.
 *
 * @param {object} opts
 * @param {string} opts.prompt          - prompt enviado pelo usuário
 * @param {string} opts.response        - resposta do painel selecionado
 * @param {string} opts.model           - modelo do painel selecionado
 * @param {string} opts.profileId       - ID do perfil ativo
 * @param {string} opts.serverId        - ID do servidor do painel selecionado
 * @returns {object}
 */
export function buildConversationFromComparison({ prompt, response, model, profileId, serverId }) {
  const ts = Date.now();
  return {
    id: `conv-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    title: prompt.slice(0, 40).trim() || "(comparação)",
    profileId,
    serverId,
    model,
    createdAt: ts,
    updatedAt: ts,
    messages: [
      { role: "user", content: prompt, ts, id: `m-${ts}-u` },
      { role: "assistant", content: response, ts: ts + 1, id: `m-${ts}-a` },
    ],
  };
}
