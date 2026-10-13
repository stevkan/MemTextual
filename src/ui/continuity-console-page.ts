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
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
button.action { border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; background: #2a352a; color: inherit; cursor: pointer; }
button.action:hover { border-color: var(--accent); }
button.action.danger { color: var(--danger); }
textarea, select { width: 100%; margin-top: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; color: inherit; background: #101410; }
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
    const heading = node("h2", state.view === "candidates" ? "Pending review" : "Persona memories");
    listPanel.append(heading);
    const items = state.view === "candidates" ? state.dashboard.candidates : state.dashboard.memories;
    if (items.length === 0) {
      listPanel.append(node("p", state.view === "candidates" ? "No pending candidates." : "No stored memories.", "empty"));
      return;
    }
    items.forEach((item) => {
      const candidate = item.candidate;
      const profile = item.personaMemory;
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
    document.getElementById("connection").textContent = "Local session active";
    renderList();
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
      const note = document.createElement("textarea");
      note.placeholder = "Optional review note";
      note.rows = 3;
      detailPanel.append(note);
      const actions = node("div", undefined, "actions");
      actions.append(actionButton("Accept as new memory", async () => {
        await api("/api/candidates/" + encodeURIComponent(id) + "/resolve", { method: "POST", body: JSON.stringify({ outcome: "create", note: note.value }) });
        setNotice("Candidate accepted.");
        clearDetail();
        await refreshDashboard();
      }));
      actions.append(actionButton("Reject", async () => {
        await api("/api/candidates/" + encodeURIComponent(id) + "/reject", { method: "POST", body: JSON.stringify({ note: note.value }) });
        setNotice("Candidate rejected.");
        clearDetail();
        await refreshDashboard();
      }, true));
      detailPanel.append(actions);
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
      const historySection = node("div", undefined, "section");
      historySection.append(node("h3", "Revision history"));
      detail.history.slice().reverse().forEach((revision) => {
        const card = node("div", undefined, "history");
        card.append(node("strong", "Revision " + revision.revisionNumber + " · " + revision.changeKind));
        card.append(node("p", revision.assertion));
        historySection.append(card);
      });
      detailPanel.append(historySection);
      const actions = node("div", undefined, "actions");
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
      detailPanel.append(actions);
    } catch (error) { setNotice(error.message, true); }
  }

  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.view = button.dataset.view;
      clearDetail();
      renderList();
    });
  });

  refreshDashboard().catch((error) => {
    document.getElementById("connection").textContent = "Connection failed";
    setNotice(error.message, true);
  });
})();
`;
