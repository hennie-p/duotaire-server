/**
 * DuoTaire Game Room - Colyseus Room Handler
 * © 2025 HBC Consulting. All rights reserved.
 * 
 * Authoritative server implementation of Duo-taire card game
 */

import { Room, Client, Delayed } from "colyseus";
import { DuoTaireState, CenterPileSchema, FoundationSchema } from "../schema/DuoTaireState";
import { PlayerSchema } from "../schema/PlayerSchema";
import { CardSchema } from "../schema/CardSchema";

// Message types from clients
interface PlayCardMessage {
  fromType: string;  // "drawn", "center"
  fromIndex: number;
  toType: string;    // "foundation", "center", "opponentDiscard", "ownDiscard"
  toIndex: number;
}

interface SequenceMoveMessage {
  fromCenter: number;
  fromCardIndex: number;
  toCenter: number;
}

export class DuoTaireRoom extends Room<DuoTaireState> {
  maxClients = 2;
  autoDispose = true;
  
  private turnTimer: Delayed | null = null;
  private zapTimer: Delayed | null = null;
  
  private static readonly SUITS = ['♠', '♣', '♥', '♦'];
  private static readonly RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  private static readonly ZAP_GRACE_PERIOD = 3000; // 3 seconds

  onCreate(options: any) {
    console.log("🎴 DuoTaire room created:", this.roomId);
    
    this.setState(new DuoTaireState());
    
    // Set room code if provided (for private rooms)
    if (options.roomCode) {
      this.state.roomCode = options.roomCode;
    } else {
      this.state.roomCode = DuoTaireState.generateRoomCode();
    }

    // Register message handlers
    this.onMessage("play_card", (client, message: PlayCardMessage) => {
      this.handlePlayCard(client, message);
    });

    this.onMessage("draw_card", (client) => {
      this.handleDrawCard(client);
    });

    this.onMessage("sequence_move", (client, message: SequenceMoveMessage) => {
      this.handleSequenceMove(client, message);
    });

    this.onMessage("zap", (client) => {
      this.handleZap(client);
    });

    this.onMessage("request_state", (client) => {
      // Client requesting full state sync
      this.state.incrementVersion();
    });

    // Set up simulation interval for timers
    this.setSimulationInterval((deltaTime) => {
      this.updateTimers(deltaTime);
    }, 1000);

    console.log("📋 Room code:", this.state.roomCode);
  }

