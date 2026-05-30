import * as fsapi from "../../workspace/fsapi.js";
import * as fsbridge from "../../workspace/fsbridge.js";
import * as rag from "../../rag/manager.js";
import { toast } from "../toasts.js";
import { state, section, field, input, checkbox, button } from "./_shared.js";

export function panelWorkspace() {
  const { store, elements, onChange, rebuildPanel } = state;
  const ws = store.get("workspace");

  const sec = section("Fontes de contexto");

  if (!ws.sources?.length) {
    const empty = document.createElement("p");
    empty.className = "field-help";
    empty.textContent = "Nenhuma fonte conectada ainda. Adicione uma abaixo para alimentar arquivos do projeto ao modelo.";
    sec.appendChild(empty);
  }

  for (const src of ws.sources) {
    const isActive = ws.activeSourceId === src.id;
    const c = document.createElement("div");
    c.className = "drawer-card" + (isActive ? " active-card" : "");

    const head = document.createElement("div");
    head.className = "row";
    const tag = document.createElement("span");
    tag.style.padding = "2px 8px";
    tag.style.borderRadius = "var(--r-sm)";
    tag.style.background = "var(--bg-2)";
    tag.style.fontSize = "var(--fs-xs)";
    tag.style.fontFamily = "var(--font-mono)";
    tag.textContent = src.kind;
    const lbl = document.createElement("strong");
    lbl.style.flex = "1";
    lbl.textContent = src.label;
    head.appendChild(tag);
    head.appendChild(lbl);
    head.appendChild(button(isActive ? "Ativo" : "Ativar", isActive ? "btn-primary" : "btn-ghost", () => {
      store.set("workspace.activeSourceId", src.id);
      onChange();
      rebuildPanel("workspace");
    }));
    head.appendChild(button("Excluir", "btn-danger", () => {
      if (!confirm("Excluir fonte?")) return;
      store.set("workspace.sources", ws.sources.filter((s) => s.id !== src.id));
      if (isActive) store.set("workspace.activeSourceId", null);
      onChange();
      rebuildPanel("workspace");
    }));
    c.appendChild(head);

    const root = document.createElement("p");
    root.className = "field-help";
    root.style.fontFamily = "var(--font-mono)";
    root.textContent = `Root: ${src.root || "(handle persistido em IDB)"}`;
    c.appendChild(root);

    if (src.kind === "server" || src.kind === "fs-api") {
      c.appendChild(buildRagSection(src));
    }

    sec.appendChild(c);
  }

  const addCard = document.createElement("div");
  addCard.className = "drawer-card";
  const addTitle = document.createElement("strong");
  addTitle.textContent = "Adicionar fonte";
  addCard.appendChild(addTitle);

  const addRow = document.createElement("div");
  addRow.className = "row";

  if (fsapi.isSupported()) {
    addRow.appendChild(button("📂 Selecionar pasta (FS API)", "btn-secondary", async () => {
      try {
        const handle = await fsapi.pickDirectory();
        const id = `fsapi-${Date.now()}`;
        await fsapi.persistHandle(id, handle);
        store.set("workspace.sources", [...ws.sources, {
          id, kind: "fs-api", label: handle.name, root: handle.name,
          lastAccessAt: Date.now(),
        }]);
        store.set("workspace.activeSourceId", id);
        onChange();
        rebuildPanel("workspace");
        toast(`Pasta "${handle.name}" conectada.`, "success");
      } catch (err) {
        if (err.name !== "AbortError") toast(err.message, "error");
      }
    }));
  } else {
    const note = document.createElement("p");
    note.className = "field-help";
    note.textContent = "FS API não suportada neste navegador (use Chrome/Edge).";
    addCard.appendChild(note);
  }

  addRow.appendChild(button("🖧 Conectar pasta do servidor", "btn-secondary", async () => {
    const root = prompt(
      "Path absoluto da pasta no disco onde o servidor está rodando.\n" +
      "Exemplos:\n" +
      "  C:\\Users\\pabst\\Documents\\CloudControl\n" +
      "  /home/user/projeto\n" +
      "  /workspace  (se rodando em Docker com volume montado)"
    );
    if (!root) return;
    const trimmed = root.trim();
    if (!trimmed) return;

    let label = trimmed.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || trimmed;
    let validationError = null;
    try {
      await fsbridge.fsList(trimmed, "");
    } catch (err) {
      validationError = err.message;
    }

    const id = `server-${Date.now()}`;
    store.set("workspace.sources", [...ws.sources, {
      id, kind: "server", label, root: trimmed,
      lastAccessAt: Date.now(),
    }]);
    store.set("workspace.activeSourceId", id);
    onChange();
    rebuildPanel("workspace");
    if (validationError) {
      toast(`Pasta adicionada, mas houve aviso: ${validationError}`, "warn", 6000);
    } else {
      toast(`Pasta "${label}" conectada.`, "success");
    }
  }));
  addCard.appendChild(addRow);
  sec.appendChild(addCard);
  elements.settingsBody.appendChild(sec);

  elements.settingsBody.appendChild(buildRagGlobalSection());

  const limitsSec = section("Limites & filtros");
  const limitsDetails = document.createElement("details");
  limitsDetails.className = "advanced-settings-details";
  const limitsSummary = document.createElement("summary");
  limitsSummary.textContent = "Ajustar limites de tamanho e arquivos ignorados";
  limitsDetails.appendChild(limitsSummary);

  const limitsCard = document.createElement("div");
  limitsCard.className = "drawer-card";
  limitsCard.style.marginTop = "var(--s-2)";

  const row = document.createElement("div");
  row.className = "row cols2";
  row.appendChild(field("Tamanho máximo por arquivo (KB)", input({
    type: "number", value: Math.round(ws.maxFileBytes / 1024), min: "1", step: "1",
    onchange: (e) => { ws.maxFileBytes = Number(e.target.value) * 1024; onChange(); },
  })));
  row.appendChild(field("Tamanho máximo total (KB)", input({
    type: "number", value: Math.round(ws.maxTotalBytes / 1024), min: "1", step: "1",
    onchange: (e) => { ws.maxTotalBytes = Number(e.target.value) * 1024; onChange(); },
  })));
  limitsCard.appendChild(row);

  const ignoreTa = document.createElement("textarea");
  ignoreTa.rows = 5;
  ignoreTa.value = (ws.ignorePatterns || []).join("\n");
  ignoreTa.addEventListener("change", () => {
    ws.ignorePatterns = ignoreTa.value.split("\n").map((x) => x.trim()).filter(Boolean);
    onChange();
  });
  limitsCard.appendChild(field("Ignorar (um padrão por linha)", ignoreTa, "Aceita nomes exatos (node_modules) ou globs simples (*.png)."));

  limitsDetails.appendChild(limitsCard);
  limitsSec.appendChild(limitsDetails);
  elements.settingsBody.appendChild(limitsSec);
}

