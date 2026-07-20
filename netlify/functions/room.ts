import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

const FLEET = [5, 4, 3, 3, 2];
const ROOM_TTL = 24 * 60 * 60 * 1000;

type Ship = { cells: number[]; hits: number[] };
type Player = {
  id: string;
  token: string;
  joinedAt: string;
  ready: boolean;
  ships: Ship[];
  shots: number[];
};
type Room = {
  code: string;
  createdAt: string;
  updatedAt: string;
  status: "waiting" | "placing" | "battle" | "finished";
  players: Player[];
  turn: number | null;
  winner: number | null;
  lastEvent: null | {
    id: string;
    type: "shot" | "joined" | "ready";
    player: number;
    cell?: number;
    hit?: boolean;
    sunk?: boolean;
    at: string;
  };
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const makeCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
};

const makeToken = () => crypto.randomUUID().replaceAll("-", "");
const roomKey = (code: string) => `room/${code}`;
const validCell = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 0 && Number(n) < 100;

function validateFleet(raw: unknown): Ship[] | null {
  if (!Array.isArray(raw) || raw.length !== FLEET.length) return null;
  const occupied = new Set<number>();
  const ships: Ship[] = [];
  const lengths: number[] = [];

  for (const entry of raw) {
    const cells = Array.isArray(entry) ? entry : (entry as { cells?: unknown })?.cells;
    if (!Array.isArray(cells) || !cells.every(validCell)) return null;
    const unique = [...new Set(cells as number[])].sort((a, b) => a - b);
    if (unique.length !== cells.length) return null;
    const rows = new Set(unique.map((c) => Math.floor(c / 10)));
    const cols = new Set(unique.map((c) => c % 10));
    const horizontal = rows.size === 1 && unique.every((c, i) => i === 0 || c === unique[i - 1] + 1);
    const vertical = cols.size === 1 && unique.every((c, i) => i === 0 || c === unique[i - 1] + 10);
    if (!horizontal && !vertical) return null;
    if (unique.some((c) => occupied.has(c))) return null;
    unique.forEach((c) => occupied.add(c));
    lengths.push(unique.length);
    ships.push({ cells: unique, hits: [] });
  }

  const sorted = [...lengths].sort((a, b) => b - a);
  if (sorted.some((n, i) => n !== FLEET[i])) return null;
  return ships;
}

function playerIndex(room: Room, token: string | null) {
  return room.players.findIndex((p) => p.token === token);
}

function publicState(room: Room, index: number) {
  const self = room.players[index];
  const enemy = room.players[1 - index];
  const enemySunkCells = enemy
    ? enemy.ships.filter((s) => s.cells.every((c) => s.hits.includes(c))).flatMap((s) => s.cells)
    : [];

  return {
    code: room.code,
    status: room.status,
    playerIndex: index,
    playerCount: room.players.length,
    ready: self.ready,
    enemyReady: Boolean(enemy?.ready),
    turn: room.turn,
    winner: room.winner,
    isYourTurn: room.turn === index,
    yourShips: self.ships,
    yourShots: self.shots,
    yourHits: enemy ? self.shots.filter((c) => enemy.ships.some((s) => s.cells.includes(c))) : [],
    incomingShots: enemy?.shots ?? [],
    enemySunkCells,
    lastEvent: room.lastEvent,
    updatedAt: room.updatedAt,
  };
}

function roomStore(context: Context) {
  return context.deploy.context === "production"
    ? getStore("battleship-rooms", { consistency: "strong" })
    : getDeployStore({ name: "battleship-rooms", deployID: context.deploy.id });
}

async function loadRoom(context: Context, code: string) {
  const store = roomStore(context);
  const room = (await store.get(roomKey(code), { type: "json" })) as Room | null;
  if (!room) return { store, room: null };
  if (Date.now() - new Date(room.updatedAt).getTime() > ROOM_TTL) {
    await store.delete(roomKey(code));
    return { store, room: null };
  }
  return { store, room };
}

