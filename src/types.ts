export type VenueName = 'metalx' | 'simpledex' | 'alcor';

export interface TokenRef {
  symbol: string;
  contract: string;
  precision?: number;
}

export interface MarketQuote {
  venue: VenueName;
  pairId: string;
  base: TokenRef;
  quote: TokenRef;
  bid?: number; // quote units paid per 1 base, price at which venue/user buys base
  ask?: number; // quote units received per 1 base, price at which venue/user sells base
  mid?: number;
  feeBps?: number;
  maxBaseSize?: number;
  maxQuoteSize?: number;
  source: 'orderbook' | 'amm' | 'ticker' | 'synthetic';
  updatedAt: string;
  raw?: unknown;
}

export interface Opportunity {
  base: TokenRef;
  quote: TokenRef;
  buyVenue: MarketQuote;
  sellVenue: MarketQuote;
  buyPrice: number;
  sellPrice: number;
  grossEdgePct: number;
  netEdgePct: number;
  notes: string[];
}

export interface ScanConfig {
  minNetEdgePct: number;
  includeThinMarkets: boolean;
  quoteSymbols: string[];
}
