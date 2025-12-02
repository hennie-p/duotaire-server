/**
 * Duo-taire Simple WebSocket Game Server
 * © 2025 HBC Consulting. All rights reserved.
 * 
 * Pure JSON WebSocket server - matches existing NetworkManager.gd interface
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
      rooms: Object.keys(lobbies).length,
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
const lobbies = {};  // code -> { host: ws, guest: ws, code: string }
const clientToLobby = new WeakMap(); // ws -> lobbyCode

// Generate random lobby code (6 characters, easy to read)
function generateLobbyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure unique
  if (lobbies[code]) {
    return generateLobbyCode();
  }
  return code;
}

// Send JSON message to client
function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// Handle incoming messages
function handleMessage(ws, data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch (e) {
    console.error('Invalid JSON:', data);
    return;
  }
  
  const msgType = msg.type;
  console.log(`📨 Received: ${msgType}`);
  
  switch (msgType) {
    case 'create_lobby':
      handleCreateLobby(ws);
      break;
      
    case 'join_lobby':
      handleJoinLobby(ws, msg.code);
      break;
      
    case 'leave_lobby':
      handleLeaveLobby(ws);
      break;
      
    case 'game_data':
      handleGameData(ws, msg.data);
      break;
      
    default:
      console.log(`Unknown message type: ${msgType}`);
  }
}

// Handle create lobby
function handleCreateLobby(ws) {
  const code = generateLobbyCode();
  
  lobbies[code] = {
    code: code,
    host: ws,
    guest: null
  };
  
  clientToLobby.set(ws, code);
  
  console.log(`🏠 Lobby created: ${code}`);
  
  // Send lobby_created (matches existing NetworkManager expectation)
  send(ws, {
    type: 'lobby_created',
    code: code
  });
}

// Handle join lobby
function handleJoinLobby(ws, code) {
  // Normalize code
  code = (code || '').toUpperCase().trim();
  
  const lobby = lobbies[code];
  
  if (!lobby) {
    console.log(`❌ Lobby not found: ${code}`);
    send(ws, {
      type: 'join_failed',
      reason: 'Lobby not found'
    });
    return;
  }
  
  if (lobby.guest) {
    console.log(`❌ Lobby full: ${code}`);
    send(ws, {
      type: 'join_failed',
      reason: 'Lobby is full'
    });
    return;
  }
  
  // Join the lobby
  lobby.guest = ws;
  clientToLobby.set(ws, code);
  
  console.log(`👤 Player joined lobby: ${code}`);
  
  // Send lobby_joined to guest
  send(ws, {
    type: 'lobby_joined',
    code: code
  });
  
  // Notify both that peer connected
  send(lobby.host, { type: 'peer_connected' });
  send(lobby.guest, { type: 'peer_connected' });
  
  console.log(`✅ Both players connected in lobby: ${code}`);
}

// Handle game data relay
function handleGameData(ws, data) {
  const code = clientToLobby.get(ws);
  if (!code) return;
  
  const lobby = lobbies[code];
  if (!lobby) return;
  
  // Determine who to send to (the other player)
  const recipient = (ws === lobby.host) ? lobby.guest : lobby.host;
  
  if (recipient) {
    console.log(`📤 Relaying game_data in lobby ${code}`);
    send(recipient, {
      type: 'game_data',
      data: data
    });
  }
}

// Handle leave lobby
function handleLeaveLobby(ws) {
  const code = clientToLobby.get(ws);
  if (!code) return;
  
  const lobby = lobbies[code];
  if (!lobby) return;
  
  console.log(`👋 Player leaving lobby: ${code}`);
  
  // Notify the other player
  const other = (ws === lobby.host) ? lobby.guest : lobby.host;
  if (other) {
    send(other, { type: 'peer_disconnected' });
  }
  
  // Clean up
  clientToLobby.delete(ws);
  delete lobbies[code];
}

// Handle disconnect
function handleDisconnect(ws) {
  const code = clientToLobby.get(ws);
  if (!code) return;
  
  const lobby = lobbies[code];
  if (!lobby) return;
  
  console.log(`❌ Player disconnected from lobby: ${code}`);
  
  // Notify the other player
  const other = (ws === lobby.host) ? lobby.guest : lobby.host;
  if (other) {
    send(other, { type: 'peer_disconnected' });
  }
  
  // Clean up
  clientToLobby.delete(ws);
  delete lobbies[code];
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log(`🔗 Client connected`);
  
  ws.on('message', (data) => {
    handleMessage(ws, data.toString());
  });
  
  ws.on('close', () => {
    console.log(`❌ Client disconnected`);
    handleDisconnect(ws);
  });
  
  ws.on('error', (err) => {
    console.error(`WebSocket error:`, err.message);
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

// Cleanup old lobbies every 10 minutes
setInterval(() => {
  // For now just log active lobbies
  const count = Object.keys(lobbies).length;
  if (count > 0) {
    console.log(`📊 Active lobbies: ${count}`);
  }
}, 10 * 60 * 1000);