/* Check if config.rag.embeddingModel matches the indexed source's meta.
   Returns a DOM warning element if mismatch, null otherwise. */
async function validateEmbeddingMatch() {
  const { store } = state;
  const ws = store.get("workspace");
  const ragCfg = store.get("rag");
  if (!ws.activeSourceId) return null;
  const meta = await rag.getStatus(ws.activeSourceId);
  if (!meta || meta.chunkCount === 0) return null;
  if (meta.embeddingModel === ragCfg.embeddingModel) return null;

  const warn = document.createElement("div");
  warn.style.padding = "var(--s-2) var(--s-3)";
  warn.style.background = "rgba(251, 191, 36, 0.12)";
  warn.style.border = "1px solid var(--warn)";
  warn.style.borderRadius = "var(--r-sm)";
  warn.style.color = "var(--fg-0)";
  warn.style.fontSize = "var(--fs-xs)";
  warn.style.marginTop = "var(--s-2)";
  warn.innerHTML =
    `⚠ <strong>Mismatch detectado.</strong> Sua fonte ativa foi indexada com ` +
    `<code style="font-family: var(--font-mono);">${meta.embeddingModel}</code> ` +
    `mas a config atual usa <code style="font-family: var(--font-mono);">${ragCfg.embeddingModel}</code>. ` +
    `Re-indexe (Configurações → Workspace → Re-indexar) ou ajuste a config pra alinhar.`;
  return warn;
}

