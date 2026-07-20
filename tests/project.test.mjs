import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const battleSource = readFileSync(path.join(root, "public/js/battle.js"), "utf8");
const roomSource = readFileSync(path.join(root, "netlify/functions/room.ts"), "utf8");
const shipDefinitions = [
  { name: "Carrier", length: 5 },
  { name: "Battleship", length: 4 },
  { name: "Cruiser", length: 3 },
  { name: "Submarine", length: 3 },
  { name: "Destroyer", length: 2 },
];

function newFleet() {
  return shipDefinitions.map((ship) => ({ ...ship, cells: [], hits: [] }));
}

function battleContext() {
  const context = {
    SHIPS: shipDefinitions,
    state: {
      mode: "solo",
      phase: "placement",
      selectedShip: 0,
      orientation: "h",
      playerFleet: newFleet(),
      enemyFleet: newFleet(),
      playerShots: [],
      enemyShots: [],
      aiTargets: [],
      turn: "player",
      busy: false,
      winner: null,
      online: { remote: null },
    },
    coordinate(cell) {
      return `${"ABCDEFGHIJ"[cell % 10]}${Math.floor(cell / 10) + 1}`;
    },
    shuffle(array) {
      return array;
    },
    sound() {},
    showToast() {},
    render() {},
    setTimeout() { return 1; },
    console,
    Math,
  };
  vm.createContext(context);
  vm.runInContext(battleSource, context, { filename: "public/js/battle.js" });
  return context;
}

function loadRoomModule() {
  const compiled = ts.transpileModule(roomSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "netlify/functions/room.ts",
  }).outputText;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require(name) {
      if (name === "@netlify/blobs") {
        return { getStore() {}, getDeployStore() {} };
      }
      if (name === "@netlify/functions") return {};
      throw new Error(`Unexpected module: ${name}`);
    },
    console,
    crypto,
    Request,
    Response,
    URL,
    Uint8Array,
    Set,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Math,
  };
  vm.runInNewContext(compiled, context, { filename: "netlify/functions/room.js" });
  return module.exports;
}

function run(context, expression) {
  return vm.runInContext(expression, context);
}

function isStraightShip(cells) {
  const sorted = [...cells].sort((a, b) => a - b);
  const sameRow = sorted.every((cell) => Math.floor(cell / 10) === Math.floor(sorted[0] / 10));
  const sameColumn = sorted.every((cell) => cell % 10 === sorted[0] % 10);
  const step = sameRow ? 1 : sameColumn ? 10 : 0;
  return step > 0 && sorted.every((cell, index) => index === 0 || cell === sorted[index - 1] + step);
}

test("all HTML asset references resolve inside public", () => {
  const index = readFileSync(path.join(root, "public/index.html"), "utf8");
  const references = [...index.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)].map((match) => match[1]);
  assert.ok(references.length >= 5, "Expected stylesheet and four script references");
  for (const reference of references) {
    assert.ok(existsSync(path.join(root, "public", reference.slice(2))), `Missing asset: ${reference}`);
  }
  assert.ok(index.indexOf("./js/core.js") < index.indexOf("./js/battle.js"));
  assert.ok(index.indexOf("./js/battle.js") < index.indexOf("./js/online.js"));
  assert.ok(index.indexOf("./js/online.js") < index.indexOf("./js/main.js"));
});

test("placement calculations reject board overflow", () => {
  const context = battleContext();
  assert.deepEqual(Array.from(run(context, 'cellsForPlacement(0, 5, "h")')), [0, 1, 2, 3, 4]);
  assert.deepEqual(Array.from(run(context, 'cellsForPlacement(8, 3, "h")')), []);
  assert.deepEqual(Array.from(run(context, 'cellsForPlacement(7, 3, "v")')), [7, 17, 27]);
  assert.deepEqual(Array.from(run(context, 'cellsForPlacement(87, 3, "v")')), []);
});

test("ships cannot overlap during placement", () => {
  const context = battleContext();
  context.state.playerFleet[0].cells = [0, 1, 2, 3, 4];
  assert.equal(run(context, "canPlace(1, [4, 14, 24, 34])"), false);
  assert.equal(run(context, "canPlace(1, [10, 11, 12, 13])"), true);
});

test("random deployment creates a valid five-ship fleet", () => {
  const context = battleContext();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    context.state.playerFleet = newFleet();
    assert.equal(run(context, "randomizeFleet()"), true);
    const occupied = new Set();
    for (const [index, ship] of context.state.playerFleet.entries()) {
      assert.equal(ship.cells.length, shipDefinitions[index].length);
      assert.ok(isStraightShip(ship.cells), `${ship.name} must be straight and contiguous`);
      for (const cell of ship.cells) {
        assert.ok(Number.isInteger(cell) && cell >= 0 && cell < 100);
        assert.equal(occupied.has(cell), false, `Overlapping cell ${cell}`);
        occupied.add(cell);
      }
    }
    assert.equal(occupied.size, 17);
  }
});

test("allSunk changes only after every ship cell has been fired upon", () => {
  const context = battleContext();
  context.state.playerFleet = [
    { name: "Scout", length: 2, cells: [0, 1], hits: [] },
    { name: "Patrol", length: 2, cells: [10, 20], hits: [] },
  ];
  assert.equal(run(context, "allSunk(state.playerFleet, [0, 1, 10])"), false);
  assert.equal(run(context, "allSunk(state.playerFleet, [0, 1, 10, 20])"), true);
});

test("server accepts only a straight, non-overlapping standard fleet", () => {
  const { validateFleet } = loadRoomModule();
  const validFleet = [
    [0, 1, 2, 3, 4],
    [10, 11, 12, 13],
    [20, 21, 22],
    [30, 40, 50],
    [60, 61],
  ];
  assert.equal(validateFleet(validFleet)?.length, 5);
  assert.equal(validateFleet([[8, 9, 10], [20, 21, 22, 23, 24], [30, 31, 32, 33], [40, 41, 42], [50, 51]]), null);
  assert.equal(validateFleet([[0, 1, 2, 3, 4], [4, 14, 24, 34], [20, 21, 22], [30, 40, 50], [60, 61]]), null);
  assert.equal(validateFleet([[0, 1, 2, 3], [10, 11, 12, 13], [20, 21, 22], [30, 40, 50], [60, 61]]), null);
});
