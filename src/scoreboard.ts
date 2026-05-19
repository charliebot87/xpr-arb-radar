import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ScoreAgent = 'charliebot' | 'mragentsmith';
export type TradeOutcome = 'profit' | 'loss' | 'breakeven';

export interface ScoreTrade {
  timestamp: string;
  agent: ScoreAgent;
  mode: 'paper' | 'live';
  strategy: 'mragentsmith';
  route: string;
  pnlValue: number;
  pnlPct: number;
  outcome: TradeOutcome;
  pointsDelta: number;
  evidence: string;
}

export interface StrategyScoreboard {
  strategy: 'mragentsmith';
  mode: string;
  scoring: { profit: 1; loss: -1; breakeven: 0 };
  firstProfitableTradeAlerted: boolean;
  firstProfitableTrade?: ScoreTrade;
  agents: Record<ScoreAgent, { points: number; wins: number; losses: number; breakevens: number }>;
  trades: ScoreTrade[];
}

export const DEFAULT_SCOREBOARD: StrategyScoreboard = {
  strategy: 'mragentsmith',
  mode: 'paper_first_live_later',
  scoring: { profit: 1, loss: -1, breakeven: 0 },
  firstProfitableTradeAlerted: false,
  agents: {
    charliebot: { points: 0, wins: 0, losses: 0, breakevens: 0 },
    mragentsmith: { points: 0, wins: 0, losses: 0, breakevens: 0 },
  },
  trades: [],
};

export function outcomeFromPnl(pnlValue: number): TradeOutcome {
  if (pnlValue > 0) return 'profit';
  if (pnlValue < 0) return 'loss';
  return 'breakeven';
}

export function pointsForOutcome(outcome: TradeOutcome): number {
  return outcome === 'profit' ? 1 : outcome === 'loss' ? -1 : 0;
}

export async function readScoreboard(path: string): Promise<StrategyScoreboard> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as StrategyScoreboard;
  } catch {
    return structuredClone(DEFAULT_SCOREBOARD);
  }
}

export async function recordTrade(path: string, trade: Omit<ScoreTrade, 'outcome' | 'pointsDelta'>): Promise<{ scoreboard: StrategyScoreboard; firstProfit: boolean; recorded: ScoreTrade }> {
  const scoreboard = await readScoreboard(path);
  const outcome = outcomeFromPnl(trade.pnlValue);
  const recorded: ScoreTrade = { ...trade, outcome, pointsDelta: pointsForOutcome(outcome) };
  const agent = scoreboard.agents[recorded.agent] ?? { points: 0, wins: 0, losses: 0, breakevens: 0 };
  agent.points += recorded.pointsDelta;
  if (outcome === 'profit') agent.wins += 1;
  else if (outcome === 'loss') agent.losses += 1;
  else agent.breakevens += 1;
  scoreboard.agents[recorded.agent] = agent;
  scoreboard.trades.push(recorded);
  const firstProfit = outcome === 'profit' && !scoreboard.firstProfitableTrade;
  if (firstProfit) scoreboard.firstProfitableTrade = recorded;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(scoreboard, null, 2) + '\n', 'utf8');
  return { scoreboard, firstProfit, recorded };
}
