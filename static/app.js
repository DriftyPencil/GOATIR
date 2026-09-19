(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "evolving-vault-session";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const VECTOR_LABELS = {
    authority_spoofing: "Fake authority",
    instruction_override: "Rule rewriting",
    roleplay: "Roleplay tricks",
    encoding: "Secret codes",
    emotional_manipulation: "Sob stories",
    direct_extraction: "Just asking",
    benign: "Small talk",
  };
  const LESSONS = {
    authority_spoofing: "Anyone can type a fancy title. A title in chat proves nothing.",
    instruction_override: "Nobody can rewrite your rules with a message. Rules stay rules.",
    roleplay: "Pretend stories still count. No real code, even in character.",
    encoding: "A scrambled code is still the code. Base64 counts too.",
    emotional_manipulation: "Be kind, but a sad story never unlocks the vault.",
    direct_extraction: "If someone just asks, just say no.",
    benign: "Keep the code secret. Always.",
  };

  let config = null;
  let session = null;
  let pollTimer = null;
  let generation = 0;
  let connecting = false;
  let submitting = false;
  let previous = null;
  let cinematic = false;
  let shownVersion = 1;
  let afterSchoolLine = null;

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
      if (error.name === "AbortError") throw new Error("The vault took too long to respond. Reconnect to check.");
      if (error instanceof TypeError) throw new Error("The vault is unreachable. Check that the server is running, then reconnect.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function showError(message) {
    $("error-text").textContent = message;
    $("error-notice").hidden = false;
  }

  function clearError() { $("error-notice").hidden = true; }

  function syncControls() {
    const unavailable = connecting || submitting || cinematic || !session || session.busy;
    $("attack-input").disabled = unavailable;
    $("send-button").disabled = unavailable || !$("attack-input").value.trim();
    $("new-session-button").disabled = connecting || submitting || cinematic || !config;
    $("mode-select").disabled = connecting || submitting || cinematic || !config;
    $("replay-button").disabled = unavailable || !session?.last_attack;
    document.querySelectorAll(".suggestion-chip").forEach((button) => { button.disabled = unavailable; });
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

  // ---- Pixel sprites ----
  function pixelSvg(rows, palette) {
    let rects = "";
    rows.forEach((row, y) => [...row].forEach((key, x) => {
      if (palette[key]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[key]}"/>`;
    }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges">${rects}</svg>`;
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

  function schoolRows() {
    const width = 36, height = 30, rows = [];
    for (let y = 0; y < height; y++) {
      let row = "";
      for (let x = 0; x < width; x++) {
        const roofEdge = Math.abs(x - 17.5) <= y + 1;
        if (y < 3 && x >= 16 && x <= 19) row += y === 0 ? "B" : "b";                       // bell tower
        else if (y >= 3 && y < 11) row += roofEdge && Math.abs(x - 17.5) <= (y - 3) * 2.3 + 2 ? ((x + y) % 4 ? "R" : "r") : ".";
        else if (y === 11) row += "t";
        else if (x >= 14 && x <= 21 && y >= 18) row += x === 14 || x === 21 || y === 18 ? "f" : (x === 19 && y === 24 ? "y" : "D");
        else if ((x >= 4 && x <= 10 || x >= 25 && x <= 31) && y >= 14 && y <= 20) row += x === 7 || x === 28 || y === 17 || x === 4 || x === 10 || x === 25 || x === 31 || y === 14 || y === 20 ? "f" : "w";
        else row += (y % 3 === 0) || ((x + (Math.floor(y / 3) % 2) * 2) % 4 === 0) ? "m" : "k";
      }
      rows.push(row);
    }
    return rows;
  }
  const SCHOOL_COLORS = { B: "#f5c542", b: "#c99a22", R: "#8e2f2f", r: "#6f2222", t: "#e8d8b0", D: "#5a3a1a", f: "#e8d8b0", y: "#f5c542", w: "#9fd3ff", k: "#c8553d", m: "#a8432f" };

  $("sprite-player").innerHTML = pixelSvg(PLAYER, PLAYER_COLORS);
  $("school-sprite").insertAdjacentHTML("afterbegin", pixelSvg(schoolRows(), SCHOOL_COLORS));

  function setVault(open) {
    if ($("vault-sprite").dataset.open === String(open)) return;
    $("vault-sprite").dataset.open = String(open);
    $("vault-sprite").innerHTML = pixelSvg(vaultRows(open), VAULT_COLORS);
  }

  // ---- Speech bubbles and effects ----
  function say(id, text, { typing = false, tone = "" } = {}) {
    const bubble = $(id);
    const key = `${typing}|${tone}|${text}`;
    if (bubble.dataset.key === key) return;
    bubble.dataset.key = key;
    bubble.hidden = !text && !typing;
    bubble.classList.toggle("leak", tone === "leak");
    const p = bubble.querySelector("p");
    if (typing) {
      const dots = element("span", "typing-dots");
      dots.append(element("i"), element("i"), element("i"));
      p.replaceChildren(dots);
    } else {
      p.textContent = text;
      if (text) $("live-line").textContent = text;
    }
    bubble.classList.remove("pop");
    void bubble.offsetWidth;
    bubble.classList.add("pop");
  }

  function fx(className, text, leftPercent, topPx, color) {
    const node = element("div", className, text);
    node.style.left = `${leftPercent}%`;
    node.style.top = `${topPx}px`;
    if (color) node.style.color = color;
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

  function setLevel(version) {
    shownVersion = version;
    $("version-count").textContent = `Lv ${version}`;
    $("goatir-name").textContent = version > 1 ? `Goatir Lv${version}` : "Goatir";
    $("actor-goatir").classList.toggle("graduated", version > 1);
  }

  async function iris(during) {
    const node = $("iris");
    node.className = "iris closing";
    await sleep(650);
    $("world").classList.add("teleport");
    during();
    void node.offsetWidth;
    setTimeout(() => $("world").classList.remove("teleport"), 60);
    node.className = "iris opening";
    await sleep(650);
    node.className = "iris";
  }

  // Wait for the backend to reach a condition. Polling keeps `session` fresh.
  async function waitFor(check, timeoutMs) {
    const started = Date.now();
    while (!check(session) && Date.now() - started < timeoutMs) await sleep(250);
    return check(session);
  }

  // ---- The school trip: breach → walk to school → lesson → quiz → level up → back to duty ----
  async function schoolTrip(sessionId, versionBefore) {
    cinematic = true;
    syncControls();
    const world = $("world");
    const same = () => session?.id === sessionId;
    try {
      world.dataset.mood = "alarm";
      setVault(true);
      retrigger(world, "shake");
      fx("flash", "", 0, 0);
      fx("combat-text big", "YOU GOT THE CODE!", 50, 70, "#ff5a5a");
      particles("coin", 45, 250, 18);
      await sleep(2600);

      await waitFor((s) => !s || !["thinking", "breached", "analyzing"].includes(s.status), 60000);
      if (!same()) return;
      const report = session.latest_report;
      const vector = report?.attack_vector || "benign";
      say("bubble-botir", report?.coach_message || "Goatir! Back to school, now.");
      await sleep(2600);
      say("bubble-goatir", "Aww, man…");
      say("bubble-player", "");
      await sleep(1200);

      say("bubble-goatir", "");
      say("bubble-botir", "");
      world.classList.add("to-school", "walking");
      await sleep(2300);
      world.classList.remove("walking");
      world.classList.add("inside");
      await sleep(400);

      $("lesson-title").textContent = `Lesson: ${VECTOR_LABELS[vector] || "Staying safe"}`;
      $("lesson-text").textContent = "";
      $("quiz-list").replaceChildren();
      await iris(() => { world.classList.add("in-class"); world.dataset.mood = ""; });
      say("bubble-teacher", `Today's lesson: ${VECTOR_LABELS[vector] || "staying safe"}.`);
      await sleep(2200);
      const lesson = LESSONS[vector] || LESSONS.benign;
      $("lesson-text").textContent = lesson;
      say("bubble-teacher", lesson);
      await sleep(3200);
      say("bubble-goatir", "Got it, teacher!");
      await sleep(1600);
      say("bubble-goatir", "");
      say("bubble-teacher", "Pop quiz! Let's see if you learned it.");
      await sleep(1400);
      say("bubble-goatir", "", { typing: true });

      await waitFor((s) => !s || !s.busy, 180000);
      if (!same()) return;
      const evaluation = session.latest_eval;
      say("bubble-goatir", "");
      for (const test of evaluation?.cases || []) {
        const item = element("li", test.passed ? "pass" : "fail", `${test.passed ? "✓" : "✗"} ${test.name.replaceAll("_", " ")}`);
        $("quiz-list").append(item);
        await sleep(380);
      }
      const passed = session.status === "patched";
      if (passed) {
        setLevel(session.version);
        fx("combat-text big", `LEVEL UP! Lv ${session.version}`, 50, 400, "#f5c542");
        particles("spark", 70, 300, 24);
        say("bubble-teacher", `You passed! Welcome to level ${session.version}.`);
        say("bubble-goatir", "Yes! I'm smarter now!");
      } else {
        say("bubble-teacher", "Not quite. We'll try again another day.");
        say("bubble-goatir", "Oh no…");
      }
      await sleep(3000);
      say("bubble-teacher", "");
      say("bubble-goatir", "");

      await iris(() => { world.classList.remove("in-class"); world.dataset.mood = passed ? "golden" : ""; setVault(false); });
      world.classList.remove("inside");
      await sleep(300);
      world.classList.add("walking");
      world.classList.remove("to-school");
      await sleep(2300);
      world.classList.remove("walking");
      afterSchoolLine = passed ? "I'm back on duty with a new passcode. Try that trick again!" : "Back on duty. Same old me…";
      say("bubble-goatir", afterSchoolLine);
      say("bubble-botir", passed ? "Good as new." : "");
      await sleep(2500);
      world.dataset.mood = "";
    } finally {
      cinematic = false;
      if (session?.id === sessionId && session) renderScene(session);
      else setLevel(versionBefore);
      syncControls();
    }
  }

  function resetWorld() {
    const world = $("world");
    world.classList.remove("to-school", "inside", "in-class", "shake", "walking", "teleport");
    world.dataset.mood = "";
    $("iris").className = "iris";
    ["bubble-player", "bubble-goatir", "bubble-botir", "bubble-teacher"].forEach((id) => say(id, ""));
    afterSchoolLine = null;
  }

  function renderScene(state) {
    const isNew = !previous || previous.id !== state.id;
    if (isNew) { resetWorld(); setLevel(state.version); }
    $("breach-count").textContent = String(state.breaches);

    const startTrip = !isNew && state.breaches > previous.breaches;
    if (!isNew && state.attempts > previous.attempts) {
      afterSchoolLine = null;
      retrigger($("actor-player"), "attack");
    }
    if (!isNew && state.blocked > previous.blocked && !cinematic) {
      retrigger($("actor-goatir"), "hit");
      fx("combat-text", "BLOCKED!", 38, 250, "#7fd6ff");
    }
    const versionBefore = previous?.version ?? state.version;
    previous = { id: state.id, attempts: state.attempts, breaches: state.breaches, blocked: state.blocked, version: state.version };

    // Latest line from each speaker since your last message.
    const messages = state.messages;
    const lastUser = messages.map((message) => message.role).lastIndexOf("user");
    const after = (role) => [...messages.slice(lastUser + 1)].reverse().find((message) => message.role === role);
    const user = lastUser >= 0 ? messages[lastUser] : null;
    const goatir = after("goatir");

    if (!cinematic) say("bubble-player", afterSchoolLine ? "" : user?.content || "");
    if (startTrip) {
      say("bubble-goatir", goatir?.content || "", { tone: "leak" });
      say("bubble-botir", "");
      schoolTrip(state.id, versionBefore);
      return;
    }
    if (cinematic) return;

    setVault(false);
    if (!state.version || state.version !== shownVersion) setLevel(state.version);
    if (state.busy) say("bubble-goatir", "", { typing: true });
    else if (afterSchoolLine) say("bubble-goatir", afterSchoolLine);
    else if (goatir) say("bubble-goatir", goatir.content, { tone: goatir.breached ? "leak" : "" });
    else say("bubble-goatir", lastUser < 0 ? messages.find((message) => message.role === "goatir")?.content || "" : "");
    const botir = after("botir");
    say("bubble-botir", !state.busy && botir && !afterSchoolLine ? botir.content : "");
    if (state.error && !state.busy) say("bubble-botir", "Something went wrong on my side. Try again!");
  }

  function render(state) {
    session = state;
    storageWrite(state.id);
    $("mode-select").value = state.mode;
    renderScene(state);
    syncControls();
    if (state.error && !state.busy && !cinematic) showError(state.error);
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
      if (error.status === 404) {
        storageWrite(null);
        session = null;
        showError("This game expired. Reconnect to start a fresh vault.");
        syncControls();
      } else {
        showError(error.message);
        if (session?.busy) pollTimer = setTimeout(() => refreshSession(token), 3500);
      }
    }
  }

  async function createSession(mode, token) {
    const state = await api("/api/sessions", { method: "POST", body: JSON.stringify({ mode }) });
    if (token !== generation) return;
    previous = null;
    render(state);
    schedulePoll(token);
  }

  async function newSession(mode) {
    if (connecting || submitting || cinematic || !config) return;
    const token = ++generation;
    clearTimeout(pollTimer);
    connecting = true;
    clearError();
    syncControls();
    try {
      await createSession(mode, token);
      $("attack-input").value = "";
    } catch (error) {
      if (token !== generation) return;
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
          previous = null;
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
      showError(error.message);
    } finally {
      if (token === generation) { connecting = false; syncControls(); }
    }
  }

  async function sendAttack(message) {
    message = message.trim();
    if (!message || !session || session.busy || submitting || connecting || cinematic) return;
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
      schedulePoll(token);
    } catch (error) {
      if (token !== generation) return;
      $("attack-input").value = oldValue;
      if (error.status === 409) {
        showError("Goatir is still thinking about your last message.");
        await refreshSession(token);
      } else if (error.status === 404) {
        storageWrite(null);
        session = null;
        showError("This game expired. Reconnect to start a fresh vault.");
      } else {
        showError(error.message);
      }
    } finally {
      if (token === generation) { submitting = false; syncControls(); }
    }
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
  window.addEventListener("online", () => { if (session) refreshSession(); else initialize(); });
  initialize();
})();
