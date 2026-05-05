/* Pure helper functions from chat.js — no DOM dependencies, importable by Node.js */

// Returns the prefix of messages up to and including the message with the given id
export function forkMessagesAt(messages, messageId) {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return [...messages];
  return messages.slice(0, idx + 1);
}

// Creates a new fork conversation object without mutating the source
export function createFork(sourceConv, messages) {
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `${sourceConv.title || "(sem título)"} (fork)`,
    profileId: sourceConv.profileId,
    serverId: sourceConv.serverId,
    model: sourceConv.model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: messages.map((m) => ({ ...m })),
  };
}

// Returns all profiles except the active one
export function getAlternativeProfiles(profiles, activeProfileId) {
  return profiles.filter((p) => p.id !== activeProfileId);
}

// Replaces the content of a message by id without mutating the original array
export function replaceMessageContent(messages, messageId, newContent) {
  return messages.map((m) =>
    m.id === messageId ? { ...m, content: newContent } : m
  );
}

// Determines body overflow for modal state
export function getBodyOverflowForModal(isOpen, previousOverflow = "") {
  return isOpen ? "hidden" : previousOverflow;
}
