/**
 * Feature Improvements — Test Suite
 * Run: node tests/feature-improvements.test.js
 * Uses fast-check for property-based tests + plain assert for examples.
 */

import fc from "fast-check";

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

function runProperty(label, prop, opts = {}) {
  try {
    fc.assert(prop, { numRuns: 100, ...opts });
    console.log(`  ✓ [PBT] ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [PBT] ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── imports ───────────────────────────────────────────────────────────────────

import {
  backupFilename,
  mergeConversations,
  validateBackupFile,
} from "../modules/ui/settings/behavior.js";

import {
  forkMessagesAt,
  createFork,
  getAlternativeProfiles,
  replaceMessageContent,
  getBodyOverflowForModal,
} from "../modules/ui/chat-helpers.js";

import {
  validateImageSize,
  buildImageMessageContent,
} from "../modules/ui/composer-helpers.js";

import {
  createTemplate,
  initConversationFromTemplate,
  removeTemplate,
} from "../modules/templates.js";

import {
  ragIndicatorShouldShow,
  shouldShowServerDropdown,
  nextServerIndex,
  shouldAutoScroll,
  getScrollPosition,
} from "../modules/app-helpers.js";
import {
  buildComparisonPayloads,
  groupModelsByServer,
  resolveServerForModel,
  buildConversationFromComparison,
} from "../modules/ui/comparison-helpers.js";

import {
  extractDelta,
  extractAssistantContent,
  extractReasoningContent,
  extractToolCalls,
  extractFinishReason,
} from "../modules/api.js";

import {
  mergeMissing,
} from "../modules/schema.js";

import {
  intentFromRegex,
  makeStrategy,
} from "../modules/rag/strategy.js";

// ═════════════════════════════════════════════════════════════════════════════
// R1 — Backup
// ═════════════════════════════════════════════════════════════════════════════

section("R1 — Backup: backupFilename");

// Property 1: Backup filename matches date pattern
// Feature: feature-improvements, Property 1: backup filename matches date pattern
runProperty(
  "Property 1: backup filename matches date pattern",
  fc.property(fc.date({ min: new Date("2000-01-01"), max: new Date("2099-12-31") }), (date) => {
    // Skip NaN dates (edge case in some fast-check versions)
    if (isNaN(date.getTime())) return true;
    const name = backupFilename(date);
    if (!/^offline-ai-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name)) return false;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return name === `offline-ai-backup-${y}-${m}-${d}.json`;
  })
);

// Example tests
assert(backupFilename(new Date(2024, 0, 5)) === "offline-ai-backup-2024-01-05.json", "backupFilename pads month and day");
assert(backupFilename(new Date(2024, 11, 31)) === "offline-ai-backup-2024-12-31.json", "backupFilename handles Dec 31");

section("R1 — Backup: mergeConversations");

// Property 2: Conversation merge preserves existing and adds only absent
// Feature: feature-improvements, Property 2: conversation merge preserves existing and adds only absent
runProperty(
  "Property 2: conversation merge preserves existing and adds only absent",
  fc.property(
    fc.array(fc.record({ id: fc.string({ minLength: 1 }), title: fc.string() }), { minLength: 0, maxLength: 10 }),
    fc.array(fc.record({ id: fc.string({ minLength: 1 }), title: fc.string() }), { minLength: 0, maxLength: 10 }),
    (existing, imported) => {
      const { merged, added, skipped } = mergeConversations(existing, imported);
      // All existing are present
      const existingIds = new Set(existing.map((c) => c.id));
      const mergedIds = new Set(merged.map((c) => c.id));
      for (const id of existingIds) {
        if (!mergedIds.has(id)) return false;
      }
      // Only absent imported are added
      const importedAbsent = imported.filter((c) => !existingIds.has(c.id));
      if (added !== importedAbsent.length) return false;
      // added + skipped === imported.length
      if (added + skipped !== imported.length) return false;
      return true;
    }
  )
);

assert(mergeConversations([], []).merged.length === 0, "merge of empty arrays is empty");
assert(mergeConversations([{ id: "a" }], [{ id: "a" }]).added === 0, "duplicate id not added");
assert(mergeConversations([{ id: "a" }], [{ id: "b" }]).added === 1, "new id is added");
assert(mergeConversations([{ id: "a" }], [{ id: "a" }, { id: "b" }]).skipped === 1, "skipped count correct");

section("R1 — Backup: validateBackupFile");

// Property 3: Backup validation rejects non-arrays and arrays without id
// Feature: feature-improvements, Property 3: backup validation rejects non-arrays and arrays without id
runProperty(
  "Property 3: backup validation rejects non-arrays and arrays without id",
  fc.property(
    fc.oneof(
      fc.integer(),
      fc.string(),
      fc.boolean(),
      fc.constant(null),
      fc.record({ foo: fc.string() }),
    ),
    (nonArray) => {
      const result = validateBackupFile(nonArray);
      return result.valid === false;
    }
  )
);

assert(validateBackupFile([]).valid === true, "empty array is valid");
assert(validateBackupFile([{ id: "abc" }]).valid === true, "array with id is valid");
assert(validateBackupFile([{ noId: true }]).valid === false, "array without id is invalid");
assert(validateBackupFile("not an array").valid === false, "string is invalid");
assert(validateBackupFile(null).valid === false, "null is invalid");
assert(validateBackupFile(42).valid === false, "number is invalid");

// ═════════════════════════════════════════════════════════════════════════════
// R2 — Fork de Conversa
// ═════════════════════════════════════════════════════════════════════════════

section("R2 — Fork: forkMessagesAt");

// Property 4: Fork slice is a prefix ending at the target message
// Feature: feature-improvements, Property 4: fork slice is a prefix ending at the target message
runProperty(
  "Property 4: fork slice is a prefix ending at the target message",
  fc.property(
    fc.array(
      fc.record({ id: fc.string({ minLength: 1 }), role: fc.constantFrom("user", "assistant"), content: fc.string() }),
      { minLength: 1, maxLength: 20 }
    ).filter((msgs) => new Set(msgs.map((m) => m.id)).size === msgs.length), // unique ids
    (messages) => {
      const idx = Math.floor(Math.random() * messages.length);
      const targetId = messages[idx].id;
      const result = forkMessagesAt(messages, targetId);
      if (result.length !== idx + 1) return false;
      if (result[result.length - 1].id !== targetId) return false;
      // Is a prefix
      for (let i = 0; i < result.length; i++) {
        if (result[i].id !== messages[i].id) return false;
      }
      return true;
    }
  )
);

const msgs = [
  { id: "m1", role: "user", content: "hello" },
  { id: "m2", role: "assistant", content: "hi" },
  { id: "m3", role: "user", content: "bye" },
];
assert(forkMessagesAt(msgs, "m2").length === 2, "forkMessagesAt returns prefix up to target");
assert(forkMessagesAt(msgs, "m1").length === 1, "forkMessagesAt at first message returns 1");
assert(forkMessagesAt(msgs, "m3").length === 3, "forkMessagesAt at last message returns all");
assert(forkMessagesAt(msgs, "nonexistent").length === 3, "forkMessagesAt with unknown id returns all");

section("R2 — Fork: createFork");

// Property 5: Fork creation produces correct metadata and does not mutate source
// Feature: feature-improvements, Property 5: fork creation produces correct metadata and does not mutate source
runProperty(
  "Property 5: fork creation produces correct metadata and does not mutate source",
  fc.property(
    fc.record({
      id: fc.string({ minLength: 1 }),
      title: fc.string(),
      profileId: fc.string(),
      serverId: fc.string(),
      model: fc.string(),
      messages: fc.array(fc.record({ id: fc.string(), role: fc.string(), content: fc.string() })),
    }),
    fc.array(fc.record({ id: fc.string(), role: fc.string(), content: fc.string() })),
    (sourceConv, messages) => {
      const sourceCopy = JSON.parse(JSON.stringify(sourceConv));
      const fork = createFork(sourceConv, messages);
      if (fork.id === sourceConv.id) return false;
      if (!fork.title.endsWith(" (fork)")) return false;
      if (fork.profileId !== sourceConv.profileId) return false;
      if (fork.serverId !== sourceConv.serverId) return false;
      if (fork.model !== sourceConv.model) return false;
      // Source not mutated
      if (JSON.stringify(sourceConv) !== JSON.stringify(sourceCopy)) return false;
      return true;
    }
  )
);

const sourceConv = { id: "c1", title: "Test", profileId: "p1", serverId: "s1", model: "m1", messages: [] };
const fork = createFork(sourceConv, msgs);
assert(fork.id !== sourceConv.id, "fork has different id");
assert(fork.title === "Test (fork)", "fork title has (fork) suffix");
assert(fork.profileId === "p1", "fork preserves profileId");
assert(fork.messages.length === 3, "fork has correct messages");
assert(fork.messages !== msgs, "fork messages are a copy");

// ═════════════════════════════════════════════════════════════════════════════
// R3 — Comparação A/B
// ═════════════════════════════════════════════════════════════════════════════

section("R3 — A/B: getAlternativeProfiles");

// Property 6: Alternative profiles excludes the active profile
// Feature: feature-improvements, Property 6: alternative profiles excludes the active profile
runProperty(
  "Property 6: alternative profiles excludes the active profile",
  fc.property(
    fc.array(fc.record({ id: fc.string({ minLength: 1 }), name: fc.string() }), { minLength: 0, maxLength: 10 }),
    fc.string({ minLength: 1 }),
    (profiles, activeId) => {
      const result = getAlternativeProfiles(profiles, activeId);
      // No active profile in result
      if (result.some((p) => p.id === activeId)) return false;
      // All non-active profiles are present
      const nonActive = profiles.filter((p) => p.id !== activeId);
      if (result.length !== nonActive.length) return false;
      return true;
    }
  )
);

const profiles = [{ id: "p1", name: "A" }, { id: "p2", name: "B" }, { id: "p3", name: "C" }];
assert(getAlternativeProfiles(profiles, "p1").length === 2, "excludes active profile");
assert(!getAlternativeProfiles(profiles, "p1").some((p) => p.id === "p1"), "active profile not in result");
assert(getAlternativeProfiles(profiles, "nonexistent").length === 3, "all profiles returned when active not found");

section("R3 — A/B: replaceMessageContent");

// Property 7: Message replacement updates only the target message
// Feature: feature-improvements, Property 7: message replacement updates only the target message
runProperty(
  "Property 7: message replacement updates only the target message",
  fc.property(
    fc.array(
      fc.record({ id: fc.string({ minLength: 1 }), role: fc.string(), content: fc.string() }),
      { minLength: 1, maxLength: 20 }
    ).filter((msgs) => new Set(msgs.map((m) => m.id)).size === msgs.length),
    fc.string(),
    (messages, newContent) => {
      const targetIdx = Math.floor(Math.random() * messages.length);
      const targetId = messages[targetIdx].id;
      const result = replaceMessageContent(messages, targetId, newContent);
      if (result.length !== messages.length) return false;
      if (result[targetIdx].content !== newContent) return false;
      // All other messages unchanged
      for (let i = 0; i < messages.length; i++) {
        if (i === targetIdx) continue;
        if (result[i].content !== messages[i].content) return false;
        if (result[i].id !== messages[i].id) return false;
      }
      return true;
    }
  )
);

const abMsgs = [
  { id: "m1", role: "user", content: "hello" },
  { id: "m2", role: "assistant", content: "original" },
];
const replaced = replaceMessageContent(abMsgs, "m2", "new content");
assert(replaced[1].content === "new content", "target message content updated");
assert(replaced[0].content === "hello", "other messages unchanged");
assert(replaced.length === 2, "array length preserved");
assert(abMsgs[1].content === "original", "original array not mutated");

// ═════════════════════════════════════════════════════════════════════════════
// R4 — Imagens
// ═════════════════════════════════════════════════════════════════════════════

section("R4 — Images: buildImageMessageContent");

// Property 8: Image message content is a valid OpenAI-compatible array
// Feature: feature-improvements, Property 8: image message content is a valid OpenAI-compatible array
runProperty(
  "Property 8: image message content is a valid OpenAI-compatible array",
  fc.property(
    fc.string({ minLength: 1 }),
    fc.string({ minLength: 1 }),
    fc.constantFrom("image/png", "image/jpeg", "image/gif", "image/webp"),
    (text, base64Data, mimeType) => {
      const result = buildImageMessageContent(text, base64Data, mimeType);
      if (!Array.isArray(result) || result.length !== 2) return false;
      if (result[0].type !== "text" || result[0].text !== text) return false;
      if (result[1].type !== "image_url") return false;
      if (result[1].image_url.url !== `data:${mimeType};base64,${base64Data}`) return false;
      return true;
    }
  )
);

const imgContent = buildImageMessageContent("hello", "abc123", "image/png");
assert(imgContent.length === 2, "image content has 2 elements");
assert(imgContent[0].type === "text", "first element is text");
assert(imgContent[1].type === "image_url", "second element is image_url");
assert(imgContent[1].image_url.url === "data:image/png;base64,abc123", "image url is correct");

section("R4 — Images: validateImageSize");

// Property 9: Image size validation enforces 10 MB limit
// Feature: feature-improvements, Property 9: image size validation enforces 10 MB limit
runProperty(
  "Property 9: image size validation enforces 10 MB limit",
  fc.property(
    fc.integer({ min: 0, max: 20 * 1024 * 1024 }),
    (sizeBytes) => {
      const limit = 10 * 1024 * 1024;
      const result = validateImageSize(sizeBytes);
      return result === (sizeBytes <= limit);
    }
  )
);

assert(validateImageSize(0) === true, "0 bytes is valid");
assert(validateImageSize(10 * 1024 * 1024) === true, "exactly 10MB is valid");
assert(validateImageSize(10 * 1024 * 1024 + 1) === false, "10MB + 1 byte is invalid");
assert(validateImageSize(5 * 1024 * 1024) === true, "5MB is valid");

// ═════════════════════════════════════════════════════════════════════════════
// R5 — Templates
// ═════════════════════════════════════════════════════════════════════════════

section("R5 — Templates: createTemplate");

// Property 10: Template creation captures conversation data correctly
// Feature: feature-improvements, Property 10: template creation captures conversation data correctly
runProperty(
  "Property 10: template creation captures conversation data correctly",
  fc.property(
    fc.record({
      id: fc.string({ minLength: 1 }),
      title: fc.string(),
      messages: fc.array(fc.record({ id: fc.string(), role: fc.string(), content: fc.string() })),
    }),
    fc.string({ minLength: 1 }),
    fc.string(),
    (conv, name, systemPrompt) => {
      const tpl = createTemplate(conv, name, systemPrompt);
      if (tpl.name !== name) return false;
      if (tpl.systemPrompt !== systemPrompt) return false;
      if (typeof tpl.id !== "string" || tpl.id.length === 0) return false;
      // messages is a deep copy
      if (JSON.stringify(tpl.messages) !== JSON.stringify(conv.messages)) return false;
      if (tpl.messages === conv.messages) return false; // not same reference
      return true;
    }
  )
);

const tplConv = { id: "c1", title: "Test", messages: [{ id: "m1", role: "user", content: "hi" }] };
const tpl = createTemplate(tplConv, "My Template", "You are helpful");
assert(tpl.name === "My Template", "template name is correct");
assert(tpl.systemPrompt === "You are helpful", "template systemPrompt is correct");
assert(typeof tpl.id === "string" && tpl.id.length > 0, "template has id");
assert(tpl.messages.length === 1, "template has messages");
assert(tpl.messages !== tplConv.messages, "template messages are a copy");

section("R5 — Templates: initConversationFromTemplate");

// Property 11: Conversation initialized from template has correct messages and system prompt
// Feature: feature-improvements, Property 11: conversation initialized from template has correct messages and system prompt
runProperty(
  "Property 11: conversation initialized from template has correct messages and system prompt",
  fc.property(
    fc.record({
      id: fc.string({ minLength: 1 }),
      name: fc.string(),
      systemPrompt: fc.string(),
      messages: fc.array(fc.record({ id: fc.string(), role: fc.string(), content: fc.string() })),
    }),
    fc.record({
      id: fc.string({ minLength: 1 }),
      title: fc.string(),
      profileId: fc.string(),
    }),
    (template, baseConv) => {
      const result = initConversationFromTemplate(template, baseConv);
      if (JSON.stringify(result.messages) !== JSON.stringify(template.messages)) return false;
      if (result._templateSystemPrompt !== template.systemPrompt) return false;
      return true;
    }
  )
);

const template = { id: "t1", name: "T", systemPrompt: "Be helpful", messages: [{ id: "m1", role: "user", content: "hi" }] };
const baseConv = { id: "c2", title: "New", profileId: "p1" };
const fromTpl = initConversationFromTemplate(template, baseConv);
assert(fromTpl.messages.length === 1, "conversation has template messages");
assert(fromTpl._templateSystemPrompt === "Be helpful", "conversation has template system prompt");
assert(fromTpl.id === "c2", "base conversation properties preserved");

section("R5 — Templates: removeTemplate");

// Property 12: Template removal eliminates exactly the target template
// Feature: feature-improvements, Property 12: template removal eliminates exactly the target template
runProperty(
  "Property 12: template removal eliminates exactly the target template",
  fc.property(
    fc.array(
      fc.record({ id: fc.string({ minLength: 1 }), name: fc.string() }),
      { minLength: 1, maxLength: 10 }
    ).filter((tpls) => new Set(tpls.map((t) => t.id)).size === tpls.length),
    (templates) => {
      const idx = Math.floor(Math.random() * templates.length);
      const targetId = templates[idx].id;
      const result = removeTemplate(templates, targetId);
      if (result.length !== templates.length - 1) return false;
      if (result.some((t) => t.id === targetId)) return false;
      // All other templates present
      const remaining = templates.filter((t) => t.id !== targetId);
      for (const t of remaining) {
        if (!result.some((r) => r.id === t.id)) return false;
      }
      return true;
    }
  )
);

const templates = [{ id: "t1", name: "A" }, { id: "t2", name: "B" }, { id: "t3", name: "C" }];
assert(removeTemplate(templates, "t2").length === 2, "removes exactly one template");
assert(!removeTemplate(templates, "t2").some((t) => t.id === "t2"), "target template removed");
assert(removeTemplate(templates, "nonexistent").length === 3, "no change when id not found");

// ═════════════════════════════════════════════════════════════════════════════
// R6 — RAG Indicator
// ═════════════════════════════════════════════════════════════════════════════

section("R6 — RAG Indicator: ragIndicatorShouldShow");

// Property 13: RAG indicator visibility follows event kind
// Feature: feature-improvements, Property 13: RAG indicator visibility follows event kind
runProperty(
  "Property 13: RAG indicator visibility follows event kind",
  fc.property(
    fc.string(),
    (eventKind) => {
      const result = ragIndicatorShouldShow(eventKind);
      const shouldBeTrue = eventKind === "started" || eventKind === "progress";
      return result === shouldBeTrue;
    }
  )
);

assert(ragIndicatorShouldShow("started") === true, "started shows indicator");
assert(ragIndicatorShouldShow("progress") === true, "progress shows indicator");
assert(ragIndicatorShouldShow("done") === false, "done hides indicator");
assert(ragIndicatorShouldShow("error") === false, "error hides indicator");
assert(ragIndicatorShouldShow("cleared") === false, "cleared hides indicator");
assert(ragIndicatorShouldShow("") === false, "empty string hides indicator");

// ═════════════════════════════════════════════════════════════════════════════
// R7 — Server Dropdown
// ═════════════════════════════════════════════════════════════════════════════

section("R7 — Server Dropdown: shouldShowServerDropdown & nextServerIndex");

// Property 14: Server dropdown navigation wraps correctly and shows only for multiple servers
// Feature: feature-improvements, Property 14: server dropdown navigation wraps correctly and shows only for multiple servers
runProperty(
  "Property 14: server dropdown navigation wraps correctly and shows only for multiple servers",
  fc.property(
    fc.array(fc.record({ id: fc.string(), nickname: fc.string() }), { minLength: 0, maxLength: 10 }),
    (servers) => {
      const show = shouldShowServerDropdown(servers);
      if (show !== (servers.length > 1)) return false;
      return true;
    }
  )
);

runProperty(
  "Property 14b: nextServerIndex wraps correctly",
  fc.property(
    fc.integer({ min: 1, max: 20 }),
    fc.integer({ min: 0, max: 19 }),
    (total, current) => {
      const idx = current % total;
      const down = nextServerIndex(idx, total, 1);
      const up = nextServerIndex(idx, total, -1);
      if (down !== (idx + 1) % total) return false;
      if (up !== (idx - 1 + total) % total) return false;
      return true;
    }
  )
);

assert(shouldShowServerDropdown([]) === false, "empty array: no dropdown");
assert(shouldShowServerDropdown([{ id: "s1" }]) === false, "single server: no dropdown");
assert(shouldShowServerDropdown([{ id: "s1" }, { id: "s2" }]) === true, "two servers: show dropdown");
assert(nextServerIndex(0, 3, 1) === 1, "next from 0 is 1");
assert(nextServerIndex(2, 3, 1) === 0, "next from last wraps to 0");
assert(nextServerIndex(0, 3, -1) === 2, "prev from 0 wraps to last");
assert(nextServerIndex(1, 3, -1) === 0, "prev from 1 is 0");

// ═════════════════════════════════════════════════════════════════════════════
// R8 — Scroll Persistence
// ═════════════════════════════════════════════════════════════════════════════

section("R8 — Scroll: getScrollPosition & shouldAutoScroll");

// Property 15: Scroll position cache returns stored value or null
// Feature: feature-improvements, Property 15: scroll position cache returns stored value or null
runProperty(
  "Property 15: scroll position cache returns stored value or null",
  fc.property(
    fc.array(fc.tuple(fc.string({ minLength: 1 }), fc.integer({ min: 0 })), { minLength: 0, maxLength: 10 }),
    fc.string({ minLength: 1 }),
    (entries, queryId) => {
      const cache = new Map(entries);
      const result = getScrollPosition(cache, queryId);
      if (cache.has(queryId)) {
        return result === cache.get(queryId);
      } else {
        return result === null;
      }
    }
  )
);

// Property 16: Auto-scroll decision is based on distance to bottom
// Feature: feature-improvements, Property 16: auto-scroll decision is based on distance to bottom
runProperty(
  "Property 16: auto-scroll decision is based on distance to bottom",
  fc.property(
    fc.integer({ min: 0, max: 10000 }),
    fc.integer({ min: 0, max: 10000 }),
    fc.integer({ min: 0, max: 10000 }),
    (scrollHeight, scrollTop, clientHeight) => {
      const result = shouldAutoScroll(scrollHeight, scrollTop, clientHeight);
      const distance = scrollHeight - scrollTop - clientHeight;
      return result === (distance <= 64);
    }
  )
);

const scrollCache = new Map([["conv-1", 500], ["conv-2", 0]]);
assert(getScrollPosition(scrollCache, "conv-1") === 500, "returns stored scroll position");
assert(getScrollPosition(scrollCache, "conv-2") === 0, "returns 0 scroll position");
assert(getScrollPosition(scrollCache, "conv-3") === null, "returns null for unknown id");

assert(shouldAutoScroll(1000, 900, 36) === true, "should auto-scroll when near bottom (distance=64)");
assert(shouldAutoScroll(1000, 899, 36) === false, "should not auto-scroll when distance=65");
assert(shouldAutoScroll(1000, 1000, 0) === true, "should auto-scroll at exact bottom");

// ═════════════════════════════════════════════════════════════════════════════
// R9 — Focus Modal
// ═════════════════════════════════════════════════════════════════════════════

section("R9 — Focus Modal: getBodyOverflowForModal");

// Property 17: Body overflow is hidden when modal is open and restored when closed
// Feature: feature-improvements, Property 17: body overflow is hidden when modal is open and restored when closed
runProperty(
  "Property 17: body overflow is hidden when modal is open and restored when closed",
  fc.property(
    fc.string(),
    (previousOverflow) => {
      const whenOpen = getBodyOverflowForModal(true, previousOverflow);
      const whenClosed = getBodyOverflowForModal(false, previousOverflow);
      return whenOpen === "hidden" && whenClosed === previousOverflow;
    }
  )
);

assert(getBodyOverflowForModal(true, "") === "hidden", "open: overflow is hidden");
assert(getBodyOverflowForModal(true, "auto") === "hidden", "open: overrides previous overflow");
assert(getBodyOverflowForModal(false, "") === "", "closed: restores empty overflow");
assert(getBodyOverflowForModal(false, "auto") === "auto", "closed: restores auto overflow");
assert(getBodyOverflowForModal(false, "scroll") === "scroll", "closed: restores scroll overflow");

// ═════════════════════════════════════════════════════════════════════════════
// R10 — Model Comparison
// ═════════════════════════════════════════════════════════════════════════════

section("R10 — Comparison: buildComparisonPayloads");

runProperty(
  "Property 18: payloads share content and differ only in model",
  fc.property(
    fc.record({
      prompt: fc.string(),
      modelA: fc.string(),
      modelB: fc.string(),
      profile: fc.record({ systemPrompt: fc.string() }),
      samplingOverride: fc.record({ temperature: fc.float(), max_tokens: fc.integer() }),
    }),
    (opts) => {
      const { payloadA, payloadB } = buildComparisonPayloads(opts);
      if (JSON.stringify(payloadA.messages) !== JSON.stringify(payloadB.messages)) return false;
      if (payloadA.model !== opts.modelA || payloadB.model !== opts.modelB) return false;
      const tempA = payloadA.temperature;
      const expectedTemp = opts.samplingOverride.temperature;
      if (Number.isNaN(tempA) && Number.isNaN(expectedTemp)) {
        // both NaN, matches
      } else if (tempA !== expectedTemp) {
        return false;
      }
      return true;
    }
  )
);

section("R10 — Comparison: groupModelsByServer");

runProperty(
  "Property 19: model grouping is complete and correct",
  fc.property(
    fc.array(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 20 }),
    fc.array(fc.record({ id: fc.string({ minLength: 1 }), nickname: fc.string() }), { minLength: 1, maxLength: 5 }),
    (models, servers) => {
      const mapping = new Map();
      models.forEach(m => mapping.set(m, servers[Math.floor(Math.random() * servers.length)].id));
      
      const groups = groupModelsByServer(models, servers, mapping);
      const groupedModels = groups.flatMap(g => g.models);
      
      // All models accounted for
      if (groupedModels.length !== models.length) return false;
      // No extra models
      for (const m of groupedModels) if (!models.includes(m)) return false;
      return true;
    }
  )
);

section("R10 — Comparison: resolveServerForModel");

runProperty(
  "Property 20: server resolution is deterministic and matches mapping",
  fc.property(
    fc.string({ minLength: 1 }),
    fc.array(fc.record({ id: fc.string({ minLength: 1 }), nickname: fc.string() }), { minLength: 1, maxLength: 5 }),
    (modelId, servers) => {
      const mapping = new Map([[modelId, servers[0].id]]);
      const res1 = resolveServerForModel(modelId, servers, mapping);
      const res2 = resolveServerForModel(modelId, servers, mapping);
      return res1 === res2 && res1.id === servers[0].id;
    }
  )
);

section("R10 — Comparison: buildConversationFromComparison");

runProperty(
  "Property 21: created conversation has correct structure",
  fc.property(
    fc.record({
      prompt: fc.string(),
      response: fc.string(),
      model: fc.string(),
      profileId: fc.string(),
      serverId: fc.string(),
    }),
    (opts) => {
      const conv = buildConversationFromComparison(opts);
      if (conv.messages.length !== 2) return false;
      if (conv.messages[0].role !== "user" || conv.messages[0].content !== opts.prompt) return false;
      if (conv.messages[1].role !== "assistant" || conv.messages[1].content !== opts.response) return false;
      if (conv.model !== opts.model) return false;
      return true;
    }
  )
);

// ═════════════════════════════════════════════════════════════════════════════
// R-Review — api.js extractDelta robustness (CODE_REVIEW nit)
// ═════════════════════════════════════════════════════════════════════════════

section("R-Review — api.js: extractDelta tolera chunks malformados");

// Estes não devem lançar, e devem retornar shape { content, reasoning } com strings.
assert(
  (() => { const d = extractDelta({}); return d.content === "" && d.reasoning === ""; })(),
  "extractDelta({}) retorna strings vazias"
);
assert(
  (() => { const d = extractDelta(null); return d.content === "" && d.reasoning === ""; })(),
  "extractDelta(null) retorna strings vazias sem throw"
);
assert(
  (() => { const d = extractDelta({ choices: [] }); return d.content === "" && d.reasoning === ""; })(),
  "extractDelta com choices vazio"
);
assert(
  (() => { const d = extractDelta({ choices: [{ delta: null }] }); return d.content === "" && d.reasoning === ""; })(),
  "extractDelta com delta=null"
);
assert(
  (() => { const d = extractDelta({ choices: [{ delta: { content: "olá" } }] }); return d.content === "olá"; })(),
  "extractDelta extrai delta.content"
);
assert(
  (() => { const d = extractDelta({ choices: [{ message: { reasoning_content: "pensando" } }] }); return d.reasoning === "pensando"; })(),
  "extractDelta extrai reasoning_content de message"
);
assert(
  extractFinishReason({ choices: [{ finish_reason: "stop" }] }) === "stop",
  "extractFinishReason extrai stop"
);
assert(
  extractFinishReason(null) === null,
  "extractFinishReason(null) retorna null"
);
assert(
  extractToolCalls({ choices: [{ message: { tool_calls: [{ id: "x" }] } }] })?.[0]?.id === "x",
  "extractToolCalls extrai array"
);
assert(
  extractToolCalls({ choices: [{ message: {} }] }) === null,
  "extractToolCalls retorna null quando ausente"
);

runProperty(
  "Property R-Review-1: extractDelta nunca lança em objetos arbitrários",
  fc.property(fc.anything(), (any) => {
    try {
      const d = extractDelta(any);
      return typeof d.content === "string" && typeof d.reasoning === "string";
    } catch {
      return false;
    }
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// R-Review — schema.js mergeMissing (deep merge defensivo)
// ═════════════════════════════════════════════════════════════════════════════

section("R-Review — schema.js: mergeMissing");

assert(
  (() => {
    const t = { a: 1 };
    mergeMissing(t, { a: 99, b: 2 });
    return t.a === 1 && t.b === 2;
  })(),
  "mergeMissing preserva valor existente, adiciona o ausente"
);
assert(
  (() => {
    const t = { rag: { enabled: true } };
    mergeMissing(t, { rag: { enabled: false, topK: 10 } });
    return t.rag.enabled === true && t.rag.topK === 10;
  })(),
  "mergeMissing é recursivo em objetos aninhados"
);
assert(
  (() => {
    const t = { arr: [1, 2] };
    mergeMissing(t, { arr: [9, 9, 9] });
    return t.arr.length === 2 && t.arr[0] === 1;
  })(),
  "mergeMissing trata arrays como atômicos (não faz merge item-a-item)"
);
assert(
  (() => {
    const t = { x: null };
    mergeMissing(t, { x: { nested: 1 } });
    return t.x === null;
  })(),
  "mergeMissing não sobrescreve null explícito do usuário"
);
assert(
  (() => {
    const t = {};
    mergeMissing(t, { deep: { a: { b: { c: 42 } } } });
    return t.deep.a.b.c === 42;
  })(),
  "mergeMissing clona objeto novo profundamente (não compartilha ref)"
);

runProperty(
  "Property R-Review-2: mergeMissing nunca remove chaves existentes",
  fc.property(
    fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()),
    (target, source) => {
      const t = { ...target };
      const beforeKeys = new Set(Object.keys(t));
      mergeMissing(t, source);
      for (const k of beforeKeys) if (!(k in t)) return false;
      return true;
    }
  )
);

// ═════════════════════════════════════════════════════════════════════════════
// R-Opt — RAG Strategy
// ═════════════════════════════════════════════════════════════════════════════

section("R-Opt — RAG Strategy: makeStrategy");

assert(
  (() => {
    const s = makeStrategy("comparative", 5, "test");
    return s.mode === "comparative" && s.topK === 15 && s.includeFirstPerFile === true;
  })(),
  "makeStrategy comparative has topK based on fileCount"
);

assert(
  (() => {
    const s = makeStrategy("summary", 5, "test");
    return s.mode === "summary" && s.topK === 8 && s.maxPerFile === 4;
  })(),
  "makeStrategy summary has static topK"
);

assert(
  (() => {
    const s = makeStrategy("point", 5, "test");
    return s.mode === "point" && s.topK === 5 && s.maxPerFile === 2;
  })(),
  "makeStrategy point has static topK"
);

section("R-Opt — RAG Strategy: intentFromRegex");

assert(intentFromRegex("compare as faturas de janeiro e fevereiro") === "comparative", "regex comparative match");
assert(intentFromRegex("resuma o relatorio de sustentabilidade") === "summary", "regex summary match");
assert(intentFromRegex("qual o valor da taxa de servico?") === null, "regex point is null (unsure)");

runProperty(
  "Property R-Opt-1: intentFromRegex returns comparative, summary or null",
  fc.property(fc.string(), (query) => {
    const result = intentFromRegex(query);
    return result === "comparative" || result === "summary" || result === null;
  })
);

// ═════════════════════════════════════════════════════════════════════════════
// Summary
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("ALL TESTS PASSED ✓");
}
