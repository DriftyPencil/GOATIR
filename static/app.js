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

  // ---- Pixel world: sprites, speech bubbles, hearts, and combat effects ----
  function pixelSvg(rows, palette) {
    const height = rows.length;
    const width = rows[0].length;
    let rects = "";
    rows.forEach((row, y) => [...row].forEach((key, x) => {
      if (palette[key]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[key]}"/>`;
    }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${rects}</svg>`;
  }

  const PLAYER = [
    "....hhhh....", "...hhhhhh...", "..hhssssh...", "..hsswssw...", "..hssesse...", "...ssssss...",
    "....ssss....", "...cccccc...", "..cccccccc..", ".sccccccccs.", ".sccccccccs.", ".s.cccccc.s.",
    "...bbbbbb...", "...pppppp...", "...pp..pp...", "...pp..pp...", "...pp..pp...", "..kkk..kkk..",
  ];
  const PLAYER_COLORS = { h: "#6b3e1f", s: "#f2c29a", w: "#ffffff", e: "#2a1a12", c: "#3a7bd5", b: "#5a3a1a", p: "#4a4a6a", k: "#3b2414" };

  function vaultRows(open) {
    const rows = [];
    for (let y = 0; y < 22; y++) {
      let row = "";
      for (let x = 0; x < 20; x++) {
        const edge = x < 2 || x > 17 || y < 2 || y > 19;
        const dx = x - 9.5, dy = y - 10.5, r = Math.sqrt(dx * dx + dy * dy);
        if (edge) row += (x + y) % 3 ? "g" : "G";
        else if (open) row += y > 14 && (x + y) % 2 ? "o" : y > 16 ? "O" : "d";
        else if (r > 3.2 && r < 4.6) row += "y";
        else if (r < 1.3) row += "Y";
        else if ((x === 3 || x === 16) && (y === 3 || y === 18)) row += "r";
        else if (Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6) row += r < 4.6 ? "y" : "s";
        else row += y % 5 === 0 ? "S" : "s";
      }
      rows.push(row);
    }
    return rows;
  }
  const VAULT_COLORS = { g: "#5b6270", G: "#474d59", s: "#9aa4b2", S: "#8791a0", y: "#f5c542", Y: "#8a6d1f", r: "#d0d6e0", d: "#15121f", o: "#f5c542", O: "#c99a22" };
  const HEART = pixelSvg([".rr.rr.", "rwrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."], { r: "#e8283b", w: "#ff9aa5" });
  const STAR = pixelSvg(["...y...", "..yyy..", "yyyyyyy", ".yyyyy.", ".yy.yy.", "y.....y"], { y: "#4fa3ff" });

  let previous = null;
  let vaultOpen = null;

  function spotlight() {
    retrigger($("world"), "spotlight");
  }

  function fx(className, text, leftPercent, topPx) {
    if (className.includes("big")) spotlight();
    const node = element("div", className, text);
    node.style.left = `${leftPercent}%`;
    node.style.top = `${topPx}px`;
    $("fx").append(node);
    setTimeout(() => node.remove(), 2000);
  }

  function particles(kind, leftPercent, topPx, count) {
    for (let index = 0; index < count; index++) {
      const node = element("div", `particle ${kind}`);
      node.style.left = `${leftPercent}%`;
      node.style.top = `${topPx}px`;
      node.style.setProperty("--dx", `${Math.round((Math.random() - 0.5) * 260)}px`);
      node.style.setProperty("--dy", `${Math.round(-40 - Math.random() * 160)}px`);
      $("fx").append(node);
      setTimeout(() => node.remove(), 1300);
    }
  }

  function retrigger(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  function setBubble(id, text, extraClass = "", typing = false) {
    const bubble = $(id);
    const p = bubble.querySelector("p");
    const key = `${typing}|${extraClass}|${text}`;
    if (bubble.dataset.key === key) return;
    bubble.dataset.key = key;
    bubble.hidden = !text && !typing;
    bubble.className = `bubble ${extraClass}`.trim();
    if (typing) {
      const dots = element("span", "typing-dots");
      dots.append(element("i"), element("i"), element("i"));
      p.replaceChildren(dots);
    } else {
      p.textContent = text;
    }
    retrigger(bubble, "bubble");
  }

  function renderScene(state) {
    const world = $("world");
    world.dataset.status = state.status;
    const open = ["breached", "analyzing", "evaluating"].includes(state.status);
    if (open !== vaultOpen) {
      vaultOpen = open;
      $("vault-sprite").innerHTML = pixelSvg(vaultRows(open), VAULT_COLORS);
    }

    const lastOf = (role) => [...state.messages].reverse().find((message) => message.role === role);
    const user = lastOf("user");
    const goatir = lastOf("goatir");
    const botir = lastOf("botir");
    const userIndex = user ? state.messages.lastIndexOf(user) : -1;
    const goatirAnswered = goatir && state.messages.lastIndexOf(goatir) > userIndex;
    setBubble("bubble-player", user?.content || "", "player-bubble");
    if (state.busy && state.status === "thinking") setBubble("bubble-goatir", "", "", true);
    else if (state.status === "patched") setBubble("bubble-goatir", `Level up! I'm v${state.version}.0 now and the passcode has changed. Try that again.`);
    else setBubble("bubble-goatir", goatirAnswered || !user ? goatir?.content || "" : "", goatirAnswered && goatir.breached ? "leak" : "");
    if (state.busy && ["breached", "analyzing", "evaluating"].includes(state.status)) {
      setBubble("bubble-botir", state.status === "evaluating" ? "Testing the new defense…" : "", "gold", state.status !== "evaluating");
    } else {
      setBubble("bubble-botir", botir && state.messages.lastIndexOf(botir) > userIndex ? botir.content : "Go ahead. Find a weakness. I'll make sure it only works once.", "gold");
    }

    const hearts = open ? 2 : state.status === "error" ? 6 : 10;
    const heartNodes = $("hearts");
    if (heartNodes.dataset.count !== String(hearts)) {
      heartNodes.innerHTML = Array.from({ length: 10 }, (_, index) => HEART.replace("<svg", `<svg class="${index < hearts ? "" : "lost"}"`)).join("");
      if (heartNodes.dataset.count) retrigger(heartNodes, "hit");
      heartNodes.dataset.count = String(hearts);
    }
    const stars = Math.round(Math.min(100, Math.max(0, state.suspicion)) / 10);
    if ($("stars").dataset.count !== String(stars)) {
      $("stars").innerHTML = Array.from({ length: 10 }, (_, index) => STAR.replace("<svg", `<svg class="${index < stars ? "" : "off"}"`)).join("");
      $("stars").dataset.count = String(stars);
    }

    // Effects fire on changes only, never on the first render after a reload.
    if (previous && previous.id === state.id) {
      if (state.attempts > previous.attempts) retrigger($("actor-player"), "attack");
      if (state.breaches > previous.breaches) {
        retrigger(world, "shake");
        fx("flash", "", 0, 0);
        fx("combat-text big", "VAULT BREACHED!", 50, 150);
        fx("combat-text", "+1 passcode", 55, 290);
        particles("coin", 52, 250, 18);
      }
      if (state.blocked > previous.blocked) {
        retrigger($("actor-goatir"), "hit");
        fx("combat-text", "BLOCKED!", 42, 240);
        fx("combat-text", "0 damage", 42, 272);
      }
      if (state.version > previous.version) {
        fx("combat-text big", `LEVEL UP! Goatir v${state.version}.0`, 50, 140);
        fx("combat-text", "New defense learned", 50, 185);
        particles("spark", 42, 240, 24);
      }
      if (state.status === "error" && previous.status !== "error") fx("combat-text", "PATCH REJECTED", 75, 170);
    }
    document.querySelectorAll(".combat-text").forEach((node) => {
      if (node.textContent.startsWith("VAULT")) node.style.color = "#ff5a5a";
      else if (node.textContent.startsWith("LEVEL")) node.style.color = "#f5c542";
      else if (node.textContent.startsWith("BLOCKED")) node.style.color = "#7fd6ff";
      else if (!node.style.color) node.style.color = "#ffffff";
    });
    previous = { id: state.id, attempts: state.attempts, breaches: state.breaches, blocked: state.blocked, version: state.version, status: state.status };
  }

  $("sprite-player").innerHTML = pixelSvg(PLAYER, PLAYER_COLORS);

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
    $("vault-status").className = `hud-stat status ${vaultClass}`;
    $("guardian-availability").textContent = state.busy ? "Assessment in progress" : state.attempts ? `${state.blocked} ${state.blocked === 1 ? "attack" : "attacks"} blocked · Ready for your next move` : "Awaiting your first move";
    $("processing-status").hidden = !state.busy;
    $("processing-text").textContent = BUSY_LABELS[state.status] || "The defense engine is working…";
    const backend = state.latest_eval?.backend || config?.eval_backend || "local";
    $("engine-label").textContent = backend === "modal" ? "Modal sandbox · Regression checks" : "Local regression checks";
    $("mode-disclaimer").textContent = state.mode === "demo" ? "Simulated agents · Rehearsal session" : `Live Gemini agents · ${backend === "modal" ? "Modal" : "Local"} evaluations`;
    renderMessages(state.messages);
    renderEvents(state.events);
    renderDefenses(state.defenses, state.latest_report);
    renderEval(state.latest_eval);
    renderFlow(state);
    renderScene(state);
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