function buildRagGlobalSection() {
  const { store, elements, onChange, rebuildPanel } = state;
  const ragSec = section("RAG");
  const ragDoc = document.createElement("p");
  ragDoc.className = "field-help";
  ragDoc.textContent = "Busca trechos relevantes nas fontes indexadas sem enviar arquivos inteiros.";
  ragSec.appendChild(ragDoc);

  const ragCfg = store.get("rag");
  const ragCard = document.createElement("div");
  ragCard.className = "drawer-card";

  ragCard.appendChild(checkbox("Habilitar RAG", ragCfg.enabled, (v) => {
    ragCfg.enabled = v;
    onChange();
  }));

  const embedWrap = document.createElement("div");
  embedWrap.className = "field";
  const embedLbl = document.createElement("label");
  embedLbl.className = "field-label";
  embedLbl.textContent = "Modelo de embedding";
  embedWrap.appendChild(embedLbl);

  const detected = (elements.modelOptions || []).filter((m) =>
    /embed/i.test(m) || /bge-/i.test(m) || /mini-?lm/i.test(m) || /e5-/i.test(m)
  );

  // Garante que o modelo salvo apareça como chip mesmo se o servidor estiver
  // offline ou não tiver retornado a lista ainda.
  const allChoices = [...detected];
  if (ragCfg.embeddingModel && !allChoices.includes(ragCfg.embeddingModel)) {
    allChoices.unshift(ragCfg.embeddingModel);
  }

  if (allChoices.length === 0) {
    const empty = document.createElement("p");
    empty.className = "field-help";
    empty.style.color = "var(--warn)";
    empty.textContent = "Nenhum modelo de embedding detectado no servidor ativo. Conecte o servidor (aba Servidor) e baixe um no LM Studio (Discover → busque \"embedding\").";
    embedWrap.appendChild(empty);
  } else {
    const sugRow = document.createElement("div");
    sugRow.className = "row";
    sugRow.style.flexWrap = "wrap";
    sugRow.style.gap = "var(--s-1)";
    for (const id of allChoices) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "btn btn-sm " + (ragCfg.embeddingModel === id ? "btn-primary" : "btn-ghost");
      chip.textContent = id;
      chip.style.fontFamily = "var(--font-mono)";
      chip.addEventListener("click", () => {
        ragCfg.embeddingModel = id;
        onChange();
        rebuildPanel("workspace");
      });
      sugRow.appendChild(chip);
    }
    embedWrap.appendChild(sugRow);
  }

  validateEmbeddingMatch().then((warning) => {
    if (warning) embedWrap.appendChild(warning);
  });

  const embedHelp = document.createElement("p");
  embedHelp.className = "field-help";
  embedHelp.textContent = "Modelos de embedding precisam estar baixados e carregados no LM Studio (Discover → Embeddings).";
  embedWrap.appendChild(embedHelp);
  ragCard.appendChild(embedWrap);

  const sliderRow = (label, key, min, max, step, suffix = "") => {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const head = document.createElement("div");
    head.className = "row";
    head.style.gap = "var(--s-2)";
    const lbl = document.createElement("label");
    lbl.className = "field-label";
    lbl.style.flex = "1";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.style.fontFamily = "var(--font-mono)";
    val.style.fontSize = "var(--fs-xs)";
    val.style.color = "var(--fg-2)";
    val.textContent = `${ragCfg[key]}${suffix}`;
    head.appendChild(lbl);
    head.appendChild(val);
    const slider = input({
      type: "range", min: String(min), max: String(max), step: String(step), value: String(ragCfg[key]),
      oninput: (e) => {
        ragCfg[key] = Number(e.target.value);
        val.textContent = `${ragCfg[key]}${suffix}`;
        onChange();
      },
    });
    wrap.appendChild(head);
    wrap.appendChild(slider);
    return wrap;
  };

  const autoDetails = document.createElement("details");
  autoDetails.className = "advanced-settings-details compact-details";
  const autoSummary = document.createElement("summary");
  autoSummary.textContent = "Como a estrategia automatica funciona";
  autoDetails.appendChild(autoSummary);
  const autoBox = document.createElement("p");
  autoBox.className = "field-help";
  autoBox.innerHTML =
    `O app detecta perguntas comparativas, de resumo ou pontuais e ajusta topK/maxPerFile automaticamente.`;
  autoDetails.appendChild(autoBox);
  ragCard.appendChild(autoDetails);

  const advanced = document.createElement("details");
  advanced.className = "advanced-settings-details";
  const summary = document.createElement("summary");
  summary.textContent = "RAG avancado";
  advanced.appendChild(summary);

  const ws = store.get("workspace");
  const ocrWrap = document.createElement("div");
  ocrWrap.style.marginTop = "var(--s-3)";
  ocrWrap.appendChild(checkbox(
    "OCR para PDFs escaneados (lento — ~10s por página na CPU)",
    !!ws.ocrEnabled,
    (v) => {
      const cur = store.get("workspace");
      store.set("workspace", { ...cur, ocrEnabled: v });
      onChange();
    },
  ));
  const ocrHelp = document.createElement("p");
  ocrHelp.className = "field-help";
  ocrHelp.innerHTML = "Quando ativo, páginas sem text layer são renderizadas como imagem e processadas com Tesseract (idiomas <code>pt+en</code> por padrão, configurável via env <code>OCR_LANGS</code>). Os modelos de idioma são baixados de uma CDN na primeira execução e ficam em cache.";
  ocrWrap.appendChild(ocrHelp);
  advanced.appendChild(ocrWrap);

  const advBody = document.createElement("div");
  advBody.style.marginTop = "var(--s-2)";
  advBody.style.display = "flex";
  advBody.style.flexDirection = "column";
  advBody.style.gap = "var(--s-2)";

  const overrideRow = document.createElement("label");
  overrideRow.className = "checkbox-row";
  const overrideCb = document.createElement("input");
  overrideCb.type = "checkbox";
  overrideCb.checked = ragCfg.autoStrategy === false;
  overrideCb.addEventListener("change", () => {
    ragCfg.autoStrategy = !overrideCb.checked;
    onChange();
  });
  const overrideLabel = document.createElement("span");
  overrideLabel.textContent = "Desativar estratégia automática (usar valores manuais abaixo)";
  overrideRow.appendChild(overrideCb);
  overrideRow.appendChild(overrideLabel);
  advBody.appendChild(overrideRow);

  advBody.appendChild(sliderRow("Tamanho do chunk (chars)", "chunkChars", 600, 6000, 100, ""));
  advBody.appendChild(sliderRow("Sobreposição entre chunks (chars)", "chunkOverlap", 0, 1000, 50, ""));
  advBody.appendChild(sliderRow("Top-K (chunks por pergunta) — só se manual", "topK", 1, 30, 1));
  advBody.appendChild(sliderRow("Max chunks por arquivo — só se manual (0=sem limite)", "maxPerFile", 0, 10, 1));
  advBody.appendChild(sliderRow("Batch size do embedder", "batchSize", 1, 128, 1));

  advanced.appendChild(advBody);
  advanced.appendChild(buildRerankingSection());
  ragCard.appendChild(advanced);

  ragSec.appendChild(ragCard);

  return ragSec;
}

