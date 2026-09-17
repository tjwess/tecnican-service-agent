const API_BASE = "/plugins/tecnican/front/api";
const STORAGE_KEY = "tecnican.agent.v1";
const PREFERENCES_KEY = "tecnican.agent.preferences.v1";
const DEFAULT_QUEUE_INTERVAL_MS = 60000;
const ALLOWED_QUEUE_INTERVALS = new Set([30000, 60000, 120000, 180000, 240000, 300000]);
let queueRefreshTimerId = null;
let eventLoopGeneration = 0;

const state = {
  baseUrl: "",
  token: "",
  user: null,
  tickets: [],
  sessions: [],
  history: [],
  pendingSessionId: null,
  focusedSessionId: null,
  queueSearch: "",
  queueFilter: "all",
  initializedQueue: false,
  newTicketIds: new Set(),
  lastSyncAt: null,
  refreshing: false,
  queueIntervalMs: DEFAULT_QUEUE_INTERVAL_MS,
  eventCursor: "",
  eventBaseUrl: "",
  realtimeConnected: false,
};

const els = {
  loginForm: document.querySelector("#loginForm"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsClose: document.querySelector("#settingsClose"),
  settingsDialog: document.querySelector("#settingsDialog"),
  connectPrompt: document.querySelector("#connectPrompt"),
  baseUrl: document.querySelector("#baseUrl"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  logoutButton: document.querySelector("#logoutButton"),
  notificationButton: document.querySelector("#notificationButton"),
  refreshButton: document.querySelector("#refreshButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  focusTicket: document.querySelector("#focusTicket"),
  focusTimer: document.querySelector("#focusTimer"),
  focusAction: document.querySelector("#focusAction"),
  slotCount: document.querySelector("#slotCount"),
  openSessionCount: document.querySelector("#openSessionCount"),
  totalElapsed: document.querySelector("#totalElapsed"),
  activeSessions: document.querySelector("#activeSessions"),
  sessionHistory: document.querySelector("#sessionHistory"),
  ticketQueue: document.querySelector("#ticketQueue"),
  queueCount: document.querySelector("#queueCount"),
  syncStatus: document.querySelector("#syncStatus"),
  queueSearch: document.querySelector("#queueSearch"),
  queueFilter: document.querySelector("#queueFilter"),
  queueInterval: document.querySelector("#queueInterval"),
  toast: document.querySelector("#toast"),
  finishDialog: document.querySelector("#finishDialog"),
  finishForm: document.querySelector("#finishForm"),
  finishDescription: document.querySelector("#finishDescription"),
  finishSolveTicket: document.querySelector("#finishSolveTicket"),
  suspendDialog: document.querySelector("#suspendDialog"),
  suspendForm: document.querySelector("#suspendForm"),
  suspendReason: document.querySelector("#suspendReason"),
  suspendText: document.querySelector("#suspendText"),
  pauseDialog: document.querySelector("#pauseDialog"),
  pauseForm: document.querySelector("#pauseForm"),
  pauseReason: document.querySelector("#pauseReason"),
};

function loadStoredSession() {
  try {
    const preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    const interval = Number(preferences.queueIntervalMs);
    if (ALLOWED_QUEUE_INTERVALS.has(interval)) {
      state.queueIntervalMs = interval;
    }
    state.eventCursor = typeof preferences.eventCursor === "string" ? preferences.eventCursor : "";
    state.eventBaseUrl = typeof preferences.eventBaseUrl === "string" ? preferences.eventBaseUrl : "";
  } catch {
    localStorage.removeItem(PREFERENCES_KEY);
  }
  els.queueInterval.value = String(state.queueIntervalMs);

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const saved = JSON.parse(raw);
    state.baseUrl = saved.baseUrl || "";
    state.token = saved.token || "";
    if (state.eventBaseUrl !== state.baseUrl) {
      state.eventCursor = "";
    }
    els.baseUrl.value = state.baseUrl;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function savePreferences() {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
    queueIntervalMs: state.queueIntervalMs,
    eventCursor: state.eventCursor,
    eventBaseUrl: state.eventBaseUrl,
  }));
}

function saveStoredSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    baseUrl: state.baseUrl,
    token: state.token,
  }));
}

