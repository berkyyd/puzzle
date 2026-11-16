const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomInt, randomUUID } = require("node:crypto");
const WebSocket = require("ws");

const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");
const rooms = new Map();
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const puzzleGrids = {
  12: { columns: 4, rows: 3 },
  50: { columns: 10, rows: 5 },
  100: { columns: 10, rows: 10 },
  250: { columns: 25, rows: 10 },
  500: { columns: 20, rows: 25 },
  1000: { columns: 40, rows: 25 },
};

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(publicDir, requested);
  if (!file.startsWith(`${publicDir}${path.sep}`) && file !== path.join(publicDir, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(file, (error, contents) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(contents);
  });
});

const wss = new WebSocket.Server({ server, maxPayload: 2 * 1024 * 1024 });

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const client of room.clients.values()) send(client.socket, message);
}

function roomSnapshot(room) {
  return {
    type: "room",
    code: room.code,
    hostId: room.hostId,
    players: [...room.clients.values()].map(({ id, name }) => ({ id, name })),
    game: room.game,
    locks: [...room.locks.entries()].map(([pieceId, playerId]) => ({ pieceId, playerId })),
  };
}

function broadcastRoom(room) {
  for (const client of room.clients.values()) {
    send(client.socket, { ...roomSnapshot(room), selfId: client.id });
  }
}

function releaseLocks(room, playerId) {
  for (const [pieceId, holderId] of room.locks) {
    if (holderId === playerId) {
      room.locks.delete(pieceId);
      broadcast(room, { type: "unlock", pieceId });
    }
  }
}

