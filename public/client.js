const presets = [
  { name: "Dağ sabahı", colors: ["#ffd19d", "#8cbdc3", "#315e68"], shapes: '<circle cx="340" cy="95" r="52" fill="#ffe5ae"/><path d="M0 235 135 91l106 119 95-115 164 140v86H0z" fill="#709a9a"/><path d="m0 251 177-94 113 105 93-72 117 62v69H0z" fill="#395f66"/><path d="m135 91 45 49 30-7 31 77zM336 95l36 50 31-4 32 64z" fill="#f3e7d5"/>', background: "#f6c99c" },
  { name: "Çiçek zamanı", colors: ["#ffc8c2", "#a9c49b", "#597a61"], shapes: '<rect y="0" width="500" height="280" fill="#f2bcaf"/><path d="M120 280q28-99 4-193m5 128q45-65 87-61m150 126q-23-103 10-196m-8 131q-49-57-79-55" fill="none" stroke="#698766" stroke-width="12"/><g fill="#f8e0b0"><circle cx="124" cy="85" r="36"/><circle cx="88" cy="92" r="27"/><circle cx="157" cy="111" r="27"/><circle cx="350" cy="111" r="37"/><circle cx="386" cy="96" r="27"/><circle cx="319" cy="82" r="26"/></g><g fill="#d8857b"><circle cx="124" cy="96" r="15"/><circle cx="350" cy="100" r="15"/></g>', background: "#f2bcaf" },
  { name: "Deniz kıyısı", colors: ["#a6d9d6", "#52a9b5", "#f0d4ad"], shapes: '<rect y="0" width="500" height="280" fill="#a9dad7"/><circle cx="365" cy="80" r="43" fill="#f7dfb0"/><path d="M0 143q75-29 150 0t150 0 200 0v137H0z" fill="#71c0c2"/><path d="M0 183q75-30 150 0t150 0 200 0v97H0z" fill="#459daf"/><path d="M0 235q95-24 187 0t313 0v45H0z" fill="#f0d4ad"/><path d="M0 252q93-20 174 0t326 0" fill="none" stroke="#fff1d8" stroke-width="8"/>', background: "#a9dad7" },
  { name: "Tatlı dostlar", colors: ["#e6c6ab", "#8b746e", "#d89472"], shapes: '<rect y="0" width="500" height="280" fill="#e9d8c6"/><path d="M126 92 90 22l77 37m118 32 45-69 45 79" fill="#ba8975"/><path d="M89 123q13-75 87-71 85 5 80 96-3 99-92 102-94 2-82-127" fill="#d59478"/><path d="M270 123q14-74 88-71 83 6 79 96-4 99-91 102-93 2-81-127" fill="#967b72"/><circle cx="143" cy="145" r="7" fill="#594e4d"/><circle cx="202" cy="145" r="7" fill="#594e4d"/><circle cx="323" cy="145" r="7" fill="#594e4d"/><circle cx="383" cy="145" r="7" fill="#594e4d"/><path d="M160 180q14 14 29 0m-29 0q-14 14-29 0m151 0q14 14 29 0m-29 0q-14 14-29 0" fill="none" stroke="#654f4d" stroke-width="5" stroke-linecap="round"/>', background: "#e9d8c6" },
];

const svgImage = (preset) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 280"><rect width="500" height="280" fill="${preset.background}"/>${preset.shapes}</svg>`)}`;
const $ = (selector) => document.querySelector(selector);
const lobby = $("#lobby"), waiting = $("#waiting"), game = $("#game");
let socket, roomCode = "", playerId = "", playerName = "", selectedImage = svgImage(presets[0]), selectedImageAspect = 500 / 280;
let selectedPieces = 100, gameState = null, players = [], startedAt = 0, timerHandle, toastHandle;
const pieces = new Map(), locks = new Map();
const peerConnections = new Map();
let localMediaStream = null, cameraEnabled = false, microphoneEnabled = false;
let celebratedGameStart = null;
const playerColors = ["#8876d9", "#e79580", "#65a9a0", "#d69b58", "#7d91cf", "#ca82a5", "#779d76", "#ae83bf"];

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => element.classList.remove("visible"), 2600);
}

function show(section) {
  lobby.classList.toggle("hidden", section !== lobby);
  waiting.classList.toggle("hidden", section !== waiting);
  game.classList.toggle("hidden", section !== game);
}

