/**
 * Balancing-Statistik aus simulierten Bot-gegen-Bot-Matches. Ohne Phaser, DOM und Canvas.
 * Die Zahlen beschreiben den Bot mit zufällig variierter Kartenreihenfolge, nicht menschliches Spielverhalten.
 * Zufall nur über `nextRandom` (Seed), daher ist jede Simulation reproduzierbar.
 */
import { botPlan } from './bot';
import { CARD_DEFS } from './cards';
import { TICK_MS } from './combat';
import { nextRandom } from './game-state';
import {
  advance,
  COMBAT_TICKS,
  createMatch,
  destroyedOutcome,
  type MatchState,
  MAX_ROUNDS,
  type Outcome,
  type PlayerIndex,
} from './match';

/** Kartenreihenfolge je Spieler. */
export type Strategies = readonly [readonly string[], readonly string[]];

export interface MatchResult {
  seed: number;
  outcome: Outcome;
  rounds: number;
  /** `towers`: ein Tower-Satz zerstört, `round-limit`: Entscheidung nach der Rundengrenze. */
  endedBy: 'towers' | 'round-limit';
  /** Gespielte Karten-IDs je Spieler (eine Eintrag pro Einsatz). */
  played: [string[], string[]];
}

export interface CardStats {
  cardId: string;
  matchesWithCard: number;
  plays: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  /** Siegquote dieser Karte minus Basisquote (Sieg über alle Spieler-Matches). */
  deltaToBaseline: number;
}

export interface BalanceReport {
  startSeed: number;
  totalMatches: number;
  winRatePlayer0: number;
  winRatePlayer1: number;
  drawRate: number;
  avgRounds: number;
  minRounds: number;
  maxRounds: number;
  /** Anteil der Matches, die durch zerstörte Tower enden (Rest: Entscheidung nach der Rundengrenze). */
  towerKillShare: number;
  roundLimitShare: number;
  /** Basisquote: Siegquote über alle Spieler-Matches. */
  baselineWinRate: number;
  cards: CardStats[];
}

export interface SimulationOptions {
  startSeed: number;
  count: number;
}

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/** Karten-IDs in zufälliger Reihenfolge (Fisher-Yates über `nextRandom`). */
export function shuffledPriority(seed: number): string[] {
  const ids = CARD_DEFS.map((def) => def.id);
  let state = seed >>> 0;
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const random = nextRandom(state);
    state = random.seed;
    const other = Math.floor(random.value * (index + 1));
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
  }
  return ids;
}

/** Strategien beider Spieler für ein Match, allein aus dessen Seed gewürfelt. */
export function strategiesForSeed(seed: number): Strategies {
  const base = Math.imul(seed, 2) >>> 0;
  return [shuffledPriority(base + 0x5bd1e995), shuffledPriority(base + 0x5bd1e996)];
}

/** Karten, die zwischen `before` und `after` aus der Hand verschwunden sind. */
function removedCards(before: string[], after: string[]): string[] {
  const rest = [...after];
  const removed: string[] = [];
  for (const id of before) {
    const index = rest.indexOf(id);
    if (index >= 0) rest.splice(index, 1);
    else removed.push(id);
  }
  return removed;
}

/**
 * Spielt ein volles Match Bot gegen Bot. Je Runde planen beide, danach läuft die ganze Kampfphase in einem
 * `advance`-Aufruf (spart das Klonen des Zustands). Endet nach höchstens `MAX_ROUNDS` Runden mit `phase === 'over'`.
 */
export function simulateMatch(seed: number, strategies: Strategies): MatchResult {
  let state: MatchState = createMatch(seed);
  const played: [string[], string[]] = [[], []];
  // Sicherung gegen Endlosschleifen: je Runde ein Planungs- und ein Kampfschritt.
  for (let step = 0; step < MAX_ROUNDS * 4 && state.phase !== 'over'; step += 1) {
    if (state.phase === 'planning') {
      for (const index of [0, 1] as PlayerIndex[]) {
        const before = state.players[index].hand;
        state = botPlan(state, index, strategies[index]);
        played[index].push(...removedCards(before, state.players[index].hand));
      }
    } else {
      state = advance(state, COMBAT_TICKS * TICK_MS);
    }
  }
  if (state.phase !== 'over' || state.outcome === null) {
    throw new Error(`Simulation von Seed ${seed} endete nicht.`);
  }
  return {
    seed,
    outcome: state.outcome,
    rounds: state.round,
    endedBy: destroyedOutcome(state) !== null ? 'towers' : 'round-limit',
    played,
  };
}

/** Verdichtet Match-Ergebnisse zu Kennzahlen. Ohne Ergebnisse sind alle Werte 0 (kein `NaN`). */
export function buildReport(results: readonly MatchResult[], startSeed: number): BalanceReport {
  const total = results.length;
  const count = (outcome: Outcome) => results.filter((result) => result.outcome === outcome).length;
  const rounds = results.map((result) => result.rounds);
  const towerKills = results.filter((result) => result.endedBy === 'towers').length;
  const playerMatches = total * 2;
  const baselineWinRate = ratio(count('player0') + count('player1'), playerMatches);

  const cards = CARD_DEFS.map((def): CardStats => {
    let matchesWithCard = 0;
    let plays = 0;
    let wins = 0;
    let draws = 0;
    for (const result of results) {
      for (const index of [0, 1] as PlayerIndex[]) {
        const uses = result.played[index].filter((id) => id === def.id).length;
        if (uses === 0) continue;
        matchesWithCard += 1;
        plays += uses;
        if (result.outcome === 'draw') draws += 1;
        else if (result.outcome === (index === 0 ? 'player0' : 'player1')) wins += 1;
      }
    }
    const winRate = ratio(wins, matchesWithCard);
    return {
      cardId: def.id,
      matchesWithCard,
      plays,
      winRate,
      drawRate: ratio(draws, matchesWithCard),
      lossRate: ratio(matchesWithCard - wins - draws, matchesWithCard),
      deltaToBaseline: matchesWithCard === 0 ? 0 : winRate - baselineWinRate,
    };
  });

  return {
    startSeed,
    totalMatches: total,
    winRatePlayer0: ratio(count('player0'), total),
    winRatePlayer1: ratio(count('player1'), total),
    drawRate: ratio(count('draw'), total),
    avgRounds: ratio(
      rounds.reduce((sum, value) => sum + value, 0),
      total,
    ),
    minRounds: total === 0 ? 0 : Math.min(...rounds),
    maxRounds: total === 0 ? 0 : Math.max(...rounds),
    towerKillShare: ratio(towerKills, total),
    roundLimitShare: ratio(total - towerKills, total),
    baselineWinRate,
    cards,
  };
}

/** Simuliert `count` Matches mit den Seeds `startSeed`, `startSeed + 1`, … und aggregiert sie. */
export function runSimulation(options: SimulationOptions): BalanceReport {
  const results: MatchResult[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const seed = (options.startSeed + index) >>> 0;
    results.push(simulateMatch(seed, strategiesForSeed(seed)));
  }
  return buildReport(results, options.startSeed);
}
