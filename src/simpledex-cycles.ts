import { tokenKey } from './normalize.js';
import type { TokenRef } from './types.js';
import { getSimpleDexPools, simpleDexPrecision, simpleDexReserves, simpleDexToken, type SimplePool } from './venues/simpledex.js';

export interface SimpleDexHop {
  poolId: number;
  input: TokenRef;
  output: TokenRef;
  isTokenAIn: boolean;
  amountIn: number;
  amountOut: number;
  amountInRaw: string;
  amountOutRaw: string;
  inputReserveRaw: string;
  outputReserveRaw: string;
  feeRate: number;
  inputImpactPct: number;
}

export interface SimpleDexCycleCandidate {
  start: TokenRef;
  notional: number;
  finalAmount: number;
  profit: number;
  profitPct: number;
  hops: SimpleDexHop[];
  route: string;
  memoRoute: string;
  confidence: 'indicative';
  notes: string[];
}

export interface DirectedEdge {
  pool: SimplePool;
  input: TokenRef;
  output: TokenRef;
  inputReserve: number;
  outputReserve: number;
  inputReserveRaw: bigint;
  outputReserveRaw: bigint;
  inputPrecision: number;
  outputPrecision: number;
  isTokenAIn: boolean;
}

export interface SimpleDexCycleOptions {
  startSymbol?: string;
  startContract?: string;
  notionals?: number[];
  maxHops?: number;
  minProfitPct?: number;
  minNotional?: number;
  minAbsoluteProfit?: number;
  maxHopImpactPct?: number;
  minHopOutputRaw?: bigint;
  limit?: number;
}

const DEFAULT_NOTIONALS = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 25];
const DEFAULT_START = { symbol: 'XPR', contract: 'eosio.token' };
const DEFAULT_MIN_NOTIONAL = 1;
const DEFAULT_MIN_ABSOLUTE_PROFIT = 0.1;
const DEFAULT_MAX_HOP_IMPACT_PCT = 5;
const DEFAULT_MIN_HOP_OUTPUT_RAW = 10n;

function sameToken(a: TokenRef, b: TokenRef): boolean {
  return tokenKey(a) === tokenKey(b);
}

function edgeKey(e: DirectedEdge): string {
  return `${e.pool.poolId}:${e.isTokenAIn ? 'a' : 'b'}`;
}

export function simulateSimpleDexSwap(edge: DirectedEdge, amountIn: number): number | undefined {
  if (amountIn > edge.inputReserve * 0.5) return undefined;
  const amountInRaw = humanToRaw(amountIn, edge.inputPrecision);
  const amountOutRaw = simulateSimpleDexSwapRaw(edge, amountInRaw);
  if (amountOutRaw === undefined) return undefined;
  return rawToHuman(amountOutRaw, edge.outputPrecision);
}

function humanToRaw(amount: number, precision: number): bigint {
  return BigInt(Math.floor(amount * 10 ** precision));
}

function rawToHuman(raw: bigint, precision: number): number {
  return Number(raw) / 10 ** precision;
}

function rawAmount(raw: string | number): bigint | undefined {
  try {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return BigInt(Math.trunc(raw));
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw);
  } catch {
    return undefined;
  }
  return undefined;
}

export function simulateSimpleDexSwapRaw(edge: DirectedEdge, amountInRaw: bigint): bigint | undefined {
  if (amountInRaw <= 0n) return undefined;
  if (amountInRaw > edge.inputReserveRaw / 2n) return undefined;
  const feeRate = edge.pool.feeRate ?? 30;
  const feeMultiplier = BigInt(10_000 - feeRate);
  const amountInAfterFee = amountInRaw * feeMultiplier;
  const out = (edge.outputReserveRaw * amountInAfterFee) / (edge.inputReserveRaw * 10_000n + amountInAfterFee);
  if (out <= 0n) return undefined;
  return out;
}

function buildEdges(pools: SimplePool[]): DirectedEdge[] {
  const edges: DirectedEdge[] = [];
  for (const pool of pools) {
    const reserves = simpleDexReserves(pool);
    if (!reserves) continue;
    const tokenA = simpleDexToken(pool.tokenA);
    const tokenB = simpleDexToken(pool.tokenB);
    const reserveARaw = rawAmount(pool.reserveA);
    const reserveBRaw = rawAmount(pool.reserveB);
    if (!reserveARaw || !reserveBRaw) continue;
    const precisionA = simpleDexPrecision(pool.tokenA.symbolFull) ?? 4;
    const precisionB = simpleDexPrecision(pool.tokenB.symbolFull) ?? 4;
    edges.push({ pool, input: tokenA, output: tokenB, inputReserve: reserves.a, outputReserve: reserves.b, inputReserveRaw: reserveARaw, outputReserveRaw: reserveBRaw, inputPrecision: precisionA, outputPrecision: precisionB, isTokenAIn: true });
    edges.push({ pool, input: tokenB, output: tokenA, inputReserve: reserves.b, outputReserve: reserves.a, inputReserveRaw: reserveBRaw, outputReserveRaw: reserveARaw, inputPrecision: precisionB, outputPrecision: precisionA, isTokenAIn: false });
  }
  return edges;
}