function connect(code, name) {
  if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  playerName = name.trim();
  if (!playerName) { toast("Önce ismini yazabilir misin?"); $("#player-name").focus(); return; }
  if (!/^[A-Z0-9]{6}$/.test(code)) { toast("Oda numarası 6 karakter olmalı."); return; }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${scheme}//${location.host}`);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "join", code, name: playerName })));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "error") { toast(message.message); return; }
    if (message.type === "room") onRoom(message);
    if (message.type === "lock") {
      setLock(message.pieceId, message.playerId);
      if (message.playerId === playerId && activeDrag?.id === Number(message.pieceId) && activeDrag.released) {
        socket.send(JSON.stringify({ type: "unlock", pieceId: message.pieceId }));
        activeDrag = null;
      }
    }
    if (message.type === "locked") {
      if (activeDrag?.id === Number(message.pieceId)) activeDrag = null;
      toast("Bu parçayı şu an başka biri tutuyor.");
    }
    if (message.type === "unlock") setLock(message.pieceId, null);
    if (message.type === "move") updatePosition(message.pieceId, message.x, message.y);
    if (message.type === "placed") placePiece(message);
    if (message.type === "chat") addChat(message);
    if (message.type === "signal") handleSignal(message).catch((error) => {
      console.error("WebRTC signaling failed:", error);
      toast("Görüntü veya ses bağlantısı kurulamadı.");
    });
  });
  socket.addEventListener("close", () => {
    closeMediaConnections();
    if (!lobby.classList.contains("hidden") && !waiting.classList.contains("hidden") && roomCode) {
      toast("Bağlantı kesildi. Odaya yeniden katılmayı deneyin.");
    }
  });
  socket.addEventListener("error", () => toast("Sunucuya bağlanılamadı. Lütfen tekrar dene."));
}

function onRoom(room) {
  roomCode = room.code;
  playerId = room.selfId;
  players = room.players;
  renderPlayers();
  if (room.game) {
    if (gameState?.startedAt !== room.game.startedAt) {
      gameState = room.game;
      locks.clear();
      show(game);
      renderGame();
    }
    gameState = room.game;
    for (const pieceId of locks.keys()) setLock(pieceId, null);
    locks.clear();
    for (const lock of room.locks || []) setLock(lock.pieceId, lock.playerId);
    syncPeerConnections();
    renderMediaTiles();
    show(game);
  } else {
    closeMediaConnections();
    gameState = null;
    $("#display-code").textContent = room.code;
    $("#start-game").classList.toggle("hidden", room.hostId !== playerId);
    renderWaitingPlayers();
    show(waiting);
  }
}

function renderWaitingPlayers() {
  $("#waiting-players").innerHTML = players.map((player) => `<span class="player-chip">${escapeHtml(player.name)}${player.id === playerId ? " · sen" : ""}</span>`).join("");
}

function renderPlayers() {
  $("#online-count").textContent = players.length;
  $("#game-players").innerHTML = players.map((player) => `<span class="player-avatar" title="${escapeHtml(player.name)}">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>`).join("");
}

function signalPeer(peerId, signal) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "signal", to: peerId, signal }));
  }
}

function syncPeerConnections() {
  if (!gameState || !playerId) return;
  const activePeerIds = new Set(players.filter((player) => player.id !== playerId).map((player) => player.id));
  for (const [peerId, peer] of peerConnections) {
    if (!activePeerIds.has(peerId)) {
      peer.connection.close();
      peerConnections.delete(peerId);
    }
  }
  for (const peerId of activePeerIds) {
    if (peerConnections.has(peerId)) continue;
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const peer = {
      connection,
      remoteStream: new MediaStream(),
      makingOffer: false,
      ignoreOffer: false,
      polite: playerId > peerId,
    };
    peerConnections.set(peerId, peer);
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) signalPeer(peerId, { type: "candidate", candidate: candidate.toJSON() });
    };
    connection.ontrack = (event) => {
      if (event.streams[0]) peer.remoteStream = event.streams[0];
      else peer.remoteStream.addTrack(event.track);
      event.track.onended = renderMediaTiles;
      event.track.onmute = renderMediaTiles;
      event.track.onunmute = renderMediaTiles;
      renderMediaTiles();
    };
    connection.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription();
        signalPeer(peerId, connection.localDescription.toJSON());
      } catch (error) {
        console.error("Unable to create WebRTC offer:", error);
        toast("Görüntü veya ses bağlantısı başlatılamadı.");
      } finally {
        peer.makingOffer = false;
      }
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") {
        toast("Bir oyuncuyla medya bağlantısı kurulamadı; ağ ayarlarını kontrol edin.");
      }
    };
    if (localMediaStream) {
      for (const track of localMediaStream.getTracks()) connection.addTrack(track, localMediaStream);
    }
  }
}

async function handleSignal(message) {
  const peer = peerConnections.get(message.from);
  if (!peer) return;
  const { connection } = peer;
  const signal = message.signal;
  if (signal.type === "candidate") {
    try {
      await connection.addIceCandidate(signal.candidate);
    } catch (error) {
      if (!peer.ignoreOffer) throw error;
    }
    return;
  }

  const offerCollision = signal.type === "offer"
    && (peer.makingOffer || connection.signalingState !== "stable");
  peer.ignoreOffer = !peer.polite && offerCollision;
  if (peer.ignoreOffer) return;
  if (offerCollision) await connection.setLocalDescription({ type: "rollback" });
  await connection.setRemoteDescription(signal);
  if (signal.type === "offer") {
    await connection.setLocalDescription();
    signalPeer(message.from, connection.localDescription.toJSON());
  }
}