function buildRerankingSection() {
  const { store, onChange } = state;
  const ragCfg = store.get("rag");
  const rCfg = ragCfg.reranking || {};

  const card = document.createElement("div");
  card.className = "drawer-card";
  card.style.marginTop = "var(--s-3)";

  const header = document.createElement("strong");
  header.textContent = "Reranking (Cross-Encoder)";
  header.style.display = "block";
  header.style.marginBottom = "var(--s-2)";
  card.appendChild(header);

  card.appendChild(checkbox("Ativar reranking", !!rCfg.enabled, (v) => {
    rCfg.enabled = v;
    ragCfg.reranking = rCfg;
    onChange();
    state.rebuildPanel("workspace");
  }));

  if (rCfg.enabled) {
    const body = document.createElement("div");
    body.style.marginTop = "var(--s-3)";
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "var(--s-3)";

    body.appendChild(field("Modelo cross-encoder", input({
      value: rCfg.rerankModel || "",
      placeholder: "ex: cross-encoder/ms-marco-MiniLM-L-6-v2",
      onchange: (e) => { rCfg.rerankModel = e.target.value.trim(); onChange(); },
    })));

    body.appendChild(field("Endpoint do reranker (opcional)", input({
      value: rCfg.rerankEndpoint || "",
      placeholder: "Padrão: mesmo servidor ativo",
      onchange: (e) => { rCfg.rerankEndpoint = e.target.value.trim(); onChange(); },
    })));

    const sliderRow = (label, key, min, max, step) => {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const head = document.createElement("div");
      head.className = "row";
      head.style.gap = "var(--s-2)";
      const lbl = document.createElement("label");
      lbl.className = "field-label";
      lbl.style.flex = "1";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.style.fontFamily = "var(--font-mono)";
      val.style.fontSize = "var(--fs-xs)";
      val.style.color = "var(--fg-2)";
      val.textContent = String(rCfg[key]);
      head.appendChild(lbl);
      head.appendChild(val);
      const slider = input({
        type: "range", min: String(min), max: String(max), step: String(step), value: String(rCfg[key]),
        oninput: (e) => {
          rCfg[key] = Number(e.target.value);
          val.textContent = String(rCfg[key]);
          
          if (rCfg.finalK > rCfg.candidateK) {
            val.style.color = "var(--error)";
            lbl.style.color = "var(--error)";
          } else {
            val.style.color = "var(--fg-2)";
            lbl.style.color = "";
            onChange();
          }
        },
      });
      wrap.appendChild(head);
      wrap.appendChild(slider);
      return wrap;
    };

    body.appendChild(sliderRow("Candidatos para reranking", "candidateK", 5, 50, 1));
    body.appendChild(sliderRow("Chunks finais após reranking", "finalK", 1, 20, 1));

    const note = document.createElement("p");
    note.className = "field-help";
    note.innerHTML = "O modelo cross-encoder deve estar carregado no LM Studio. Modelos de embedding não funcionam como cross-encoder.";
    body.appendChild(note);

    card.appendChild(body);
  }

  return card;
}