function simulatePath(path: DirectedEdge[], notional: number, start: TokenRef, options: Required<Pick<SimpleDexCycleOptions, 'maxHopImpactPct' | 'minHopOutputRaw'>>): SimpleDexCycleCandidate | undefined {
  let amount = notional;
  let amountRaw = humanToRaw(notional, path[0]?.inputPrecision ?? start.precision ?? 4);
  const hops: SimpleDexHop[] = [];
  for (const edge of path) {
    if (amountRaw > edge.inputReserveRaw / 2n) return undefined;
    const inputImpactPct = (Number(amountRaw) / Number(edge.inputReserveRaw)) * 100;
    if (!Number.isFinite(inputImpactPct) || inputImpactPct > options.maxHopImpactPct) return undefined;
    const amountOutRaw = simulateSimpleDexSwapRaw(edge, amountRaw);
    if (!amountOutRaw) return undefined;
    if (amountOutRaw < options.minHopOutputRaw) return undefined;
    const amountOut = rawToHuman(amountOutRaw, edge.outputPrecision);
    hops.push({
      poolId: edge.pool.poolId,
      input: edge.input,
      output: edge.output,
      isTokenAIn: edge.isTokenAIn,
      amountIn: amount,
      amountOut,
      amountInRaw: amountRaw.toString(),
      amountOutRaw: amountOutRaw.toString(),
      inputReserveRaw: edge.inputReserveRaw.toString(),
      outputReserveRaw: edge.outputReserveRaw.toString(),
      feeRate: edge.pool.feeRate ?? 30,
      inputImpactPct,
    });
    amount = amountOut;
    amountRaw = amountOutRaw;
  }
  const profit = amount - notional;
  const profitPct = (profit / notional) * 100;
  const poolRoute = hops.map((h) => `${h.poolId}${h.isTokenAIn ? 'A' : 'B'}`).join('>');
  const tokenRoute = [start, ...hops.map((h) => h.output)].map((t) => t.symbol).join('->');
  return {
    start,
    notional,
    finalAmount: amount,
    profit,
    profitPct,
    hops,
    route: `${tokenRoute} via ${poolRoute}`,
    memoRoute: `pools=[${hops.map((h) => h.poolId).join(',')}] isTokenAIns=[${hops.map((h) => h.isTokenAIn).join(',')}]`,
    confidence: 'indicative',
    notes: ['simpledex-only raw integer constant-product simulation', 'chain-pool reserves required; read-only; no live execution', 'filters: min notional, min absolute profit, per-hop reserve impact, min raw output'],
  };
}

export function findSimpleDexCyclesFromPools(pools: SimplePool[], options: SimpleDexCycleOptions = {}): SimpleDexCycleCandidate[] {
  const start: TokenRef = { symbol: (options.startSymbol ?? DEFAULT_START.symbol).toUpperCase(), contract: options.startContract ?? DEFAULT_START.contract };
  const notionals = options.notionals?.length ? options.notionals : DEFAULT_NOTIONALS;
  const maxHops = options.maxHops ?? 4;
  const minProfitPct = options.minProfitPct ?? 0;
  const minNotional = options.minNotional ?? DEFAULT_MIN_NOTIONAL;
  const minAbsoluteProfit = options.minAbsoluteProfit ?? DEFAULT_MIN_ABSOLUTE_PROFIT;
  const maxHopImpactPct = options.maxHopImpactPct ?? DEFAULT_MAX_HOP_IMPACT_PCT;
  const minHopOutputRaw = options.minHopOutputRaw ?? DEFAULT_MIN_HOP_OUTPUT_RAW;
  const limit = options.limit ?? 20;
  const edges = buildEdges(pools);
  const byInput = new Map<string, DirectedEdge[]>();
  for (const edge of edges) {
    const list = byInput.get(tokenKey(edge.input)) ?? [];
    list.push(edge);
    byInput.set(tokenKey(edge.input), list);
  }

  const paths: DirectedEdge[][] = [];
  function dfs(current: TokenRef, path: DirectedEdge[], usedPools: Set<number>) {
    if (path.length >= 2 && sameToken(current, start)) {
      paths.push([...path]);
      return;
    }
    if (path.length >= maxHops) return;
    for (const edge of byInput.get(tokenKey(current)) ?? []) {
      if (usedPools.has(edge.pool.poolId)) continue;
      // Do not immediately round-trip through the same token unless it closes a real 2+ hop cycle.
      const nextUsed = new Set(usedPools);
      nextUsed.add(edge.pool.poolId);
      path.push(edge);
      dfs(edge.output, path, nextUsed);
      path.pop();
    }
  }
  dfs(start, [], new Set<number>());

  const out: SimpleDexCycleCandidate[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const pathKey = path.map(edgeKey).join('>');
    for (const notional of notionals) {
      if (notional < minNotional) continue;
      const simulated = simulatePath(path, notional, start, { maxHopImpactPct, minHopOutputRaw });
      if (!simulated || simulated.profitPct < minProfitPct || simulated.profit < minAbsoluteProfit) continue;
      const key = `${pathKey}:${notional}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(simulated);
    }
  }
  return out.sort((a, b) => b.profitPct - a.profitPct || b.profit - a.profit).slice(0, limit);
}

export async function findSimpleDexCycles(options: SimpleDexCycleOptions = {}): Promise<SimpleDexCycleCandidate[]> {
  const pools = await getSimpleDexPools();
  return findSimpleDexCyclesFromPools(pools, options);
}
