/**
 * Duo-taire Relay Server
 * © 2025 HBC Consulting
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10567;
const rooms = new Map();

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('+ Client connected');
    ws.room = null;
    ws.isHost = false;
    ws.isAlive = true;
    
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            handle(ws, msg);
        } catch (e) {
            send(ws, { type: 'error', reason: 'Invalid message' });
        }
    });
    
    ws.on('close', () => onClose(ws));
    ws.on('error', () => {});
});

function handle(ws, msg) {
    switch (msg.type) {
        case 'create':
            create(ws);
            break;
        case 'join':
            join(ws, msg.code);
            break;
        case 'leave':
            leave(ws);
            break;
        case 'data':
            relay(ws, msg.payload);
            break;
    }
}

function create(ws) {
    leave(ws);
    
    let code;
    do { code = generateCode(); } while (rooms.has(code));
    
    rooms.set(code, { host: ws, client: null });
    ws.room = code;
    ws.isHost = true;
    
    console.log('+ Room: ' + code);
    send(ws, { type: 'created', code });
}

function join(ws, code) {
    if (!code) {
        send(ws, { type: 'error', reason: 'No code' });
        return;
    }
    
    code = code.toUpperCase();
    const room = rooms.get(code);
    
    if (!room) {
        send(ws, { type: 'error', reason: 'Room not found' });
        return;
    }
    
    if (room.client) {
        send(ws, { type: 'error', reason: 'Room full' });
        return;
    }
    
    leave(ws);
    
    room.client = ws;
    ws.room = code;
    ws.isHost = false;
    
    console.log('+ Joined: ' + code);
    send(ws, { type: 'joined', code });
    send(room.host, { type: 'peer_joined' });
    send(ws, { type: 'peer_joined' });
}

function leave(ws) {
    if (!ws.room) return;
    
    const code = ws.room;
    const room = rooms.get(code);
    
    if (room) {
        if (ws.isHost) {
            if (room.client) {
                send(room.client, { type: 'peer_left' });
                room.client.room = null;
            }
            rooms.delete(code);
            console.log('- Room closed: ' + code);
        } else {
            room.client = null;
            send(room.host, { type: 'peer_left' });
            console.log('- Client left: ' + code);
        }
    }
    
    ws.room = null;
    ws.isHost = false;
}

function relay(ws, payload) {
    if (!ws.room) return;
    
    const room = rooms.get(ws.room);
    if (!room) return;
    
    const target = ws.isHost ? room.client : room.host;
    if (target && target.readyState === WebSocket.OPEN) {
        send(target, { type: 'data', payload });
    }
}

function onClose(ws) {
    console.log('- Client disconnected');
    leave(ws);
}

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// Heartbeat
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
});
