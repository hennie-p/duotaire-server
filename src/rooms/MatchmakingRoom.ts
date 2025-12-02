/**
 * Matchmaking Room - Handles random opponent matching
 * © 2025 HBC Consulting. All rights reserved.
 */

import { Room, Client, matchMaker } from "colyseus";
import { Schema, type } from "@colyseus/schema";

class MatchmakingState extends Schema {
  @type("number") playersWaiting: number = 0;
  @type("string") status: string = "searching";
}

interface WaitingPlayer {
  client: Client;
  name: string;
  joinedAt: number;
}

export class MatchmakingRoom extends Room<MatchmakingState> {
  maxClients = 100; // Can hold many waiting players
  autoDispose = true;
  
  private waitingPlayers: WaitingPlayer[] = [];
  private matchInterval: NodeJS.Timeout | null = null;

  onCreate(options: any) {
    console.log("🔍 Matchmaking room created");
    this.setState(new MatchmakingState());
    
    // Check for matches every 500ms
    this.matchInterval = setInterval(() => {
      this.tryMatch();
    }, 500);
  }

  onJoin(client: Client, options: any) {
    console.log(`👤 Player ${client.sessionId} looking for match`);
    
    this.waitingPlayers.push({
      client,
      name: options.name || "Player",
      joinedAt: Date.now()
    });
    
    this.state.playersWaiting = this.waitingPlayers.length;
    
    // Send waiting status
    client.send("matchmaking_status", {
      status: "searching",
      playersWaiting: this.state.playersWaiting
    });
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`👋 Player ${client.sessionId} left matchmaking`);
    
    // Remove from waiting list
    this.waitingPlayers = this.waitingPlayers.filter(p => p.client.sessionId !== client.sessionId);
    this.state.playersWaiting = this.waitingPlayers.length;
  }

  onDispose() {
    console.log("🗑️ Matchmaking room disposed");
    if (this.matchInterval) {
      clearInterval(this.matchInterval);
    }
  }

  private async tryMatch() {
    // Need at least 2 players
    if (this.waitingPlayers.length < 2) return;

    // Sort by wait time (oldest first)
    this.waitingPlayers.sort((a, b) => a.joinedAt - b.joinedAt);

    // Match first two players
    const player1 = this.waitingPlayers.shift()!;
    const player2 = this.waitingPlayers.shift()!;

    console.log(`🎮 Matching ${player1.name} with ${player2.name}`);

    try {
      // Create a new game room
      const room = await matchMaker.createRoom("duotaire", {});
      
      // Get seat reservations for both players
      const reservation1 = await matchMaker.reserveSeatFor(room, {
        name: player1.name
      });
      
      const reservation2 = await matchMaker.reserveSeatFor(room, {
        name: player2.name
      });

      // Send room details to both players
      player1.client.send("match_found", {
        roomId: room.roomId,
        sessionId: reservation1.sessionId,
        opponent: player2.name
      });

      player2.client.send("match_found", {
        roomId: room.roomId,
        sessionId: reservation2.sessionId,
        opponent: player1.name
      });

      console.log(`✅ Match created: Room ${room.roomId}`);

      // Players will leave matchmaking and join game room
      this.state.playersWaiting = this.waitingPlayers.length;

    } catch (error) {
      console.error("❌ Failed to create match:", error);
      
      // Put players back in queue
      this.waitingPlayers.unshift(player2);
      this.waitingPlayers.unshift(player1);
      
      player1.client.send("matchmaking_error", { error: "Failed to create match" });
      player2.client.send("matchmaking_error", { error: "Failed to create match" });
    }
  }
}
