# Duo-taire Simple WebSocket Server

A lightweight, pure JSON WebSocket server for the Duo-taire card game.

## Features

- ✅ Simple JSON messages (no binary protocol)
- ✅ Room creation with 6-letter codes
- ✅ Join by code
- ✅ Random matchmaking
- ✅ Full game state synchronization
- ✅ Automatic cleanup of old rooms
- ✅ Health check endpoint

## Server Setup

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start server:
   ```bash
   npm start
   ```

3. Server runs on `ws://localhost:2567`

### Deploy to Render

1. Create a new **Web Service** on Render
2. Connect your GitHub repository
3. Render auto-detects the `render.yaml` configuration
4. The server will be available at `wss://your-app.onrender.com`

## Godot Client Setup

1. Add `SimpleWebSocket.gd` as an **Autoload**:
   - Project → Project Settings → AutoLoad
   - Add `SimpleWebSocket.gd` with name `SimpleWebSocket`

2. Replace your existing `NetworkManager.gd` with the provided one

3. Update the server URL in `SimpleWebSocket.gd`:
   ```gdscript
   const PRODUCTION_SERVER: String = "wss://your-app.onrender.com"
   ```

## Message Protocol

All messages are JSON objects with a `type` field.

### Client → Server

| Type | Description | Data |
|------|-------------|------|
| `create_room` | Create a new room | `{ playerName: string }` |
| `join_room` | Join by code | `{ roomCode: string, playerName: string }` |
| `find_match` | Random matchmaking | `{ playerName: string }` |
| `draw_card` | Draw from deck | `{}` |
| `play_card` | Play a card | `{ fromType, fromIndex, toType, toIndex }` |
| `leave_room` | Leave current room | `{}` |

### Server → Client

| Type | Description | Data |
|------|-------------|------|
| `connected` | Connection established | `{ clientId: string }` |
| `room_created` | Room created | `{ roomCode, playerIndex }` |
| `room_joined` | Joined a room | `{ roomCode, playerIndex, hostName }` |
| `player_joined` | Opponent joined | `{ playerName }` |
| `game_started` | Game begins | `{ state: GameState }` |
| `state_update` | State changed | `{ state: GameState, lastMove }` |
| `card_drawn` | You drew a card | `{ card: { suit, rank }, deckSize }` |
| `opponent_drew` | Opponent drew | `{ playerIndex, deckSize }` |
| `game_over` | Game ended | `{ winner, reason }` |
| `opponent_left` | Opponent disconnected | `{}` |
| `error` | Error occurred | `{ message: string }` |

## Game State Structure

```json
{
  "roomCode": "ABC123",
  "phase": "playing",
  "currentPlayer": 0,
  "winner": -1,
  "players": [
    {
      "index": 0,
      "name": "Host",
      "deckSize": 21,
      "discardPile": [],
      "drawnCard": { "suit": "♠", "rank": "5" }
    },
    {
      "index": 1,
      "name": "Guest",
      "deckSize": 21,
      "discardPile": [],
      "drawnCard": null
    }
  ],
  "centerPiles": [
    [{ "suit": "♥", "rank": "K" }, { "suit": "♣", "rank": "2" }],
    ...
  ],
  "foundations": [
    { "suit": "♠", "cards": [] },
    { "suit": "♣", "cards": [] },
    { "suit": "♥", "cards": [] },
    { "suit": "♦", "cards": [] }
  ]
}
```

## Health Check

GET `/health` returns:
```json
{
  "status": "ok",
  "server": "Duo-taire Simple Server",
  "rooms": 5,
  "timestamp": "2025-12-02T10:00:00.000Z"
}
```

## License

© 2025 HBC Consulting. All rights reserved.
