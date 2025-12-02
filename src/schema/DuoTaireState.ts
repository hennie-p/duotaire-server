/**
 * DuoTaire Game State Schema for Colyseus
 * © 2025 HBC Consulting. All rights reserved.
 * 
 * This is the authoritative game state that gets synchronized to all clients
 */

import { Schema, ArraySchema, MapSchema, type } from "@colyseus/schema";
import { CardSchema } from "./CardSchema";
import { PlayerSchema } from "./PlayerSchema";

// Center pile schema (array of cards)
export class CenterPileSchema extends Schema {
  @type([CardSchema]) cards = new ArraySchema<CardSchema>();

  getTopCard(): CardSchema | null {
    if (this.cards.length === 0) return null;
    return this.cards[this.cards.length - 1];
  }

  isEmpty(): boolean {
    return this.cards.length === 0;
  }
}

// Foundation pile schema
export class FoundationSchema extends Schema {
  @type("string") suit: string = "";
  @type([CardSchema]) cards = new ArraySchema<CardSchema>();

  constructor(suit: string = "") {
    super();
    this.suit = suit;
  }

  getTopCard(): CardSchema | null {
    if (this.cards.length === 0) return null;
    return this.cards[this.cards.length - 1];
  }

  isComplete(): boolean {
    return this.cards.length === 13;
  }
}

// Main game state
export class DuoTaireState extends Schema {
  // Game metadata
  @type("string") roomCode: string = "";
  @type("string") phase: string = "waiting"; // waiting, playing, finished
  @type("number") currentPlayer: number = 0;
  @type("boolean") gameOver: boolean = false;
  @type("number") winner: number = -1;
  
  // Drawn card (null if none drawn)
  @type(CardSchema) drawnCard: CardSchema | null = null;
  
  // Turn state
  @type("boolean") hasMovedThisTurn: boolean = false;
  @type("number") turnStartTime: number = 0;
  
  // ZAP state
  @type("boolean") zapGracePeriod: boolean = false;
  @type("number") zapGraceEndTime: number = 0;
  @type("string") lastMoveCard: string = ""; // For ZAP detection
  @type("string") lastMoveType: string = "";
  
  // Players (indexed by session ID)
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  
  // Center piles (5 piles)
  @type([CenterPileSchema]) centerPiles = new ArraySchema<CenterPileSchema>();
  
  // Foundation piles (4 piles, one per suit)
  @type([FoundationSchema]) foundations = new ArraySchema<FoundationSchema>();

  // Timestamps for synchronization
  @type("number") lastUpdateTime: number = 0;
  @type("number") stateVersion: number = 0;

  constructor() {
    super();
    this.initializePiles();
  }

  private initializePiles(): void {
    // Initialize 5 center piles
    for (let i = 0; i < 5; i++) {
      this.centerPiles.push(new CenterPileSchema());
    }

    // Initialize 4 foundations (one per suit)
    const suits = ['♠', '♣', '♥', '♦'];
    for (const suit of suits) {
      this.foundations.push(new FoundationSchema(suit));
    }
  }

  // Increment state version (for client sync verification)
  incrementVersion(): void {
    this.stateVersion++;
    this.lastUpdateTime = Date.now();
  }

  // Get player by index (0 or 1)
  getPlayerByIndex(index: number): PlayerSchema | null {
    for (const player of this.players.values()) {
      if (player.index === index) return player;
    }
    return null;
  }

  // Get player by session ID
  getPlayerBySession(sessionId: string): PlayerSchema | null {
    return this.players.get(sessionId) || null;
  }

  // Get opponent of current player
  getOpponent(): PlayerSchema | null {
    return this.getPlayerByIndex(1 - this.currentPlayer);
  }

  // Check if all foundations are complete (win condition)
  checkWin(): boolean {
    for (const foundation of this.foundations) {
      if (!foundation.isComplete()) return false;
    }
    return true;
  }

  // Get foundation index by suit
  getFoundationIndex(suit: string): number {
    const suits = ['♠', '♣', '♥', '♦'];
    return suits.indexOf(suit);
  }

  // Generate room code
  static generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
