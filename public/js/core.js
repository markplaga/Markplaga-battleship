const SHIPS = [
  { name: "Carrier", length: 5 },
  { name: "Battleship", length: 4 },
  { name: "Cruiser", length: 3 },
  { name: "Submarine", length: 3 },
  { name: "Destroyer", length: 2 },
];

const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");
const helpDialog = document.querySelector("#helpDialog");

const state = {
  screen: "home",
  mode: null,
  phase: "placement",
  orientation: "h",
  selectedShip: 0,
  playerFleet: freshFleet(),
  enemyFleet: freshFleet(),
  playerShots: [],
  enemyShots: [],
  turn: "player",
  winner: null,
  aiTargets: [],
  sound: true,
  busy: false,
  online: {
    code: "",
    token: "",
    playerIndex: null,
    remote: null,
    pollTimer: null,
    lastEventId: null,
  },
};

function freshFleet() {
  return SHIPS.map((ship) => ({ ...ship, cells: [], hits: [] }));
}

function resetGame(mode) {
  clearPolling();
  state.mode = mode;
  state.phase = "placement";
  state.orientation = "h";
  state.selectedShip = 0;
  state.playerFleet = freshFleet();
  state.enemyFleet = freshFleet();
  state.playerShots = [];
  state.enemyShots = [];
  state.turn = "player";
  state.winner = null;
  state.aiTargets = [];
  state.busy = false;
  state.online = { code: "", token: "", playerIndex: null, remote: null, pollTimer: null, lastEventId: null };
}

function render() {
  if (state.screen === "home") app.innerHTML = homeTemplate();
  else if (state.screen === "onlineLobby") app.innerHTML = lobbyTemplate();
  else app.innerHTML = gameTemplate();
}

function homeTemplate() {
  const squares = Array.from({ length: 100 }, () => "<i></i>").join("");
  return `
    <section class="hero">
      <div>
        <div class="eyebrow">Tactical naval combat</div>
        <h1>COMMAND<br><span>THE DEEP</span></h1>
        <p class="lead">Deploy your fleet across a cinematic 3D ocean grid. Challenge the computer commander or open a private room and battle another player online.</p>
        <div class="mode-grid">
          <button class="mode-card" data-action="solo">
            <span class="mode-icon">🤖</span><b>Solo Command</b><small>Player versus a tactical computer opponent.</small>
          </button>
          <button class="mode-card" data-action="online">
            <span class="mode-icon">🌐</span><b>Online Battle</b><small>Create or join a private match with a room code.</small>
          </button>
        </div>
      </div>
      <div class="hero-scene" aria-hidden="true">
        <div class="hero-glow"></div>
        <div class="hero-board">${squares}</div>
      </div>
    </section>`;
}

function lobbyTemplate() {
  const roomFromUrl = new URLSearchParams(location.search).get("room") || "";
  return `
    <section class="lobby panel">
      <div class="eyebrow">Private online match</div>
      <h2>Open a battle channel</h2>
      <p>Create a new room and send the code to your opponent, or enter the code they shared with you. No account is required.</p>
      <div class="lobby-grid">
        <div class="lobby-option">
          <h3>Create room</h3>
          <div class="field"><label for="createName">Commander name</label><input id="createName" maxlength="40" placeholder="Commander One" autocomplete="nickname"></div>
          <button class="btn btn-primary" data-action="create-room">Create private room</button>
        </div>
        <div class="divider">OR</div>
        <div class="lobby-option">
          <h3>Join room</h3>
          <div class="field"><label for="joinName">Commander name</label><input id="joinName" maxlength="40" placeholder="Commander Two" autocomplete="nickname"></div>
          <div class="field"><label for="roomCode">Room code</label><input id="roomCode" maxlength="6" value="${escapeHtml(roomFromUrl.toUpperCase())}" placeholder="ABC234" autocomplete="off"></div>
          <button class="btn btn-primary" data-action="join-room">Join battle</button>
        </div>
      </div>
      <div class="btn-row" style="margin-top:24px"><button class="btn btn-secondary" data-action="home">← Main menu</button></div>
    </section>`;
}

