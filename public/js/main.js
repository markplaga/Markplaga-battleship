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
    osc.start(now); osc.stop(now + .75);
  } catch {}
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "solo") {
    resetGame("solo"); state.screen = "game"; render();
  } else if (action === "online") {
    resetGame("online"); state.screen = "onlineLobby"; render();
  } else if (action === "home") {
    clearPolling(); resetGame(null); state.screen = "home"; history.replaceState({}, "", location.pathname); render();
  } else if (action === "create-room") createRoom();
  else if (action === "join-room") joinRoom();
  else if (action === "select-ship") {
    const i = Number(button.dataset.ship);
    if (state.playerFleet[i].cells.length) state.playerFleet[i].cells = [];
    state.selectedShip = i; render();
  } else if (action === "rotate") {
    state.orientation = state.orientation === "h" ? "v" : "h"; sound("place"); render();
  } else if (action === "randomize") {
    state.playerFleet = freshFleet(); randomizeFleet(); state.selectedShip = 0; sound("place"); render();
  } else if (action === "ready") {
    state.mode === "online" ? lockOnlineFleet() : startSoloBattle();
  } else if (action === "copy-room") {
    const link = `${location.origin}${location.pathname}?room=${state.online.code}`;
    navigator.clipboard?.writeText(link).then(() => showToast("Invitation link copied.")).catch(() => showToast(`Room code: ${state.online.code}`));
  } else if (action === "play-again") {
    if (state.mode === "solo") { resetGame("solo"); state.screen = "game"; render(); }
    else { clearPolling(); resetGame("online"); state.screen = "onlineLobby"; render(); }
  }

  const cellButton = button.matches("[data-cell]") ? button : null;
  if (cellButton) {
    const cell = Number(cellButton.dataset.cell);
    const board = cellButton.dataset.board;
    if (state.phase === "placement" && board === "own") placeSelected(cell);
    else if (state.phase === "battle" && board === "enemy") state.mode === "online" ? onlineFire(cell) : playerFire(cell);
  }
});

app.addEventListener("pointerover", (event) => {
  const cellButton = event.target.closest('[data-board="own"][data-cell]');
  if (!cellButton || state.phase !== "placement") return;
  const ship = state.playerFleet[state.selectedShip];
  const cells = cellsForPlacement(Number(cellButton.dataset.cell), ship.length, state.orientation);
  const valid = canPlace(state.selectedShip, cells);
  document.querySelectorAll('[data-board="own"][data-cell]').forEach((el) => el.classList.remove("preview-valid", "preview-invalid"));
  cells.forEach((cell) => document.querySelector(`[data-board="own"][data-cell="${cell}"]`)?.classList.add(valid ? "preview-valid" : "preview-invalid"));
});

app.addEventListener("pointerleave", () => {
  document.querySelectorAll(".preview-valid,.preview-invalid").forEach((el) => el.classList.remove("preview-valid", "preview-invalid"));
}, true);

document.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.action;
  if (action === "sound") {
    state.sound = !state.sound;
    event.target.closest("button").textContent = state.sound ? "🔊" : "🔇";
    if (state.sound) sound("place");
  } else if (action === "help") helpDialog.showModal();
  else if (action === "close-help") helpDialog.close();
});

window.addEventListener("beforeunload", clearPolling);

render();
