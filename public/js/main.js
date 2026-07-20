function sound(type) {
  if (!state.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const frequencies = { place: 180, start: 110, miss: 320, hit: 74, sunk: 52, victory: 440, defeat: 90, error: 140 };
    osc.type = type === "hit" || type === "sunk" ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(frequencies[type] || 220, now);
    if (type === "victory") osc.frequency.exponentialRampToValueAtTime(880, now + .6);
    if (type === "miss") osc.frequency.exponentialRampToValueAtTime(140, now + .18);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === "hit" || type === "sunk" ? .22 : .1, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + (type === "sunk" || type === "victory" ? .7 : .25));
    osc.connect(gain).connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + .75);
  } catch {}
}

function goHome() {
  clearPolling();
  clearOnlineSession();
  resetGame(null);
  state.screen = "home";
  history.replaceState({}, "", location.pathname);
  render();
}

async function copyRoomInvitation() {
  const link = `${location.origin}${location.pathname}?room=${state.online.code}`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const field = document.createElement("textarea");
      field.value = link;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const copied = document.execCommand("copy");
      field.remove();
      if (!copied) throw new Error("Copy failed");
    }
    showToast("Invitation link copied.");
  } catch {
    showToast(`Room code: ${state.online.code}`);
  }
}

app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("button");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "solo") {
    resetGame("solo");
    state.screen = "game";
    render();
  } else if (action === "online") {
    clearOnlineSession();
    resetGame("online");
    state.screen = "onlineLobby";
    render();
  } else if (action === "home") {
    goHome();
  } else if (action === "create-room") {
    createRoom();
  } else if (action === "join-room") {
    joinRoom();
  } else if (action === "select-ship") {
    const index = Number(button.dataset.ship);
    if (state.playerFleet[index].cells.length) state.playerFleet[index].cells = [];
    state.selectedShip = index;
    render();
  } else if (action === "rotate") {
    state.orientation = state.orientation === "h" ? "v" : "h";
    sound("place");
    render();
  } else if (action === "randomize") {
    state.playerFleet = freshFleet();
    randomizeFleet();
    state.selectedShip = 0;
    sound("place");
    render();
  } else if (action === "ready") {
    state.mode === "online" ? lockOnlineFleet() : startSoloBattle();
  } else if (action === "copy-room") {
    copyRoomInvitation();
  } else if (action === "play-again") {
    if (state.mode === "solo") {
      resetGame("solo");
      state.screen = "game";
      render();
    } else {
      clearPolling();
      clearOnlineSession();
      resetGame("online");
      state.screen = "onlineLobby";
      history.replaceState({}, "", location.pathname);
      render();
    }
  }

  if (button.matches("[data-cell]")) {
    const cell = Number(button.dataset.cell);
    const board = button.dataset.board;
    if (state.phase === "placement" && board === "own") placeSelected(cell);
    else if (state.phase === "battle" && board === "enemy") state.mode === "online" ? onlineFire(cell) : playerFire(cell);
  }
});

app.addEventListener("pointerover", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const cellButton = target?.closest('[data-board="own"][data-cell]');
  if (!cellButton || state.phase !== "placement") return;
  const ship = state.playerFleet[state.selectedShip];
  if (!ship) return;
  const cells = cellsForPlacement(Number(cellButton.dataset.cell), ship.length, state.orientation);
  const valid = canPlace(state.selectedShip, cells);
  document.querySelectorAll('[data-board="own"][data-cell]').forEach((element) => element.classList.remove("preview-valid", "preview-invalid"));
  cells.forEach((cell) => document.querySelector(`[data-board="own"][data-cell="${cell}"]`)?.classList.add(valid ? "preview-valid" : "preview-invalid"));
});

app.addEventListener("pointerleave", () => {
  document.querySelectorAll(".preview-valid,.preview-invalid").forEach((element) => element.classList.remove("preview-valid", "preview-invalid"));
}, true);

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("button");
  const action = button?.dataset.action;
  if (!button) return;

  if (action === "home" && !app.contains(button)) {
    goHome();
  } else if (action === "sound") {
    state.sound = !state.sound;
    button.textContent = state.sound ? "🔊" : "🔇";
    button.setAttribute("aria-pressed", String(!state.sound));
    if (state.sound) sound("place");
  } else if (action === "help") {
    if (typeof helpDialog.showModal === "function") helpDialog.showModal();
    else helpDialog.setAttribute("open", "");
  } else if (action === "close-help") {
    if (typeof helpDialog.close === "function") helpDialog.close();
    else helpDialog.removeAttribute("open");
  }
});

window.addEventListener("beforeunload", clearPolling);

async function boot() {
  if (await resumeOnlineSession()) {
    render();
    return;
  }

  const roomFromUrl = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
  if (roomFromUrl) {
    resetGame("online");
    state.screen = "onlineLobby";
  }
  render();
}

boot();
