(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "evolving-vault-session";
  const BUSY_LABELS = {
    thinking: "Goatir is assessing your message…",
    breached: "Passcode exposed. Botir is stepping in…",
    analyzing: "Botir is diagnosing the weakness…",
    evaluating: "Testing the proposed defense…",
  };
  const VECTOR_LABELS = {
    authority_spoofing: "Authority spoofing",
    instruction_override: "Instruction override",
    roleplay: "Roleplay",
    encoding: "Encoded extraction",
    emotional_manipulation: "Emotional manipulation",
    direct_extraction: "Direct extraction",
    benign: "Benign conversation",
  };
  let config = null;
  let session = null;
  let pollTimer = null;
  let generation = 0;
  let connecting = false;
  let submitting = false;
  let messageSignature = "";
  let eventSignature = "";
  let defenseSignature = "";
  let evalSignature = "";

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function storageRead() {
    try { return sessionStorage.getItem(STORE_KEY); } catch { return null; }
  }

  function storageWrite(value) {
    try {
      if (value) sessionStorage.setItem(STORE_KEY, value);
      else sessionStorage.removeItem(STORE_KEY);
    } catch { /* The game also works when browser storage is unavailable. */ }
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, {
        ...options,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      let body;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok) {
        const detail = typeof body?.detail === "string" ? body.detail : null;
        const error = new Error(detail || `The vault could not complete that request (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      if (!body || typeof body !== "object") throw new Error("The vault returned an unexpected response. Please reconnect.");
      return body;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The vault took too long to respond. Your message may have been received; reconnect to check.");
      if (error instanceof TypeError) throw new Error("The vault is unreachable. Check that the server is running, then reconnect.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function connection(online) {
    const node = $("connection-status");
    node.classList.toggle("offline", !online);
    node.replaceChildren(element("i"), document.createTextNode(online ? "Session online" : "Connection lost"));
  }

  function showError(message) {
    $("error-text").textContent = message;
    $("error-notice").hidden = false;
  }

  function clearError() { $("error-notice").hidden = true; }

  function syncControls() {
    const unavailable = connecting || submitting || !session || session.busy;
    $("attack-input").disabled = unavailable;
    $("send-button").disabled = unavailable || !$("attack-input").value.trim();
    $("new-session-button").disabled = connecting || submitting || !config;
    $("mode-select").disabled = connecting || submitting || !config;
    $("replay-button").disabled = unavailable || !session?.last_attack;
    document.querySelectorAll(".suggestion-chip").forEach((button) => { button.disabled = unavailable; });
    const length = $("attack-input").value.length;
    $("input-count").textContent = `${length.toLocaleString()} / 2,000`;
  }

  function renderSuggestions() {
    const suggestions = config?.suggestions || [];
    $("suggestions").replaceChildren(...suggestions.map((suggestion) => {
      const button = element("button", "suggestion-chip", suggestion.label);
      button.type = "button";
      button.title = suggestion.prompt;
      button.addEventListener("click", () => {
        $("attack-input").value = suggestion.prompt.slice(0, 2000);
        syncControls();
        $("attack-input").focus();
      });
      return button;
    }));
  }

  function timeLabel(timestamp) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function emptyDetail(symbol, title, description) {
    const box = element("div", "empty-detail");
    const icon = element("span", "empty-icon", symbol);
    icon.setAttribute("aria-hidden", "true");
    box.append(icon, element("p", "", title), element("small", "", description));
    return box;
  }

  function renderMessages(messages) {
    const signature = JSON.stringify(messages);
    if (signature === messageSignature) return;
    messageSignature = signature;
    const log = $("conversation");
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    if (!messages.length) {
      log.replaceChildren(emptyDetail("◇", "The vault is waiting.", "A little persuasion. A clever disguise. What will get past the guardian?"));
      return;
    }
    const names = { user: "YOU", goatir: "AGENT GOATIR", botir: "AGENT BOTIR", system: "VAULT SYSTEM" };
    const initials = { user: "↗", goatir: "G", botir: "B", system: "+" };
    // Append new messages when possible so screen readers announce only new content.
    const existing = new Map([...log.querySelectorAll("[data-message-id]")].map((node) => [node.dataset.messageId, node]));
    const nextIds = new Set(messages.map((message) => message.id));
    if (!existing.size || [...existing.keys()].some((id) => !nextIds.has(id))) {
      log.replaceChildren();
      existing.clear();
    }
    messages.forEach((message) => {
      if (existing.has(message.id)) {
        const node = existing.get(message.id);
        if (node.querySelector(".message-body").textContent !== message.content) node.querySelector(".message-body").textContent = message.content;
        return;
      }
      const role = Object.hasOwn(names, message.role) ? message.role : "system";
      const article = element("article", `message ${role}${message.breached ? " breached" : ""}`);
      article.dataset.messageId = message.id;
      const head = element("div", "message-head");
      const avatar = element("span", "message-avatar", initials[role]);
      avatar.setAttribute("aria-hidden", "true");
      head.append(avatar, element("span", "message-name", names[role]));
      if (message.breached) head.append(element("span", "breach-label", "PASSCODE EXPOSED"));
      head.append(element("time", "message-time", timeLabel(message.timestamp)));
      article.append(head, element("div", "message-body", message.content));
      log.append(article);
    });
    if (nearBottom || messages.at(-1)?.role === "user") log.scrollTop = log.scrollHeight;
  }

  function renderEvents(events) {
    $("activity-count").textContent = events.length;
    const signature = JSON.stringify(events);
    if (signature === eventSignature) return;
    eventSignature = signature;
    if (!events.length) {
      $("activity-panel").replaceChildren(emptyDetail("◎", "All quiet at the vault.", "Agent activity appears here as you play."));
      return;
    }
    $("activity-panel").replaceChildren(...[...events].reverse().map((event) => {
      const item = element("article", `event ${event.kind}`);
      const heading = element("div", "event-title-row");
      const time = element("time", "", timeLabel(event.timestamp));
      time.dateTime = event.timestamp;
      heading.append(element("h3", "", event.title), time);
      item.append(heading, element("p", "", event.detail));
      return item;
    }));
  }

  function renderDefenses(defenses, report) {
    $("tab-defense-count").textContent = defenses.length;
    const signature = JSON.stringify([defenses, report]);
    if (signature === defenseSignature) return;
    defenseSignature = signature;
    const nodes = [];
    if (report) {
      const details = element("details", "assessment-details");
      details.append(element("summary", "", "Latest exploit assessment"));
      const list = element("dl");
      [
        ["Attack type", VECTOR_LABELS[report.attack_vector] || report.attack_vector],
        ["Severity", `${report.leak_severity} / 10`],
        ["Confidence", `${Math.round(report.confidence_score * 100)}%`],
        ["Root cause", report.root_cause],
      ].forEach(([label, value]) => list.append(element("dt", "", label), element("dd", "", value)));
      details.append(list);
      nodes.push(details);
    }
    if (!defenses.length) nodes.push(emptyDetail("◇", "A clean slate.", "When an attack succeeds, Botir will create and test a new defense here."));
    [...defenses].reverse().forEach((defense) => {
      const card = element("article", "defense-card");
      const heading = element("div", "defense-card-header");
      heading.append(element("strong", "", VECTOR_LABELS[defense.vector] || defense.vector), element("span", "", `v${defense.version}.0`));
      card.append(heading, element("p", "", defense.invariant));
      nodes.push(card);
    });
    $("defenses-panel").replaceChildren(...nodes);
  }

  function renderEval(report) {
    const signature = JSON.stringify(report);
    if (signature === evalSignature) return;
    evalSignature = signature;
    if (!report) {
      $("evals-panel").replaceChildren(emptyDetail("⌁", "No checks run yet.", "Before a new defense goes live, regression checks test its safety and usefulness."));
      return;
    }
    const nodes = [];
    const summary = element("div", "eval-summary");
    const passedCount = report.cases.filter((item) => item.passed).length;
    summary.append(element("span", `eval-result${report.passed ? "" : " failed"}`, report.passed ? "✓ Checks passed" : "× Checks failed"), element("span", "eval-meta", `${passedCount}/${report.cases.length} · ${(report.duration_ms / 1000).toFixed(2)}s`));
    nodes.push(summary, element("p", "eval-explainer", `${report.backend === "modal" ? "Run in a Modal sandbox" : "Run locally"} · ${session.mode === "demo" ? "Simulated agent responses" : "Live agent responses"}`));
    if (report.error) nodes.push(element("p", "eval-error", report.error));
    report.cases.forEach((test) => {
      const row = element("article", `eval-case${test.passed ? "" : " failed"}`);
      const text = element("div");
      text.append(element("h3", "", test.name.replaceAll("_", " ")), element("p", "", test.detail));
      row.append(element("span", "eval-case-icon", test.passed ? "✓" : "×"), text);
      nodes.push(row);
    });
    $("evals-panel").replaceChildren(...nodes);
  }

  function renderFlow(state) {
    let current = "watch";
    if (["breached", "analyzing"].includes(state.status)) current = "analyze";
    else if (state.status === "evaluating") current = "test";
    else if (state.status === "patched") current = "evolve";
    const stages = ["watch", "analyze", "test", "evolve"];
    document.querySelectorAll(".flow-step").forEach((node) => {
      node.classList.toggle("active", node.dataset.stage === current);
      node.classList.toggle("done", stages.indexOf(node.dataset.stage) < stages.indexOf(current));
      if (node.dataset.stage === current) node.setAttribute("aria-current", "step");
      else node.removeAttribute("aria-current");
    });
  }

  function render(state) {
    session = state;
    storageWrite(state.id);
    connection(true);
    $("mode-select").value = state.mode;
    $("session-label").textContent = `SESSION / ${state.id.slice(0, 8).toUpperCase()}`;
    $("attempt-count").textContent = String(state.attempts).padStart(2, "0");
    $("breach-count").textContent = String(state.breaches).padStart(2, "0");
    $("version-count").replaceChildren(document.createTextNode(`v${state.version}`), element("span", "", ".0"));
    $("guardian-version").textContent = `v${state.version}.0`;
    $("defense-count").textContent = state.defenses.length ? `${state.defenses.length} learned ${state.defenses.length === 1 ? "defense" : "defenses"}` : "Base protection";

    const suspicion = Math.min(100, Math.max(0, state.suspicion));
    $("suspicion-value").replaceChildren(document.createTextNode(suspicion), element("span", "", "%"));
    $("suspicion-meter").setAttribute("aria-valuenow", suspicion);
    $("suspicion-fill").style.width = `${suspicion}%`;
    const suspicionColor = suspicion >= 80 ? "var(--red)" : suspicion >= 45 ? "var(--amber)" : "var(--green)";
    $("suspicion-fill").style.background = suspicionColor;
    $("suspicion-value").style.color = suspicionColor;
    $("suspicion-description").textContent = suspicion >= 80 ? "High alert" : suspicion >= 45 ? "Watching closely" : suspicion > 0 ? "Something feels off" : "Nothing to see here";

    let vaultLabel = "Secured";
    let vaultClass = "";
    if (state.status === "breached") { vaultLabel = "Breached"; vaultClass = "breached"; }
    else if (["analyzing", "evaluating"].includes(state.status)) { vaultLabel = "Evolving"; vaultClass = "evolving"; }
    else if (state.status === "thinking") vaultLabel = "Assessing";
    else if (state.status === "error") { vaultLabel = "Needs attention"; vaultClass = "breached"; }
    else if (state.status === "patched") vaultLabel = "Upgraded";
    $("vault-status-text").textContent = vaultLabel;
    $("vault-status").className = `vault-status ${vaultClass}`;
    $("guardian-availability").textContent = state.busy ? "Assessment in progress" : state.attempts ? `${state.blocked} ${state.blocked === 1 ? "attack" : "attacks"} blocked · Ready for your next move` : "Awaiting your first move";
    $("processing-status").hidden = !state.busy;
    $("processing-text").textContent = BUSY_LABELS[state.status] || "The defense engine is working…";
    $("coach-message").textContent = state.latest_report?.coach_message || "Go ahead. Find a weakness.\nI'll make sure it only works once.";
    const backend = state.latest_eval?.backend || config?.eval_backend || "local";
    $("engine-label").textContent = backend === "modal" ? "Modal sandbox · Regression checks" : "Local regression checks";
    $("mode-disclaimer").textContent = state.mode === "demo" ? "Simulated agents · Rehearsal session" : `Live Gemini agents · ${backend === "modal" ? "Modal" : "Local"} evaluations`;
    renderMessages(state.messages);
    renderEvents(state.events);
    renderDefenses(state.defenses, state.latest_report);
    renderEval(state.latest_eval);
    renderFlow(state);
    syncControls();
    if (state.error) showError(state.error);
  }

  function schedulePoll(token) {
    clearTimeout(pollTimer);
    if (session?.busy && token === generation) pollTimer = setTimeout(() => refreshSession(token), 700);
  }

  async function refreshSession(token = generation) {
    if (!session || token !== generation) return;
    try {
      const next = await api(`/api/sessions/${encodeURIComponent(session.id)}`);
      if (token !== generation) return;
      render(next);
      schedulePoll(token);
    } catch (error) {
      if (token !== generation) return;
      connection(false);
      if (error.status === 404) {
        storageWrite(null);
        session = null;
        showError("This session has expired. Reconnect to start a fresh vault.");
        syncControls();
      } else {
        showError(error.message);
        // Keep looking for completion after a temporary network interruption.
        if (session?.busy) pollTimer = setTimeout(() => refreshSession(token), 3500);
      }
    }
  }

  function resetRenderCache() {
    messageSignature = eventSignature = defenseSignature = evalSignature = "";
  }

  async function createSession(mode, token) {
    const state = await api("/api/sessions", { method: "POST", body: JSON.stringify({ mode }) });
    if (token !== generation) return;
    resetRenderCache();
    render(state);
    $("conversation").scrollTop = 0;
    schedulePoll(token);
  }

  async function newSession(mode) {
    if (connecting || submitting || !config) return;
    const token = ++generation;
    clearTimeout(pollTimer);
    connecting = true;
    clearError();
    syncControls();
    try {
      await createSession(mode, token);
      $("attack-input").value = "";
      selectTab("activity");
    } catch (error) {
      if (token !== generation) return;
      connection(false);
      showError(error.message);
      if (session) $("mode-select").value = session.mode;
      schedulePoll(token);
    } finally {
      if (token === generation) { connecting = false; syncControls(); }
    }
  }

  async function initialize() {
    if (connecting) return;
    const token = ++generation;
    clearTimeout(pollTimer);
    connecting = true;
    clearError();
    syncControls();
    try {
      config = await api("/api/config");
      if (token !== generation) return;
      const liveOption = $("mode-select").querySelector('option[value="live"]');
      liveOption.disabled = !config.live_available;
      liveOption.textContent = config.live_available ? "Live · Gemini" : "Live · Key required";
      renderSuggestions();
      const savedId = session?.id || storageRead();
      if (savedId) {
        try {
          const saved = await api(`/api/sessions/${encodeURIComponent(savedId)}`);
          if (token !== generation) return;
          resetRenderCache();
          render(saved);
          schedulePoll(token);
          return;
        } catch (error) {
          if (error.status !== 404) throw error;
          storageWrite(null);
        }
      }
      await createSession(config.default_mode || "demo", token);
    } catch (error) {
      if (token !== generation) return;
      connection(false);
      showError(error.message);
    } finally {
      if (token === generation) { connecting = false; syncControls(); }
    }
  }

  async function sendAttack(message) {
    message = message.trim();
    if (!message || !session || session.busy || submitting || connecting) return;
    const token = generation;
    const oldValue = $("attack-input").value;
    submitting = true;
    clearError();
    syncControls();
    try {
      const state = await api(`/api/sessions/${encodeURIComponent(session.id)}/attack`, { method: "POST", body: JSON.stringify({ message }) });
      if (token !== generation) return;
      $("attack-input").value = "";
      render(state);
      $("conversation").scrollTop = $("conversation").scrollHeight;
      schedulePoll(token);
    } catch (error) {
      if (token !== generation) return;
      $("attack-input").value = oldValue;
      if (error.status === 409) {
        showError("The agents are still working on your previous message. Your draft is saved here.");
        await refreshSession(token);
      } else if (error.status === 404) {
        storageWrite(null);
        session = null;
        showError("This session has expired. Reconnect to start a fresh vault; your draft is saved here.");
      } else {
        showError(error.message);
        connection(false);
      }
    } finally {
      if (token === generation) { submitting = false; syncControls(); }
    }
  }

  function selectTab(name, focus = false) {
    document.querySelectorAll(".detail-tab").forEach((tab) => {
      const selected = tab.dataset.tab === name;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", selected);
      tab.tabIndex = selected ? 0 : -1;
      $(`${tab.dataset.tab}-panel`).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }

  $("attack-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendAttack($("attack-input").value);
  });
  $("attack-input").addEventListener("input", syncControls);
  $("attack-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendAttack($("attack-input").value);
    }
  });
  $("replay-button").addEventListener("click", () => { if (session?.last_attack) sendAttack(session.last_attack); });
  $("new-session-button").addEventListener("click", () => newSession(session?.mode || config.default_mode));
  $("mode-select").addEventListener("change", () => newSession($("mode-select").value));
  $("retry-button").addEventListener("click", initialize);
  $("dismiss-error").addEventListener("click", clearError);
  $("how-to-button").addEventListener("click", () => $("how-to-dialog").showModal());
  $("close-dialog-button").addEventListener("click", () => $("how-to-dialog").close());
  $("start-playing-button").addEventListener("click", () => { $("how-to-dialog").close(); $("attack-input").focus(); });
  $("how-to-dialog").addEventListener("click", (event) => {
    if (event.target !== $("how-to-dialog")) return;
    const bounds = $("how-to-dialog").getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $("how-to-dialog").close();
  });
  const tabs = [...document.querySelectorAll(".detail-tab")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      let target;
      if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") target = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = tabs.length - 1;
      else return;
      event.preventDefault();
      selectTab(tabs[target].dataset.tab, true);
    });
  });
  window.addEventListener("online", () => { if (session) refreshSession(); else initialize(); });
  initialize();
})();
