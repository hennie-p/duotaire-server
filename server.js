/**
 * Duo-taire WebSocket Relay Server
 * Simple room-based message relay for multiplayer games
 * © 2025 HBC Consulting NZ
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 10000;

// Health check endpoint for Render
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Duo-taire Game Server',
    rooms: Object.keys(rooms).length,
    matchmaking: matchmakingQueue.length,
    connections: wss ? wss.clients.size : 0
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Room storage
const rooms = {};

// Matchmaking queue
const matchmakingQueue = [];

// Generate 6-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Clean up old rooms (30 min timeout)
setInterval(() => {
  const now = Date.now();
  for (const code in rooms) {
    if (now - rooms[code].createdAt > 30 * 60 * 1000) {
      console.log(`[Cleanup] Removing stale room: ${code}`);
      delete rooms[code];
    }
  }
}, 60000);

wss.on('connection', (ws) => {
  const connectionId = uuidv4();
  ws.connectionId = connectionId;
  ws.roomCode = null;
  ws.isHost = false;
  ws.inMatchmaking = false;
  
  console.log(`[Connect] New connection: ${connectionId}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(ws, message);
    } catch (err) {
      console.error('[Error] Failed to parse message:', err);
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('close', () => {
    console.log(`[Disconnect] Connection closed: ${connectionId}`);
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error(`[Error] WebSocket error for ${connectionId}:`, err);
  });
});

function handleMessage(ws, message) {
  const type = message.type;
  console.log(`[Message] ${type} from ${ws.connectionId}`);

  switch (type) {
    case 'create_room':
      handleCreateRoom(ws, message);
      break;
    
    case 'join_room':
      handleJoinRoom(ws, message);
      break;
    
    case 'leave_room':
      handleLeaveRoom(ws);
      break;
    
    case 'find_match':
      handleFindMatch(ws, message);
      break;
    
    case 'cancel_matchmaking':
      handleCancelMatchmaking(ws);
      break;
    
    default:
      // Relay all other messages to opponent
      relayMessage(ws, message);
      break;
  }
}

function handleCreateRoom(ws, message) {
  // Remove from matchmaking if in queue
  removeFromMatchmaking(ws);
  
  // Generate unique room code
  let code;
  do {
    code = generateRoomCode();
  } while (rooms[code]);

  const playerId = uuidv4();
  
  // Create room
  rooms[code] = {
    code: code,
    host: ws,
    hostId: playerId,
    guest: null,
    guestId: null,
    gameMode: message.game_mode || 'casual',
    createdAt: Date.now()
  };

  ws.roomCode = code;
  ws.playerId = playerId;
  ws.isHost = true;

  console.log(`[Room] Created room: ${code} by ${playerId}`);

  // Send confirmation to host
  send(ws, {
    type: 'room_created',
    room_code: code,
    player_id: playerId
  });
}

function handleJoinRoom(ws, message) {
  const code = (message.room_code || '').toUpperCase().trim();
  
  if (!code) {
    sendError(ws, 'Room code required');
    return;
  }

  const room = rooms[code];
  
  if (!room) {
    sendError(ws, 'Room not found');
    return;
  }

  if (room.guest) {
    sendError(ws, 'Room is full');
    return;
  }

  // Remove from matchmaking if in queue
  removeFromMatchmaking(ws);

  const playerId = uuidv4();
  
  room.guest = ws;
  room.guestId = playerId;

  ws.roomCode = code;
  ws.playerId = playerId;
  ws.isHost = false;

  console.log(`[Room] Player ${playerId} joined room: ${code}`);

  // Send confirmation to guest
  send(ws, {
    type: 'room_joined',
    room_code: code,
    player_id: playerId
  });

  // Notify host that guest joined
  if (room.host && room.host.readyState === 1) {
    send(room.host, {
      type: 'player_joined',
      player_id: playerId
    });
  }

  // Also notify guest about host (so both know game can start)
  send(ws, {
    type: 'player_joined',
    player_id: room.hostId
  });
}

function handleLeaveRoom(ws) {
  const code = ws.roomCode;
  if (!code || !rooms[code]) return;

  const room = rooms[code];
  
  // Notify opponent
  const opponent = ws.isHost ? room.guest : room.host;
  if (opponent && opponent.readyState === 1) {
    send(opponent, {
      type: 'player_left',
      player_id: ws.playerId
    });
  }

  // Clean up
  if (ws.isHost) {
    // Host left, close room
    console.log(`[Room] Host left, closing room: ${code}`);
    delete rooms[code];
  } else {
    // Guest left, keep room open
    room.guest = null;
    room.guestId = null;
  }

  ws.roomCode = null;
}

// ===== MATCHMAKING =====

function handleFindMatch(ws, message) {
  console.log(`[Matchmaking] Player ${ws.connectionId} looking for match`);
  
  // Remove from any existing room
  handleLeaveRoom(ws);
  
  // Check if already in queue
  if (ws.inMatchmaking) {
    console.log(`[Matchmaking] Already in queue`);
    return;
  }
  
  // Check if there's someone waiting
  if (matchmakingQueue.length > 0) {
    // Get the first waiting player
    const opponent = matchmakingQueue.shift();
    
    // Make sure opponent is still connected
    if (opponent.readyState !== 1) {
      console.log(`[Matchmaking] Waiting player disconnected, trying next`);
      // Recursively try again
      handleFindMatch(ws, message);
      return;
    }
    
    opponent.inMatchmaking = false;
    
    // Create a room for them
    let code;
    do {
      code = generateRoomCode();
    } while (rooms[code]);
    
    const hostId = opponent.playerId || uuidv4();
    const guestId = uuidv4();
    
    rooms[code] = {
      code: code,
      host: opponent,
      hostId: hostId,
      guest: ws,
      guestId: guestId,
      gameMode: 'matchmaking',
      createdAt: Date.now()
    };
    
    // Set up opponent as host
    opponent.roomCode = code;
    opponent.playerId = hostId;
    opponent.isHost = true;
    
    // Set up current player as guest
    ws.roomCode = code;
    ws.playerId = guestId;
    ws.isHost = false;
    
    console.log(`[Matchmaking] Match found! Room: ${code}`);
    
    // Notify the host (was waiting)
    send(opponent, {
      type: 'room_created',
      room_code: code,
      player_id: hostId
    });
    send(opponent, {
      type: 'player_joined',
      player_id: guestId
    });
    
    // Notify the guest (just joined)
    send(ws, {
      type: 'room_joined',
      room_code: code,
      player_id: guestId
    });
    send(ws, {
      type: 'player_joined',
      player_id: hostId
    });
    
  } else {
    // No one waiting, add to queue
    ws.playerId = uuidv4();
    ws.inMatchmaking = true;
    matchmakingQueue.push(ws);
    
    console.log(`[Matchmaking] Added to queue. Queue size: ${matchmakingQueue.length}`);
    
    send(ws, {
      type: 'matchmaking_waiting',
      message: 'Waiting for opponent...',
      queue_position: matchmakingQueue.length
    });
  }
}

function handleCancelMatchmaking(ws) {
  removeFromMatchmaking(ws);
  console.log(`[Matchmaking] Cancelled for ${ws.connectionId}`);
  send(ws, {
    type: 'matchmaking_cancelled'
  });
}

function removeFromMatchmaking(ws) {
  const index = matchmakingQueue.indexOf(ws);
  if (index !== -1) {
    matchmakingQueue.splice(index, 1);
    ws.inMatchmaking = false;
    console.log(`[Matchmaking] Removed from queue. Queue size: ${matchmakingQueue.length}`);
  }
}

function handleDisconnect(ws) {
  removeFromMatchmaking(ws);
  handleLeaveRoom(ws);
}

function relayMessage(ws, message) {
  const code = ws.roomCode;
  if (!code || !rooms[code]) {
    console.log(`[Relay] No room for message from ${ws.connectionId}`);
    return;
  }

  const room = rooms[code];
  const opponent = ws.isHost ? room.guest : room.host;

  if (opponent && opponent.readyState === 1) {
    console.log(`[Relay] ${message.type} from ${ws.isHost ? 'host' : 'guest'} to ${ws.isHost ? 'guest' : 'host'}`);
    send(opponent, message);
  } else {
    console.log(`[Relay] No opponent to relay to`);
  }
}

function send(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function sendError(ws, message) {
  send(ws, {
    type: 'error',
    message: message
  });
}

server.listen(PORT, () => {
  console.log(`======================================`);
  console.log(`Duo-taire Server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`======================================`);
});
