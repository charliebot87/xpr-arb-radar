import type { RouteObservation } from './observations.js';
import { recordTrade, type ScoreAgent } from './scoreboard.js';

export interface PaperTradeCandidate {
  observation: RouteObservation;
  notionalValue: number;
  slippageBps: number;
  treasuryValveCostBps: number;
  simulatedPnlValue: number;
  simulatedPnlPct: number;
  rejectionReason?: string;
}

function isCandidate(o: RouteObservation): boolean {
  return o.operator_actionability === 'paper_route_candidate' || o.operator_actionability === 'manual_review';
}

export function buildPaperTradeCandidates(observations: RouteObservation[], notionalValue: number, slippageBps = 25, treasuryValveCostBps = 5): PaperTradeCandidate[] {
  return observations
    .filter(isCandidate)
    .filter((o) => typeof o.net_edge_pct === 'number')
    .map((observation) => {
      const frictionPct = (slippageBps + (observation.treasury_valve_needed ? treasuryValveCostBps : 0)) / 100;
      const simulatedPnlPct = (observation.net_edge_pct ?? 0) - frictionPct;
      const simulatedPnlValue = notionalValue * (simulatedPnlPct / 100);
      return {
        observation,
        notionalValue,
        slippageBps,
        treasuryValveCostBps: observation.treasury_valve_needed ? treasuryValveCostBps : 0,
        simulatedPnlPct,
        simulatedPnlValue,
        rejectionReason: simulatedPnlValue <= 0 ? 'paper pnl not positive after slippage/treasury friction' : undefined,
      };
    })
    .sort((a, b) => b.simulatedPnlValue - a.simulatedPnlValue);
}

export async function scoreBestPaperCandidate(options: {
  observations: RouteObservation[];
  scoreboardPath: string;
  agent: ScoreAgent;
  notionalValue: number;
  slippageBps?: number;
  treasuryValveCostBps?: number;
}): Promise<{ candidates: PaperTradeCandidate[]; scored?: Awaited<ReturnType<typeof recordTrade>> }> {
  const candidates = buildPaperTradeCandidates(options.observations, options.notionalValue, options.slippageBps, options.treasuryValveCostBps);
  const best = candidates.find((c) => !c.rejectionReason);
  if (!best) return { candidates };
  const scored = await recordTrade(options.scoreboardPath, {
    timestamp: new Date().toISOString(),
    agent: options.agent,
    mode: 'paper',
    strategy: 'mragentsmith',
    route: best.observation.route_key,
    pnlValue: best.simulatedPnlValue,
    pnlPct: best.simulatedPnlPct,
    evidence: best.observation.route_key,
  });
  return { candidates, scored };
}
