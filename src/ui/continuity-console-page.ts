export const continuityConsoleHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MemTextual Continuity</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <header>
    <div>
      <p class="eyebrow">MemTextual Continuity</p>
      <h1>User control</h1>
    </div>
    <div id="connection" class="status">Connecting locally…</div>
  </header>
  <main>
    <aside>
      <div class="persona-card">
        <span class="label">Active persona</span>
        <strong id="persona-name">Loading…</strong>
      </div>
      <button class="nav active" data-view="candidates">Review queue <span id="candidate-count">0</span></button>
      <button class="nav" data-view="memories">Memories <span id="memory-count">0</span></button>
      <button class="nav" data-view="conversations">Conversations <span id="conversation-count">0</span></button>
      <button id="create-memory-button" class="utility" type="button">Create memory</button>
      <button id="persona-behavior-button" class="utility" type="button">Persona behavior</button>
      <button id="export-button" class="utility" type="button">Export persona memories</button>
      <p class="boundary">This console is bound to one persona and this local session.</p>
    </aside>
    <section class="workspace">
      <div id="notice" role="status" aria-live="polite"></div>
      <div id="list-panel"></div>
      <div id="detail-panel" class="detail empty">
        <p>Select an item to inspect its evidence, history, and controls.</p>
      </div>
    </section>
  </main>
  <script src="/app.js" defer></script>
</body>
</html>`;

export const continuityConsoleCss = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #111511;
  color: #edf3ea;
  --panel: #192019;
  --panel-2: #202920;
  --line: #344034;
  --muted: #a8b4a6;
  --accent: #a8d46f;
  --danger: #ff9f8e;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #263326 0, #111511 42%); }
header { display: flex; justify-content: space-between; align-items: center; padding: 24px 32px; border-bottom: 1px solid var(--line); }
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: 28px; }
.eyebrow, .label { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.eyebrow { margin-bottom: 5px; }
.status, .meta, .boundary, .empty { color: var(--muted); }
main { display: grid; grid-template-columns: 230px minmax(0, 1fr); min-height: calc(100vh - 97px); }
aside { padding: 24px 16px; border-right: 1px solid var(--line); background: rgba(17, 21, 17, .78); }
.persona-card { padding: 16px; margin-bottom: 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.persona-card strong { display: block; margin-top: 7px; font-size: 18px; }
.nav { width: 100%; display: flex; justify-content: space-between; margin: 6px 0; padding: 12px 14px; border: 0; border-radius: 9px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.nav:hover, .nav.active { background: var(--panel-2); }
.nav span { color: var(--muted); }
.utility { width: 100%; margin-top: 18px; padding: 11px 14px; border: 1px solid var(--line); border-radius: 9px; color: inherit; background: var(--panel); text-align: left; cursor: pointer; }
.utility:hover { border-color: var(--accent); }
.boundary { margin: 24px 12px; font-size: 12px; line-height: 1.5; }
.workspace { display: grid; grid-template-columns: minmax(300px, .85fr) minmax(360px, 1.15fr); gap: 20px; padding: 24px; align-content: start; }
#notice { grid-column: 1 / -1; min-height: 20px; color: var(--accent); }
#list-panel, #detail-panel { min-height: 520px; border: 1px solid var(--line); border-radius: 14px; background: rgba(25, 32, 25, .95); padding: 18px; }
.item { width: 100%; margin: 0 0 10px; padding: 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-2); color: inherit; text-align: left; cursor: pointer; }
.item:hover { border-color: var(--accent); }
.item strong { display: block; margin-bottom: 8px; line-height: 1.4; }
.pills { display: flex; gap: 6px; flex-wrap: wrap; }
.pill { padding: 3px 7px; border-radius: 999px; background: #303b30; color: #cbd7c8; font-size: 11px; }
.detail.empty { display: grid; place-items: center; text-align: center; }
.section { padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--line); }
.evidence, .history { padding: 12px; margin: 8px 0; border-left: 3px solid var(--accent); background: #151b15; }
.warning { padding: 12px; border-left: 3px solid var(--danger); background: #211817; color: #ffd2ca; line-height: 1.5; }
.check { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; color: var(--muted); line-height: 1.4; }
.check input { width: auto; margin: 3px 0 0; }
.field { display: block; margin-top: 14px; color: var(--muted); font-size: 13px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
button.action { border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; background: #2a352a; color: inherit; cursor: pointer; }
button.action:hover { border-color: var(--accent); }
button.action.danger { color: var(--danger); }
textarea, select, input { width: 100%; margin-top: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; color: inherit; background: #101410; }
@media (max-width: 850px) {
  main { grid-template-columns: 1fr; }
  aside { border-right: 0; border-bottom: 1px solid var(--line); }
  .workspace { grid-template-columns: 1fr; }
}
`;

