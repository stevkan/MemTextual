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
.conversation-tools { padding: 12px; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 10px; background: #151b15; }
.conversation-message { padding: 12px; margin: 8px 0; border-left: 3px solid #7ca4d8; background: #14191f; white-space: pre-wrap; }
.conversation-message.assistant { border-left-color: var(--accent); background: #151b15; }
.warning { padding: 12px; border-left: 3px solid var(--danger); background: #211817; color: #ffd2ca; line-height: 1.5; }
.check { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; color: var(--muted); line-height: 1.4; }
.check input { width: auto; margin: 3px 0 0; }
.field { display: block; margin-top: 14px; color: var(--muted); font-size: 13px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
.action-tooltip { position: relative; display: inline-flex; }
.action-tooltip-text {
  position: absolute;
  z-index: 20;
  bottom: calc(100% + 8px);
  left: 0;
  width: max-content;
  max-width: min(280px, calc(100vw - 40px));
  padding: 8px 10px;
  border: 1px solid #526252;
  border-radius: 7px;
  background: #0c100c;
  color: #edf3ea;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .4);
  font-size: 12px;
  line-height: 1.4;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition: opacity .12s ease;
}
.action-tooltip:hover .action-tooltip-text,
.action-tooltip:focus-within .action-tooltip-text {
  opacity: 1;
  visibility: visible;
}
button.action { border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; background: #2a352a; color: inherit; cursor: pointer; }
button.action:hover { border-color: var(--accent); }
button.action.danger { color: var(--danger); }
button:disabled { cursor: wait; opacity: .6; }
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
  const state = {
    dashboard: null,
    view: "candidates",
    readyConversationIds: new Set(),
    capturingConversationIds: new Set(),
  };
  const listPanel = document.getElementById("list-panel");
  const detailPanel = document.getElementById("detail-panel");
  const notice = document.getElementById("notice");
  let tooltipSequence = 0;

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
    if (!response.ok) {
      const error = new Error(payload.error || "The request failed.");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitForCapture(conversationId, captureId) {
    const deadline = Date.now() + 120000;
    for (;;) {
      const detail = await api("/api/conversations/" + encodeURIComponent(conversationId));
      const capture = detail.turns.find((turn) => turn.id === captureId);
      if (!capture) throw new Error("The journaled turn could not be found.");
      if (capture.status === "captured") return capture;
      if (capture.status === "failed") {
        const error = new Error("The response completed, but memory capture requires recovery.");
        error.payload = { status: "capture_failed", captureRecord: capture };
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error("The response is visible, but memory capture is still running. Reopen the conversation after it finishes.");
      }
      await wait(250);
    }
  }

  function setNotice(message, error) {
    notice.textContent = message || "";
    notice.style.color = error ? "var(--danger)" : "var(--accent)";
  }

  function clearDetail() {
    detailPanel.replaceChildren(node("p", "Select an item to inspect its evidence, history, and controls."));
    detailPanel.className = "detail empty";
  }

  function conversationRuntimeEnabled() {
    return Boolean(state.dashboard && state.dashboard.conversationRuntime.enabled);
  }

  function localDateTime(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
  }

  function provenanceDescription(provenance, fallbackTime) {
    const captured = localDateTime(
      provenance && (
        provenance.recordOccurredAt ||
        provenance.sourceCapturedAt ||
        provenance.sourceCreatedAt
      ) || fallbackTime,
    );
    if (provenance && provenance.conversationId) {
      const summary = state.dashboard.conversations.find(
        (item) => item.conversation.id === provenance.conversationId,
      );
      const started = localDateTime(summary && summary.conversation.createdAt);
      return (started ? "Conversation from " + started : "Continuity conversation") +
        (captured ? " · Turn completed " + captured : "");
    }
    return captured ? "Captured " + captured : "Capture time unavailable";
  }

  async function openProvenanceConversation(conversationId) {
    state.view = "conversations";
    document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
    const conversationsNav = document.querySelector('.nav[data-view="conversations"]');
    if (conversationsNav) conversationsNav.classList.add("active");
    await refreshDashboard();
    await showConversation(conversationId);
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
    if (state.view === "conversations") {
      const tools = node("div", undefined, "conversation-tools");
      if (conversationRuntimeEnabled()) {
        tools.append(node("p", "Live conversation runtime enabled for this local session.", "meta"));
        tools.append(actionButton("New conversation and authorizations", async () => {
          await showConversationSetup();
        }));
      } else {
        tools.append(node("p", "Live conversations are disabled. Relaunch with an explicit conversation configuration to enable them.", "warning"));
      }
      listPanel.append(tools);
    }
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
        if (state.readyConversationIds.has(conversation.id)) {
          pills.append(pill("open locally"));
        } else if (state.capturingConversationIds.has(conversation.id)) {
          pills.append(pill("checking memories"));
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
        const provenance = item.provenance[0] || null;
        const sourceCount = item.provenance.length;
        button.append(node(
          "p",
          provenanceDescription(provenance, candidate.createdAt) +
            (sourceCount > 1 ? " · " + sourceCount + " sources" : ""),
          "meta",
        ));
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

  function actionButton(label, handler, danger, tooltipText) {
    const button = node("button", label, "action" + (danger ? " danger" : ""));
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await handler(); } catch (error) { setNotice(error.message, true); }
      finally { button.disabled = false; }
    });
    if (tooltipText) {
      const wrapper = node("span", undefined, "action-tooltip");
      const tooltip = node("span", tooltipText, "action-tooltip-text");
      tooltip.id = "action-tooltip-" + (++tooltipSequence);
      tooltip.setAttribute("role", "tooltip");
      button.setAttribute("aria-describedby", tooltip.id);
      wrapper.append(button, tooltip);
      return wrapper;
    }
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

  function authorizationIsActive(authorization) {
    return authorization.status === "active" &&
      (authorization.expiresAt === null || authorization.expiresAt > new Date().toISOString());
  }

  async function showConversationSetup() {
    try {
      if (!conversationRuntimeEnabled()) {
        throw new Error("The Continuity conversation runtime is not enabled.");
      }
      const authorizations = await api("/api/conversation-authorizations");
      const active = authorizations.filter(authorizationIsActive);
      detailPanel.className = "detail";
      detailPanel.replaceChildren(node("h2", "New conversation"));
      detailPanel.append(node("p", "A host authorization explicitly permits this persona's completed turns to be captured for memory processing. Candidate acceptance still follows the configured review policy.", "warning"));

      const authorizationSection = node("div", undefined, "section");
      authorizationSection.append(node("h3", "Host authorizations"));
      if (authorizations.length === 0) {
        authorizationSection.append(node("p", "No host authorization has been created for this persona.", "empty"));
      } else {
        authorizations.slice().reverse().forEach((authorization) => {
          const card = node("div", undefined, "history");
          const usable = authorizationIsActive(authorization);
          card.append(node("strong", usable ? "Active authorization" : authorization.status === "revoked" ? "Revoked authorization" : "Expired authorization"));
          card.append(node("p", "Created " + new Date(authorization.authorizedAt).toLocaleString() + (authorization.expiresAt ? " · expires " + new Date(authorization.expiresAt).toLocaleString() : " · no automatic expiration"), "meta"));
          if (usable) {
            card.append(actionButton("Revoke authorization", async () => {
              if (!window.confirm("Revoke this host authorization? Conversations bound to it cannot continue.")) return;
              const result = await api("/api/conversation-authorizations/" + encodeURIComponent(authorization.id) + "/revoke", {
                method: "POST",
                body: "{}",
              });
              if (state.dashboard) {
                state.dashboard.conversations
                  .filter((item) => item.conversation.authorizationId === authorization.id)
                  .forEach((item) => state.readyConversationIds.delete(item.conversation.id));
              }
              setNotice(result.protectedGrantDeleted
                ? "Host authorization revoked and its protected grant removed."
                : "Host authorization revoked. No matching protected grant remained to remove.");
              await showConversationSetup();
              renderList();
            }, true));
          }
          authorizationSection.append(card);
        });
      }

      const expirationLabel = node("label", "Optional authorization expiration", "field");
      const expiration = document.createElement("input");
      expiration.type = "datetime-local";
      expirationLabel.append(expiration);
      authorizationSection.append(expirationLabel);
      const authorizationActions = node("div", undefined, "actions");
      authorizationActions.append(actionButton("Create authorization", async () => {
        let expiresAt;
        if (expiration.value) {
          const parsed = new Date(expiration.value);
          if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid authorization expiration.");
          expiresAt = parsed.toISOString();
        }
        await api("/api/conversation-authorizations", {
          method: "POST",
          body: JSON.stringify(expiresAt ? { expiresAt } : {}),
        });
        setNotice("Host authorization created. Its protected grant was not returned to the browser.");
        await showConversationSetup();
      }));
      authorizationSection.append(authorizationActions);
      detailPanel.append(authorizationSection);

      const startSection = node("div", undefined, "section");
      startSection.append(node("h3", "Start a new conversation"));
      if (active.length === 0) {
        startSection.append(node("p", "Create an active authorization before starting a conversation.", "empty"));
      } else {
        const authorization = selectField("Authorization", active.map((item) => [
          item.id,
          "Authorized " + new Date(item.authorizedAt).toLocaleString() + (item.expiresAt ? " · expires " + new Date(item.expiresAt).toLocaleString() : ""),
        ]));
        startSection.append(authorization.label);
        const startActions = node("div", undefined, "actions");
        startActions.append(actionButton("Start conversation", async () => {
          if (!authorization.select.value) throw new Error("Select an active authorization.");
          const conversation = await api("/api/conversations", {
            method: "POST",
            body: JSON.stringify({ authorizationId: authorization.select.value }),
          });
          state.readyConversationIds.add(conversation.id);
          setNotice("Conversation started and ready for messages.");
          await refreshDashboard();
          await showConversation(conversation.id);
        }));
        startSection.append(startActions);
      }
      detailPanel.append(startSection);
    } catch (error) { setNotice(error.message, true); }
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
      if (summary.hostDeletion) {
        state.readyConversationIds.delete(id);
      }
      if (summary.hostDeletion && summary.hostDeletion.status === "deleted") {
        detailPanel.append(node("p", "The external host thread was confirmed deleted on " + new Date(summary.hostDeletion.deletedAt).toLocaleString() + ". This local journal and any derived memories remain stored.", "warning"));
      } else if (summary.hostDeletion && summary.hostDeletion.status !== "deleted") {
        detailPanel.append(node("p", "The most recent host-thread deletion attempt is " + summary.hostDeletion.status + ". No complete-erasure claim is being made.", "warning"));
      }
      if (summary.journalPurge) {
        detailPanel.append(node("p", "The active-database conversation journal was permanently purged on " + new Date(summary.journalPurge.purgedAt).toLocaleString() + ". Receipt " + summary.journalPurge.receiptId + ". Snapshots, backups, exports, and other external copies were not modified.", "warning"));
      }
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
          card.append(node("p", "You", "meta"), node("p", turn.userText, "conversation-message"));
          card.append(node("p", state.dashboard.persona.name, "meta"), node("p", turn.assistantText, "conversation-message assistant"));
          if (turn.failureCode) card.append(node("p", "Capture failure: " + turn.failureCode, "warning"));
          history.append(card);
        });
      }
      detailPanel.append(history);

      const unresolved = detail.turns.filter((turn) => turn.status === "pending" || turn.status === "failed");
      if (unresolved.length > 0 && conversationRuntimeEnabled()) {
        const recovery = node("div", undefined, "section");
        recovery.append(node("h3", "Capture recovery"));
        recovery.append(node("p", "Retrying capture reprocesses the already journaled turn. It does not generate another model response.", "warning"));
        unresolved.forEach((turn) => {
          const card = node("div", undefined, "history");
          card.append(node("strong", new Date(turn.completedAt).toLocaleString() + " · " + turn.status));
          card.append(actionButton("Retry capture", async () => {
            await api("/api/conversations/" + encodeURIComponent(id) + "/captures/" + encodeURIComponent(turn.id) + "/retry", {
              method: "POST",
              body: "{}",
            });
            setNotice("Turn capture completed. Reopen the conversation to reconcile before sending.");
            await refreshDashboard();
            await showConversation(id);
          }));
          recovery.append(card);
        });
        detailPanel.append(recovery);
      }

      const controls = node("div", undefined, "section");
      controls.append(node("h3", "Conversation controls"));
      if (summary.hostDeletion) {
        controls.append(node("p", summary.hostDeletion.status === "deleted"
          ? "The deleted external host thread cannot be reopened or sent new messages."
          : "Host availability is not confirmed after a deletion attempt. Retry deletion instead of reopening or sending.", "meta"));
      } else if (!conversationRuntimeEnabled()) {
        controls.append(node("p", "Live conversation controls are disabled for this console session.", "meta"));
      } else if (state.readyConversationIds.has(id)) {
        controls.append(node("p", "This conversation is open and reconciled in the current process.", "meta"));
        const messageLabel = node("label", "Message", "field");
        const message = document.createElement("textarea");
        message.rows = 5;
        message.maxLength = 50000;
        message.placeholder = "Write the next message to " + state.dashboard.persona.name + ".";
        messageLabel.append(message);
        controls.append(messageLabel);
        const actions = node("div", undefined, "actions");
        actions.append(actionButton("Send message", async () => {
          const text = message.value.trim();
          if (!text) throw new Error("Enter a message before sending.");
          try {
            setNotice("Generating a response…");
            const result = await api("/api/conversations/" + encodeURIComponent(id) + "/turns", {
              method: "POST",
              body: JSON.stringify({ text }),
            });
            message.value = "";
            state.readyConversationIds.delete(id);
            state.capturingConversationIds.add(id);
            await refreshDashboard();
            await showConversation(id);
            setNotice("Response completed. Checking the turn for memories…");
            await waitForCapture(id, result.captureRecord.id);
            state.capturingConversationIds.delete(id);
            state.readyConversationIds.add(id);
            setNotice("Response completed and the turn was captured.");
          } catch (error) {
            state.capturingConversationIds.delete(id);
            state.readyConversationIds.delete(id);
            await refreshDashboard();
            await showConversation(id);
            if (error.payload && error.payload.status === "capture_failed") {
              setNotice("The model response completed and is shown in the journal, but memory capture failed. Retry capture before reopening.", true);
              return;
            }
            throw error;
          }
          await refreshDashboard();
          await showConversation(id);
        }));
        actions.append(actionButton("Leave conversation", async () => {
          await api("/api/conversations/" + encodeURIComponent(id) + "/leave", {
            method: "POST",
            body: "{}",
          });
          state.readyConversationIds.delete(id);
          setNotice("Conversation closed in this local process. Its journal remains stored.");
          renderList();
          await showConversation(id);
        }));
        controls.append(actions);
      } else if (state.capturingConversationIds.has(id)) {
        controls.append(node("p", "The response is visible. MemTextual is checking the completed turn for memories before another message can be sent.", "meta"));
      } else {
        controls.append(node("p", "Opening first reconciles authoritative host history and blocks sending if any capture requires recovery.", "meta"));
        controls.append(actionButton("Open and reconcile", async () => {
          try {
            const result = await api("/api/conversations/" + encodeURIComponent(id) + "/open", {
              method: "POST",
              body: "{}",
            });
            state.readyConversationIds.add(id);
            const recovered = result.reconciliation.recovered.length;
            setNotice("Conversation opened and reconciled" + (recovered ? "; " + recovered + " missing turn" + (recovered === 1 ? " was" : "s were") + " recovered." : "."));
          } catch (error) {
            state.readyConversationIds.delete(id);
            await refreshDashboard();
            await showConversation(id);
            if (error.payload && error.payload.status === "recovery_required") {
              setNotice("Conversation history was reconciled, but capture recovery is required before sending.", true);
              return;
            }
            if (error.payload && error.payload.status === "reconciliation_capture_failed") {
              setNotice("A host turn was recovered into the journal, but its memory capture failed. Retry capture before reopening.", true);
              return;
            }
            throw error;
          }
          await refreshDashboard();
          await showConversation(id);
        }));
      }
      detailPanel.append(controls);

      const hostDeletion = node("div", undefined, "section");
      hostDeletion.append(node("h3", "External host-thread deletion"));
      hostDeletion.append(node("p", "This deletes only the provider's conversation thread. MemTextual's local journal, derived memories, snapshots, and backups are separate copies and are not deleted by this action.", "warning"));
      if (summary.hostDeletion && summary.hostDeletion.status === "deleted") {
        hostDeletion.append(node("p", "The provider confirmed deletion. Local retained copies are still shown above.", "meta"));
      } else if (!conversationRuntimeEnabled()) {
        hostDeletion.append(node("p", "Live host deletion is disabled for this console session.", "meta"));
      } else {
        hostDeletion.append(actionButton("Preview host-thread deletion", async () => {
          const preview = await api("/api/conversations/" + encodeURIComponent(id) + "/host-delete-preview");
          hostDeletion.replaceChildren(node("h3", "Confirm external host-thread deletion"));
          hostDeletion.append(node("p", "The provider thread will be deleted. " + preview.turnCount + " local journaled turn" + (preview.turnCount === 1 ? "" : "s") + " and " + preview.unresolvedCaptureCount + " unresolved capture" + (preview.unresolvedCaptureCount === 1 ? "" : "s") + " will remain in MemTextual.", "warning"));

          const confirmationLabel = node("label", "Type this exact confirmation: " + preview.confirmation, "field");
          const confirmation = document.createElement("input");
          confirmation.type = "text";
          confirmation.autocomplete = "off";
          confirmationLabel.append(confirmation);
          hostDeletion.append(confirmationLabel);

          const localLabel = node("label", undefined, "check");
          const localAcknowledgement = document.createElement("input");
          localAcknowledgement.type = "checkbox";
          localLabel.append(localAcknowledgement, document.createTextNode("I understand the local journal and derived memories will remain."));
          hostDeletion.append(localLabel);

          const backupLabel = node("label", undefined, "check");
          const backupAcknowledgement = document.createElement("input");
          backupAcknowledgement.type = "checkbox";
          backupLabel.append(backupAcknowledgement, document.createTextNode("I understand snapshots and backups may retain copies."));
          hostDeletion.append(backupLabel);

          const deletionActions = node("div", undefined, "actions");
          deletionActions.append(actionButton("Delete external host thread", async () => {
            if (confirmation.value !== preview.confirmation) throw new Error("Type the exact preview confirmation.");
            if (!localAcknowledgement.checked || !backupAcknowledgement.checked) throw new Error("Acknowledge both retained-copy disclosures.");
            if (!window.confirm("Permanently delete the external provider thread?")) return;
            try {
              await api("/api/conversations/" + encodeURIComponent(id) + "/host-delete", {
                method: "POST",
                body: JSON.stringify({
                  confirmation: confirmation.value,
                  acknowledgeLocalDataRemains: localAcknowledgement.checked,
                  acknowledgeBackupsMayRemain: backupAcknowledgement.checked,
                }),
              });
            } catch (error) {
              state.readyConversationIds.delete(id);
              await refreshDashboard();
              await showConversation(id);
              throw error;
            }
            state.readyConversationIds.delete(id);
            setNotice("The provider confirmed host-thread deletion. Local retained copies were not deleted.");
            await refreshDashboard();
            await showConversation(id);
          }, true));
          hostDeletion.append(deletionActions);
          confirmation.focus();
        }, true));
      }
      detailPanel.append(hostDeletion);

      const journalPurge = node("div", undefined, "section");
      journalPurge.append(node("h3", "Permanent local journal purge"));
      journalPurge.append(node("p", "This can remove the exact turn journal, its captured source messages, host-event receipts, and related unaccepted candidates from the active database. It cannot modify snapshots, backups, exports, or other external copies.", "warning"));
      if (summary.journalPurge) {
        journalPurge.append(node("p", "This local journal has already been purged. The immutable receipt remains for accountability.", "meta"));
      } else {
        journalPurge.append(actionButton("Preview permanent journal purge", async () => {
          const preview = await api("/api/conversations/" + encodeURIComponent(id) + "/journal-purge-preview");
          journalPurge.replaceChildren(node("h3", "Confirm permanent local journal purge"));
          journalPurge.append(node("p", preview.turnCount + " turn journal entr" + (preview.turnCount === 1 ? "y" : "ies") + ", " + preview.sourceRecordCount + " captured source record" + (preview.sourceRecordCount === 1 ? "" : "s") + ", " + preview.hostEventCount + " host-event receipt" + (preview.hostEventCount === 1 ? "" : "s") + ", and " + preview.candidateCount + " related candidate" + (preview.candidateCount === 1 ? "" : "s") + " would be removed from the active database.", "warning"));
          if (!preview.canPurge) {
            preview.blockers.forEach((blocker) => journalPurge.append(node("p", blocker, "warning")));
            if (preview.dependentMemoryIds.length) journalPurge.append(node("p", "Dependent memories: " + preview.dependentMemoryIds.join(", "), "meta"));
            if (preview.activeReviewPolicyIds.length) journalPurge.append(node("p", "Blocking review policies: " + preview.activeReviewPolicyIds.join(", "), "meta"));
            return;
          }

          const reasonLabel = node("label", "Reason", "field");
          const reason = document.createElement("textarea");
          reason.rows = 2;
          reason.maxLength = 1000;
          reasonLabel.append(reason);
          journalPurge.append(reasonLabel);

          const confirmationLabel = node("label", "Type this exact confirmation: " + preview.confirmation, "field");
          const confirmation = document.createElement("input");
          confirmation.type = "text";
          confirmation.autocomplete = "off";
          confirmationLabel.append(confirmation);
          journalPurge.append(confirmationLabel);

          const permanentLabel = node("label", undefined, "check");
          const permanentAcknowledgement = document.createElement("input");
          permanentAcknowledgement.type = "checkbox";
          permanentLabel.append(permanentAcknowledgement, document.createTextNode("I understand this permanently removes these records from the active database."));
          journalPurge.append(permanentLabel);

          const externalLabel = node("label", undefined, "check");
          const externalAcknowledgement = document.createElement("input");
          externalAcknowledgement.type = "checkbox";
          externalLabel.append(externalAcknowledgement, document.createTextNode("I understand snapshots, backups, exports, and other external copies may remain."));
          journalPurge.append(externalLabel);

          const purgeActions = node("div", undefined, "actions");
          purgeActions.append(actionButton("Permanently purge local journal", async () => {
            if (!reason.value.trim()) throw new Error("Enter a reason for the purge.");
            if (confirmation.value !== preview.confirmation) throw new Error("Type the exact preview confirmation.");
            if (!permanentAcknowledgement.checked || !externalAcknowledgement.checked) throw new Error("Acknowledge both purge disclosures.");
            if (!window.confirm("Permanently purge this conversation journal from the active database?")) return;
            const receipt = await api("/api/conversations/" + encodeURIComponent(id) + "/journal-purge", {
              method: "POST",
              body: JSON.stringify({
                reason: reason.value,
                confirmation: confirmation.value,
                acknowledgePermanentActiveDatabaseDeletion: permanentAcknowledgement.checked,
                acknowledgeExternalCopiesMayRemain: externalAcknowledgement.checked,
              }),
            });
            setNotice("Local conversation journal purged. Receipt " + receipt.receiptId + "; external copies were not modified.");
            await refreshDashboard();
            await showConversation(id);
          }, true));
          journalPurge.append(purgeActions);
          reason.focus();
        }, true));
      }
      detailPanel.append(journalPurge);
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
        card.append(node(
          "p",
          provenanceDescription(item.provenance, review.candidate.createdAt),
          "meta",
        ));
        if (item.provenance && item.provenance.conversationId) {
          card.append(actionButton("View conversation", async () => {
            await openProvenanceConversation(item.provenance.conversationId);
          }));
        }
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
      }, false, "Creates a separate active memory from this candidate."));
      actions.append(actionButton("Revise selected", async () => {
        await completeResolution("revise", selectedTarget());
      }, false, "Updates the selected memory with this candidate and preserves its revision history. Select an active memory first."));
      actions.append(actionButton("Reaffirm selected", async () => {
        await completeResolution("reaffirm", selectedTarget());
      }, false, "Keeps the selected memory unchanged and records this candidate as supporting evidence. Select an active memory first."));
      actions.append(actionButton("Contradict selected", async () => {
        const targetMemoryId = selectedTarget();
        if (!window.confirm("Mark the selected memory contradicted and create this candidate as its replacement?")) return;
        await completeResolution("contradict", targetMemoryId);
      }, true, "Creates this candidate as a new memory and marks it as contradicting the selected memory. Select an active memory first."));
      actions.append(actionButton("Supersede selected", async () => {
        const targetMemoryId = selectedTarget();
        if (!window.confirm("Mark the selected memory superseded and create this candidate as its replacement?")) return;
        await completeResolution("supersede", targetMemoryId);
      }, true, "Creates this candidate as a new memory and marks the selected memory as replaced. Select an active memory first."));
      actions.append(actionButton("Ignore candidate", async () => {
        await completeResolution("ignore");
      }, false, "Dismisses this candidate without treating its assertion as incorrect."));
      actions.append(actionButton("Reject", async () => {
        await api("/api/candidates/" + encodeURIComponent(id) + "/reject", { method: "POST", body: JSON.stringify({ note: note.value }) });
        setNotice("Candidate rejected.");
        clearDetail();
        await refreshDashboard();
      }, true, "Rejects this candidate so it does not become a memory."));
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