wss.on("connection", (socket) => {
  socket.playerId = randomUUID();
  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Geçersiz istek." });
      return;
    }

    if (message.type === "join") {
      const code = String(message.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      const name = String(message.name || "").trim().slice(0, 20);
      if (!name || code.length !== 6) {
        send(socket, { type: "error", message: "İsim ve geçerli bir oda kodu gerekli." });
        return;
      }

      let room = rooms.get(code);
      if (!room) {
        room = { code, hostId: socket.playerId, clients: new Map(), locks: new Map(), game: null };
        rooms.set(code, room);
      }
      if (room.clients.size >= 8) {
        send(socket, { type: "error", message: "Bu oda dolu (en fazla 8 kişi)." });
        return;
      }

      socket.roomCode = code;
      room.clients.set(socket.playerId, { id: socket.playerId, name, socket });
      broadcastRoom(room);
      return;
    }

    const room = rooms.get(socket.roomCode);
    if (!room) return;

    if (message.type === "signal") {
      const target = typeof message.to === "string" ? room.clients.get(message.to) : null;
      const signal = message.signal;
      if (!target || target.id === socket.playerId || !signal || typeof signal !== "object") return;
      if (signal.type === "offer" || signal.type === "answer") {
        if (typeof signal.sdp !== "string" || signal.sdp.length > 100_000) return;
        send(target.socket, {
          type: "signal",
          from: socket.playerId,
          signal: { type: signal.type, sdp: signal.sdp },
        });
        return;
      }
      if (signal.type === "candidate") {
        const candidate = signal.candidate;
        if (!candidate || typeof candidate.candidate !== "string" || candidate.candidate.length > 4096) return;
        send(target.socket, {
          type: "signal",
          from: socket.playerId,
          signal: {
            type: "candidate",
            candidate: candidate.candidate,
            sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
            sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex) ? candidate.sdpMLineIndex : null,
            usernameFragment: typeof candidate.usernameFragment === "string" ? candidate.usernameFragment : null,
          },
        });
      }
      return;
    }

    if (room.game?.completedAt && ["lock", "move", "place", "unlock"].includes(message.type)) return;

    if (message.type === "start") {
      if (socket.playerId !== room.hostId) return;
      const pieces = [12, 50, 100, 250, 500, 1000].includes(Number(message.pieces))
        ? Number(message.pieces)
        : 100;
      const image = typeof message.image === "string" && message.image.length <= 1_800_000
        ? message.image
        : "";
      if (!image.startsWith("data:image/")) {
        send(socket, { type: "error", message: "Geçerli bir görsel seçin." });
        return;
      }

      const requestedAspect = Number(message.imageAspect);
      const imageAspect = Number.isFinite(requestedAspect) && requestedAspect >= 0.1 && requestedAspect <= 10
        ? requestedAspect
        : 16 / 9;
      const board = { width: 1000, height: 1000 };
      const { columns, rows } = puzzleGrids[pieces];
      const tileWidth = board.width / columns;
      const tileHeight = board.height / rows;
      const tabDepth = Math.min(tileWidth, tileHeight) * 0.24;
      const positions = {};
      for (let index = 0; index < pieces; index += 1) {
        positions[index] = {
          x: randomInt(Math.ceil(tabDepth), Math.max(Math.ceil(tabDepth) + 1, board.width - Math.ceil(tileWidth + tabDepth))),
          y: randomInt(Math.ceil(tabDepth), Math.max(Math.ceil(tabDepth) + 1, board.height - Math.ceil(tileHeight + tabDepth))),
        };
      }
      room.locks.clear();
      room.game = {
        image,
        imageAspect,
        board,
        pieces,
        columns,
        rows,
        startedAt: Date.now(),
        completedAt: null,
        positions,
        solved: [],
      };
      broadcastRoom(room);
      return;
    }

    if (!room.game) return;
    if (message.type === "lock") {
      const pieceId = Number(message.pieceId);
      if (!Number.isInteger(pieceId) || pieceId < 0 || pieceId >= room.game.pieces) return;
      const holder = room.locks.get(pieceId);
      if (holder && holder !== socket.playerId) {
        send(socket, { type: "locked", pieceId });
        return;
      }
      room.locks.set(pieceId, socket.playerId);
      broadcast(room, { type: "lock", pieceId, playerId: socket.playerId });
      return;
    }

    if (message.type === "move") {
      const pieceId = Number(message.pieceId);
      if (room.locks.get(pieceId) !== socket.playerId) return;
      const x = Number(message.x);
      const y = Number(message.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const position = {
        x: Math.max(0, Math.min(990, x)),
        y: Math.max(0, Math.min(990, y)),
      };
      room.game.positions[pieceId] = position;
      broadcast(room, { type: "move", pieceId, ...position });
      return;
    }

    if (message.type === "place") {
      const pieceId = Number(message.pieceId);
      if (room.locks.get(pieceId) !== socket.playerId) return;
      const pieceW = room.game.board.width / room.game.columns;
      const pieceH = room.game.board.height / room.game.rows;
      const targetX = (pieceId % room.game.columns) * pieceW;
      const targetY = Math.floor(pieceId / room.game.columns) * pieceH;
      const current = room.game.positions[pieceId];
      const correct = Math.hypot(current.x - targetX, current.y - targetY) < Math.max(pieceW, pieceH) * 0.6;
      if (!correct) return;
      room.game.positions[pieceId] = { x: targetX, y: targetY };
      if (!room.game.solved.includes(pieceId)) room.game.solved.push(pieceId);
      if (room.game.solved.length === room.game.pieces) room.game.completedAt = Date.now();
      room.locks.delete(pieceId);
      broadcast(room, {
        type: "placed",
        pieceId,
        x: targetX,
        y: targetY,
        solved: room.game.solved.length,
        completedAt: room.game.completedAt,
      });
      return;
    }

    if (message.type === "unlock") {
      if (room.locks.get(Number(message.pieceId)) !== socket.playerId) return;
      room.locks.delete(Number(message.pieceId));
      broadcast(room, { type: "unlock", pieceId: Number(message.pieceId) });
      return;
    }

    if (message.type === "chat") {
      const text = String(message.text || "").trim().slice(0, 180);
      if (text) broadcast(room, {
        type: "chat",
        playerId: socket.playerId,
        name: room.clients.get(socket.playerId)?.name || "Oyuncu",
        text,
      });
    }
  });

  socket.on("close", () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    releaseLocks(room, socket.playerId);
    room.clients.delete(socket.playerId);
    if (room.clients.size === 0) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === socket.playerId) room.hostId = room.clients.keys().next().value;
    broadcastRoom(room);
  });
});

server.listen(port, () => {
  console.log(`Birlikte Puzzle hazır: http://localhost:${port}`);
});
