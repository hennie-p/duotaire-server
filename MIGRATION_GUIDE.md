# Migration Guide: WebSocket Relay to Colyseus

© 2025 HBC Consulting. All rights reserved.

This guide explains how to migrate Duo-taire from the simple WebSocket relay server to the full Colyseus implementation.

## Overview

### Current Architecture (WebSocket Relay)

```
┌─────────────┐     WebSocket      ┌─────────────────┐     WebSocket      ┌─────────────┐
│   Client A  │ ◄──────────────────► │  Relay Server   │ ◄──────────────────► │  Client B   │
│   (Host)    │                     │  (Pass-through) │                     │   (Guest)   │
└─────────────┘                     └─────────────────┘                     └─────────────┘
      │                                                                           │
      │  Game Logic                                              Game Logic  │
      │  (Local)                                                  (Local)   │
      └────────────────────────────────────────────────────────────────────────────┘
```

**Problems:**
- Both clients have game logic → state can desync
- Host is authoritative but logic is duplicated
- Cheating possible by modifying client
- Complex sync code needed

### New Architecture (Colyseus)

```
┌─────────────┐                     ┌─────────────────┐                     ┌─────────────┐
│   Client A  │ ◄───────────────────► │ Colyseus Server │ ◄───────────────────► │   Client B   │
│   (View)    │     State Sync      │  (Game Logic)   │     State Sync      │    (View)   │
└─────────────┘                     └─────────────────┘                     └─────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │ Authoritative│
                                    │ Game State   │
                                    └─────────────┘
```

**Benefits:**
- Single source of truth (server)
- No cheating possible
- Automatic state sync
- Built-in matchmaking
- Reconnection support

## Migration Steps

### Step 1: Deploy Colyseus Server

```bash
# Build server
cd DuoTaire_Server
npm install
npm run build

# Test locally
npm start

# Deploy to Render.com (or your host)
# See README.md for deployment instructions
```

### Step 2: Update Godot Client Configuration

Update `project.godot` to include new autoloads:

```ini
[autoload]
GameManager="*res://scripts/autoload/GameManager.gd"
SaveManager="*res://scripts/autoload/SaveManager.gd"
AudioManager="*res://scripts/autoload/AudioManager.gd"
NetworkManager="*res://scripts/autoload/NetworkManager.gd"
JuiceManager="*res://scripts/autoload/JuiceManager.gd"
ColyseusClient="*res://scripts/autoload/ColyseusClient.gd"
```

### Step 3: Update NetworkManager.gd

Replace the WebSocket relay connection with ColyseusClient:

```gdscript
# OLD CODE (WebSocket Relay)
func connect_to_server():
    _socket = WebSocketPeer.new()
    var url = "wss://duotaire-relay.onrender.com"
    _socket.connect_to_url(url)

# NEW CODE (Colyseus)
func connect_to_server():
    ColyseusClient.connect_to_server()
    ColyseusClient.connected.connect(_on_colyseus_connected)
    ColyseusClient.state_changed.connect(_on_colyseus_state_changed)
```

### Step 4: Replace Message Handlers

**Old approach** - Handle raw messages:
```gdscript
func _handle_message(data: Dictionary):
    match data.action:
        "play_card":
            # Validate and apply locally
            _apply_play_card(data)
        "draw_card":
            _apply_draw_card(data)
```

**New approach** - React to state changes:
```gdscript
func _on_colyseus_state_changed(state: Dictionary):
    # Server already validated - just update UI
    var game_state = ColyseusClient.convert_state_to_game_manager_format()
    GameManager.apply_full_state(game_state)
    emit_signal("state_changed")
```

### Step 5: Update Action Sending

**Old approach** - Send raw actions:
```gdscript
func send_play_card(from_type, from_index, to_type, to_index):
    _send_message({
        "action": "play_card",
        "fromType": from_type,
        "fromIndex": from_index,
        "toType": to_type,
        "toIndex": to_index
    })
```

**New approach** - Use ColyseusClient:
```gdscript
func send_play_card(from_type, from_index, to_type, to_index):
    ColyseusClient.send_play_card(from_type, from_index, to_type, to_index)
    # Server will validate and send back updated state
```

