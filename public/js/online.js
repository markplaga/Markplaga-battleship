const ONLINE_SESSION_KEY = "battleship-online-session-v1";
const API_ORIGIN = (() => {
  const configured = String(window.BATTLESHIP_API_ORIGIN || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  if (location.hostname === "markplaga.github.io") return "https://battleship-deep-command.netlify.app";
  return "";
})();

function apiUrl(path) {
  return `${API_ORIGIN}${path}`;
}

function saveOnlineSession() {
  if (!state.online.code || !state.online.token) return;
  try {
    sessionStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify({
      code: state.online.code,
      token: state.online.token,
      playerIndex: state.online.playerIndex,
    }));
  } catch {}
}

function loadOnlineSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(ONLINE_SESSION_KEY) || "null");
    if (!value || !/^[A-Z2-9]{6}$/.test(String(value.code || "")) || !value.token) return null;
    return {
      code: String(value.code).toUpperCase(),
      token: String(value.token),
      playerIndex: Number(value.playerIndex),
    };
  } catch {
    return null;
  }
}

function clearOnlineSession() {
  try { sessionStorage.removeItem(ONLINE_SESSION_KEY); } catch {}
}

async function resumeOnlineSession() {
  const saved = loadOnlineSession();
  if (!saved) return false;
  const requestedRoom = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
  if (requestedRoom && requestedRoom !== saved.code) {
    clearOnlineSession();
    return false;
  }

  resetGame("online");
  state.screen = "game";
  state.online.code = saved.code;
  state.online.token = saved.token;
  state.online.playerIndex = saved.playerIndex;

  try {
    const remote = await api("/api/room", {
      action: "state",
      code: saved.code,
      token: saved.token,
    });
    syncOnline(remote);
    startPolling();
    return true;
  } catch {
    clearOnlineSession();
    return false;
  }
}

async function createRoom() {
  const name = document.querySelector("#createName")?.value.trim() || "Commander One";
  setBusyButton("create-room", true, "Opening channel…");
  try {
    const data = await api("/api/room", { action: "create", playerId: name });
    resetGame("online");
    state.screen = "game";
    state.online.code = data.code;
    state.online.token = data.token;
    state.online.playerIndex = 0;
    syncOnline(data.state);
    saveOnlineSession();
    history.replaceState({}, "", `${location.pathname}?room=${data.code}`);
    startPolling();
    render();
    showToast(`Room ${data.code} created.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to create the room.");
    setBusyButton("create-room", false, "Create private room");
  }
}

async function joinRoom() {
  const name = document.querySelector("#joinName")?.value.trim() || "Commander Two";
  const code = document.querySelector("#roomCode")?.value.trim().toUpperCase() || "";
  setBusyButton("join-room", true, "Joining…");
  try {
    const data = await api("/api/room", { action: "join", code, playerId: name });
    resetGame("online");
    state.screen = "game";
    state.online.code = data.code;
    state.online.token = data.token;
    state.online.playerIndex = 1;
    syncOnline(data.state);
    saveOnlineSession();
    history.replaceState({}, "", `${location.pathname}?room=${data.code}`);
    startPolling();
    render();
    showToast("Battle channel connected.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to join the room.");
    setBusyButton("join-room", false, "Join battle");
  }
}

async function lockOnlineFleet() {
  if (!state.playerFleet.every((ship) => ship.cells.length) || state.busy) return;
  state.busy = true;
  render();
  try {
    const data = await api("/api/room", {
      action: "place",
      code: state.online.code,
      token: state.online.token,
      ships: state.playerFleet.map((ship) => ship.cells),
    });
    syncOnline(data);
    saveOnlineSession();
    sound("start");
    render();
  } catch (error) {
    state.busy = false;
    render();
    showToast(error instanceof Error ? error.message : "Unable to lock the fleet.");
  }
}

async function onlineFire(cell) {
  if (state.busy || !state.online.remote?.isYourTurn || state.online.remote.yourShots.includes(cell)) return;
  state.busy = true;
  render();
  try {
    const data = await api("/api/room", {
      action: "fire",
      code: state.online.code,
      token: state.online.token,
      cell,
    });
    syncOnline(data);
    const result = data.shotResult;
    sound(result.hit ? result.sunk ? "sunk" : "hit" : "miss");
    if (result.sunk) showToast("Enemy vessel sunk!");
    render();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "The shot could not be recorded.");
    await pollRoom();
  } finally {
    state.busy = false;
    render();
  }
}

function syncOnline(remote) {
  if (!remote) return;
  const previous = state.online.remote;
  state.online.remote = remote;
  state.online.playerIndex = remote.playerIndex;
  state.busy = false;
  if (!remote.ready) state.phase = "placement";
  else if (remote.status === "finished") state.phase = "finished";
  else if (remote.status === "battle") state.phase = "battle";
  else state.phase = "waiting";

  const event = remote.lastEvent;
  if (event?.id && event.id !== state.online.lastEventId) {
    if (state.online.lastEventId && event.type === "shot" && event.player !== state.online.playerIndex) {
      sound(event.hit ? event.sunk ? "sunk" : "hit" : "miss");
      showToast(event.hit ? event.sunk ? "One of your vessels was sunk." : "Your fleet was hit!" : "Enemy fire missed.");
    }
    if (state.online.lastEventId && event.type === "joined") showToast("Your opponent joined the room.");
    state.online.lastEventId = event.id;
  }
  if (!previous && event?.id) state.online.lastEventId = event.id;
}

async function pollRoom() {
  if (!state.online.code || !state.online.token || state.screen !== "game") return;
  try {
    const before = JSON.stringify(state.online.remote);
    const data = await api("/api/room", {
      action: "state",
      code: state.online.code,
      token: state.online.token,
    });
    syncOnline(data);
    if (JSON.stringify(state.online.remote) !== before) render();
  } catch (error) {
    console.warn(error);
  }
}

function startPolling() {
  clearPolling();
  state.online.pollTimer = setInterval(pollRoom, 1400);
}

function clearPolling() {
  if (state.online?.pollTimer) clearInterval(state.online.pollTimer);
}

async function api(path, body) {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error("Unable to reach the online battle server.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The battle server did not respond.");
  return data;
}

function setBusyButton(action, busy, text) {
  const button = document.querySelector(`[data-action="${action}"]`);
  if (!button) return;
  button.disabled = busy;
  button.textContent = text;
}

function coordinate(cell) {
  return `${"ABCDEFGHIJ"[cell % 10]}${Math.floor(cell / 10) + 1}`;
}

function shuffle(array) {
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char]));
}

let toastTimer;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}

let audioContext;