function buildRagSection(src) {
  const { store } = state;
  const wrap = document.createElement("div");
  wrap.style.borderTop = "1px solid var(--line)";
  wrap.style.paddingTop = "var(--s-3)";
  wrap.style.marginTop = "var(--s-2)";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "var(--s-2)";

  const headerRow = document.createElement("div");
  headerRow.className = "row";
  const ragTitle = document.createElement("strong");
  ragTitle.style.fontSize = "var(--fs-sm)";
  ragTitle.textContent = "🔍 RAG (busca semântica)";
  headerRow.appendChild(ragTitle);
  wrap.appendChild(headerRow);

  const status = document.createElement("p");
  status.className = "field-help";
  status.dataset.role = "rag-status";
  status.textContent = "Carregando status...";
  wrap.appendChild(status);

  const progress = document.createElement("div");
  progress.style.height = "6px";
  progress.style.background = "var(--bg-2)";
  progress.style.borderRadius = "var(--r-pill)";
  progress.style.overflow = "hidden";
  progress.style.display = "none";
  const bar = document.createElement("div");
  bar.style.height = "100%";
  bar.style.background = "var(--accent)";
  bar.style.width = "0%";
  bar.style.transition = "width 200ms ease";
  progress.appendChild(bar);
  wrap.appendChild(progress);

  const actions = document.createElement("div");
  actions.className = "row";
  const indexBtn = document.createElement("button");
  indexBtn.type = "button";
  indexBtn.className = "btn btn-primary btn-sm";
  indexBtn.textContent = "Indexar com RAG";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-ghost btn-sm";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.style.display = "none";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn-danger btn-sm";
  clearBtn.textContent = "Limpar índice";
  clearBtn.style.display = "none";
  actions.appendChild(indexBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(clearBtn);
  wrap.appendChild(actions);

  function updateUiFromMeta(meta, jobStatus) {
    if (jobStatus?.running) {
      const p = jobStatus.progress;
      const pct = p?.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
      bar.style.width = pct + "%";
      progress.style.display = "block";
      status.textContent = p?.message || "Trabalhando...";
      indexBtn.style.display = "none";
      cancelBtn.style.display = "inline-flex";
      clearBtn.style.display = "none";
      return;
    }

    progress.style.display = "none";
    cancelBtn.style.display = "none";

    if (meta) {
      const ago = formatAgo(meta.indexedAt);
      status.innerHTML = "";
      const span = document.createElement("span");
      span.style.color = "var(--success)";
      span.textContent = "✓ ";
      const rest = document.createElement("span");
      rest.textContent = `Indexado: ${meta.chunkCount} chunks de ${meta.fileCount} arquivos · modelo "${meta.embeddingModel}" · ${ago}`;
      status.appendChild(span);
      status.appendChild(rest);
      indexBtn.textContent = "Re-indexar";
      indexBtn.style.display = "inline-flex";
      clearBtn.style.display = "inline-flex";
    } else {
      status.textContent = "Não indexado. Clique pra criar embeddings dos arquivos desta fonte.";
      indexBtn.textContent = "Indexar com RAG";
      indexBtn.style.display = "inline-flex";
      clearBtn.style.display = "none";
    }
  }

  Promise.all([rag.getStatus(src.id), Promise.resolve(rag.getJobStatus(src.id))])
    .then(([meta, job]) => updateUiFromMeta(meta, job))
    .catch(() => updateUiFromMeta(null, null));

  const unsub = rag.subscribe((evt) => {
    if (evt.sourceId !== src.id) return;
    if (evt.kind === "progress") {
      updateUiFromMeta(null, { running: true, progress: evt.progress });
    } else if (evt.kind === "done") {
      rag.getStatus(src.id).then((meta) => updateUiFromMeta(meta, null));
      toast(`Indexação concluída: ${evt.result.chunkCount} chunks`, "success");
    } else if (evt.kind === "error") {
      updateUiFromMeta(null, null);
      toast(`Indexação falhou: ${evt.error}`, "error", 6000);
    } else if (evt.kind === "cleared") {
      updateUiFromMeta(null, null);
    }
  });
  wrap.addEventListener("DOMNodeRemovedFromDocument", () => unsub());

  indexBtn.addEventListener("click", async () => {
    const ragCfg = store.get("rag");
    const conn = store.get("connection");
    const server = conn.servers.find((s) => s.id === conn.activeServerId) || conn.servers[0];
    if (!server?.baseUrl) {
      toast("Configure um servidor LM Studio antes.", "warn");
      return;
    }
    if (!ragCfg.embeddingModel) {
      toast("Defina um embedding model em Configurações → Workspace → seção RAG.", "warn");
      return;
    }
    if (rag.isAnyJobRunning()) {
      toast("Já existe uma indexação em andamento.", "warn");
      return;
    }
    try {
      await rag.startIndexing({
        source: src,
        embedConfig: {
          baseUrl: server.baseUrl,
          apiKey: server.apiKey,
          model: ragCfg.embeddingModel,
          batchSize: ragCfg.batchSize,
        },
        workspace: store.get("workspace"),
        ragConfig: {
          chunkChars: ragCfg.chunkChars,
          chunkOverlap: ragCfg.chunkOverlap,
        },
      });
    } catch (err) {
      toast(`Indexação: ${err.message}`, "error", 6000);
    }
  });

  cancelBtn.addEventListener("click", () => rag.cancelIndexing(src.id));

  clearBtn.addEventListener("click", async () => {
    if (!confirm("Limpar índice RAG desta fonte?")) return;
    await rag.clearIndex(src.id);
    toast("Índice limpo.", "info");
  });

  return wrap;
}

function formatAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}
