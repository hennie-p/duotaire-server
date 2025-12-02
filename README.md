# Duo-taire Colyseus Server

© 2025 HBC Consulting. All rights reserved.

A real-time multiplayer game server for Duo-taire card game built with [Colyseus](https://colyseus.io/).

## Features

- **Authoritative Server**: Server is the single source of truth - prevents cheating
- **Automatic State Sync**: Real-time state synchronization to all clients
- **Room Management**: Private rooms with codes, public matchmaking
- **Random Matchmaking**: Automatic opponent matching system
- **ZAP Detection**: Server-side validation of missed plays
- **Reconnection Support**: Players can reconnect to games in progress

## Quick Start

### Prerequisites

- Node.js 18+ installed
- npm or yarn

### Installation

```bash
cd DuoTaire_Server
npm install
```

### Development

```bash
npm start
```

Server will start at:
- WebSocket: `ws://localhost:2567`
- Monitor: `http://localhost:2567/colyseus`
- Health: `http://localhost:2567/health`

### Production Build

```bash
npm run build
npm run start:prod
```

## Server Architecture

```
DuoTaire_Server/
├── src/
│   ├── index.ts           # Main entry point
│   ├── rooms/
│   │   ├── DuoTaireRoom.ts    # Main game room logic
│   │   └── MatchmakingRoom.ts # Random matchmaking
│   └── schema/
│       ├── DuoTaireState.ts   # Game state schema
│       ├── PlayerSchema.ts     # Player data schema
│       └── CardSchema.ts       # Card data schema
├── package.json
└── tsconfig.json
```

## API Reference

### Room Types

| Room | Description |
|------|-------------|
| `duotaire` | Public game room (join any available) |
| `duotaire_private` | Private room (requires room code) |
| `matchmaking` | Random opponent matching |

### Client Messages

| Message | Data | Description |
|---------|------|-------------|
| `draw_card` | `{}` | Draw a card from deck |
| `play_card` | `{fromType, fromIndex, toType, toIndex}` | Play a card |
| `sequence_move` | `{fromCenter, fromCardIndex, toCenter}` | Move card sequence |
| `zap` | `{}` | Trigger ZAP on opponent |
| `request_state` | `{}` | Request full state sync |

### Server Messages

| Message | Data | Description |
|---------|------|-------------|
| `state_change` | Full state object | State updated |
| `game_over` | `{winner, reason}` | Game ended |
| `match_found` | `{roomId, opponent}` | Matchmaking success |
| `matchmaking_status` | `{status, playersWaiting}` | Queue status |

## Deployment

### Render.com

1. Create new Web Service
2. Connect your repository
3. Set build command: `npm install && npm run build`
4. Set start command: `npm run start:prod`
5. Add environment variable: `PORT=10000`

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY lib ./lib
EXPOSE 2567
CMD ["npm", "run", "start:prod"]
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `2567` | Server port |
| `NODE_ENV` | `development` | Environment mode |

## Monitoring

Access the Colyseus monitor panel at `http://localhost:2567/colyseus` (development only).

Features:
- View active rooms
- Inspect room state
- See connected clients
- Force disconnect clients

## State Schema

### DuoTaireState

```typescript
{
  roomCode: string,
  phase: "waiting" | "playing" | "finished",
  currentPlayer: number,
  gameOver: boolean,
  winner: number,
  drawnCard: CardSchema | null,
  hasMovedThisTurn: boolean,
  zapGracePeriod: boolean,
  players: Map<sessionId, PlayerSchema>,
  centerPiles: CenterPileSchema[5],
  foundations: FoundationSchema[4],
  stateVersion: number
}
```

### PlayerSchema

```typescript
{
  index: number,
  sessionId: string,
  name: string,
  connected: boolean,
  timer: number,
  deck: CardSchema[],
  discard: CardSchema[]
}
```

### CardSchema

```typescript
{
  suit: "♠" | "♣" | "♥" | "♦",
  rank: "A" | "2" | ... | "K"
}
```

## Migration from WebSocket Relay

See `MIGRATION_GUIDE.md` for steps to migrate from the simple WebSocket relay server to Colyseus.

## License

Proprietary - © 2025 HBC Consulting

## Support

Contact: henniep@gmail.com