function renderMediaTiles() {
  const container = $("#media-tiles");
  container.replaceChildren();
  const tiles = [];
  if (localMediaStream?.getTracks().some((track) => track.readyState === "live")) {
    tiles.push({ id: playerId, stream: localMediaStream, local: true });
  }
  for (const [peerId, peer] of peerConnections) {
    if (peer.remoteStream.getTracks().some((track) => track.readyState === "live")) {
      tiles.push({ id: peerId, stream: peer.remoteStream, local: false });
    }
  }
  for (const tile of tiles) {
    const player = players.find((item) => item.id === tile.id);
    const videoTrack = tile.stream.getVideoTracks().find((track) => track.readyState === "live" && track.enabled && !track.muted);
    const audioTrack = tile.stream.getAudioTracks().find((track) => track.readyState === "live" && track.enabled && !track.muted);
    const card = document.createElement("div");
    card.className = "media-tile";
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = tile.local;
    video.srcObject = tile.stream;
    video.classList.toggle("audio-only", !videoTrack);
    const avatar = document.createElement("span");
    avatar.className = "media-avatar";
    avatar.textContent = (player?.name || "Oyuncu").slice(0, 1).toLocaleUpperCase("tr-TR");
    avatar.hidden = Boolean(videoTrack);
    const name = document.createElement("span");
    name.className = "media-tile-name";
    name.textContent = `${player?.name || "Oyuncu"}${tile.local ? " · sen" : ""}`;
    const indicator = document.createElement("span");
    indicator.className = "media-indicator";
    indicator.textContent = audioTrack ? "♫" : "♫ kapalı";
    indicator.title = audioTrack ? "Mikrofon açık" : "Mikrofon kapalı";
    card.append(video, avatar, name, indicator);
    container.append(card);
  }
}

function updateMediaControls() {
  const camera = $("#media-camera"), microphone = $("#media-microphone");
  camera.setAttribute("aria-pressed", String(cameraEnabled));
  camera.textContent = cameraEnabled ? "▣ Kamerayı kapat" : "▣ Kamerayı aç";
  microphone.setAttribute("aria-pressed", String(microphoneEnabled));
  microphone.textContent = microphoneEnabled ? "♫ Mikrofonu kapat" : "♫ Mikrofonu aç";
}

function removeLocalTrack(track) {
  if (!localMediaStream?.getTracks().includes(track)) return;
  for (const peer of peerConnections.values()) {
    const sender = peer.connection.getSenders().find((item) => item.track === track);
    if (sender) peer.connection.removeTrack(sender);
  }
  localMediaStream.removeTrack(track);
  if (track.kind === "video") cameraEnabled = false;
  else microphoneEnabled = false;
  if (!localMediaStream.getTracks().length) localMediaStream = null;
  updateMediaControls();
  renderMediaTiles();
}

async function toggleMedia(kind) {
  const enabled = kind === "video" ? cameraEnabled : microphoneEnabled;
  const button = kind === "video" ? $("#media-camera") : $("#media-microphone");
  button.disabled = true;
  try {
    if (enabled) {
      const tracks = localMediaStream?.getTracks().filter((track) => track.kind === kind) || [];
      for (const track of tracks) {
        for (const peer of peerConnections.values()) {
          const sender = peer.connection.getSenders().find((item) => item.track === track);
          if (sender) peer.connection.removeTrack(sender);
        }
        track.onended = null;
        track.stop();
        localMediaStream.removeTrack(track);
      }
      if (!localMediaStream?.getTracks().length) localMediaStream = null;
      if (kind === "video") cameraEnabled = false;
      else microphoneEnabled = false;
    } else {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Kamera ve mikrofon için güvenli bağlantı (HTTPS veya localhost) gerekli.");
      }
      if (typeof RTCPeerConnection === "undefined") {
        throw new Error("Tarayıcınız görüntülü ve sesli görüşmeyi desteklemiyor.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: kind === "video",
        audio: kind === "audio",
      });
      localMediaStream ||= new MediaStream();
      for (const track of stream.getTracks()) {
        track.onended = () => removeLocalTrack(track);
        localMediaStream.addTrack(track);
      }
      if (kind === "video") cameraEnabled = true;
      else microphoneEnabled = true;
      syncPeerConnections();
      for (const peer of peerConnections.values()) {
        for (const track of stream.getTracks()) {
          if (!peer.connection.getSenders().some((sender) => sender.track === track)) {
            peer.connection.addTrack(track, localMediaStream);
          }
        }
      }
    }
    updateMediaControls();
    renderMediaTiles();
  } catch (error) {
    console.error(`Unable to enable ${kind}:`, error);
    toast(error.name === "NotAllowedError"
      ? "Kamera veya mikrofon izni verilmedi."
      : error.message || "Kamera veya mikrofona erişilemedi.");
  } finally {
    button.disabled = false;
  }
}