  onJoin(client: Client, options: any) {
    console.log(`👤 Player joined: ${client.sessionId}`);
    
    if (this.state.players.size >= 2) {
      console.log("❌ Room full, rejecting");
      throw new Error("Room is full");
    }

    const playerIndex = this.state.players.size;
    const player = new PlayerSchema(playerIndex, client.sessionId);
    player.name = options.name || (playerIndex === 0 ? "Host" : "Guest");
    
    this.state.players.set(client.sessionId, player);
    
    console.log(`✅ Player ${playerIndex} (${player.name}) joined. Total: ${this.state.players.size}`);
    
    // Broadcast player joined message (JSON format for Godot client)
    this.broadcast("player_joined", {
      sessionId: client.sessionId,
      playerIndex: playerIndex,
      playerName: player.name,
      totalPlayers: this.state.players.size
    });

    // Start game when both players join
    if (this.state.players.size === 2) {
      this.startGame();
    }
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`👋 Player left: ${client.sessionId} (consented: ${consented})`);
    
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      
      // If game is in progress, other player wins
      if (this.state.phase === "playing") {
        const opponent = this.state.getOpponent();
        if (opponent) {
          this.endGame(opponent.index, "Opponent disconnected");
        }
      }
    }
  }

  onDispose() {
    console.log("🗑️ Room disposed:", this.roomId);
    if (this.turnTimer) this.turnTimer.clear();
    if (this.zapTimer) this.zapTimer.clear();
  }

  // ===== GAME INITIALIZATION =====

  private startGame(): void {
    console.log("🎮 Starting game!");
    
    try {
      // Create and shuffle deck
      const deck = this.createShuffledDeck();
      
      // Deal cards to players (26 each)
      const player0 = this.state.getPlayerByIndex(0);
      const player1 = this.state.getPlayerByIndex(1);
      
      if (!player0 || !player1) {
        console.error("❌ Players not found!");
        return;
      }

      // Deal 26 cards to each player
      for (let i = 0; i < 52; i++) {
        const card = deck[i];
        if (i % 2 === 0) {
          player0.deck.push(card);
        } else {
          player1.deck.push(card);
        }
      }

      // Deal initial cards to center piles (one from each player to each pile)
      for (let pile = 0; pile < 5; pile++) {
        const card0 = player0.deck.pop();
        const card1 = player1.deck.pop();
        if (card0) this.state.centerPiles[pile].cards.push(card0);
        if (card1) this.state.centerPiles[pile].cards.push(card1);
      }

      // Set game state
      this.state.phase = "playing";
      this.state.currentPlayer = 0; // Host starts
      this.state.turnStartTime = Date.now();
      this.state.incrementVersion();

      console.log(`✅ Game started! Player 0 deck: ${player0.deck.length}, Player 1 deck: ${player1.deck.length}`);
      console.log(`📦 Center piles: ${this.state.centerPiles.map(p => p.cards.length).join(', ')}`);
      
      // Small delay to ensure both clients are ready
      this.clock.setTimeout(() => {
        // Broadcast game_started with full state (JSON format for Godot client)
        const gameState = this.getFullStateJSON();
        console.log("📤 Broadcasting game_started...");
        this.broadcast("game_started", gameState);
        console.log("✅ game_started broadcast sent");
      }, 500); // 500ms delay
      
    } catch (error) {
      console.error("❌ Error in startGame:", error);
    }
  }
  
  // Helper to get full game state as JSON (for Godot client)
  private getFullStateJSON(): any {
    console.log("📊 getFullStateJSON called");
    try {
      const player0 = this.state.getPlayerByIndex(0);
      const player1 = this.state.getPlayerByIndex(1);
      console.log("  Players found: p0=%s, p1=%s", !!player0, !!player1);
      
      const serializeCard = (c: CardSchema | undefined | null) => {
        if (!c) return null;
        return { suit: c.suit, rank: c.rank };
      };
      
      const serializeCardArray = (arr: any) => {
        if (!arr) return [];
        const result: any[] = [];
        try {
          // Handle ArraySchema or regular array
          if (typeof arr.forEach === 'function') {
            arr.forEach((c: CardSchema) => {
              if (c) result.push(serializeCard(c));
            });
          } else if (Array.isArray(arr)) {
            arr.forEach((c: CardSchema) => {
              if (c) result.push(serializeCard(c));
            });
          }
        } catch (e) {
          console.error("Error serializing card array:", e);
        }
        return result;
      };
      
      // Safely get center piles
      console.log("  centerPiles exists: %s, length: %s", !!this.state.centerPiles, this.state.centerPiles?.length);
      const centerPilesData: any[] = [];
      if (this.state.centerPiles) {
        for (let i = 0; i < 5; i++) {
          const pile = this.state.centerPiles[i];
          console.log("    Pile %d: exists=%s, cards=%s", i, !!pile, pile?.cards?.length);
          if (pile && pile.cards) {
            centerPilesData.push(serializeCardArray(pile.cards));
          } else {
            centerPilesData.push([]);
          }
        }
      }
      
      // Safely get foundations
      console.log("  foundations exists: %s, length: %s", !!this.state.foundations, this.state.foundations?.length);
      const foundationsData: any[] = [];
      if (this.state.foundations) {
        for (let i = 0; i < 4; i++) {
          const f = this.state.foundations[i];
          console.log("    Foundation %d: exists=%s, suit=%s", i, !!f, f?.suit);
          if (f) {
            foundationsData.push({
              suit: f.suit || '',
              cards: serializeCardArray(f.cards)
            });
          } else {
            foundationsData.push({ suit: '', cards: [] });
          }
        }
      }
      
      console.log("  Building result object...");
      const result = {
        phase: this.state.phase,
        currentPlayer: this.state.currentPlayer,
        roomCode: this.state.roomCode,
        version: this.state.stateVersion,
        players: [
          {
            index: 0,
            sessionId: player0?.sessionId || "",
            name: player0?.name || "Player 1",
            deckSize: player0?.deck?.length || 0,
            discardPile: serializeCardArray(player0?.discardPile),
            drawnCard: serializeCard(player0?.drawnCard)
          },
          {
            index: 1,
            sessionId: player1?.sessionId || "",
            name: player1?.name || "Player 2",
            deckSize: player1?.deck?.length || 0,
            discardPile: serializeCardArray(player1?.discardPile),
            drawnCard: serializeCard(player1?.drawnCard)
          }
        ],
        centerPiles: centerPilesData,
        foundations: foundationsData
      };
      console.log("✅ getFullStateJSON completed successfully");
      return result;
    } catch (error) {
      console.error("❌ Error in getFullStateJSON:", error);
      return { phase: "error", error: String(error) };
    }
  }

  private createShuffledDeck(): CardSchema[] {
    const deck: CardSchema[] = [];
    
    for (const suit of DuoTaireRoom.SUITS) {
      for (const rank of DuoTaireRoom.RANKS) {
        deck.push(new CardSchema(suit, rank));
      }
    }
    
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    return deck;
  }

  // ===== MESSAGE HANDLERS =====

  private handleDrawCard(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Validate turn
    if (player.index !== this.state.currentPlayer) {
      console.log(`❌ Not player ${player.index}'s turn`);
      return;
    }

    if (this.state.drawnCard) {
      console.log("❌ Already have a drawn card");
      return;
    }

    // Close ZAP grace period
    this.closeZapGracePeriod();

    // Draw card
    const card = player.drawCard();
    if (!card) {
      console.log("❌ No cards to draw");
      return;
    }

    this.state.drawnCard = card;
    this.state.incrementVersion();
    
    console.log(`🃏 Player ${player.index} drew: ${card.toString()}`);
  }

  private handlePlayCard(client: Client, message: PlayCardMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Validate turn
    if (player.index !== this.state.currentPlayer) {
      console.log(`❌ Not player ${player.index}'s turn`);
      return;
    }

    const { fromType, fromIndex, toType, toIndex } = message;
    console.log(`🎯 Play card: ${fromType}[${fromIndex}] -> ${toType}[${toIndex}]`);

    // Get source card
    const card = this.getCardFromSource(fromType, fromIndex);
    if (!card) {
      console.log("❌ No card at source");
      return;
    }

    // Validate and apply move
    let success = false;
    
    switch (toType) {
      case "foundation":
        success = this.playToFoundation(card, toIndex, fromType, fromIndex);
        break;
      case "center":
        success = this.playToCenter(card, toIndex, fromType, fromIndex);
        break;
      case "opponentDiscard":
        success = this.playToOpponentDiscard(card, fromType, fromIndex);
        break;
      case "ownDiscard":
        success = this.playToOwnDiscard(card, fromType, fromIndex);
        break;
    }

    if (success) {
      this.state.hasMovedThisTurn = true;
      this.state.incrementVersion();
      
      // Check win condition
      if (this.state.checkWin()) {
        this.endGame(this.state.currentPlayer, "All foundations complete!");
      }
    }
  }

  private handleSequenceMove(client: Client, message: SequenceMoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (player.index !== this.state.currentPlayer) {
      console.log(`❌ Not player ${player.index}'s turn`);
      return;
    }

    const { fromCenter, fromCardIndex, toCenter } = message;
    
    if (fromCenter === toCenter) return;
    if (fromCenter < 0 || fromCenter >= 5 || toCenter < 0 || toCenter >= 5) return;

    const fromPile = this.state.centerPiles[fromCenter];
    const toPile = this.state.centerPiles[toCenter];

    if (fromCardIndex < 0 || fromCardIndex >= fromPile.cards.length) return;

    // Validate sequence
    const sequence = this.getValidSequence(fromPile, fromCardIndex);
    if (sequence.length === 0) return;

    // Check if bottom card can be placed on target
    const bottomCard = sequence[0];
    const targetTop = toPile.getTopCard();
    
    if (targetTop && !bottomCard.canPlaceOn(targetTop)) {
      console.log("❌ Invalid sequence move");
      return;
    }

    // Close ZAP grace period
    this.closeZapGracePeriod();

    // Move sequence
    const cardsToMove = fromPile.cards.splice(fromCardIndex, sequence.length);
    for (const card of cardsToMove) {
      toPile.cards.push(card);
    }

    this.state.hasMovedThisTurn = true;
    this.state.incrementVersion();
    
    console.log(`📦 Moved ${sequence.length} cards from pile ${fromCenter} to pile ${toCenter}`);
  }

  private handleZap(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (!this.state.zapGracePeriod) {
      console.log("❌ No ZAP opportunity");
      return;
    }

    // ZAP successful - penalize opponent
    const opponent = this.state.getPlayerByIndex(1 - player.index);
    if (!opponent) return;

    console.log(`⚡ ZAP! Player ${player.index} caught opponent's missed play!`);

    // Add penalty cards to opponent (implementation depends on game rules)
    // For now, just end the ZAP grace period
    this.closeZapGracePeriod();
    this.state.incrementVersion();
  }

  // ===== CARD MOVEMENT HELPERS =====

  private getCardFromSource(fromType: string, fromIndex: number): CardSchema | null {
    switch (fromType) {
      case "drawn":
        return this.state.drawnCard;
      case "center":
        if (fromIndex >= 0 && fromIndex < 5) {
          const pile = this.state.centerPiles[fromIndex];
          return pile.getTopCard();
        }
        break;
    }
    return null;
  }

  private removeCardFromSource(fromType: string, fromIndex: number): void {
    switch (fromType) {
      case "drawn":
        this.state.drawnCard = null;
        break;
      case "center":
        if (fromIndex >= 0 && fromIndex < 5) {
          this.state.centerPiles[fromIndex].cards.pop();
        }
        break;
    }
  }

  private playToFoundation(card: CardSchema, foundationIndex: number, fromType: string, fromIndex: number): boolean {
    if (foundationIndex < 0 || foundationIndex >= 4) return false;

    const foundation = this.state.foundations[foundationIndex];
    const foundationTop = foundation.getTopCard();

    if (!card.canPlaceOnFoundation(foundationTop, foundation.suit)) {
      console.log("❌ Invalid foundation play");
      return false;
    }

    // Close ZAP grace period and check for missed plays
    this.closeZapGracePeriod();

    this.removeCardFromSource(fromType, fromIndex);
    foundation.cards.push(card.clone());

    // Track for ZAP detection
    this.state.lastMoveCard = card.toString();
    this.state.lastMoveType = "foundation";
    this.startZapGracePeriod();

    console.log(`✅ Played ${card.toString()} to foundation ${foundationIndex}`);
    return true;
  }

  private playToCenter(card: CardSchema, centerIndex: number, fromType: string, fromIndex: number): boolean {
    if (centerIndex < 0 || centerIndex >= 5) return false;

    const pile = this.state.centerPiles[centerIndex];
    const pileTop = pile.getTopCard();

    if (pileTop && !card.canPlaceOn(pileTop)) {
      console.log("❌ Invalid center play");
      return false;
    }

    // Close ZAP grace period
    this.closeZapGracePeriod();

    this.removeCardFromSource(fromType, fromIndex);
    pile.cards.push(card.clone());

    console.log(`✅ Played ${card.toString()} to center pile ${centerIndex}`);
    return true;
  }

  private playToOpponentDiscard(card: CardSchema, fromType: string, fromIndex: number): boolean {
    const opponent = this.state.getOpponent();
    if (!opponent) return false;

    const discardTop = opponent.getDiscardTop();
    if (!discardTop || !card.canPlayOnOpponentDiscard(discardTop)) {
      console.log("❌ Invalid opponent discard play");
      return false;
    }

    // Close ZAP grace period
    this.closeZapGracePeriod();

    this.removeCardFromSource(fromType, fromIndex);
    opponent.addToDiscard(card.clone());

    console.log(`✅ Played ${card.toString()} to opponent's discard`);
    return true;
  }

  private playToOwnDiscard(card: CardSchema, fromType: string, fromIndex: number): boolean {
    if (fromType !== "drawn") {
      console.log("❌ Can only discard drawn card");
      return false;
    }

    const currentPlayer = this.state.getPlayerByIndex(this.state.currentPlayer);
    if (!currentPlayer) return false;

    // Close ZAP grace period
    this.closeZapGracePeriod();

    this.removeCardFromSource(fromType, fromIndex);
    currentPlayer.addToDiscard(card.clone());

    // End turn
    this.endTurn();

    console.log(`✅ Player ${this.state.currentPlayer} discarded ${card.toString()}`);
    return true;
  }

  // ===== SEQUENCE VALIDATION =====

  private getValidSequence(pile: CenterPileSchema, startIndex: number): CardSchema[] {
    const sequence: CardSchema[] = [];
    
    for (let i = startIndex; i < pile.cards.length; i++) {
      const card = pile.cards[i];
      
      if (sequence.length === 0) {
        sequence.push(card);
      } else {
        const prevCard = sequence[sequence.length - 1];
        if (card.canPlaceOn(prevCard)) {
          sequence.push(card);
        } else {
          break;
        }
      }
    }
    
    // Sequence must extend to end of pile
    if (startIndex + sequence.length !== pile.cards.length) {
      return [];
    }
    
    return sequence;
  }

  // ===== ZAP SYSTEM =====

  private startZapGracePeriod(): void {
    this.state.zapGracePeriod = true;
    this.state.zapGraceEndTime = Date.now() + DuoTaireRoom.ZAP_GRACE_PERIOD;

    if (this.zapTimer) this.zapTimer.clear();
    
    this.zapTimer = this.clock.setTimeout(() => {
      this.closeZapGracePeriod();
    }, DuoTaireRoom.ZAP_GRACE_PERIOD);
  }

  private closeZapGracePeriod(): void {
    this.state.zapGracePeriod = false;
    if (this.zapTimer) {
      this.zapTimer.clear();
      this.zapTimer = null;
    }
  }

  // ===== TURN MANAGEMENT =====

  private endTurn(): void {
    // Switch player
    this.state.currentPlayer = 1 - this.state.currentPlayer;
    this.state.hasMovedThisTurn = false;
    this.state.turnStartTime = Date.now();
    
    console.log(`🔄 Turn ended. Now player ${this.state.currentPlayer}'s turn`);
  }

  private updateTimers(deltaTime: number): void {
    if (this.state.phase !== "playing") return;
    
    const currentPlayer = this.state.getPlayerByIndex(this.state.currentPlayer);
    if (currentPlayer) {
      currentPlayer.timer += deltaTime / 1000;
    }
  }

  // ===== GAME END =====

  private endGame(winnerIndex: number, reason: string): void {
    this.state.phase = "finished";
    this.state.gameOver = true;
    this.state.winner = winnerIndex;
    this.state.incrementVersion();

    console.log(`🏆 Game over! Player ${winnerIndex} wins: ${reason}`);

    // Notify all clients
    this.broadcast("game_over", {
      winner: winnerIndex,
      reason: reason
    });
  }
}
