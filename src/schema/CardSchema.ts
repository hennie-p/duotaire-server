/**
 * Card Schema for Colyseus State Synchronization
 * © 2025 HBC Consulting. All rights reserved.
 */

import { Schema, type } from "@colyseus/schema";

export class CardSchema extends Schema {
  @type("string") suit: string = "";
  @type("string") rank: string = "";

  constructor(suit: string = "", rank: string = "") {
    super();
    this.suit = suit;
    this.rank = rank;
  }

  // Get rank value for comparison (A=1, 2-10, J=11, Q=12, K=13)
  getRankValue(): number {
    const rankValues: { [key: string]: number } = {
      'A': 1, '2': 2, '3': 3, '4': 4, '5': 5,
      '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
      'J': 11, 'Q': 12, 'K': 13
    };
    return rankValues[this.rank] || 0;
  }

  // Get card color (red or black)
  getColor(): string {
    return (this.suit === '♥' || this.suit === '♦') ? 'red' : 'black';
  }

  // Check if this card can be placed on another in center pile (descending, alternating colors)
  canPlaceOn(other: CardSchema): boolean {
    if (!other || !other.rank) return true; // Empty pile accepts any card
    const thisValue = this.getRankValue();
    const otherValue = other.getRankValue();
    return thisValue === otherValue - 1 && this.getColor() !== other.getColor();
  }

  // Check if this card can be placed on foundation (ascending, same suit)
  canPlaceOnFoundation(foundationTop: CardSchema | null, foundationSuit: string): boolean {
    if (this.suit !== foundationSuit) return false;
    if (!foundationTop) return this.rank === 'A';
    return this.getRankValue() === foundationTop.getRankValue() + 1;
  }

  // Check if this card can be played on opponent's discard
  canPlayOnOpponentDiscard(discardTop: CardSchema): boolean {
    if (!discardTop || !discardTop.rank) return false;
    
    // Same rank, different suit
    if (this.rank === discardTop.rank && this.suit !== discardTop.suit) {
      return true;
    }
    
    // Same suit, ±1 rank
    if (this.suit === discardTop.suit) {
      const diff = Math.abs(this.getRankValue() - discardTop.getRankValue());
      return diff === 1;
    }
    
    return false;
  }

  toString(): string {
    return `${this.rank}${this.suit}`;
  }

  clone(): CardSchema {
    return new CardSchema(this.suit, this.rank);
  }
}