function closeMediaConnections() {
  for (const peer of peerConnections.values()) peer.connection.close();
  peerConnections.clear();
  if (localMediaStream) {
    for (const track of localMediaStream.getTracks()) {
      track.onended = null;
      track.stop();
    }
  }
  localMediaStream = null;
  cameraEnabled = false;
  microphoneEnabled = false;
  updateMediaControls();
  renderMediaTiles();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function startGame() {
  if (socket?.readyState !== WebSocket.OPEN) { toast("Sunucu bağlantısı kuruluyor…"); return; }
  socket.send(JSON.stringify({ type: "start", image: selectedImage, imageAspect: selectedImageAspect, pieces: selectedPieces }));
}

function edgeSign(direction, row, column) {
  const key = `${direction}:${row}:${column}`;
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return hash & 1 ? 1 : -1;
}

function puzzlePiecePath(width, height, depth, edges) {
  const sides = [
    { name: "top", length: width, start: [0, 0], tangent: [1, 0], normal: [0, -1] },
    { name: "right", length: height, start: [width, 0], tangent: [0, 1], normal: [1, 0] },
    { name: "bottom", length: width, start: [width, height], tangent: [-1, 0], normal: [0, 1] },
    { name: "left", length: height, start: [0, height], tangent: [0, -1], normal: [-1, 0] },
  ];
  const point = (side, amount, outward = 0) => [
    side.start[0] + side.tangent[0] * side.length * amount + side.normal[0] * outward,
    side.start[1] + side.tangent[1] * side.length * amount + side.normal[1] * outward,
  ];
  const format = ([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  const commands = ["M 0 0"];

  for (const side of sides) {
    const sign = edges[side.name];
    if (!sign) {
      commands.push(`L ${format(point(side, 1))}`);
      continue;
    }

    const amount = sign * depth;
    commands.push(`L ${format(point(side, .3))}`);
    commands.push(`C ${format(point(side, .37))} ${format(point(side, .39, amount * .12))} ${format(point(side, .4, amount * .38))}`);
    commands.push(`C ${format(point(side, .4, amount * .7))} ${format(point(side, .43, amount * 1.05))} ${format(point(side, .5, amount * 1.05))}`);
    commands.push(`C ${format(point(side, .57, amount * 1.05))} ${format(point(side, .6, amount * .7))} ${format(point(side, .6, amount * .38))}`);
    commands.push(`C ${format(point(side, .61, amount * .12))} ${format(point(side, .63))} ${format(point(side, .7))}`);
    commands.push(`L ${format(point(side, 1))}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

function pieceEdges(id) {
  const column = id % gameState.columns;
  const row = Math.floor(id / gameState.columns);
  return {
    top: id < gameState.columns ? 0 : -edgeSign("h", row, column),
    right: column === gameState.columns - 1 || id + 1 >= gameState.pieces ? 0 : edgeSign("v", row, column + 1),
    bottom: id + gameState.columns >= gameState.pieces ? 0 : edgeSign("h", row + 1, column),
    left: column === 0 ? 0 : -edgeSign("v", row, column),
  };
}

function renderGame() {
  if (!gameState) return;
  startedAt = gameState.startedAt;
  $("#game-code").textContent = roomCode;
  $("#reference-image").src = gameState.image;
  $("#total-pieces").textContent = gameState.pieces;
  $("#game-subtitle").textContent = gameState.completedAt
    ? `Beraber tamamladınız! Harika iş · ${formatElapsed(gameState.completedAt)}`
    : `Bir parçaya dokun, birlikte tamamlayalım · ${gameState.columns} × ${gameState.rows}`;
  const stage = $("#puzzle-stage");
  const bounds = stage.getBoundingClientRect();
  const { board } = gameState;
  const boardW = Math.min(bounds.width * .9, bounds.height * .8 * gameState.imageAspect);
  const boardH = boardW / gameState.imageAspect;
  const boardLeft = (bounds.width - boardW) / 2;
  const boardTop = (bounds.height - boardH) / 2;
  $("#puzzle-board").style.left = `${boardLeft}px`;
  $("#puzzle-board").style.top = `${boardTop}px`;
  $("#puzzle-board").style.width = `${boardW}px`;
  $("#puzzle-board").style.height = `${boardH}px`;
  const tileW = boardW / gameState.columns;
  const tileH = boardH / gameState.rows;
  const tabDepth = Math.min(tileW, tileH) * .24;
  const layer = $("#pieces-layer");
  layer.replaceChildren();
  pieces.clear();
  gameState.solved.forEach((id) => locks.set(id, null));
  for (let id = 0; id < gameState.pieces; id += 1) {
    const piece = document.createElement("div");
    piece.className = "piece";
    piece.dataset.id = id;
    piece.dataset.depth = tabDepth;
    piece.style.width = `${tileW + tabDepth * 2}px`;
    piece.style.height = `${tileH + tabDepth * 2}px`;
    const column = id % gameState.columns;
    const row = Math.floor(id / gameState.columns);
    const edges = pieceEdges(id);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${tileW + tabDepth * 2} ${tileH + tabDepth * 2}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("aria-hidden", "true");
    const defs = document.createElementNS(svg.namespaceURI, "defs");
    const clip = document.createElementNS(svg.namespaceURI, "clipPath");
    const clipId = `piece-${roomCode}-${id}`;
    clip.id = clipId;
    clip.setAttribute("clipPathUnits", "userSpaceOnUse");
    const shape = document.createElementNS(svg.namespaceURI, "path");
    shape.setAttribute("d", puzzlePiecePath(tileW, tileH, tabDepth, edges));
    shape.setAttribute("transform", `translate(${tabDepth} ${tabDepth})`);
    clip.append(shape);
    defs.append(clip);
    const image = document.createElementNS(svg.namespaceURI, "image");
    image.setAttribute("href", gameState.image);
    image.setAttribute("x", `${tabDepth - column * tileW}`);
    image.setAttribute("y", `${tabDepth - row * tileH}`);
    image.setAttribute("width", `${boardW}`);
    image.setAttribute("height", `${boardH}`);
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("clip-path", `url(#${clipId})`);
    const seam = document.createElementNS(svg.namespaceURI, "path");
    seam.setAttribute("d", puzzlePiecePath(tileW, tileH, tabDepth, edges));
    seam.setAttribute("transform", `translate(${tabDepth} ${tabDepth})`);
    seam.setAttribute("fill", "none");
    seam.setAttribute("stroke", "#514a45");
    seam.setAttribute("stroke-opacity", ".68");
    seam.setAttribute("stroke-width", `${Math.max(.7, Math.min(1.5, tileW / 42))}`);
    seam.setAttribute("stroke-linejoin", "round");
    svg.append(defs, image, seam);
    piece.append(svg);
    const position = gameState.positions[id];
    if (gameState.solved.includes(id)) {
      piece.style.left = `${boardLeft + column * tileW - tabDepth}px`;
      piece.style.top = `${boardTop + row * tileH - tabDepth}px`;
      piece.classList.add("solved");
    } else {
      piece.style.left = `${boardLeft + position.x * boardW / board.width - tabDepth}px`;
      piece.style.top = `${boardTop + position.y * boardH / board.height - tabDepth}px`;
    }
    pieces.set(id, piece);
    layer.append(piece);
  }
  updateProgress(gameState.solved.length);
  $("#capture-memory").classList.toggle("hidden", !gameState.completedAt);
  renderPlayers();
  clearInterval(timerHandle);
  if (!gameState.completedAt) timerHandle = setInterval(updateTimer, 1000);
  updateTimer();
  if (gameState.completedAt) showCelebration();
}

function formatElapsed(endTime) {
  const seconds = Math.max(0, Math.floor((endTime - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function updateTimer() {
  $("#timer").textContent = formatElapsed(gameState.completedAt || Date.now());
}

function updateProgress(solved) {
  $("#progress").textContent = solved;
  $("#progress-fill").style.width = `${solved / gameState.pieces * 100}%`;
  $("#loose-count").textContent = gameState.pieces - solved;
  $("#capture-memory").classList.toggle("hidden", solved !== gameState.pieces);
  if (solved === gameState.pieces) {
    gameState.completedAt ||= Date.now();
    clearInterval(timerHandle);
    updateTimer();
    $("#game-subtitle").textContent = `Beraber tamamladınız! Harika iş · ${$("#timer").textContent}`;
  }
}

function updatePosition(id, x, y) {
  const piece = pieces.get(Number(id));
  if (!piece) return;
  const bounds = $("#puzzle-stage").getBoundingClientRect();
  const boardW = Math.min(bounds.width * .9, bounds.height * .8 * gameState.imageAspect);
  const boardH = boardW / gameState.imageAspect;
  const boardLeft = (bounds.width - boardW) / 2;
  const boardTop = (bounds.height - boardH) / 2;
  const depth = Number(piece.dataset.depth);
  piece.style.left = `${boardLeft + x * boardW / gameState.board.width - depth}px`;
  piece.style.top = `${boardTop + y * boardH / gameState.board.height - depth}px`;
}

function setLock(id, owner) {
  id = Number(id);
  if (owner) locks.set(id, owner);
  else locks.delete(id);
  const piece = pieces.get(id);
  if (piece) {
    piece.classList.toggle("locked", Boolean(owner));
    piece.classList.toggle("dragging", owner === playerId);
    let badge = piece.querySelector(".piece-holder-badge");
    if (owner) {
      const ownerIndex = players.findIndex((player) => player.id === owner);
      const ownerName = players[ownerIndex]?.name || "Oyuncu";
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "piece-holder-badge";
        badge.setAttribute("aria-hidden", "true");
        piece.append(badge);
      }
      badge.textContent = ownerName.trim().slice(0, 1).toLocaleUpperCase("tr-TR");
      badge.title = `${ownerName} bu parçayı taşıyor`;
      badge.style.setProperty("--holder-color", playerColors[Math.max(0, ownerIndex) % playerColors.length]);
    } else {
      badge?.remove();
    }
  }
}

function placePiece(message) {
  updatePosition(message.pieceId, message.x, message.y);
  const piece = pieces.get(Number(message.pieceId));
  if (piece) {
    piece.classList.remove("dragging", "locked");
    piece.classList.add("solved");
    piece.querySelector(".piece-holder-badge")?.remove();
  }
  locks.delete(Number(message.pieceId));
  gameState.completedAt = message.completedAt || null;
  updateProgress(message.solved);
  if (gameState.completedAt) showCelebration();
}

function showCelebration() {
  if (celebratedGameStart === gameState.startedAt) return;
  celebratedGameStart = gameState.startedAt;
  $("#completion-time").textContent = formatElapsed(gameState.completedAt);
  $("#completion-modal").classList.remove("hidden");
}

let activeDrag = null;
$("#pieces-layer").addEventListener("pointerdown", (event) => {
  const layer = $("#pieces-layer");
  const hit = event.target.closest(".piece");
  let piece = hit && !hit.classList.contains("solved") ? hit : null;
  if (!piece) {
    const candidates = [...layer.querySelectorAll(".piece:not(.solved)")]
      .filter((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return !locks.has(Number(candidate.dataset.id))
          && event.clientX >= bounds.left && event.clientX <= bounds.right
          && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      });
    piece = candidates.pop();
  }
  if (!piece) return;
  const id = Number(piece.dataset.id);
  if (locks.has(id)) return;
  activeDrag = { id, pointerId: event.pointerId, offsetX: event.clientX - piece.getBoundingClientRect().left, offsetY: event.clientY - piece.getBoundingClientRect().top };
  socket.send(JSON.stringify({ type: "lock", pieceId: id }));
  piece.setPointerCapture(event.pointerId);
});

$("#pieces-layer").addEventListener("pointermove", (event) => {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId || locks.get(activeDrag.id) !== playerId) return;
  const stageBounds = $("#puzzle-stage").getBoundingClientRect();
  const piece = pieces.get(activeDrag.id);
  const depth = Number(piece.dataset.depth);
  const boardW = Math.min(stageBounds.width * .9, stageBounds.height * .8 * gameState.imageAspect);
  const boardH = boardW / gameState.imageAspect;
  const boardLeft = (stageBounds.width - boardW) / 2;
  const boardTop = (stageBounds.height - boardH) / 2;
  const tileW = boardW / gameState.columns;
  const tileH = boardH / gameState.rows;
  const x = Math.max(0, Math.min(boardW - tileW, event.clientX - stageBounds.left - activeDrag.offsetX + depth - boardLeft));
  const y = Math.max(0, Math.min(boardH - tileH, event.clientY - stageBounds.top - activeDrag.offsetY + depth - boardTop));
  piece.style.left = `${boardLeft + x - depth}px`;
  piece.style.top = `${boardTop + y - depth}px`;
  socket.send(JSON.stringify({ type: "move", pieceId: activeDrag.id, x: x * gameState.board.width / boardW, y: y * gameState.board.height / boardH }));
});

function endDrag(event) {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
  const id = activeDrag.id;
  if (locks.get(id) !== playerId) {
    activeDrag.released = true;
    return;
  }
  activeDrag = null;
  const stageBounds = $("#puzzle-stage").getBoundingClientRect();
  const boardW = Math.min(stageBounds.width * .9, stageBounds.height * .8 * gameState.imageAspect);
  const boardH = boardW / gameState.imageAspect;
  const boardLeft = (stageBounds.width - boardW) / 2;
  const boardTop = (stageBounds.height - boardH) / 2;
  const tileW = boardW / gameState.columns;
  const tileH = boardH / gameState.rows;
  const column = id % gameState.columns, row = Math.floor(id / gameState.columns);
  const targetX = boardLeft + column * tileW;
  const targetY = boardTop + row * tileH;
  const piece = pieces.get(id);
  const depth = Number(piece.dataset.depth);
  const snapDistance = Math.min(tileW, tileH) * .5;
  if (Math.hypot(parseFloat(piece.style.left) + depth - targetX, parseFloat(piece.style.top) + depth - targetY) < snapDistance) {
    socket.send(JSON.stringify({ type: "place", pieceId: id }));
  } else {
    socket.send(JSON.stringify({ type: "unlock", pieceId: id }));
  }
}
$("#pieces-layer").addEventListener("pointerup", endDrag);
$("#pieces-layer").addEventListener("pointercancel", endDrag);

function addChat(message) {
  const row = document.createElement("div");
  row.className = "chat-message";
  const name = document.createElement("b");
  name.textContent = message.name;
  row.append(name, document.createTextNode(message.text));
  $("#chat-messages").append(row);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

presets.forEach((preset, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `preset-card${index === 0 ? " selected" : ""}`;
  button.innerHTML = `<img src="${svgImage(preset)}" alt=""><span>${preset.name}</span>`;
  button.addEventListener("click", () => {
    document.querySelectorAll(".preset-card").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    selectedImage = svgImage(preset);
    selectedImageAspect = 500 / 280;
    $("#upload-status").textContent = "";
  });
  $("#preset-list").append(button);
});

document.querySelectorAll(".piece-choice").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".piece-choice").forEach((choice) => choice.classList.remove("selected"));
  button.classList.add("selected");
  selectedPieces = Number(button.dataset.pieces);
}));

$("#image-upload").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { toast("Lütfen JPG, PNG veya WebP seç."); return; }
  const image = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    image.onload = () => {
      const scale = Math.min(1, 1400 / image.width, 1000 / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      selectedImage = canvas.toDataURL("image/jpeg", .84);
      selectedImageAspect = canvas.width / canvas.height;
      document.querySelectorAll(".preset-card").forEach((item) => item.classList.remove("selected"));
      $("#upload-status").textContent = `✓ ${file.name} puzzle için hazır`;
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function makeRoom() {
  const code = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  history.replaceState(null, "", `?oda=${code}`);
  connect(code, $("#player-name").value);
}
$("#create-room").addEventListener("click", makeRoom);
$("#join-room").addEventListener("click", () => connect($("#room-code").value.toUpperCase().replace(/-/g, ""), $("#player-name").value));
$("#room-code").addEventListener("keydown", (event) => { if (event.key === "Enter") $("#join-room").click(); });
$("#start-game").addEventListener("click", startGame);
$("#copy-code").addEventListener("click", () => navigator.clipboard.writeText(roomCode).then(() => toast("Oda numarası kopyalandı!")).catch(() => toast(`Oda numarası: ${roomCode}`)));
async function copyLink() {
  const link = `${location.origin}/?oda=${roomCode}`;
  try { await navigator.clipboard.writeText(link); toast("Davet bağlantısı kopyalandı!"); }
  catch { toast(link); }
}
$("#copy-link").addEventListener("click", copyLink);
$("#share-room").addEventListener("click", copyLink);
function goHome() {
  $("#completion-modal").classList.add("hidden");
  $("#memory-modal").classList.add("hidden");
  if (memoryPreviewUrl) URL.revokeObjectURL(memoryPreviewUrl);
  memoryPreviewUrl = "";
  memoryBlob = null;
  if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  clearInterval(timerHandle);
  history.replaceState(null, "", "/");
  roomCode = "";
  playerId = "";
  gameState = null;
  players = [];
  pieces.clear();
  locks.clear();
  show(lobby);
}
$("#back-home").addEventListener("click", goHome);
$("#game-home").addEventListener("click", goHome);
$("#media-camera").addEventListener("click", () => toggleMedia("video"));
$("#media-microphone").addEventListener("click", () => toggleMedia("audio"));
$("#chat-toggle").addEventListener("click", () => $("#chat-panel").classList.toggle("hidden"));
$("#chat-close").addEventListener("click", () => $("#chat-panel").classList.add("hidden"));
function closeCelebration() {
  $("#completion-modal").classList.add("hidden");
}
$("#completion-close").addEventListener("click", closeCelebration);
$("#completion-close-action").addEventListener("click", closeCelebration);
$("#completion-home").addEventListener("click", goHome);
$("#completion-modal").addEventListener("click", (event) => {
  if (event.target === $("#completion-modal")) closeCelebration();
});

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

async function createMemoryCard() {
  if (!gameState?.completedAt) throw new Error("Puzzle henüz tamamlanmadı.");
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Puzzle görseli yüklenemedi."));
    image.src = gameState.image;
  });

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Anı kartı oluşturulamadı.");

  const background = context.createLinearGradient(0, 0, 1200, 900);
  background.addColorStop(0, "#f7e9df");
  background.addColorStop(.52, "#f5effb");
  background.addColorStop(1, "#e5f1ed");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  roundedRect(context, 54, 48, 1092, 804, 32);
  context.fill();

  context.fillStyle = "#8876d9";
  roundedRect(context, 92, 82, 52, 52, 17);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "800 33px Manrope, sans-serif";
  context.textAlign = "center";
  context.fillText("p.", 118, 119);
  context.textAlign = "left";
  context.fillStyle = "#37333e";
  context.font = "700 24px Manrope, sans-serif";
  context.fillText("parça parça", 158, 115);
  context.fillStyle = "#928b9a";
  context.font = "700 13px 'DM Sans', sans-serif";
  context.textAlign = "right";
  context.fillText("BİRLİKTE TAMAMLANDI  ·  ODA " + roomCode, 1106, 112);

  const imageScale = Math.min(976 / image.width, 460 / image.height);
  const imageWidth = image.width * imageScale;
  const imageHeight = image.height * imageScale;
  const imageX = 112 + (976 - imageWidth) / 2;
  const imageY = 180 + (460 - imageHeight) / 2;
  const imagePadding = 18;
  context.fillStyle = "#f4f1f3";
  roundedRect(
    context,
    imageX - imagePadding,
    imageY - imagePadding,
    imageWidth + imagePadding * 2,
    imageHeight + imagePadding * 2,
    20,
  );
  context.fill();
  const tileWidth = imageWidth / gameState.columns;
  const tileHeight = imageHeight / gameState.rows;
  const tabDepth = Math.min(tileWidth, tileHeight) * .24;
  context.save();
  roundedRect(context, imageX, imageY, imageWidth, imageHeight, 12);
  context.clip();
  for (let id = 0; id < gameState.pieces; id += 1) {
    const column = id % gameState.columns;
    const row = Math.floor(id / gameState.columns);
    const path = new Path2D(puzzlePiecePath(tileWidth, tileHeight, tabDepth, pieceEdges(id)));
    context.save();
    context.translate(imageX + column * tileWidth - tabDepth, imageY + row * tileHeight - tabDepth);
    context.translate(tabDepth, tabDepth);
    context.clip(path);
    context.drawImage(
      image,
      -column * tileWidth,
      -row * tileHeight,
      imageWidth,
      imageHeight,
    );
    context.restore();

    context.save();
    context.translate(imageX + column * tileWidth - tabDepth, imageY + row * tileHeight - tabDepth);
    context.translate(tabDepth, tabDepth);
    context.strokeStyle = "#473f45";
    context.globalAlpha = .9;
    context.lineWidth = Math.max(2.2, Math.min(3.2, tileWidth * .045));
    context.lineJoin = "round";
    context.shadowColor = "#30283b35";
    context.shadowBlur = 2;
    context.stroke(path);
    context.restore();
  }
  context.restore();

  context.textAlign = "left";
  context.fillStyle = "#37333e";
  context.font = "800 35px Manrope, sans-serif";
  context.fillText("Her parça yerini buldu.", 94, 724);
  context.fillStyle = "#82798a";
  context.font = "500 18px 'DM Sans', sans-serif";
  const playerNames = players.map((player) => player.name).join(" · ");
  context.fillText(playerNames ? `${playerNames} ile güzel bir an.` : "Birlikte güzel bir an.", 96, 762);

  context.fillStyle = "#f1edfb";
  roundedRect(context, 880, 694, 226, 100, 19);
  context.fill();
  context.textAlign = "center";
  context.fillStyle = "#8876d9";
  context.font = "700 12px 'DM Sans', sans-serif";
  context.fillText("TAMAMLAMA SÜRESİ", 993, 728);
  context.fillStyle = "#5f4db0";
  context.font = "800 30px Manrope, sans-serif";
  context.fillText(formatElapsed(gameState.completedAt), 993, 770);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Anı kartı dosyası oluşturulamadı."));
    }, "image/png");
  });
}

