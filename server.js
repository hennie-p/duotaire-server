/**
 * Duo-taire WebSocket Relay Server
 * © 2025 HBC Consulting. All rights reserved.
 */

const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: PORT });

const lobbies = new Map();

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function cleanupLobby(code, disconnectedRole) {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    
    const other = disconnectedRole === 'host' ? lobby.client : lobby.host;
    if (other && other.readyState === WebSocket.OPEN) {
        other.send(JSON.stringify({ type: 'peer_disconnected' }));
    }
    
    lobbies.delete(code);
    console.log(`Lobby ${code} cleaned up`);
}

wss.on('connection', (ws) => {
    console.log('+ Client connected');
    
    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch (e) {
            console.error('Invalid JSON:', e.message);
            return;
        }
        
        console.log('< Received:', msg.type);
        
        switch (msg.type) {
            case 'create_lobby': {
                let code;
                do {
                    code = generateCode();
                } while (lobbies.has(code));
                
                lobbies.set(code, { host: ws, client: null });
                ws.myLobbyCode = code;
                ws.myRole = 'host';
                
                console.log(`> Lobby created: ${code}`);
                ws.send(JSON.stringify({ type: 'lobby_created', code: code }));
                break;
            }
            
            case 'join_lobby': {
                const code = (msg.code || '').toUpperCase().trim();
                const lobby = lobbies.get(code);
                
                if (!lobby) {
                    console.log(`> Join failed: ${code} not found`);
                    ws.send(JSON.stringify({ type: 'join_failed', reason: 'Lobby not found' }));
                    break;
                }
                
                if (lobby.client) {
                    console.log(`> Join failed: ${code} full`);
                    ws.send(JSON.stringify({ type: 'join_failed', reason: 'Lobby is full' }));
                    break;
                }
                
                lobby.client = ws;
                ws.myLobbyCode = code;
                ws.myRole = 'client';
                
                console.log(`> Client joined lobby: ${code}`);
                ws.send(JSON.stringify({ type: 'lobby_joined', code: code }));
                
                // Notify both players
                if (lobby.host && lobby.host.readyState === WebSocket.OPEN) {
                    lobby.host.send(JSON.stringify({ type: 'peer_connected' }));
                }
                ws.send(JSON.stringify({ type: 'peer_connected' }));
                break;
            }
            
            case 'game_data': {
                const lobby = lobbies.get(ws.myLobbyCode);
                if (!lobby) break;
                
                const target = ws.myRole === 'host' ? lobby.client : lobby.host;
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify({
                        type: 'game_data',
                        data: msg.data
                    }));
                }
                break;
            }
            
            case 'leave_lobby': {
                if (ws.myLobbyCode) {
                    cleanupLobby(ws.myLobbyCode, ws.myRole);
                    ws.myLobbyCode = null;
                    ws.myRole = null;
                }
                break;
            }
        }
    });
    
    ws.on('close', () => {
        console.log('- Client disconnected');
        if (ws.myLobbyCode) {
            cleanupLobby(ws.myLobbyCode, ws.myRole);
        }
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
});

console.log(`Server running on port ${PORT}`);
