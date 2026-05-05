/* Templates — pure functions and storage for conversation templates. */

const TEMPLATES_KEY = "offline-ai-chat:templates:v1";

/* ---------- pure functions (exported for testing) ---------- */

// Creates a Template object from a conversation
export function createTemplate(conv, name, systemPrompt) {
  return {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    systemPrompt,
    messages: (conv.messages || []).map((m) => ({ ...m })),
    createdAt: Date.now(),
  };
}

// Initializes a new conversation from a template
export function initConversationFromTemplate(template, baseConv) {
  return {
    ...baseConv,
    messages: (template.messages || []).map((m) => ({ ...m })),
    _templateSystemPrompt: template.systemPrompt,
  };
}

// Removes a template from the array by id (pure, returns new array)
export function removeTemplate(templates, id) {
  return templates.filter((t) => t.id !== id);
}

/* ---------- storage ---------- */

export const templateStore = {
  list() {
    try {
      return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]");
    } catch {
      return [];
    }
  },
  save(templates) {
    try {
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
    } catch (e) {
      console.warn("templateStore.save failed:", e);
    }
  },
};