let memoryBlob = null;
let memoryPreviewUrl = "";
$("#capture-memory").addEventListener("click", async () => {
  const modal = $("#memory-modal");
  const preview = $("#memory-preview");
  const download = $("#memory-download");
  const status = $("#memory-status");
  if (memoryPreviewUrl) URL.revokeObjectURL(memoryPreviewUrl);
  memoryPreviewUrl = "";
  modal.classList.remove("hidden");
  modal.classList.remove("is-capturing");
  preview.classList.add("hidden");
  download.disabled = true;
  memoryBlob = null;
  status.textContent = "Anı kartınız hazırlanıyor…";
  requestAnimationFrame(() => modal.classList.add("is-capturing"));

  try {
    memoryBlob = await createMemoryCard();
    memoryPreviewUrl = URL.createObjectURL(memoryBlob);
    preview.src = memoryPreviewUrl;
    preview.classList.remove("hidden");
    status.textContent = "Anı kartınız hazır. İndirip paylaşabilirsiniz.";
    download.disabled = false;
  } catch (error) {
    status.textContent = error.message;
    toast(error.message);
  }
});
function closeMemory() {
  $("#memory-modal").classList.add("hidden");
  $("#memory-modal").classList.remove("is-capturing");
  if (memoryPreviewUrl) URL.revokeObjectURL(memoryPreviewUrl);
  memoryPreviewUrl = "";
  memoryBlob = null;
}
$("#memory-close").addEventListener("click", closeMemory);
$("#memory-dismiss").addEventListener("click", closeMemory);
$("#memory-modal").addEventListener("click", (event) => {
  if (event.target === $("#memory-modal")) closeMemory();
});
$("#memory-download").addEventListener("click", () => {
  if (!memoryBlob) return;
  const url = URL.createObjectURL(memoryBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `parca-parca-ani-${roomCode || "puzzle"}.png`;
  link.style.position = "fixed";
  link.style.left = "-9999px";
  document.body.append(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1000);
});
$("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (text) socket.send(JSON.stringify({ type: "chat", text }));
  input.value = "";
});

const inviteCode = new URLSearchParams(location.search).get("oda");
if (inviteCode) {
  $("#room-code").value = inviteCode;
  $("#player-name").focus();
}
window.addEventListener("resize", () => { if (gameState && !game.classList.contains("hidden")) renderGame(); });