function clearStoredSession() {
  localStorage.removeItem(STORAGE_KEY);
  state.token = "";
  state.user = null;
  state.tickets = [];
  state.sessions = [];
  state.history = [];
  state.queueSearch = "";
  state.queueFilter = "all";
  state.initializedQueue = false;
  state.newTicketIds.clear();
  state.lastSyncAt = null;
  els.queueSearch.value = "";
  els.queueFilter.value = "all";
}

function endpoint(path) {
  return `${state.baseUrl.replace(/\/$/, "")}${API_BASE}${path}`;
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
  };

  const response = await fetch(endpoint(path), {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const error = new Error(payload.error?.message || `HTTP ${response.status}`);
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function setBusy(isBusy) {
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

function statusLabel(status) {
  return {
    running: "Rodando",
    paused: "Pausada",
    suspended: "Suspensa",
    finished: "Finalizada",
  }[status] || status;
}

function parseServerTime(value) {
  if (!value) {
    return null;
  }
  return new Date(String(value).replace(" ", "T"));
}

function formatSeconds(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours, minutes, remaining].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatMoney(minorUnits, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(Number(minorUnits || 0) / 100);
}

function sessionElapsedSeconds(session) {
  const base = Number(session.elapsed_seconds || 0);
  if (session.status !== "running" || !session.active_started_at) {
    return base;
  }

  const activeStarted = parseServerTime(session.active_started_at);
  if (!activeStarted || Number.isNaN(activeStarted.getTime())) {
    return base;
  }

  const serverReported = Number(session.accumulated_seconds || 0);
  const liveDelta = Math.max(0, Math.floor((Date.now() - activeStarted.getTime()) / 1000));
  return Math.max(base, serverReported + liveDelta);
}

function ticketName(session) {
  return session.ticket?.name || `Ticket #${session.ticket_id}`;
}

function renderConnection() {
  if (!state.token || !state.user) {
    els.connectionStatus.textContent = "Desconectado";
    els.logoutButton.hidden = true;
    els.notificationButton.hidden = true;
    els.syncStatus.textContent = "Aguardando conexao";
    els.syncStatus.classList.remove("online");
    els.connectPrompt.classList.add("visible");
    return;
  }

  els.connectionStatus.textContent = `${state.user.name} conectado`;
  els.logoutButton.hidden = false;
  els.notificationButton.hidden = !("Notification" in window) || Notification.permission === "granted";
  const syncTime = state.lastSyncAt
    ? state.lastSyncAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  els.syncStatus.textContent = state.realtimeConnected
    ? `Tempo real${syncTime ? ` · ${syncTime}` : ""}`
    : (syncTime ? `Atualizado ${syncTime}` : "Sincronizando");
  els.syncStatus.classList.add("online");
  els.connectPrompt.classList.remove("visible");
}

function renderFocus() {
  const selected = state.sessions.find((session) => session.id === state.focusedSessionId);
  const focused = selected || state.sessions.find((session) => session.status === "running");
  if (!focused) {
    els.focusTicket.textContent = "Nenhuma sessao rodando";
    els.focusTimer.textContent = "00:00:00";
    els.focusAction.classList.remove("running");
    els.focusAction.title = "Selecionar chamado";
    return;
  }

  state.focusedSessionId = focused.id;
  els.focusTicket.textContent = ticketName(focused);
  els.focusTimer.textContent = formatSeconds(sessionElapsedSeconds(focused));
  els.focusAction.classList.toggle("running", focused.status === "running");
  els.focusAction.title = focused.status === "running" ? "Finalizar atendimento" : "Retomar atendimento";
}

function renderStats() {
  const runningCount = state.sessions.filter((session) => session.status === "running").length;
  const totalSeconds = state.sessions.reduce((total, session) => total + sessionElapsedSeconds(session), 0);
  els.slotCount.textContent = `${runningCount}/3`;
  els.openSessionCount.textContent = String(state.sessions.length);
  els.totalElapsed.textContent = formatSeconds(totalSeconds);
}

function renderSessions() {
  if (state.sessions.length === 0) {
    state.focusedSessionId = null;
    els.activeSessions.innerHTML = '<p class="empty">Sem sessoes abertas.</p>';
    renderFocus();
    renderStats();
    return;
  }

  if (!state.sessions.some((session) => session.id === state.focusedSessionId)) {
    state.focusedSessionId = state.sessions.find((session) => session.status === "running")?.id
      || state.sessions[0].id;
  }

  els.activeSessions.innerHTML = state.sessions.map((session) => {
    const canPause = session.status === "running";
    const canResume = session.status === "paused" || session.status === "suspended";
    const elapsed = formatSeconds(sessionElapsedSeconds(session));
    return `
      <article class="sessionCard ${session.id === state.focusedSessionId ? "isFocused" : ""}" data-session-id="${session.id}">
        <div>
          <div class="sessionTitle">${escapeHtml(ticketName(session))}</div>
          <div class="meta">
            <span>#${session.ticket_id}</span>
            <span class="statusPill ${session.status}">${statusLabel(session.status)}</span>
            <span>${escapeHtml(elapsed)} acumulado</span>
            <span>Inicio ${escapeHtml(session.started_at || "-")}</span>
          </div>
          <div class="miniClock" data-session-clock="${session.id}">${elapsed}</div>
        </div>
        <div class="sessionActions">
          <button data-action="pause" ${canPause ? "" : "disabled"}>Pausar</button>
          <button data-action="resume" ${canResume ? "" : "disabled"}>Retomar</button>
          <button data-action="suspend">Suspender</button>
          <button data-action="finish" class="primary">Finalizar</button>
        </div>
      </article>
    `;
  }).join("");
  renderFocus();
  renderStats();
}

function renderHistory() {
  if (state.history.length === 0) {
    els.sessionHistory.innerHTML = '<p class="empty">Nenhum atendimento finalizado.</p>';
    return;
  }

  els.sessionHistory.innerHTML = state.history.map((session) => `
    <article class="historyItem">
      <div>
        <div class="sessionTitle">${escapeHtml(ticketName(session))}</div>
        <div class="meta">
          <span>#${session.ticket_id}</span>
          <span>${escapeHtml(session.finished_at || "-")}</span>
        </div>
        <p class="historyDescription">${escapeHtml(session.finish_description || "Sem descricao")}</p>
        ${session.billing ? `<div class="meta billingMeta"><span>Real ${formatSeconds(session.billing.real_seconds)}</span><span>Faturavel ${formatSeconds(session.billing.billable_seconds)}</span><span>${escapeHtml(formatMoney(session.billing.amount_minor, session.billing.currency))}</span></div>` : ""}
      </div>
      <span class="historyTime">${formatSeconds(Number(session.elapsed_seconds || 0))}</span>
    </article>
  `).join("");
}

function renderLiveTimers() {
  renderFocus();
  renderStats();
  state.sessions.forEach((session) => {
    const clock = els.activeSessions.querySelector(`[data-session-clock="${session.id}"]`);
    if (clock) {
      clock.textContent = formatSeconds(sessionElapsedSeconds(session));
    }
  });
}

function renderTickets() {
  const tickets = filteredTickets();
  els.queueCount.textContent = `${tickets.length}/${state.tickets.length}`;
  if (tickets.length === 0) {
    els.ticketQueue.innerHTML = '<p class="empty">Fila vazia.</p>';
    return;
  }

  const activeTicketIds = new Set(state.sessions.map((session) => session.ticket_id));
  const runningSlotsFull = state.sessions.filter((session) => session.status === "running").length >= 3;
  els.ticketQueue.innerHTML = tickets.map((ticket) => {
    const isActive = activeTicketIds.has(ticket.id);
    const isBlocked = runningSlotsFull && !isActive;
    return `
      <article class="ticketCard ${isActive ? "isRunning" : ""} ${isBlocked ? "isBlocked" : ""} ${state.newTicketIds.has(ticket.id) ? "isNew" : ""}" data-ticket-id="${ticket.id}">
        <div>
          <div class="ticketTitle">${escapeHtml(ticket.name)}</div>
          <div class="meta">
            <span>#${ticket.id}</span>
            <span class="priority">P${ticket.priority}</span>
            <span>${ticket.assigned_directly ? "Direto" : "Grupo"}</span>
            ${isActive ? "<span>Aberto</span>" : ""}
            ${state.newTicketIds.has(ticket.id) ? "<span>Novo</span>" : ""}
          </div>
        </div>
        <div class="ticketActions">
          <button data-action="start" class="primary" ${isActive || isBlocked ? "disabled" : ""}>Iniciar</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderAll() {
  renderConnection();
  renderSessions();
  renderHistory();
  renderStats();
  renderTickets();
}

function filteredTickets() {
  const search = state.queueSearch.trim().toLowerCase();
  const activeTicketIds = new Set(state.sessions.map((session) => session.ticket_id));

  return state.tickets.filter((ticket) => {
    if (state.queueFilter === "direct" && !ticket.assigned_directly) {
      return false;
    }
    if (state.queueFilter === "group" && !ticket.assigned_to_group) {
      return false;
    }
    if (state.queueFilter === "available" && activeTicketIds.has(ticket.id)) {
      return false;
    }
    if (!search) {
      return true;
    }

    const haystack = `${ticket.id} ${ticket.name} p${ticket.priority}`.toLowerCase();
    return haystack.includes(search);
  });
}

function notifyTicket(title, body) {
  showToast(body);
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification(title, { body, tag: `tecnican-${body}` });
  }
}

function detectQueueEvents(nextTickets) {
  if (!state.initializedQueue) {
    state.initializedQueue = true;
    return;
  }

  const previous = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
  nextTickets.forEach((ticket) => {
    const oldTicket = previous.get(ticket.id);
    if (!oldTicket) {
      state.newTicketIds.add(ticket.id);
      notifyTicket("Novo chamado", `#${ticket.id} ${ticket.name}`);
      return;
    }
    if (oldTicket.date_mod !== ticket.date_mod || oldTicket.status !== ticket.status) {
      notifyTicket("Chamado atualizado", `#${ticket.id} ${ticket.name}`);
    }
  });
}

async function refreshAll(options = {}) {
  if (!state.token || state.refreshing) {
    renderAll();
    return;
  }

  state.refreshing = true;
  try {
    const [me, active, history, queue] = await Promise.all([
      api("/auth/me.php"),
      api("/work-sessions/active.php"),
      api("/work-sessions/history.php?limit=20"),
      api("/tickets/my-queue.php?limit=100"),
    ]);
    state.user = me.user || me;
    state.sessions = active.sessions || [];
    state.history = history.sessions || [];
    const nextTickets = queue.tickets || [];
    if (options.detectEvents !== false) {
      detectQueueEvents(nextTickets);
    }
    state.tickets = nextTickets;
    state.lastSyncAt = new Date();
    renderAll();
  } finally {
    state.refreshing = false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function runEventLoop(generation) {
  while (state.token && generation === eventLoopGeneration) {
    try {
      const query = new URLSearchParams({ wait: "20" });
      if (state.eventCursor) {
        query.set("cursor", state.eventCursor);
      }
      const data = await api(`/events/poll.php?${query.toString()}`);
      if (generation !== eventLoopGeneration) {
        return;
      }

      state.realtimeConnected = true;
      state.eventCursor = data.cursor || state.eventCursor;
      savePreferences();
      const events = data.events || [];
      if (events.length > 0) {
        events.forEach((event) => {
          if (event.type === "ticket.assigned") {
            state.newTicketIds.add(event.ticket.id);
          }
          notifyTicket(
            event.type === "ticket.assigned" ? "Novo chamado" : "Chamado atualizado",
            `#${event.ticket.id} ${event.ticket.name}`
          );
        });
        await refreshAll({ detectEvents: false });
      } else {
        renderConnection();
      }
    } catch {
      state.realtimeConnected = false;
      renderConnection();
      await delay(5000);
    }
  }
}

function startEventLoop() {
  eventLoopGeneration += 1;
  state.realtimeConnected = false;
  runEventLoop(eventLoopGeneration);
}

function stopEventLoop() {
  eventLoopGeneration += 1;
  state.realtimeConnected = false;
}

function scheduleQueueRefresh() {
  if (queueRefreshTimerId !== null) {
    window.clearInterval(queueRefreshTimerId);
  }
  queueRefreshTimerId = window.setInterval(() => {
    if (state.token) {
      refreshAll().catch(() => {});
    }
  }, state.queueIntervalMs);
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    showToast("Este navegador nao suporta notificacoes");
    return;
  }
  const permission = await Notification.requestPermission();
  renderConnection();
  showToast(permission === "granted" ? "Notificacoes ativadas" : "Notificacoes nao autorizadas");
}

async function login(event) {
  event.preventDefault();
  state.baseUrl = els.baseUrl.value.trim();
  if (state.eventBaseUrl !== state.baseUrl) {
    state.eventCursor = "";
    state.eventBaseUrl = state.baseUrl;
    savePreferences();
  }
  try {
    setBusy(true);
    const data = await api("/auth/login.php", {
      method: "POST",
      body: {
        username: els.username.value.trim(),
        password: els.password.value,
        agent_version: "0.1.0-web",
        protocol_version: 1,
        platform: navigator.platform || "web",
        hostname: window.location.hostname || "browser",
      },
    });
    state.token = data.token;
    state.user = data.user;
    saveStoredSession();
    els.password.value = "";
    await refreshAll();
    startEventLoop();
    els.settingsDialog.close();
    showToast("Conectado");
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function logout() {
  stopEventLoop();
  try {
    if (state.token) {
      await api("/auth/logout.php", { method: "POST", body: {} });
    }
  } catch {
    // Local logout still clears the browser session.
  }
  clearStoredSession();
  renderAll();
}

async function mutateSession(action, body) {
  try {
    setBusy(true);
    await api(`/work-sessions/${action}.php`, { method: "POST", body });
    await refreshAll();
    if (body.session_id) {
      state.focusedSessionId = body.session_id;
    } else if (body.ticket_id) {
      state.focusedSessionId = state.sessions.find((session) => session.ticket_id === body.ticket_id)?.id || null;
    }
    renderAll();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

function openFinish(sessionId) {
  state.pendingSessionId = sessionId;
  els.finishDescription.value = "";
  els.finishSolveTicket.checked = false;
  els.finishDialog.showModal();
}

function openSuspend(sessionId) {
  state.pendingSessionId = sessionId;
  els.suspendReason.value = "aguardando_cliente";
  els.suspendText.value = "";
  els.suspendDialog.showModal();
}

function openPause(sessionId) {
  state.pendingSessionId = sessionId;
  state.focusedSessionId = sessionId;
  els.pauseReason.value = "";
  renderAll();
  els.pauseDialog.showModal();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

els.loginForm.addEventListener("submit", login);
els.settingsButton.addEventListener("click", () => els.settingsDialog.showModal());
els.settingsClose.addEventListener("click", () => els.settingsDialog.close());
els.connectPrompt.addEventListener("click", () => els.settingsDialog.showModal());
els.focusAction.addEventListener("click", () => {
  const focused = state.sessions.find((session) => session.id === state.focusedSessionId);
  if (focused?.status === "running") {
    openFinish(focused.id);
    return;
  }
  if (focused && (focused.status === "paused" || focused.status === "suspended")) {
    mutateSession("resume", { session_id: focused.id });
    return;
  }
  document.querySelector(".navButton[data-view='queueView']").click();
});
document.querySelectorAll(".navButton").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".navButton").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".view").forEach((view) => {
      view.hidden = view.id !== button.dataset.view;
      view.classList.toggle("activeView", view.id === button.dataset.view);
    });
  });
});
els.logoutButton.addEventListener("click", logout);
els.notificationButton.addEventListener("click", enableNotifications);
els.refreshButton.addEventListener("click", () => refreshAll().catch((error) => showToast(error.message)));
els.queueSearch.addEventListener("input", () => {
  state.queueSearch = els.queueSearch.value;
  renderTickets();
});
els.queueFilter.addEventListener("change", () => {
  state.queueFilter = els.queueFilter.value;
  renderTickets();
});
els.queueInterval.addEventListener("change", () => {
  const interval = Number(els.queueInterval.value);
  if (!ALLOWED_QUEUE_INTERVALS.has(interval)) {
    return;
  }
  state.queueIntervalMs = interval;
  savePreferences();
  scheduleQueueRefresh();
  showToast(`Atualizacao da fila: ${els.queueInterval.selectedOptions[0].textContent}`);
});

els.ticketQueue.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='start']");
  if (!button) {
    return;
  }
  const card = button.closest("[data-ticket-id]");
  state.newTicketIds.delete(Number(card.dataset.ticketId));
  mutateSession("start", { ticket_id: Number(card.dataset.ticketId) });
});