### Step 6: Update Room/Matchmaking

**Old approach**:
```gdscript
func create_room():
    room_code = _generate_room_code()
    _send_message({"action": "create_room", "code": room_code})

func join_room(code):
    _send_message({"action": "join_room", "code": code})
```

**New approach**:
```gdscript
func create_room():
    ColyseusClient.create_room("duotaire_private", {"name": player_name})
    # Room code will be in state.roomCode

func join_room(code):
    ColyseusClient.join_room_by_code(code, {"name": player_name})

func find_random_opponent():
    ColyseusClient.start_matchmaking(player_name)
```

### Step 7: Remove Client-Side Validation

Since the server is now authoritative, remove validation logic from GameManager:

**Old code** (keep for local play):
```gdscript
func playCard(fromType, fromIndex, toType, toIndex) -> bool:
    # Validate move
    if not _is_valid_move(fromType, fromIndex, toType, toIndex):
        return false
    # Apply move
    _apply_play_card(fromType, fromIndex, toType, toIndex)
    # Send to network
    NetworkManager.send_play_card(...)
    return true
```

**New code** (for network play):
```gdscript
func playCard(fromType, fromIndex, toType, toIndex) -> bool:
    if isNetworkGame:
        # Just send to server - it will validate and sync state back
        ColyseusClient.send_play_card(fromType, fromIndex, toType, toIndex)
        return true  # Assume success, UI will update on state change
    else:
        # Local play - use existing validation
        return _apply_play_card(fromType, fromIndex, toType, toIndex)
```

## Code Comparison

### Connecting to Game

| Aspect | Old (Relay) | New (Colyseus) |
|--------|-------------|----------------|
| Connect | `WebSocketPeer.connect_to_url()` | `ColyseusClient.connect_to_server()` |
| Create Room | Manual message | `ColyseusClient.create_room()` |
| Join Room | Manual message | `ColyseusClient.join_room_by_code()` |
| Matchmaking | Not supported | `ColyseusClient.start_matchmaking()` |

### Sending Actions

| Action | Old (Relay) | New (Colyseus) |
|--------|-------------|----------------|
| Draw Card | `_send({"action":"draw_card"})` | `ColyseusClient.send_draw_card()` |
| Play Card | `_send({"action":"play_card",...})` | `ColyseusClient.send_play_card()` |
| ZAP | `_send({"action":"zap"})` | `ColyseusClient.send_zap()` |

### Receiving State

| Aspect | Old (Relay) | New (Colyseus) |
|--------|-------------|----------------|
| State Format | Custom JSON | Schema-based |
| Sync Method | Full state send | Delta compression |
| Validation | Client-side | Server-side |

## Testing the Migration

1. **Local Testing**
   ```bash
   # Terminal 1: Start Colyseus server
   cd DuoTaire_Server && npm start
   
   # Terminal 2: Run Godot client
   # Open project in Godot and run
   ```

2. **Test Scenarios**
   - [ ] Create private room
   - [ ] Join with room code
   - [ ] Random matchmaking
   - [ ] Card play syncs correctly
   - [ ] Draw card syncs correctly
   - [ ] ZAP works
   - [ ] Turn changes work
   - [ ] Disconnect/reconnect works
   - [ ] Win condition detected

3. **Network Testing**
   - Deploy server to Render.com
   - Update ColyseusClient.PRODUCTION_SERVER
   - Test with two devices

## Rollback Plan

If issues arise, you can revert to the relay server:

1. Comment out ColyseusClient autoload in project.godot
2. Re-enable old NetworkManager WebSocket code
3. Point to relay server URL

## Performance Comparison

| Metric | Relay Server | Colyseus |
|--------|--------------|----------|
| Message Size | ~500 bytes (full state) | ~50 bytes (delta) |
| Latency | ~100ms | ~50ms |
| Bandwidth | High | Low |
| Server CPU | Minimal | Moderate |
| Scalability | ~100 rooms | ~1000+ rooms |

## Support

If you encounter issues during migration, contact:
- Email: henniep@gmail.com
- Check server logs: `http://localhost:2567/colyseus`
