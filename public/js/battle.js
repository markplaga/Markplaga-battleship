function boardCard(kind) {
  const isOwn = kind === "own";
  const title = isOwn ? "YOUR WATERS" : "ENEMY WATERS";
  const subtitle = isOwn ? "Fleet defense grid" : "Targeting grid";
  const fleet = ownFleet();
  const incoming = incomingShots();
  const outgoing = outgoingShots();
  const outgoingHits = hitShots();
  const sunkEnemy = enemySunkCells();
  const axisX = "ABCDEFGHIJ".split("").map((x) => `<span>${x}</span>`).join("");
  const axisY = Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join("");
  const canTarget = state.phase === "battle" && (state.mode === "online" ? state.online.remote?.isYourTurn : state.turn === "player") && !state.busy;

  const cells = Array.from({ length: 100 }, (_, cell) => {
    const ship = fleet.find((s) => s.cells.includes(cell));
    const wasIncoming = incoming.includes(cell);
    const wasOutgoing = outgoing.includes(cell);
    const ownHit = wasIncoming && Boolean(ship);
    const enemyHit = wasOutgoing && outgoingHits.includes(cell);
    const ownSunk = ship && ship.cells.every((c) => incoming.includes(c));
    const enemySunk = sunkEnemy.includes(cell);
    const showShip = isOwn && Boolean(ship);
    const marker = isOwn && wasIncoming
      ? `<span class="marker ${ownHit ? ownSunk ? "sunk" : "hit" : "miss"}"></span>`
      : !isOwn && wasOutgoing
        ? `<span class="marker ${enemyHit ? enemySunk ? "sunk" : "hit" : "miss"}"></span>`
        : "";
    const disabled = isOwn ? state.phase !== "placement" : (!canTarget || wasOutgoing || state.phase !== "battle");
    return `<button class="cell ${showShip ? "ship" : ""}" data-cell="${cell}" data-board="${kind}" aria-label="${coordinate(cell)}${wasOutgoing || wasIncoming ? ", fired upon" : ""}" ${disabled ? "disabled" : ""}>${marker}</button>`;
  }).join("");

  return `<div class="board-card panel"><div class="board-title"><h3>${title}</h3><span>${subtitle}</span></div><div class="board-stage"><div class="board" data-board-grid="${kind}"><div class="axis-x">${axisX}</div><div class="axis-y">${axisY}</div>${cells}</div></div></div>`;
}

function ownFleet() {
  if (state.mode === "online" && state.phase !== "placement" && state.online.remote?.yourShips?.length) {
    return SHIPS.map((ship, i) => ({ ...ship, cells: state.online.remote.yourShips[i]?.cells || [], hits: state.online.remote.yourShips[i]?.hits || [] }));
  }
  return state.playerFleet;
}

function incomingShots() {
  return state.mode === "online" ? (state.online.remote?.incomingShots || []) : state.enemyShots;
}
function outgoingShots() {
  return state.mode === "online" ? (state.online.remote?.yourShots || []) : state.playerShots;
}
function hitShots() {
  if (state.mode === "online") return state.online.remote?.yourHits || [];
  return state.playerShots.filter((c) => state.enemyFleet.some((s) => s.cells.includes(c)));
}
function enemySunkCells() {
  if (state.mode === "online") return state.online.remote?.enemySunkCells || [];
  return state.enemyFleet.filter((s) => s.cells.every((c) => state.playerShots.includes(c))).flatMap((s) => s.cells);
}

function cellsForPlacement(start, length, orientation) {
  const row = Math.floor(start / 10);
  const col = start % 10;
  if (orientation === "h") {
    if (col + length > 10) return [];
    return Array.from({ length }, (_, i) => start + i);
  }
  if (row + length > 10) return [];
  return Array.from({ length }, (_, i) => start + i * 10);
}

function canPlace(shipIndex, cells) {
  if (!cells.length) return false;
  const occupied = new Set(state.playerFleet.filter((_, i) => i !== shipIndex).flatMap((s) => s.cells));
  return cells.every((c) => !occupied.has(c));
}

