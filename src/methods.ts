import { fetchJson } from './http.js';
import { buildPaperTradeCandidates } from './paper.js';
import type { RouteObservation, OperatorActionability } from './observations.js';

export type MethodName = 'depth_confirmed_arb' | 'xpr_xmd_momentum' | 'xpr_xmd_mean_reversion' | 'rebalance_assisted_route';

export interface MethodSignal {
  method: MethodName;
  actionability: OperatorActionability;
  reason: string;
  evidence: Record<string, unknown>;
}

type DailyRow = { symbol: string; open?: number; close?: number; high?: number; low?: number; volume_bid?: number; volume_ask?: number; change_percentage?: number };
type RecentTrade = { price?: number; bid_total?: number; ask_total?: number; block_time?: string; trade_id?: string };

const METALX_API = process.env.METALX_API ?? 'https://dex.api.mainnet.metalx.com/dex/v1';

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

export async function getXprXmdMarketContext(): Promise<{ daily?: DailyRow; recent: RecentTrade[] }> {
  const dailyRes = await fetchJson<{ data: DailyRow[] }>(`${METALX_API}/trades/daily`);
  const daily = dailyRes.data.find((r) => r.symbol === 'XPR_XMD');
  let recent: RecentTrade[] = [];
  try {
    const recentRes = await fetchJson<{ data: RecentTrade[] }>(`${METALX_API}/trades/recent?symbol=XPR_XMD&limit=50`);
    recent = recentRes.data ?? [];
  } catch {
    recent = [];
  }
  return { daily, recent };
}

export async function evaluateTradingMethods(observations: RouteObservation[], notionalValue = 10): Promise<MethodSignal[]> {
  const signals: MethodSignal[] = [];
  const paperCandidates = buildPaperTradeCandidates(observations, notionalValue);
  const profitablePaper = paperCandidates.filter((c) => c.simulatedPnlValue > 0);
  signals.push({
    method: 'depth_confirmed_arb',
    actionability: profitablePaper.length ? 'paper_route_candidate' : 'none',
    reason: profitablePaper.length ? 'positive paper candidate exists after friction' : 'no depth-confirmed positive paper candidate after friction',
    evidence: { candidates: paperCandidates.length, profitableCandidates: profitablePaper.length },
  });

  const treasuryCandidates = paperCandidates.filter((c) => c.observation.treasury_valve_needed);
  signals.push({
    method: 'rebalance_assisted_route',
    actionability: treasuryCandidates.some((c) => c.simulatedPnlValue > 0) ? 'paper_route_candidate' : treasuryCandidates.length ? 'monitor' : 'none',
    reason: treasuryCandidates.length ? 'mixed XMD/XUSDC route exists; treasury valve must be costed' : 'no mixed XMD/XUSDC paper candidate',
    evidence: { treasuryCandidates: treasuryCandidates.length, positiveTreasuryCandidates: treasuryCandidates.filter((c) => c.simulatedPnlValue > 0).length },
  });

  const { daily, recent } = await getXprXmdMarketContext();
  const open = num(daily?.open);
  const close = num(daily?.close);
  const change = num(daily?.change_percentage);
  const recentPrices = recent.map((t) => num(t.price)).filter((p): p is number => p !== undefined);
  const latest = recentPrices[0];
  const recentMin = recentPrices.length ? Math.min(...recentPrices) : undefined;
  const recentMax = recentPrices.length ? Math.max(...recentPrices) : undefined;
  const hasRecentTape = recent.length >= 10;

  const momentumOk = Boolean(hasRecentTape && change !== undefined && change > 3 && latest && close && latest >= close * 0.995);
  signals.push({
    method: 'xpr_xmd_momentum',
    actionability: momentumOk ? 'manual_review' : 'monitor',
    reason: momentumOk ? 'XPR/XMD has positive daily move and recent tape near close; needs defined invalidation before paper/live' : 'momentum not clean enough for paper route',
    evidence: { open, close, change_percentage: change, recentTrades: recent.length, latest, recentMin, recentMax, volume_bid: daily?.volume_bid, volume_ask: daily?.volume_ask },
  });

  const meanReversionOk = Boolean(hasRecentTape && change !== undefined && Math.abs(change) > 8 && recentMin && recentMax && close && (recentMax - recentMin) / close > 0.02);
  signals.push({
    method: 'xpr_xmd_mean_reversion',
    actionability: meanReversionOk ? 'manual_review' : 'monitor',
    reason: meanReversionOk ? 'large move plus intraperiod range; possible mean-reversion review' : 'no large enough dislocation/range for mean-reversion setup',
    evidence: { open, close, change_percentage: change, recentTrades: recent.length, latest, recentMin, recentMax },
  });

  return signals;
}
