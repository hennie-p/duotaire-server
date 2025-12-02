/**
 * Duo-taire Simple WebSocket Game Server
 * © 2025 HBC Consulting. All rights reserved.
 * 
 * Pure JSON WebSocket server - no complex protocols
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 2567;

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      server: 'Duo-taire Simple Server',
      rooms: Object.keys(rooms).length,
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Duo-taire Game Server');
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Game state storage
const rooms = {};  // roomCode -> Room
const clients = {}; // odId -> { ws, odId, roomCode, playerIndex, name }

// Generate random room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate unique client ID
function generateClientId() {
  return 'p_' + Math.random().toString(36).substr(2, 9);
}

// Create a shuffled deck
function createShuffledDeck() {
  const suits = ['♠', '♣', '♥', '♦'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

// Create new room
function createRoom(roomCode) {
  return {
    roomCode,
    players: [],  // [{ odId, name, deck, discardPile, drawnCard }, ...]
    phase: 'waiting',  // waiting, playing, finished
    currentPlayer: 0,
    centerPiles: [[], [], [], [], []],  // 5 center piles
    foundations: [
      { suit: '♠', cards: [] },
      { suit: '♣', cards: [] },
      { suit: '♥', cards: [] },
      { suit: '♦', cards: [] }
    ],
    winner: -1,
    createdAt: Date.now()
  };
}

// Start game when 2 players join
function startGame(room) {
  console.log(`🎮 Starting game in room ${room.roomCode}`);
  
  const deck = createShuffledDeck();
  
  // Deal 26 cards to each player
  room.players[0].deck = [];
  room.players[1].deck = [];
  
  for (let i = 0; i < 52; i++) {
    if (i % 2 === 0) {
      room.players[0].deck.push(deck[i]);
    } else {
      room.players[1].deck.push(deck[i]);
    }
  }
  
  // Deal to center piles (2 cards each)
  for (let pile = 0; pile < 5; pile++) {
    room.centerPiles[pile].push(room.players[0].deck.pop());
    room.centerPiles[pile].push(room.players[1].deck.pop());
  }
  
  room.phase = 'playing';
  room.currentPlayer = 0;
  
  console.log(`✅ Game started! P0: ${room.players[0].deck.length} cards, P1: ${room.players[1].deck.length} cards`);
  
  // Broadcast game started to all players
  broadcastToRoom(room.roomCode, {
    type: 'game_started',
    state: getGameState(room)
  });
}

// Get game state (with hidden info per player)
function getGameState(room, forPlayerIndex = -1) {
  return {
    roomCode: room.roomCode,
    phase: room.phase,
    currentPlayer: room.currentPlayer,
    winner: room.winner,
    players: room.players.map((p, idx) => ({
      index: idx,
      name: p.name,
      deckSize: p.deck.length,
      discardPile: p.discardPile,
      drawnCard: (forPlayerIndex === idx || forPlayerIndex === -1) ? p.drawnCard : null
    })),
    centerPiles: room.centerPiles,
    foundations: room.foundations
  };
}

// Send message to specific client
function sendToClient(clientId, message) {
  const client = clients[clientId];
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

// Broadcast to all clients in a room
function broadcastToRoom(roomCode, message, excludeClientId = null) {
  const room = rooms[roomCode];
  if (!room) return;
  
  const msgStr = JSON.stringify(message);
  
  for (const player of room.players) {
    if (player.odId !== excludeClientId) {
      const client = clients[player.odId];
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msgStr);
      }
    }
  }
}

// Handle incoming messages
function handleMessage(ws, clientId, data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch (e) {
    console.error('Invalid JSON:', data);
    return;
  }
  
  console.log(`📨 [${clientId}] ${msg.type}`);
  
  switch (msg.type) {
    case 'create_room':
      handleCreateRoom(ws, clientId, msg);
      break;
      
    case 'join_room':
      handleJoinRoom(ws, clientId, msg);
      break;
      
    case 'find_match':
      handleFindMatch(ws, clientId, msg);
      break;
      
    case 'draw_card':
      handleDrawCard(clientId, msg);
      break;
      
    case 'play_card':
      handlePlayCard(clientId, msg);
      break;
      
    case 'leave_room':
      handleLeaveRoom(clientId);
      break;
      
    default:
      console.log(`Unknown message type: ${msg.type}`);
  }
}

// Handle create room
function handleCreateRoom(ws, clientId, msg) {
  const roomCode = generateRoomCode();
  const room = createRoom(roomCode);
  
  const player = {
    odId: clientId,
    name: msg.playerName || 'Host',
    deck: [],
    discardPile: [],
    drawnCard: null
  };
  
  room.players.push(player);
  rooms[roomCode] = room;
  
  clients[clientId].roomCode = roomCode;
  clients[clientId].playerIndex = 0;
  clients[clientId].name = player.name;
  
  console.log(`🏠 Room created: ${roomCode} by ${player.name}`);
  
  sendToClient(clientId, {
    type: 'room_created',
    roomCode: roomCode,
    playerIndex: 0,
    playerName: player.name
  });
}

// Handle join room
function handleJoinRoom(ws, clientId, msg) {
  const roomCode = msg.roomCode.toUpperCase();
  const room = rooms[roomCode];
  
  if (!room) {
    sendToClient(clientId, {
      type: 'error',
      message: 'Room not found'
    });
    return;
  }
  
  if (room.players.length >= 2) {
    sendToClient(clientId, {
      type: 'error',
      message: 'Room is full'
    });
    return;
  }
  
  if (room.phase !== 'waiting') {
    sendToClient(clientId, {
      type: 'error',
      message: 'Game already in progress'
    });
    return;
  }
  
  const player = {
    odId: clientId,
    name: msg.playerName || 'Guest',
    deck: [],
    discardPile: [],
    drawnCard: null
  };
  
  room.players.push(player);
  
  clients[clientId].roomCode = roomCode;
  clients[clientId].playerIndex = 1;
  clients[clientId].name = player.name;
  
  console.log(`👤 ${player.name} joined room ${roomCode}`);
  
  // Notify joiner
  sendToClient(clientId, {
    type: 'room_joined',
    roomCode: roomCode,
    playerIndex: 1,
    playerName: player.name,
    hostName: room.players[0].name
  });
  
  // Notify host
  sendToClient(room.players[0].odId, {
    type: 'player_joined',
    playerIndex: 1,
    playerName: player.name
  });
  
  // Start game with 2 players
  if (room.players.length === 2) {
    setTimeout(() => startGame(room), 500);
  }
}

// Handle find match (random matchmaking)
function handleFindMatch(ws, clientId, msg) {
  // Find a waiting room or create one
  let foundRoom = null;
  
  for (const code in rooms) {
    const room = rooms[code];
    if (room.phase === 'waiting' && room.players.length === 1) {
      foundRoom = room;
      break;
    }
  }
  
  if (foundRoom) {
    // Join existing room
    handleJoinRoom(ws, clientId, { 
      roomCode: foundRoom.roomCode, 
      playerName: msg.playerName 
    });
  } else {
    // Create new room and wait
    handleCreateRoom(ws, clientId, msg);
    sendToClient(clientId, {
      type: 'matchmaking_waiting',
      message: 'Waiting for opponent...'
    });
  }
}

// Handle draw card
function handleDrawCard(clientId, msg) {
  const client = clients[clientId];
  if (!client || !client.roomCode) return;
  
  const room = rooms[client.roomCode];
  if (!room || room.phase !== 'playing') return;
  
  const playerIndex = client.playerIndex;
  if (room.currentPlayer !== playerIndex) {
    sendToClient(clientId, { type: 'error', message: 'Not your turn' });
    return;
  }
  
  const player = room.players[playerIndex];
  if (player.drawnCard) {
    sendToClient(clientId, { type: 'error', message: 'Already drew a card' });
    return;
  }
  
  if (player.deck.length === 0) {
    sendToClient(clientId, { type: 'error', message: 'Deck is empty' });
    return;
  }
  
  player.drawnCard = player.deck.pop();
  
  console.log(`🃏 Player ${playerIndex} drew ${player.drawnCard.rank}${player.drawnCard.suit}`);
  
  // Send to drawing player (show the card)
  sendToClient(clientId, {
    type: 'card_drawn',
    card: player.drawnCard,
    deckSize: player.deck.length
  });
  
  // Broadcast to opponent (hide the card)
  const opponentId = room.players[1 - playerIndex].odId;
  sendToClient(opponentId, {
    type: 'opponent_drew',
    playerIndex: playerIndex,
    deckSize: player.deck.length
  });
}

// Handle play card
function handlePlayCard(clientId, msg) {
  const client = clients[clientId];
  if (!client || !client.roomCode) return;
  
  const room = rooms[client.roomCode];
  if (!room || room.phase !== 'playing') return;
  
  const playerIndex = client.playerIndex;
  const player = room.players[playerIndex];
  
  // Validate and process the move
  const { fromType, toType, toIndex, card } = msg;
  
  let playedCard = null;
  
  // Get the card being played
  if (fromType === 'drawn') {
    if (!player.drawnCard) {
      sendToClient(clientId, { type: 'error', message: 'No drawn card' });
      return;
    }
    playedCard = player.drawnCard;
    player.drawnCard = null;
  } else if (fromType === 'center') {
    const pile = room.centerPiles[msg.fromIndex];
    if (!pile || pile.length === 0) {
      sendToClient(clientId, { type: 'error', message: 'Empty center pile' });
      return;
    }
    playedCard = pile.pop();
  }
  
  if (!playedCard) {
    sendToClient(clientId, { type: 'error', message: 'No card to play' });
    return;
  }
  
  // Place the card
  let success = false;
  
  if (toType === 'foundation') {
    const foundation = room.foundations[toIndex];
    // Validate foundation play (must be same suit, sequential)
    if (foundation.suit === playedCard.suit) {
      const expectedRank = foundation.cards.length === 0 ? 'A' : 
        getNextRank(foundation.cards[foundation.cards.length - 1].rank);
      if (playedCard.rank === expectedRank) {
        foundation.cards.push(playedCard);
        success = true;
      }
    }
  } else if (toType === 'center') {
    room.centerPiles[toIndex].push(playedCard);
    success = true;
  } else if (toType === 'discard') {
    player.discardPile.push(playedCard);
    success = true;
    
    // End turn after discarding
    room.currentPlayer = 1 - playerIndex;
  }
  
  if (!success) {
    // Return card
    if (fromType === 'drawn') {
      player.drawnCard = playedCard;
    } else {
      room.centerPiles[msg.fromIndex].push(playedCard);
    }
    sendToClient(clientId, { type: 'error', message: 'Invalid move' });
    return;
  }
  
  console.log(`🎴 Player ${playerIndex} played ${playedCard.rank}${playedCard.suit} to ${toType}`);
  
  // Broadcast updated state
  broadcastToRoom(room.roomCode, {
    type: 'state_update',
    state: getGameState(room),
    lastMove: {
      playerIndex,
      card: playedCard,
      fromType,
      toType,
      toIndex
    }
  });
  
  // Check win condition
  checkWinCondition(room);
}

function getNextRank(rank) {
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const idx = ranks.indexOf(rank);
  return idx < ranks.length - 1 ? ranks[idx + 1] : null;
}

function checkWinCondition(room) {
  // Check if all foundations are complete
  const allComplete = room.foundations.every(f => f.cards.length === 13);
  
  if (allComplete) {
    room.phase = 'finished';
    room.winner = room.currentPlayer;
    
    broadcastToRoom(room.roomCode, {
      type: 'game_over',
      winner: room.winner,
      reason: 'All foundations complete'
    });
  }
}

// Handle player leaving
function handleLeaveRoom(clientId) {
  const client = clients[clientId];
  if (!client || !client.roomCode) return;
  
  const room = rooms[client.roomCode];
  if (!room) return;
  
  const playerIndex = client.playerIndex;
  console.log(`👋 Player ${playerIndex} left room ${room.roomCode}`);
  
  // Notify other player
  const otherPlayerIndex = 1 - playerIndex;
  if (room.players[otherPlayerIndex]) {
    const otherId = room.players[otherPlayerIndex].odId;
    sendToClient(otherId, {
      type: 'opponent_left',
      message: 'Opponent disconnected'
    });
    
    // They win by default if game was in progress
    if (room.phase === 'playing') {
      room.phase = 'finished';
      room.winner = otherPlayerIndex;
      sendToClient(otherId, {
        type: 'game_over',
        winner: otherPlayerIndex,
        reason: 'Opponent disconnected'
      });
    }
  }
  
  // Clean up
  delete rooms[client.roomCode];
  client.roomCode = null;
  client.playerIndex = null;
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  const clientId = generateClientId();
  
  clients[clientId] = {
    ws,
    odId: clientId,
    roomCode: null,
    playerIndex: null,
    name: null
  };
  
  console.log(`🔗 Client connected: ${clientId}`);
  
  // Send welcome message with client ID
  ws.send(JSON.stringify({
    type: 'connected',
    clientId: clientId
  }));
  
  ws.on('message', (data) => {
    handleMessage(ws, clientId, data.toString());
  });
  
  ws.on('close', () => {
    console.log(`❌ Client disconnected: ${clientId}`);
    handleLeaveRoom(clientId);
    delete clients[clientId];
  });
  
  ws.on('error', (err) => {
    console.error(`WebSocket error for ${clientId}:`, err);
  });
});

// Start server
server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     🎴 Duo-taire Simple WebSocket Server 🎴    ║');
  console.log('║          © 2025 HBC Consulting                 ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║  🌐 WebSocket: ws://localhost:${PORT}             ║`);
  console.log(`║  ❤️  Health:    http://localhost:${PORT}/health     ║`);
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
});

// Cleanup old rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  for (const code in rooms) {
    if (now - rooms[code].createdAt > maxAge) {
      console.log(`🧹 Cleaning up old room: ${code}`);
      delete rooms[code];
    }
  }
}, 5 * 60 * 1000);
