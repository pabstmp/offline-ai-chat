/* Pure helper functions extracted from app.js for testability.
   These functions have no DOM or browser dependencies. */

// R6 — RAG Indicator
// Determines if the RAG indexing indicator should be visible given the event kind
export function ragIndicatorShouldShow(eventKind) {
  return eventKind === "started" || eventKind === "progress";
}

// R7 — Server Dropdown
// Determines if the server dropdown should be shown (requires multiple servers)
export function shouldShowServerDropdown(servers) {
  return Array.isArray(servers) && servers.length > 1;
}

// Calculates the next server index with wrap-around
// direction: 1 (ArrowDown) or -1 (ArrowUp)
export function nextServerIndex(currentIndex, total, direction) {
  return (currentIndex + direction + total) % total;
}

// R8 — Scroll Persistence
// Determines if the chat should auto-scroll based on distance to bottom
export function shouldAutoScroll(scrollHeight, scrollTop, clientHeight, threshold = 64) {
  return (scrollHeight - scrollTop - clientHeight) <= threshold;
}

// Returns the stored scroll position for a conversation, or null if not cached
export function getScrollPosition(cache, conversationId) {
  return cache.has(conversationId) ? cache.get(conversationId) : null;
}