function gameTemplate() {
  const status = statusInfo();
  const remote = state.online.remote;
  const roomInfo = state.mode === "online" ? `<span class="room-code">${state.online.code}</span>` : "SOLO MISSION";
  const controls = state.phase === "placement" ? placementControls() : battleControls();
  const result = state.phase === "finished" ? resultTemplate() : "";
  const wait = state.mode === "online" && state.phase === "waiting" ? waitTemplate() : "";

  return `
    <section class="game-wrap">
      <div class="game-header">
        <div><div class="eyebrow">${roomInfo}</div><h2>${state.phase === "placement" ? "Deploy the fleet" : state.phase === "finished" ? "Battle concluded" : "Battle stations"}</h2></div>
        <div class="status-box panel"><div class="status-label">Command status</div><div class="status-main ${status.yourTurn ? "your-turn" : ""}">${status.text}</div>${remote?.playerCount === 1 ? '<div class="small-note">One commander connected</div>' : ""}</div>
      </div>
      ${result}
      ${controls}
      ${wait}
      <div class="boards ${state.phase === "waiting" ? "hidden" : ""}">
        ${boardCard("own")}
        ${boardCard("enemy")}
      </div>
    </section>`;
}

function statusInfo() {
  if (state.phase === "placement") return { text: "Position all five ships", yourTurn: false };
  if (state.phase === "waiting") {
    const r = state.online.remote;
    if (r?.playerCount < 2) return { text: "Waiting for an opponent", yourTurn: false };
    return { text: r?.enemyReady ? "Synchronizing battle" : "Opponent is deploying", yourTurn: false };
  }
  if (state.phase === "finished") {
    const won = state.mode === "online" ? state.online.remote?.winner === state.online.playerIndex : state.winner === "player";
    return { text: won ? "Enemy fleet destroyed" : "Your fleet was destroyed", yourTurn: false };
  }
  const yours = state.mode === "online" ? Boolean(state.online.remote?.isYourTurn) : state.turn === "player";
  return { text: yours ? "Your turn — select a target" : "Enemy turn — stand by", yourTurn: yours };
}

function placementControls() {
  const placed = state.playerFleet.every((s) => s.cells.length);
  const chips = state.playerFleet.map((ship, i) => `
    <button class="ship-chip ${state.selectedShip === i ? "active" : ""} ${ship.cells.length ? "placed" : ""}" data-action="select-ship" data-ship="${i}">
      ${ship.name}<div class="ship-dots">${Array.from({ length: ship.length }, () => "<i></i>").join("")}</div>
    </button>`).join("");
  return `
    <div class="command-deck panel">
      <div class="ship-rack">${chips}</div>
      <div class="btn-row">
        <button class="btn btn-secondary" data-action="rotate">Rotate ${state.orientation === "h" ? "↔" : "↕"}</button>
        <button class="btn btn-secondary" data-action="randomize">Random fleet</button>
        <button class="btn btn-primary" data-action="ready" ${placed || state.busy ? "" : "disabled"}>${state.mode === "online" ? "Lock fleet" : "Begin battle"}</button>
      </div>
    </div>`;
}

function battleControls() {
  if (state.mode !== "online") return `<div class="command-deck panel"><div class="small-note">Red = hit · White = miss · Gold = sunk vessel</div><button class="btn btn-danger" data-action="home">Abandon mission</button></div>`;
  return `
    <div class="command-deck panel">
      <div class="btn-row"><button class="btn btn-secondary" data-action="copy-room">Copy room link</button><span class="small-note">Room <b class="room-code">${state.online.code}</b></span></div>
      <button class="btn btn-danger" data-action="home">Leave match</button>
    </div>`;
}

function waitTemplate() {
  const r = state.online.remote;
  const title = r?.playerCount < 2 ? "Waiting for the second commander" : "Opponent is positioning their fleet";
  return `<div class="wait-card panel"><div class="radar"></div><h3>${title}</h3><p class="small-note">Share room code <b class="room-code">${state.online.code}</b>. This screen updates automatically.</p><div class="btn-row" style="justify-content:center;margin-top:16px"><button class="btn btn-primary" data-action="copy-room">Copy invitation link</button></div></div>`;
}

function resultTemplate() {
  const won = state.mode === "online" ? state.online.remote?.winner === state.online.playerIndex : state.winner === "player";
  return `<div class="result-banner panel ${won ? "victory" : ""}"><div class="eyebrow">${won ? "Mission accomplished" : "Fleet lost"}</div><h2>${won ? "VICTORY" : "DEFEAT"}</h2><p>${won ? "Every enemy vessel has been sent to the deep." : "The opposing commander destroyed your fleet."}</p><div class="btn-row" style="justify-content:center"><button class="btn btn-primary" data-action="play-again">Play again</button><button class="btn btn-secondary" data-action="home">Main menu</button></div></div>`;
}
