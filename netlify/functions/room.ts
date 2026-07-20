import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";

const FLEET = [5, 4, 3, 3, 2];
const ROOM_TTL = 24 * 60 * 60 * 1000;
const ALLOWED_ORIGINS = new Set([
  "https://markplaga.github.io",
  "http://localhost:8888",
  "http://127.0.0.1:8888",
]);

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

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = { vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-max-age"] = "86400";
  }
  return headers;
}

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(req),
    },
  });
}

function preflight(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(null, { status: 403, headers: { vary: "Origin" } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

const makeCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

const makeToken = () => crypto.randomUUID().replaceAll("-", "");
const roomKey = (code: string) => `room/${code}`;
const validCell = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 100;

export function validateFleet(raw: unknown): Ship[] | null {
  if (!Array.isArray(raw) || raw.length !== FLEET.length) return null;
  const occupied = new Set<number>();
  const ships: Ship[] = [];
  const lengths: number[] = [];

  for (const entry of raw) {
    const cells = Array.isArray(entry) ? entry : (entry as { cells?: unknown })?.cells;
    if (!Array.isArray(cells) || !cells.every(validCell)) return null;
    const unique = [...new Set(cells as number[])].sort((a, b) => a - b);
    if (unique.length !== cells.length) return null;

    const rows = new Set(unique.map((cell) => Math.floor(cell / 10)));
    const columns = new Set(unique.map((cell) => cell % 10));
    const horizontal = rows.size === 1 && unique.every((cell, index) => index === 0 || cell === unique[index - 1] + 1);
    const vertical = columns.size === 1 && unique.every((cell, index) => index === 0 || cell === unique[index - 1] + 10);
    if (!horizontal && !vertical) return null;
    if (unique.some((cell) => occupied.has(cell))) return null;

    unique.forEach((cell) => occupied.add(cell));
    lengths.push(unique.length);
    ships.push({ cells: unique, hits: [] });
  }

  const sorted = [...lengths].sort((a, b) => b - a);
  if (sorted.some((length, index) => length !== FLEET[index])) return null;
  return ships;
}

function playerIndex(room: Room, token: string | null) {
  return room.players.findIndex((player) => player.token === token);
}

function publicState(room: Room, index: number) {
  const self = room.players[index];
  const enemy = room.players[1 - index];
  const enemySunkCells = enemy
    ? enemy.ships.filter((ship) => ship.cells.every((cell) => ship.hits.includes(cell))).flatMap((ship) => ship.cells)
    : [];

  return {
    code: room.code,
    status: room.status,
    playerIndex: index,
    playerCount: room.players.length,
    yourName: self.id,
    enemyName: enemy?.id ?? null,
    ready: self.ready,
    enemyReady: Boolean(enemy?.ready),
    turn: room.turn,
    winner: room.winner,
    isYourTurn: room.turn === index,
    yourShips: self.ships,
    yourShots: self.shots,
    yourHits: enemy ? self.shots.filter((cell) => enemy.ships.some((ship) => ship.cells.includes(cell))) : [],
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
    if (req.method === "OPTIONS") return preflight(req);

    if (req.method === "GET") {
      const code = String(context.params.code || "").trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) return json(req, { error: "Enter a valid six-character room code." }, 400);
      const token = new URL(req.url).searchParams.get("token");
      const { room } = await loadRoom(context, code);
      if (!room) return json(req, { error: "Room not found or expired." }, 404);
      const index = playerIndex(room, token);
      if (index < 0) return json(req, { error: "This player token is not valid for the room." }, 403);
      return json(req, publicState(room, index));
    }

    if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "");
    const playerId = String(body.playerId || "Player").trim().slice(0, 40) || "Player";

    if (action === "create") {
      const store = roomStore(context);
      let code = "";
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = makeCode();
        if (!await store.get(roomKey(candidate))) {
          code = candidate;
          break;
        }
      }
      if (!code) return json(req, { error: "Unable to reserve a room code. Please try again." }, 503);

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
      return json(req, { code, token, state: publicState(room, 0) }, 201);
    }

    const code = String(body.code || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return json(req, { error: "Enter a valid six-character room code." }, 400);
    const { store, room } = await loadRoom(context, code);
    if (!room) return json(req, { error: "Room not found or expired." }, 404);

    if (action === "join") {
      if (room.players.length >= 2) return json(req, { error: "That room is already full." }, 409);
      const token = makeToken();
      const now = new Date().toISOString();
      room.players.push({ id: playerId, token, joinedAt: now, ready: false, ships: [], shots: [] });
      room.status = "placing";
      room.updatedAt = now;
      room.lastEvent = { id: crypto.randomUUID(), type: "joined", player: 1, at: now };
      await store.setJSON(roomKey(code), room);
      return json(req, { code, token, state: publicState(room, 1) });
    }

    const token = String(body.token || "");
    const index = playerIndex(room, token);
    if (index < 0) return json(req, { error: "This player token is not valid for the room." }, 403);

    if (action === "state") return json(req, publicState(room, index));

    if (action === "place") {
      if (room.status === "battle" || room.status === "finished") return json(req, { error: "Fleet placement is closed." }, 409);
      const ships = validateFleet(body.ships);
      if (!ships) return json(req, { error: "Fleet placement is invalid." }, 400);
      room.players[index].ships = ships;
      room.players[index].ready = true;
      const now = new Date().toISOString();
      room.lastEvent = { id: crypto.randomUUID(), type: "ready", player: index, at: now };
      if (room.players.length === 2 && room.players.every((player) => player.ready)) {
        room.status = "battle";
        room.turn = crypto.getRandomValues(new Uint8Array(1))[0] % 2;
      } else {
        room.status = room.players.length === 2 ? "placing" : "waiting";
      }
      room.updatedAt = now;
      await store.setJSON(roomKey(code), room);
      return json(req, publicState(room, index));
    }

    if (action === "fire") {
      if (room.status !== "battle") return json(req, { error: "The battle has not started." }, 409);
      if (room.turn !== index) return json(req, { error: "It is not your turn." }, 409);
      const cell = Number(body.cell);
      if (!validCell(cell)) return json(req, { error: "Invalid target." }, 400);
      if (room.players[index].shots.includes(cell)) return json(req, { error: "You already fired at that coordinate." }, 409);

      const defender = room.players[1 - index];
      room.players[index].shots.push(cell);
      const ship = defender.ships.find((candidate) => candidate.cells.includes(cell));
      const hit = Boolean(ship);
      if (ship) ship.hits.push(cell);
      const sunk = Boolean(ship && ship.cells.every((shipCell) => ship.hits.includes(shipCell)));
      const won = defender.ships.every((defenderShip) => defenderShip.cells.every((shipCell) => defenderShip.hits.includes(shipCell)));
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
      return json(req, { ...publicState(room, index), shotResult: { cell, hit, sunk, won } });
    }

    return json(req, { error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json(req, { error: "The battle server encountered an error." }, 500);
  }
};

export const config: Config = {
  path: ["/api/room", "/api/room/:code"],
};