function placeSelected(start) {
  const ship = state.playerFleet[state.selectedShip];
  if (!ship) return;
  const cells = cellsForPlacement(start, ship.length, state.orientation);
  if (!canPlace(state.selectedShip, cells)) {
    sound("error");
    showToast("That vessel will not fit there.");
    return;
  }
  ship.cells = cells;
  const next = state.playerFleet.findIndex((s, i) => i > state.selectedShip && !s.cells.length);
  const first = state.playerFleet.findIndex((s) => !s.cells.length);
  state.selectedShip = next >= 0 ? next : first >= 0 ? first : state.selectedShip;
  sound("place");
  render();
}

function randomizeFleet(targetFleet = state.playerFleet) {
  let attempts = 0;
  while (attempts++ < 250) {
    const occupied = new Set();
    let valid = true;
    for (const ship of targetFleet) {
      let placed = false;
      for (let j = 0; j < 100 && !placed; j++) {
        const orientation = Math.random() > .5 ? "h" : "v";
        const start = Math.floor(Math.random() * 100);
        const cells = cellsForPlacement(start, ship.length, orientation);
        if (cells.length && cells.every((c) => !occupied.has(c))) {
          ship.cells = cells;
          ship.hits = [];
          cells.forEach((c) => occupied.add(c));
          placed = true;
        }
      }
      if (!placed) { valid = false; break; }
    }
    if (valid) return true;
  }
  return false;
}

function startSoloBattle() {
  if (!state.playerFleet.every((s) => s.cells.length)) return;
  state.enemyFleet = freshFleet();
  randomizeFleet(state.enemyFleet);
  state.phase = "battle";
  state.turn = Math.random() > .5 ? "player" : "enemy";
  sound("start");
  render();
  if (state.turn === "enemy") setTimeout(aiFire, 850);
}

function playerFire(cell) {
  if (state.turn !== "player" || state.playerShots.includes(cell) || state.phase !== "battle") return;
  state.playerShots.push(cell);
  const ship = state.enemyFleet.find((s) => s.cells.includes(cell));
  if (ship) ship.hits.push(cell);
  const sunk = ship && ship.cells.every((c) => state.playerShots.includes(c));
  sound(ship ? sunk ? "sunk" : "hit" : "miss");
  if (allSunk(state.enemyFleet, state.playerShots)) {
    state.phase = "finished";
    state.winner = "player";
    sound("victory");
    render();
    return;
  }
  state.turn = "enemy";
  state.busy = true;
  render();
  setTimeout(aiFire, 850);
}

function aiFire() {
  if (state.phase !== "battle") return;
  let cell;
  state.aiTargets = state.aiTargets.filter((c) => !state.enemyShots.includes(c) && c >= 0 && c < 100);
  if (state.aiTargets.length) {
    cell = state.aiTargets.shift();
  } else {
    const candidates = Array.from({ length: 100 }, (_, i) => i).filter((i) => !state.enemyShots.includes(i));
    const parity = candidates.filter((i) => (Math.floor(i / 10) + i % 10) % 2 === 0);
    const pool = parity.length ? parity : candidates;
    cell = pool[Math.floor(Math.random() * pool.length)];
  }
  state.enemyShots.push(cell);
  const ship = state.playerFleet.find((s) => s.cells.includes(cell));
  if (ship) {
    ship.hits.push(cell);
    const row = Math.floor(cell / 10), col = cell % 10;
    const neighbors = [col > 0 ? cell - 1 : -1, col < 9 ? cell + 1 : -1, row > 0 ? cell - 10 : -1, row < 9 ? cell + 10 : -1]
      .filter((c) => c >= 0 && !state.enemyShots.includes(c) && !state.aiTargets.includes(c));
    state.aiTargets.push(...shuffle(neighbors));
  }
  const sunk = ship && ship.cells.every((c) => state.enemyShots.includes(c));
  sound(ship ? sunk ? "sunk" : "hit" : "miss");
  if (allSunk(state.playerFleet, state.enemyShots)) {
    state.phase = "finished";
    state.winner = "enemy";
    state.busy = false;
    sound("defeat");
    render();
    return;
  }
  state.turn = "player";
  state.busy = false;
  render();
}

function allSunk(fleet, shots) {
  return fleet.every((ship) => ship.cells.every((c) => shots.includes(c)));
}
