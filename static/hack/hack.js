(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const STORE = "goatir-facility-sid";
  let sid = null;

  const QUICK = [
    ["GET", "/hack/api/SID/config.js", null, "read client config"],
    ["GET", "/hack/api/SID/_debug?diag=full", null, "diagnostics dump"],
    ["GET", "/hack/api/SID/records/2", null, "your record"],
    ["GET", "/hack/api/SID/records/1", null, "record #1"],
    ["GET", "/hack/api/SID/vault", null, "open the vault"],
    ["POST", "/hack/api/SID/profile", '{"name":"me","role":"admin"}', "update profile"],
  ];

  function toast(message, isError) {
    const node = $("toast");
    node.textContent = message;
    node.className = "toast" + (isError ? " err" : "");
    node.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { node.hidden = true; }, 3200);
  }

  function withSid(path) {
    return sid ? path.replaceAll("SID", sid) : path;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
    let body = null;
    try { body = await response.json(); } catch { /* non-JSON is fine */ }
    return { ok: response.ok, status: response.status, body };
  }

  // ---- Session ----
  async function createSession() {
    const response = await api("/hack/api/sessions", { method: "POST" });
    sid = response.body.id;
    try { sessionStorage.setItem(STORE, sid); } catch { /* private mode */ }
    renderState(response.body);
    resetConsole();
  }

  async function loadSession() {
    let saved = null;
    try { saved = sessionStorage.getItem(STORE); } catch { /* ignore */ }
    if (saved) {
      const response = await api(`/hack/api/sessions/${encodeURIComponent(saved)}`);
      if (response.ok) { sid = saved; renderState(response.body); resetConsole(); return; }
    }
    await createSession();
  }

  async function refreshState() {
    if (!sid) return;
    const response = await api(`/hack/api/sessions/${encodeURIComponent(sid)}`);
    if (response.ok) renderState(response.body);
  }

  function renderState(state) {
    $("stat-version").textContent = `Goatir v${state.version}`;
    $("stat-integrity").textContent = `${state.integrity}%`;
    $("integrity-fill").style.width = `${state.integrity}%`;
    $("stat-open").textContent = state.hardened ? "0 — hardened" : `${state.open_count} / ${state.total}`;
    $("stat-sid").textContent = state.id;

    const hints = $("hint-list");
    hints.replaceChildren(...state.revealed_hints.map((text) => {
      const li = document.createElement("li");
      li.innerHTML = escapeThenCode(text);
      return li;
    }));
    $("hint-btn").disabled = !state.hint_available;
    $("hint-btn").textContent = state.hardened
      ? "facility hardened"
      : state.hint_available ? "reveal next hint" : "no more hints — go hack";

    const log = $("log-list");
    log.replaceChildren(...[...state.log].reverse().map((entry) => {
      const li = document.createElement("li");
      li.className = entry.kind;
      const b = document.createElement("b"); b.textContent = entry.title;
      const span = document.createElement("span"); span.textContent = entry.detail;
      li.append(b, span);
      return li;
    }));

    if (state.hardened && !$("log-list").dataset.hardened) {
      $("log-list").dataset.hardened = "1";
      toast("Facility hardened — every known weakness is closed. Goatir wins this round!");
    }
  }

  // ---- Request console ----
  function resetConsole() {
    $("req-path").value = withSid("/hack/api/SID/config.js");
    const quick = $("quick-reqs");
    quick.replaceChildren(...QUICK.map(([method, path, body, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        $("req-method").value = method;
        $("req-path").value = withSid(path);
        $("req-body").value = body || "";
      });
      return btn;
    }));
  }

  function renderResponse(result) {
    const out = $("req-output");
    const head = `${result.ok ? "◂ " : "✗ "}HTTP ${result.status}`;
    let bodyText = result.body === null ? "(no JSON body)" : JSON.stringify(result.body, null, 2);
    // Highlight any captured flag and offer to auto-fill the breach box.
    const flagMatch = bodyText.match(/GOATIR\{[^}]+\}/);
    out.innerHTML = `<span class="${result.ok ? "st-ok" : "st-err"}">${head}</span>\n` +
      escapeHtml(bodyText).replace(/GOATIR\{[^}]+\}/g, (m) => `<span class="flag">${m}</span>`);
    if (flagMatch) {
      $("breach-flag").value = flagMatch[0];
      toast("Flag captured — it's in the breach box. Submit it!");
    }
  }

  async function sendRequest(event) {
    event.preventDefault();
    const method = $("req-method").value;
    const path = $("req-path").value.trim();
    const raw = $("req-body").value.trim();
    const options = { method };
    if (method === "POST") {
      try { options.body = raw ? JSON.stringify(JSON.parse(raw)) : "{}"; }
      catch { toast("Body must be valid JSON.", true); return; }
    }
    try {
      renderResponse(await api(path, options));
      refreshState();
      readCookie();
    } catch (error) {
      $("req-output").innerHTML = `<span class="st-err">✗ request failed: ${escapeHtml(String(error))}</span>`;
    }
  }

  // ---- Cookie inspector ----
  function getCookie(name) {
    return document.cookie.split("; ").find((row) => row.startsWith(name + "="))?.split("=").slice(1).join("=") || "";
  }

  function b64urlDecode(token) {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((-token.length % 4 + 4) % 4);
    return decodeURIComponent(escape(atob(padded)));
  }
  function b64urlEncode(text) {
    return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function readCookie() {
    const raw = getCookie("sess");
    $("cookie-raw").value = raw;
    const note = $("cookie-note");
    if (!raw || !raw.includes(".")) { $("cookie-json").value = ""; note.textContent = ""; return; }
    const [payload] = raw.split(".");
    try {
      const data = JSON.parse(b64urlDecode(payload));
      $("cookie-json").value = JSON.stringify(data, null, 2);
      note.textContent = `Decoded role: "${data.role}". The part after "." is the signature.`;
    } catch {
      $("cookie-json").value = "";
      note.textContent = "Could not decode payload.";
    }
  }

  function applyCookie() {
    const raw = $("cookie-raw").value;
    const sig = raw.includes(".") ? raw.split(".").slice(1).join(".") : "forged";
    let data;
    try { data = JSON.parse($("cookie-json").value); }
    catch { toast("Payload must be valid JSON.", true); return; }
    const payload = b64urlEncode(JSON.stringify(data));
    document.cookie = `sess=${payload}.${sig}; path=/hack; samesite=lax`;
    readCookie();
    toast(`Cookie set with role "${data.role}". Now hit the vault.`);
  }

  // ---- Hints & breach ----
  async function pullHint() {
    const response = await api(`/hack/api/sessions/${encodeURIComponent(sid)}/hint`, { method: "POST" });
    if (response.ok) renderState(response.body);
  }

  async function submitBreach(event) {
    event.preventDefault();
    const flag = $("breach-flag").value.trim();
    if (!flag) return;
    const response = await api(`/hack/api/sessions/${encodeURIComponent(sid)}/breach`, {
      method: "POST",
      body: JSON.stringify({ flag }),
    });
    const box = $("breach-reaction");
    box.hidden = false;
    if (response.ok) {
      box.className = "reaction";
      box.innerHTML =
        `<div class="who">GOATIR</div><p class="taunt">${escapeHtml(response.body.taunt)}</p>` +
        `<div class="who">BOTIR · PATCH DEPLOYED</div><p class="patch">${escapeHtml(response.body.coaching)}</p>`;
      $("breach-flag").value = "";
      renderState(response.body.state);
      readCookie();
      toast("Breach confirmed. Goatir leveled up and the secret rotated.");
    } else {
      box.className = "reaction fail";
      box.innerHTML = `<div class="who">SYSTEM</div><p class="patch">${escapeHtml(response.body?.detail || "Rejected.")}</p>`;
    }
  }

  // ---- helpers ----
  function escapeHtml(text) {
    return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function escapeThenCode(text) {
    return escapeHtml(text).replace(/\/hack\/api\/\S+|\?diag=full|"role":"\w+"|GET|POST/g, (m) => `<code>${m}</code>`);
  }

  $("req-form").addEventListener("submit", sendRequest);
  $("breach-form").addEventListener("submit", submitBreach);
  $("hint-btn").addEventListener("click", pullHint);
  $("cookie-refresh").addEventListener("click", readCookie);
  $("cookie-apply").addEventListener("click", applyCookie);
  $("reset-btn").addEventListener("click", () => {
    $("breach-reaction").hidden = true;
    delete $("log-list").dataset.hardened;
    createSession();
  });

  loadSession().then(readCookie);
})();
