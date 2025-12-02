/**
 * Duo-taire WebSocket Relay Server v2
 * Simple, reliable relay for turn-based multiplayer
 * © 2025 HBC Consulting
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10567;

// Room storage
const rooms = new Map();

// Generate readable room codes
function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            server: 'Duo-taire Relay v2',
            rooms: rooms.size,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

console.log(`🎮 Duo-taire Relay Server v2 starting on port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('👤 Client connected');
    
    // Client state
    ws.roomCode = null;
    ws.isHost = false;
    ws.isAlive = true;
    
    // Heartbeat
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            handleMessage(ws, msg);
        } catch (err) {
            console.error('Parse error:', err.message);
            send(ws, { type: 'error', message: 'Invalid JSON' });
        }
    });
    
    ws.on('close', () => {
        handleDisconnect(ws);
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
});

function handleMessage(ws, msg) {
    const { type } = msg;
    
    switch (type) {
        case 'create_lobby':
            createLobby(ws);
            break;
            
        case 'join_lobby':
            joinLobby(ws, msg.code);
            break;
            
        case 'leave_lobby':
            leaveLobby(ws);
            break;
            
        case 'game_data':
            relayGameData(ws, msg.data);
            break;
            
        default:
            console.log('Unknown message type:', type);
    }
}

function createLobby(ws) {
    // Leave any existing room
    if (ws.roomCode) {
        leaveLobby(ws);
    }
    
    // Generate unique code
    let code;
    do {
        code = generateCode();
    } while (rooms.has(code));
    
    // Create room
    rooms.set(code, {
        host: ws,
        client: null,
        created: Date.now()
    });
    
    ws.roomCode = code;
    ws.isHost = true;
    
    console.log(`🏠 Room created: ${code}`);
    send(ws, { type: 'lobby_created', code });
}

function joinLobby(ws, code) {
    if (!code) {
        send(ws, { type: 'join_failed', reason: 'No code provided' });
        return;
    }
    
    code = code.toUpperCase();
    const room = rooms.get(code);
    
    if (!room) {
        send(ws, { type: 'join_failed', reason: 'Room not found' });
        return;
    }
    
    if (room.client) {
        send(ws, { type: 'join_failed', reason: 'Room is full' });
        return;
    }
    
    // Leave any existing room
    if (ws.roomCode) {
        leaveLobby(ws);
    }
    
    // Join room
    room.client = ws;
    ws.roomCode = code;
    ws.isHost = false;
    
    console.log(`🚪 Client joined room: ${code}`);
    
    // Notify both players
    send(ws, { type: 'lobby_joined', code });
    send(room.host, { type: 'peer_connected' });
    send(ws, { type: 'peer_connected' });
}

function leaveLobby(ws) {
    if (!ws.roomCode) return;
    
    const code = ws.roomCode;
    const room = rooms.get(code);
    
    if (room) {
        if (ws.isHost) {
            // Host leaving - notify client and close room
            if (room.client) {
                send(room.client, { type: 'peer_disconnected' });
                room.client.roomCode = null;
            }
            rooms.delete(code);
            console.log(`🗑️ Room closed: ${code}`);
        } else {
            // Client leaving - notify host
            room.client = null;
            send(room.host, { type: 'peer_disconnected' });
            console.log(`👤 Client left room: ${code}`);
        }
    }
    
    ws.roomCode = null;
    ws.isHost = false;
}

function relayGameData(ws, data) {
    if (!ws.roomCode) {
        console.log('⚠️ Game data from player not in room');
        return;
    }
    
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    // Find the other player
    const target = ws.isHost ? room.client : room.host;
    
    if (target && target.readyState === WebSocket.OPEN) {
        send(target, { type: 'game_data', data });
    }
}

function handleDisconnect(ws) {
    console.log('👤 Client disconnected');
    leaveLobby(ws);
}

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            console.log('💔 Dead connection, terminating');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Cleanup old empty rooms
const cleanup = setInterval(() => {
    const now = Date.now();
    const MAX_AGE = 30 * 60 * 1000; // 30 minutes
    
    rooms.forEach((room, code) => {
        if (now - room.created > MAX_AGE && !room.client) {
            rooms.delete(code);
            console.log(`🧹 Cleaned up old room: ${code}`);
        }
    });
}, 60000);

wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(cleanup);
});

server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