els.activeSessions.addEventListener("click", (event) => {
  const card = event.target.closest("[data-session-id]");
  if (!card) {
    return;
  }
  state.focusedSessionId = Number(card.dataset.sessionId);
  const button = event.target.closest("button[data-action]");
  if (!button) {
    renderAll();
    return;
  }
  const sessionId = Number(card.dataset.sessionId);
  const action = button.dataset.action;

  if (action === "finish") {
    openFinish(sessionId);
    return;
  }
  if (action === "suspend") {
    openSuspend(sessionId);
    return;
  }
  if (action === "pause") {
    openPause(sessionId);
    return;
  }

  mutateSession(action, { session_id: sessionId });
});

els.pauseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const reasonText = els.pauseReason.value.trim();
  if (!reasonText) {
    showToast("Informe o motivo da pausa");
    return;
  }
  els.pauseDialog.close();
  mutateSession("pause", {
    session_id: state.pendingSessionId,
    reason_code: "outro",
    reason_text: reasonText,
  });
});

els.finishForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const description = els.finishDescription.value.trim();
  if (!description) {
    showToast("Informe a descricao");
    return;
  }
  els.finishDialog.close();
  mutateSession("finish", {
    session_id: state.pendingSessionId,
    description,
    solve_ticket: els.finishSolveTicket.checked,
  });
});

els.suspendForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const reasonCode = els.suspendReason.value;
  const reasonText = els.suspendText.value.trim();
  if (reasonCode === "outro" && !reasonText) {
    showToast("Informe o detalhe");
    return;
  }
  els.suspendDialog.close();
  mutateSession("suspend", {
    session_id: state.pendingSessionId,
    reason_code: reasonCode,
    reason_text: reasonText || null,
  });
});

window.setInterval(renderLiveTimers, 1000);

loadStoredSession();
scheduleQueueRefresh();
renderAll();
if (state.token) {
  refreshAll().catch(() => {
    clearStoredSession();
    renderAll();
  }).then(() => {
    if (state.token) {
      startEventLoop();
    }
  });
}