export default async (req: Request, context: Context) => {
  try {
    if (req.method === "GET") {
      const code = String(context.params.code || "").toUpperCase();
      const token = new URL(req.url).searchParams.get("token");
      const { room } = await loadRoom(context, code);
      if (!room) return json({ error: "Room not found or expired." }, 404);
      const index = playerIndex(room, token);
      if (index < 0) return json({ error: "This player token is not valid for the room." }, 403);
      return json(publicState(room, index));
    }

    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "");
    const playerId = String(body.playerId || "Player").slice(0, 40);

    if (action === "create") {
      const store = roomStore(context);
      let code = makeCode();
      for (let i = 0; i < 5 && await store.get(roomKey(code)); i++) code = makeCode();
      const token = makeToken();
      const now = new Date().toISOString();
      const room: Room = {
        code,
        createdAt: now,
        updatedAt: now,
        status: "waiting",
        players: [{ id: playerId, token, joinedAt: now, ready: false, ships: [], shots: [] }],
        turn: null,
        winner: null,
        lastEvent: null,
      };
      await store.setJSON(roomKey(code), room);
      return json({ code, token, state: publicState(room, 0) }, 201);
    }

    const code = String(body.code || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return json({ error: "Enter a valid six-character room code." }, 400);
    const { store, room } = await loadRoom(context, code);
    if (!room) return json({ error: "Room not found or expired." }, 404);

    if (action === "join") {
      if (room.players.length >= 2) return json({ error: "That room is already full." }, 409);
      const token = makeToken();
      const now = new Date().toISOString();
      room.players.push({ id: playerId, token, joinedAt: now, ready: false, ships: [], shots: [] });
      room.status = "placing";
      room.updatedAt = now;
      room.lastEvent = { id: crypto.randomUUID(), type: "joined", player: 1, at: now };
      await store.setJSON(roomKey(code), room);
      return json({ code, token, state: publicState(room, 1) });
    }

    const token = String(body.token || "");
    const index = playerIndex(room, token);
    if (index < 0) return json({ error: "This player token is not valid for the room." }, 403);

    if (action === "place") {
      if (room.status === "battle" || room.status === "finished") return json({ error: "Fleet placement is closed." }, 409);
      const ships = validateFleet(body.ships);
      if (!ships) return json({ error: "Fleet placement is invalid." }, 400);
      room.players[index].ships = ships;
      room.players[index].ready = true;
      const now = new Date().toISOString();
      room.lastEvent = { id: crypto.randomUUID(), type: "ready", player: index, at: now };
      if (room.players.length === 2 && room.players.every((p) => p.ready)) {
        room.status = "battle";
        room.turn = crypto.getRandomValues(new Uint8Array(1))[0] % 2;
      } else {
        room.status = room.players.length === 2 ? "placing" : "waiting";
      }
      room.updatedAt = now;
      await store.setJSON(roomKey(code), room);
      return json(publicState(room, index));
    }

    if (action === "fire") {
      if (room.status !== "battle") return json({ error: "The battle has not started." }, 409);
      if (room.turn !== index) return json({ error: "It is not your turn." }, 409);
      const cell = Number(body.cell);
      if (!validCell(cell)) return json({ error: "Invalid target." }, 400);
      if (room.players[index].shots.includes(cell)) return json({ error: "You already fired at that coordinate." }, 409);
      const defender = room.players[1 - index];
      room.players[index].shots.push(cell);
      const ship = defender.ships.find((s) => s.cells.includes(cell));
      const hit = Boolean(ship);
      if (ship) ship.hits.push(cell);
      const sunk = Boolean(ship && ship.cells.every((c) => ship.hits.includes(c)));
      const won = defender.ships.every((s) => s.cells.every((c) => s.hits.includes(c)));
      const now = new Date().toISOString();
      room.lastEvent = { id: crypto.randomUUID(), type: "shot", player: index, cell, hit, sunk, at: now };
      if (won) {
        room.status = "finished";
        room.winner = index;
        room.turn = null;
      } else {
        room.turn = 1 - index;
      }
      room.updatedAt = now;
      await store.setJSON(roomKey(code), room);
      return json({ ...publicState(room, index), shotResult: { cell, hit, sunk, won } });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "The battle server encountered an error." }, 500);
  }
};

export const config: Config = {
  path: ["/api/room", "/api/room/:code"],
};
