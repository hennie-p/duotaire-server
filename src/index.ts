/**
 * Duo-taire Colyseus Server
 * © 2025 HBC Consulting. All rights reserved.
 * 
 * Main entry point for the multiplayer game server
 */

import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import express from "express";
import cors from "cors";
import http from "http";

import { DuoTaireRoom } from "./rooms/DuoTaireRoom";
import { MatchmakingRoom } from "./rooms/MatchmakingRoom";

const port = Number(process.env.PORT) || 2567;

const app = express();

// Enable CORS for all origins (adjust for production)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    server: "Duo-taire Colyseus Server",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// Create HTTP server
const server = http.createServer(app);

// Create Colyseus game server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
    pingInterval: 5000,
    pingMaxRetries: 3
  })
});

// Register game rooms
gameServer.define("duotaire", DuoTaireRoom)
  .enableRealtimeListing();

gameServer.define("matchmaking", MatchmakingRoom)
  .enableRealtimeListing();

// Private room with code
gameServer.define("duotaire_private", DuoTaireRoom)
  .filterBy(["roomCode"]);

// Colyseus monitor (for development)
if (process.env.NODE_ENV !== "production") {
  app.use("/colyseus", monitor());
}

// API endpoints for room management
app.get("/api/rooms", async (req, res) => {
  try {
    const rooms = await gameServer.matchMaker.query({ name: "duotaire" });
    res.json({
      rooms: rooms.map(room => ({
        roomId: room.roomId,
        clients: room.clients,
        maxClients: room.maxClients,
        locked: room.locked
      }))
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// Start server
gameServer.listen(port).then(() => {
  console.log("");
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║       🎴 Duo-taire Colyseus Server 🎴          ║");
  console.log("║        © 2025 HBC Consulting                   ║");
  console.log("╠════════════════════════════════════════════════╣");
  console.log(`║  🌐 WebSocket: ws://localhost:${port}             ║`);
  console.log(`║  📊 Monitor:   http://localhost:${port}/colyseus   ║`);
  console.log(`║  ❤️  Health:    http://localhost:${port}/health     ║`);
  console.log("╚════════════════════════════════════════════════╝");
  console.log("");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Shutting down server...");
  gameServer.gracefullyShutdown();
});

process.on("SIGINT", () => {
  console.log("🛑 Shutting down server...");
  gameServer.gracefullyShutdown();
});
