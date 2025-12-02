/**
 * Player Schema for Colyseus State Synchronization
 * © 2025 HBC Consulting. All rights reserved.
 */

import { Schema, ArraySchema, type } from "@colyseus/schema";
import { CardSchema } from "./CardSchema";

export class PlayerSchema extends Schema {
  @type("number") index: number = 0;
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("boolean") connected: boolean = true;
  @type("number") timer: number = 0; // Accumulated time in seconds
  @type([CardSchema]) deck = new ArraySchema<CardSchema>();
  @type([CardSchema]) discard = new ArraySchema<CardSchema>();

  constructor(index: number = 0, sessionId: string = "") {
    super();
    this.index = index;
    this.sessionId = sessionId;
    this.name = index === 0 ? "Host" : "Guest";
  }

  // Get top card of discard pile
  getDiscardTop(): CardSchema | null {
    if (this.discard.length === 0) return null;
    return this.discard[this.discard.length - 1];
  }

  // Get top card of deck (for drawing)
  getDeckTop(): CardSchema | null {
    if (this.deck.length === 0) return null;
    return this.deck[this.deck.length - 1];
  }

  // Draw a card from deck
  drawCard(): CardSchema | null {
    if (this.deck.length === 0) {
      // Recycle discard pile (keep top card)
      if (this.discard.length <= 1) return null;
      
      const topDiscard = this.discard.pop();
      const newDeck: CardSchema[] = [];
      
      // Reverse discard into deck
      while (this.discard.length > 0) {
        const card = this.discard.shift();
        if (card) newDeck.push(card);
      }
      
      // Put back top discard
      if (topDiscard) this.discard.push(topDiscard);
      
      // Refill deck
      for (const card of newDeck) {
        this.deck.push(card);
      }
    }
    
    return this.deck.pop() || null;
  }

  // Add card to discard pile
  addToDiscard(card: CardSchema): void {
    this.discard.push(card);
  }

  // Check if player has any cards left
  hasCards(): boolean {
    return this.deck.length > 0 || this.discard.length > 0;
  }

  // Get total card count
  getTotalCards(): number {
    return this.deck.length + this.discard.length;
  }
}