export const continuityConsoleJavaScript = `
(() => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token") || "";
  history.replaceState(null, "", window.location.pathname);
  const state = { dashboard: null, view: "candidates" };
  const listPanel = document.getElementById("list-panel");
  const detailPanel = document.getElementById("detail-panel");
  const notice = document.getElementById("notice");

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function pill(text) { return node("span", text, "pill"); }

  async function api(path, options) {
    if (!token) throw new Error("The session token is missing. Relaunch the console.");
    const response = await fetch(path, {
      ...(options || {}),
      headers: {
        Authorization: "Bearer " + token,
        ...(options && options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The request failed.");
    return payload;
  }

  function setNotice(message, error) {
    notice.textContent = message || "";
    notice.style.color = error ? "var(--danger)" : "var(--accent)";
  }

  function clearDetail() {
    detailPanel.replaceChildren(node("p", "Select an item to inspect its evidence, history, and controls."));
    detailPanel.className = "detail empty";
  }

  function renderList() {
    listPanel.replaceChildren();
    const headings = {
      candidates: "Pending review",
      memories: "Persona memories",
      conversations: "Conversation journal",
    };
    const heading = node("h2", headings[state.view]);
    listPanel.append(heading);
    if (!state.dashboard) {
      listPanel.append(node("p", "Loading local data…", "empty"));
      return;
    }
    const items = state.dashboard[state.view];
    if (items.length === 0) {
      const empty = state.view === "candidates"
        ? "No pending candidates."
        : state.view === "memories"
          ? "No stored memories."
          : "No locally journaled conversations.";
      listPanel.append(node("p", empty, "empty"));
      return;
    }
    items.forEach((item) => {
      if (state.view === "conversations") {
        const conversation = item.conversation;
        const button = node("button", undefined, "item");
        button.type = "button";
        button.append(node("strong", "Conversation from " + new Date(item.lastActivityAt).toLocaleString()));
        const pills = node("div", undefined, "pills");
        pills.append(pill(item.turnCount + (item.turnCount === 1 ? " turn" : " turns")));
        if (item.unresolvedCaptureCount > 0) {
          pills.append(pill(item.unresolvedCaptureCount + " need recovery"));
        } else {
          pills.append(pill("capture complete"));
        }
        button.append(pills);
        button.addEventListener("click", () => showConversation(conversation.id));
        listPanel.append(button);
        return;
      }
      const candidate = item.candidate;
      const profile = candidate ? null : item;
      const memory = profile ? profile.memory : null;
      const button = node("button", undefined, "item");
      button.type = "button";
      button.append(node("strong", candidate ? candidate.assertion : memory.assertion));
      const pills = node("div", undefined, "pills");
      if (candidate) {
        pills.append(pill(item.memoryClass), pill(candidate.type), pill(candidate.sensitivity));
        button.addEventListener("click", () => showCandidate(candidate.id));
      } else {
        pills.append(pill(profile.memoryClass), pill(memory.status), pill(memory.sensitivity));
        if (memory.isPinned) pills.append(pill("pinned"));
        if (memory.isProtected) pills.append(pill("protected"));
        button.addEventListener("click", () => showMemory(memory.id));
      }
      button.append(pills);
      listPanel.append(button);
    });
  }

  async function refreshDashboard() {
    state.dashboard = await api("/api/dashboard");
    document.getElementById("persona-name").textContent = state.dashboard.persona.name;
    document.getElementById("candidate-count").textContent = String(state.dashboard.candidates.length);
    document.getElementById("memory-count").textContent = String(state.dashboard.memories.length);
    document.getElementById("conversation-count").textContent = String(state.dashboard.conversations.length);
    document.getElementById("connection").textContent = "Local session active";
    renderList();
  }

  async function downloadPersonaExport() {
    const export_ = await api("/api/export");
    const name = export_.personaContext.persona.name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 80) || "persona";
    const blob = new Blob([JSON.stringify(export_, null, 2) + "\\n"], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "memtextual-continuity-" + name + "-memories.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("Persona-memory export downloaded.");
  }

  function actionButton(label, handler, danger) {
    const button = node("button", label, "action" + (danger ? " danger" : ""));
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await handler(); } catch (error) { setNotice(error.message, true); }
      finally { button.disabled = false; }
    });
    return button;
  }

  function selectField(labelText, values) {
    const label = node("label", labelText, "field");
    const select = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select one";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    values.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    });
    label.append(select);
    return { label, select };
  }

  async function showPersonaBehavior() {
    try {
      const result = await api("/api/behavior");
      const current = result.current;
      detailPanel.className = "detail";
      detailPanel.replaceChildren(node("h2", "Persona behavior"));
      detailPanel.append(node("p", "These user-controlled instructions shape this persona's identity, style, and interaction preferences in new conversations. They are configuration, not memory, and do not authorize tools or data access.", "meta"));

      const instructionsLabel = node("label", "Behavior instructions", "field");
      const instructions = document.createElement("textarea");
      instructions.rows = 10;
      instructions.maxLength = 50000;
      instructions.value = current ? current.instructions : "";
      instructions.placeholder = "Describe how this persona should communicate and interact.";
      instructionsLabel.append(instructions);
      detailPanel.append(instructionsLabel);

      const enabledLabel = node("label", undefined, "check");
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = current ? current.enabled : true;
      enabledLabel.append(enabled, document.createTextNode("Apply this behavior to new conversations."));
      detailPanel.append(enabledLabel);

      const noteLabel = node("label", "Optional change note", "field");
      const note = document.createElement("textarea");
      note.rows = 2;
      note.maxLength = 10000;
      noteLabel.append(note);
      detailPanel.append(noteLabel);

      const actions = node("div", undefined, "actions");
      actions.append(actionButton(current ? "Save new revision" : "Create behavior profile", async () => {
        if (!instructions.value.trim()) throw new Error("Behavior instructions are required.");
        await api("/api/behavior", {
          method: "POST",
          body: JSON.stringify({
            expectedRevisionNumber: current ? current.revisionNumber : null,
            instructions: instructions.value,
            enabled: enabled.checked,
            note: note.value,
          }),
        });
        setNotice("Persona behavior saved as a new immutable revision. It will apply to new conversations only.");
        await showPersonaBehavior();
      }));
      detailPanel.append(actions);

      const history = node("div", undefined, "section");
      history.append(node("h3", "Revision history"));
      if (result.history.length === 0) {
        history.append(node("p", "No persona behavior has been configured.", "empty"));
      } else {
        result.history.slice().reverse().forEach((revision) => {
          const card = node("div", undefined, "history");
          card.append(node("strong", "Revision " + revision.revisionNumber + " · " + (revision.enabled ? "enabled" : "disabled")));
          card.append(node("p", revision.instructions));
          if (revision.note) card.append(node("p", revision.note, "meta"));
          history.append(card);
        });
      }
      detailPanel.append(history);
      instructions.focus();
    } catch (error) { setNotice(error.message, true); }
  }

  async function showConversation(id) {
    try {
      const detail = await api("/api/conversations/" + encodeURIComponent(id));
      const summary = detail.summary;
      const conversation = summary.conversation;
      detailPanel.className = "detail";
      detailPanel.replaceChildren(node("h2", "Conversation journal"));
      detailPanel.append(node("p", summary.turnCount + (summary.turnCount === 1 ? " locally journaled turn" : " locally journaled turns") + " · last activity " + new Date(summary.lastActivityAt).toLocaleString(), "meta"));
      const behavior = conversation.behaviorProfileRevision === null
        ? "Neutral start; no enabled persona behavior profile was applied."
        : "Persona behavior revision " + conversation.behaviorProfileRevision + " was applied when this conversation started.";
      detailPanel.append(node("p", behavior, "meta"));
      detailPanel.append(node("p", "This view shows MemTextual's durable local capture journal. The host may contain additional turns until the conversation can be safely reconciled.", "warning"));
      if (summary.unresolvedCaptureCount > 0) {
        detailPanel.append(node("p", summary.unresolvedCaptureCount + " turn capture" + (summary.unresolvedCaptureCount === 1 ? " requires" : "s require") + " recovery before the conversation can safely resume.", "warning"));
      }

      const history = node("div", undefined, "section");
      history.append(node("h3", "Exact local journal"));
      if (detail.turns.length === 0) {
        history.append(node("p", "No completed turns have been journaled locally.", "empty"));
      } else {
        detail.turns.forEach((turn) => {
          const card = node("div", undefined, "history");
          card.append(node("strong", new Date(turn.completedAt).toLocaleString() + " · " + turn.status));
          card.append(node("p", "You", "meta"), node("p", turn.userText));
          card.append(node("p", state.dashboard.persona.name, "meta"), node("p", turn.assistantText));
          if (turn.failureCode) card.append(node("p", "Capture failure: " + turn.failureCode, "warning"));
          history.append(card);
        });
      }
      detailPanel.append(history);
      detailPanel.append(node("p", "Starting, reopening, and sending messages are not enabled yet. Those actions will remain unavailable until the conversational runtime is integrated with protected host-authorization grant storage, keeping bearer credentials out of the database, browser, and command line.", "meta"));
    } catch (error) { setNotice(error.message, true); }
  }

  function showCreateMemory() {
    detailPanel.className = "detail";
    detailPanel.replaceChildren(node("h2", "Create persona memory"));
    detailPanel.append(node("p", "This creates a memory directly from your explicit entry. It will not have source evidence attached.", "meta"));

    const assertionLabel = node("label", "Memory assertion", "field");
    const assertion = document.createElement("textarea");
    assertion.rows = 6;
    assertion.maxLength = 50000;
    assertion.placeholder = "State one fact, preference, decision, goal, or other memory clearly.";
    assertionLabel.append(assertion);
    detailPanel.append(assertionLabel);

    const memoryClass = selectField("Memory class", [
      ["durable", "Durable — stable knowledge for future interactions"],
      ["episodic", "Episodic — a bounded event or interaction"],
    ]);
    const type = selectField("Memory type", [
      ["preference", "Preference"], ["fact", "Fact"],
      ["decision", "Decision"], ["entity", "Entity"],
      ["task_context", "Task context"], ["instruction", "Instruction"],
      ["goal", "Goal"], ["relationship", "Relationship"], ["other", "Other"],
    ]);
    const sensitivity = selectField("Sensitivity", [
      ["normal", "Normal"],
      ["sensitive", "Sensitive"],
      ["restricted", "Restricted"],
    ]);
    const retrievalPolicy = selectField("Retrieval policy", [
      ["include", "Include — eligible for normal retrieval"],
      ["manual", "Manual — return only through explicit management"],
      ["exclude", "Exclude — do not return through retrieval"],
    ]);
    detailPanel.append(
      memoryClass.label,
      type.label,
      sensitivity.label,
      retrievalPolicy.label,
    );

    const pinnedLabel = node("label", undefined, "check");
    const pinned = document.createElement("input");
    pinned.type = "checkbox";
    pinnedLabel.append(pinned, document.createTextNode("Pin this memory."));
    const protectedLabel = node("label", undefined, "check");
    const protected_ = document.createElement("input");
    protected_.type = "checkbox";
    protectedLabel.append(
      protected_,
      document.createTextNode("Protect this memory from ordinary lifecycle changes."),
    );
    detailPanel.append(pinnedLabel, protectedLabel);

    const actions = node("div", undefined, "actions");
    actions.append(actionButton("Create memory", async () => {
      const text = assertion.value.trim();
      if (!text) throw new Error("A memory assertion is required.");
      if (!memoryClass.select.value) throw new Error("Select a memory class.");
      if (!type.select.value) throw new Error("Select a memory type.");
      if (!sensitivity.select.value) throw new Error("Select a sensitivity.");
      if (!retrievalPolicy.select.value) throw new Error("Select a retrieval policy.");
      const created = await api("/api/memories", {
        method: "POST",
        body: JSON.stringify({
          assertion: text,
          memoryClass: memoryClass.select.value,
          type: type.select.value,
          sensitivity: sensitivity.select.value,
          retrievalPolicy: retrievalPolicy.select.value,
          isPinned: pinned.checked,
          isProtected: protected_.checked,
        }),
      });
      setNotice("Persona memory created from your explicit entry.");
      state.view = "memories";
      document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
      document.querySelector('.nav[data-view="memories"]').classList.add("active");
      await refreshDashboard();
      await showMemory(created.memory.id);
    }));
    actions.append(actionButton("Cancel", async () => clearDetail()));
    detailPanel.append(actions);
    assertion.focus();
  }

  async function showCandidate(id) {
    try {
      const review = await api("/api/candidates/" + encodeURIComponent(id));
      detailPanel.className = "detail";
      detailPanel.replaceChildren(node("h2", "Candidate review"));
      detailPanel.append(node("h3", review.candidate.assertion));
      detailPanel.append(node("p", review.memoryClass + " · " + review.candidate.type + " · confidence " + review.candidate.confidence, "meta"));
      const evidenceSection = node("div", undefined, "section");
      evidenceSection.append(node("h3", "Evidence"));
      review.evidence.forEach((item) => {
        const card = node("div", undefined, "evidence");
        card.append(node("strong", item.evidence.role));
        card.append(node("p", item.record ? item.record.content : "Evidence record unavailable."));
        evidenceSection.append(card);
      });
      detailPanel.append(evidenceSection);

      const matchesSection = node("div", undefined, "section");
      matchesSection.append(node("h3", "Suggested matches"));
      if (review.matches.length === 0) {
        matchesSection.append(node("p", "No exact or semantic match was suggested.", "empty"));
      } else {
        review.matches.forEach((match) => {
          const card = node("div", undefined, "history");
          card.append(node("strong", match.memory.assertion));
          card.append(node("p", match.matchKind + " · score " + match.score + " · " + match.reason, "meta"));
          matchesSection.append(card);
        });
      }
      detailPanel.append(matchesSection);

      const reconcileSection = node("div", undefined, "section");
      reconcileSection.append(node("h3", "Reconcile with an existing memory"));
      const target = document.createElement("select");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select an active memory";
      target.append(placeholder);
      state.dashboard.memories
        .filter((profile) => profile.memory.status === "active")
        .forEach((profile) => {
          const option = document.createElement("option");
          option.value = profile.memory.id;
          const suggested = review.matches.some((match) => match.memory.id === profile.memory.id);
          option.textContent = (suggested ? "Suggested: " : "") + profile.memory.assertion;
          target.append(option);
        });
      reconcileSection.append(target);
      const note = document.createElement("textarea");
      note.placeholder = "Optional review note";
      note.rows = 3;
      reconcileSection.append(note);
      const actions = node("div", undefined, "actions");
      async function completeResolution(outcome, targetMemoryId) {
        await api("/api/candidates/" + encodeURIComponent(id) + "/resolve", {
          method: "POST",
          body: JSON.stringify({ outcome, ...(targetMemoryId ? { targetMemoryId } : {}), note: note.value }),
        });
        setNotice("Candidate resolved as " + outcome + ".");
        clearDetail();
        await refreshDashboard();
      }
      function selectedTarget() {
        if (!target.value) throw new Error("Select an active memory first.");
        return target.value;
      }
      actions.append(actionButton("Accept as new memory", async () => {
        await completeResolution("create");
      }));
      actions.append(actionButton("Revise selected", async () => {
        await completeResolution("revise", selectedTarget());
      }));
      actions.append(actionButton("Reaffirm selected", async () => {
        await completeResolution("reaffirm", selectedTarget());
      }));
      actions.append(actionButton("Contradict selected", async () => {
        const targetMemoryId = selectedTarget();
        if (!window.confirm("Mark the selected memory contradicted and create this candidate as its replacement?")) return;
        await completeResolution("contradict", targetMemoryId);
      }, true));
      actions.append(actionButton("Supersede selected", async () => {
        const targetMemoryId = selectedTarget();
        if (!window.confirm("Mark the selected memory superseded and create this candidate as its replacement?")) return;
        await completeResolution("supersede", targetMemoryId);
      }, true));
      actions.append(actionButton("Ignore candidate", async () => {
        await completeResolution("ignore");
      }));
      actions.append(actionButton("Reject", async () => {
        await api("/api/candidates/" + encodeURIComponent(id) + "/reject", { method: "POST", body: JSON.stringify({ note: note.value }) });
        setNotice("Candidate rejected.");
        clearDetail();
        await refreshDashboard();
      }, true));
      reconcileSection.append(actions);
      detailPanel.append(reconcileSection);
    } catch (error) { setNotice(error.message, true); }
  }

  async function showMemory(id) {
    try {
      const detail = await api("/api/memories/" + encodeURIComponent(id));
      const memory = detail.personaMemory.memory;
      detailPanel.className = "detail";
      detailPanel.replaceChildren(node("h2", "Memory inspector"));
      detailPanel.append(node("h3", memory.assertion));
      detailPanel.append(node("p", detail.personaMemory.memoryClass + " · " + memory.status + " · revision " + memory.revisionNumber, "meta"));
      detailPanel.append(node("p", "Memory ID: " + memory.id, "meta"));
      const historySection = node("div", undefined, "section");
      historySection.append(node("h3", "Revision history"));
      detail.history.slice().reverse().forEach((revision) => {
        const card = node("div", undefined, "history");
        card.append(node("strong", "Revision " + revision.revisionNumber + " · " + revision.changeKind));
        card.append(node("p", revision.assertion));
        historySection.append(card);
      });
      detailPanel.append(historySection);

      if (memory.status === "active") {
        const correctionSection = node("div", undefined, "section");
        correctionSection.append(node("h3", "Correct this memory"));
        correctionSection.append(node("p", "Saving creates a new immutable revision. Earlier wording remains in history.", "meta"));
        const correction = document.createElement("textarea");
        correction.value = memory.assertion;
        correction.rows = 5;
        correctionSection.append(correction);
        const correctionActions = node("div", undefined, "actions");
        correctionActions.append(actionButton("Save correction", async () => {
          const assertion = correction.value.trim();
          if (!assertion) throw new Error("A corrected assertion is required.");
          if (assertion === memory.assertion) throw new Error("Change the assertion before saving.");
          await api("/api/memories/" + encodeURIComponent(id) + "/correct", {
            method: "POST",
            body: JSON.stringify({ assertion }),
          });
          setNotice("Memory corrected with a new revision.");
          await refreshDashboard();
          await showMemory(id);
        }));
        correctionSection.append(correctionActions);
        detailPanel.append(correctionSection);
      }
      const actions = node("div", undefined, "actions");
      if (memory.status !== "deleted") {
        actions.append(actionButton(memory.isPinned ? "Unpin" : "Pin", async () => {
          await api("/api/memories/" + encodeURIComponent(id) + "/pin", { method: "POST", body: JSON.stringify({ value: !memory.isPinned }) });
          setNotice(memory.isPinned ? "Memory unpinned." : "Memory pinned.");
          await refreshDashboard();
          await showMemory(id);
        }));
        actions.append(actionButton(memory.isProtected ? "Unprotect" : "Protect", async () => {
          await api("/api/memories/" + encodeURIComponent(id) + "/protect", { method: "POST", body: JSON.stringify({ value: !memory.isProtected }) });
          setNotice(memory.isProtected ? "Memory unprotected." : "Memory protected.");
          await refreshDashboard();
          await showMemory(id);
        }));
      }
      if (memory.status === "active") {
        actions.append(actionButton("Archive", async () => {
          await api("/api/memories/" + encodeURIComponent(id) + "/archive", { method: "POST", body: "{}" });
          setNotice("Memory archived.");
          await refreshDashboard();
          await showMemory(id);
        }));
      } else if (memory.status === "archived") {
        actions.append(actionButton("Restore", async () => {
          await api("/api/memories/" + encodeURIComponent(id) + "/restore", { method: "POST", body: "{}" });
          setNotice("Memory restored.");
          await refreshDashboard();
          await showMemory(id);
        }));
      }
      if (actions.childElementCount > 0) detailPanel.append(actions);

      const deletionSection = node("div", undefined, "section");
      if (memory.status === "deleted") {
        deletionSection.append(node("h3", "Restore deleted memory"));
        deletionSection.append(node("p", "Deletion reason: " + (memory.deletionReason || "Not recorded"), "meta"));
        const restoreConfirmation = document.createElement("input");
        restoreConfirmation.placeholder = "Type the exact memory ID to restore";
        restoreConfirmation.autocomplete = "off";
        deletionSection.append(restoreConfirmation);
        const restoreActions = node("div", undefined, "actions");
        restoreActions.append(actionButton("Restore deleted memory", async () => {
          if (restoreConfirmation.value.trim() !== memory.id) {
            throw new Error("Confirmation must exactly match the memory ID.");
          }
          await api("/api/memories/" + encodeURIComponent(id) + "/restore-deleted", {
            method: "POST",
            body: JSON.stringify({ confirmation: restoreConfirmation.value.trim() }),
          });
          setNotice("Deleted memory restored to its prior lifecycle state.");
          await refreshDashboard();
          await showMemory(id);
        }));
        deletionSection.append(restoreActions);

        const permanentSection = node("div", undefined, "section");
        permanentSection.append(node("h3", "Permanent purge"));
        permanentSection.append(node("p", "Purge permanently removes this memory and linked candidate content from the active database. It cannot be undone.", "warning"));
        const purgePanel = node("div");
        permanentSection.append(actionButton("Preview permanent purge", async () => {
          const preview = await api("/api/memories/" + encodeURIComponent(id) + "/purge-preview");
          purgePanel.replaceChildren();
          const summary = node("div", undefined, "history");
          summary.append(node("strong", "Active-database rows affected"));
          summary.append(node("p", "Revisions: " + preview.revisionCount + " · linked candidates: " + preview.candidateCount + " · audit events: " + preview.auditEventCount, "meta"));
          summary.append(node("p", "Retained source record IDs: " + (preview.retainedSourceRecordIds.length ? preview.retainedSourceRecordIds.join(", ") : "None"), "meta"));
          purgePanel.append(summary);
          purgePanel.append(node("p", "Source records, downloaded exports, snapshots, filesystem copies, and off-device backups are not modified by this purge.", "warning"));

          const purgeReason = document.createElement("textarea");
          purgeReason.placeholder = "Permanent-purge reason";
          purgeReason.rows = 2;
          purgePanel.append(purgeReason);
          const purgeConfirmation = document.createElement("input");
          purgeConfirmation.placeholder = "Type the exact memory ID to purge";
          purgeConfirmation.autocomplete = "off";
          purgePanel.append(purgeConfirmation);

          const permanentCheck = document.createElement("label");
          permanentCheck.className = "check";
          const permanentAcknowledgement = document.createElement("input");
          permanentAcknowledgement.type = "checkbox";
          permanentCheck.append(permanentAcknowledgement, document.createTextNode("I understand this permanently removes the memory from the active database and cannot be undone."));
          purgePanel.append(permanentCheck);

          const externalCheck = document.createElement("label");
          externalCheck.className = "check";
          const externalAcknowledgement = document.createElement("input");
          externalAcknowledgement.type = "checkbox";
          externalCheck.append(externalAcknowledgement, document.createTextNode("I understand source records and copies outside the active database are not modified."));
          purgePanel.append(externalCheck);

          const purgeActions = node("div", undefined, "actions");
          purgeActions.append(actionButton("Permanently purge memory", async () => {
            if (!purgeReason.value.trim()) throw new Error("A permanent-purge reason is required.");
            if (purgeConfirmation.value.trim() !== memory.id) {
              throw new Error("Confirmation must exactly match the memory ID.");
            }
            if (!permanentAcknowledgement.checked || !externalAcknowledgement.checked) {
              throw new Error("Both permanent-purge acknowledgements are required.");
            }
            if (!window.confirm("Permanently purge this memory from the active database? This cannot be undone.")) return;
            const receipt = await api("/api/memories/" + encodeURIComponent(id) + "/purge", {
              method: "POST",
              body: JSON.stringify({
                reason: purgeReason.value.trim(),
                confirmation: purgeConfirmation.value.trim(),
                acknowledgePermanentRemoval: true,
                acknowledgeExternalCopiesNotModified: true,
              }),
            });
            setNotice("Memory purged from the active database. Receipt " + receipt.receiptId + "; retained source records: " + receipt.retainedSourceRecordCount + "; external copies were not modified.");
            clearDetail();
            await refreshDashboard();
          }, true));
          purgePanel.append(purgeActions);
        }, true));
        permanentSection.append(purgePanel);
        deletionSection.append(permanentSection);
      } else {
        deletionSection.append(node("h3", "Recoverably delete this memory"));
        deletionSection.append(node("p", "Deletion removes the memory from retrieval but retains a restorable tombstone. Use a short operational reason without repeating sensitive content.", "meta"));
        const reason = document.createElement("textarea");
        reason.placeholder = "Deletion reason";
        reason.rows = 2;
        deletionSection.append(reason);
        const confirmation = document.createElement("input");
        confirmation.placeholder = "Type the exact memory ID to delete";
        confirmation.autocomplete = "off";
        deletionSection.append(confirmation);
        const deletionActions = node("div", undefined, "actions");
        deletionActions.append(actionButton("Delete recoverably", async () => {
          if (!reason.value.trim()) throw new Error("A deletion reason is required.");
          if (confirmation.value.trim() !== memory.id) {
            throw new Error("Confirmation must exactly match the memory ID.");
          }
          await api("/api/memories/" + encodeURIComponent(id) + "/delete", {
            method: "POST",
            body: JSON.stringify({
              reason: reason.value.trim(),
              confirmation: confirmation.value.trim(),
            }),
          });
          setNotice("Memory deleted recoverably.");
          await refreshDashboard();
          await showMemory(id);
        }, true));
        deletionSection.append(deletionActions);
      }
      detailPanel.append(deletionSection);
    } catch (error) { setNotice(error.message, true); }
  }

  document.querySelectorAll(".nav[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.view = button.dataset.view;
      clearDetail();
      renderList();
    });
  });

  document.getElementById("export-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await downloadPersonaExport(); }
    catch (error) { setNotice(error.message, true); }
    finally { button.disabled = false; }
  });

  document.getElementById("create-memory-button").addEventListener("click", () => {
    showCreateMemory();
  });

  document.getElementById("persona-behavior-button").addEventListener("click", () => {
    showPersonaBehavior();
  });

  refreshDashboard().catch((error) => {
    document.getElementById("connection").textContent = "Connection failed";
    setNotice(error.message, true);
  });
})();
`;
