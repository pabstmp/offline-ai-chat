/* Conversation search engine — inverted index in memory.
   Pure functions for indexing and querying. No DOM side-effects. */

/**
 * Tokenize text for indexing: lowercase, split on non-alphanumeric, filter short tokens.
 */
export function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9\u00e0-\u00ff]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Build an inverted index from an array of conversations.
 * Returns Map<token, Set<conversationId>>.
 */
export function buildIndex(conversations) {
  const index = new Map();
  for (const conv of conversations) {
    const id = conv.id;
    const text = [
      conv.title || "",
      ...(conv.messages || []).map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) return m.content.filter((p) => p.type === "text").map((p) => p.text || "").join(" ");
        return "";
      }),
    ].join(" ");
    const tokens = tokenize(text);
    for (const token of tokens) {
      if (!index.has(token)) index.set(token, new Set());
      index.get(token).add(id);
    }
  }
  return index;
}

/**
 * Search conversations using the inverted index.
 * Returns array of conversation IDs sorted by relevance (token match count).
 */
export function searchIndex(index, query, allConversationIds) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [...allConversationIds];

  // Count matches per conversation
  const scores = new Map();
  for (const token of queryTokens) {
    const matches = index.get(token);
    if (!matches) continue;
    for (const id of matches) {
      scores.set(id, (scores.get(id) || 0) + 1);
    }
  }

  // Sort by score desc
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/**
 * Find snippet matches within message content for highlighting.
 * Returns array of { messageIndex, snippets: [{ start, end, text }] }.
 */
export function findSnippets(conversation, query, maxSnippets = 3) {
  if (!conversation?.messages?.length || !query) return [];
  const queryLower = query.toLowerCase();
  const results = [];

  for (let i = 0; i < conversation.messages.length && results.length < maxSnippets; i++) {
    const msg = conversation.messages[i];
    const content = typeof msg.content === "string" ? msg.content
      : Array.isArray(msg.content) ? msg.content.filter((p) => p.type === "text").map((p) => p.text || "").join("\n")
      : "";

    const idx = content.toLowerCase().indexOf(queryLower);
    if (idx < 0) continue;

    // Extract context around the match
    const contextStart = Math.max(0, idx - 40);
    const contextEnd = Math.min(content.length, idx + queryLower.length + 40);
    let snippet = content.slice(contextStart, contextEnd).replace(/\n/g, " ");
    if (contextStart > 0) snippet = "…" + snippet;
    if (contextEnd < content.length) snippet += "…";

    results.push({
      messageIndex: i,
      role: msg.role,
      snippet,
      matchStart: idx - contextStart + (contextStart > 0 ? 1 : 0),
      matchLength: queryLower.length,
    });
  }

  return results;
}

/**
 * Incrementally update index when a conversation is added or updated.
 */
export function updateIndex(index, conversation) {
  // Remove old entries for this conversation
  removeFromIndex(index, conversation.id);

  // Re-add
  const text = [
    conversation.title || "",
    ...(conversation.messages || []).map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) return m.content.filter((p) => p.type === "text").map((p) => p.text || "").join(" ");
      return "";
    }),
  ].join(" ");

  const tokens = tokenize(text);
  for (const token of tokens) {
    if (!index.has(token)) index.set(token, new Set());
    index.get(token).add(conversation.id);
  }
}

/**
 * Remove a conversation from the index.
 */
export function removeFromIndex(index, conversationId) {
  for (const [, ids] of index) {
    ids.delete(conversationId);
  }
}
