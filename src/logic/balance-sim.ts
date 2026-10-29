/**
 * Balancing-Statistik aus simulierten Bot-gegen-Bot-Matches. Ohne Phaser, DOM und Canvas.
 * Die Zahlen beschreiben den Bot mit zufällig variierter Kartenreihenfolge, nicht menschliches Spielverhalten.
 * Zufall nur über `nextRandom` (Seed), daher ist jede Simulation reproduzierbar.
 */
import { BOT_LEVELS, type BotLevel, botStepFor, ECONOMY_ACTIONS } from './bot';
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
  setReady,
} from './match';
import { ROUND_EVENTS, type RoundEventId } from './round-events';

/** Kartenreihenfolge je Spieler. */
export type Strategies = readonly [readonly string[], readonly string[]];

/** Bot-Stufe je Spieler. */
export type Levels = readonly [BotLevel, BotLevel];

export interface MatchResult {
  seed: number;
  /** Stufen der beiden Bots; fehlt bei Ergebnissen ohne Stufenvergleich (beide „Leicht“). */
  levels?: Levels;
  outcome: Outcome;
  rounds: number;
  /** `towers`: ein Tower-Satz zerstört, `round-limit`: Entscheidung nach der Rundengrenze. */
  endedBy: 'towers' | 'round-limit';
  /** Gespielte Karten-IDs je Spieler (eine Eintrag pro Einsatz). */
  played: [string[], string[]];
  /** Ereignisse, die in diesem Match aufgetreten sind (eine Runde, ein Eintrag). */
  events?: RoundEventId[];
}

/** Häufigkeit je Ereignis des Pools (immer alle Ereignisse, auch mit 0). */
export type EventCounts = Record<RoundEventId, number>;

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

/** Ergebnis einer Bot-Stufe in den Matches, in denen beide Stufen gegeneinander gespielt haben. */
export interface LevelStats {
  /** Matches mit dieser Stufe (jedes Stufen-Match zählt für beide Stufen). */
  matches: number;
  wins: number;
  /** `wins / matches`; 0 ohne Matches. */
  winRate: number;
}

export interface BalanceReport {
  startSeed: number;
  totalMatches: number;
  /**
   * Siegquote je Bot-Stufe, nur aus Matches mit verschiedenen Stufen (Leicht gegen Normal). Ohne solche Matches sind
   * alle Werte 0. Remis zählen als Match, aber nicht als Sieg.
   */
  levelStats: Record<BotLevel, LevelStats>;
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
  /** Wie oft jedes Runden-Ereignis über alle Matches aufgetreten ist. */
  eventCounts: EventCounts;
  cards: CardStats[];
}

export interface SimulationOptions {
  startSeed: number;
  count: number;
  /** Matches Leicht gegen Normal mit Seitenwechsel je Seed (`levelsForSeed`); sonst spielen beide Seiten „Leicht“. */
  compareLevels?: boolean;
}

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/** Karten-IDs und Wirtschaftsaktionen des Bots in zufälliger Reihenfolge (Fisher-Yates über `nextRandom`). */
export function shuffledPriority(seed: number): string[] {
  const ids: string[] = [...CARD_DEFS.map((def) => def.id), ...ECONOMY_ACTIONS];
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

/**
 * Stufen für den Stufenvergleich: bei geradem Seed spielt Spieler 0 „Leicht“ und Spieler 1 „Normal“, bei ungeradem
 * Seed umgekehrt (Seitenwechsel je Seed, damit kein Vorteil einer Seite die Quote verzerrt).
 */
export function levelsForSeed(seed: number): Levels {
  return seed % 2 === 0 ? ['easy', 'normal'] : ['normal', 'easy'];
}

/**
 * Spielt ein volles Match Bot gegen Bot. Je Runde planen beide, danach läuft die ganze Kampfphase in einem
 * `advance`-Aufruf (spart das Klonen des Zustands). Endet nach höchstens `MAX_ROUNDS` Runden mit `phase === 'over'`.
 * `levels` wählt die Stufe je Spieler (Standard: beide „Leicht“, dann gilt `strategies`); „Normal“ ignoriert die
 * Kartenreihenfolge seiner Seite.
 */
export function simulateMatch(seed: number, strategies: Strategies, levels?: Levels): MatchResult {
  let state: MatchState = createMatch(seed);
  const played: [string[], string[]] = [[], []];
  const events: RoundEventId[] = [];
  let eventRound = 0;
  // Sicherung gegen Endlosschleifen: je Runde ein Planungs- und ein Kampfschritt.
  for (let step = 0; step < MAX_ROUNDS * 4 && state.phase !== 'over'; step += 1) {
    if (state.phase === 'planning') {
      if (state.event && state.round !== eventRound) events.push(state.event);
      eventRound = state.round;
      for (const index of [0, 1] as PlayerIndex[]) {
        // Schrittweise statt `botPlan`, damit auch eine gezogene und gleich gespielte Karte zählt.
        const level = levels?.[index] ?? 'easy';
        for (
          let move = botStepFor(level, state, index, strategies[index]);
          move;
          move = botStepFor(level, state, index, strategies[index])
        ) {
          if (!move.economy && !move.discard) played[index].push(move.cardId);
          state = move.state;
        }
        state = setReady(state, index);
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
    ...(levels ? { levels } : {}),
    outcome: state.outcome,
    rounds: state.round,
    endedBy: destroyedOutcome(state) !== null ? 'towers' : 'round-limit',
    played,
    events,
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

  const eventCounts = Object.fromEntries(ROUND_EVENTS.map((def) => [def.id, 0])) as EventCounts;
  for (const result of results) for (const id of result.events ?? []) eventCounts[id] += 1;

  const levelStats = Object.fromEntries(BOT_LEVELS.map((level) => [level, { matches: 0, wins: 0, winRate: 0 }])) as Record<
    BotLevel,
    LevelStats
  >;
  for (const result of results) {
    const levels = result.levels;
    if (!levels || levels[0] === levels[1]) continue;
    for (const index of [0, 1] as PlayerIndex[]) {
      const stats = levelStats[levels[index]];
      stats.matches += 1;
      if (result.outcome === (index === 0 ? 'player0' : 'player1')) stats.wins += 1;
    }
  }
  for (const stats of Object.values(levelStats)) stats.winRate = ratio(stats.wins, stats.matches);

  return {
    startSeed,
    totalMatches: total,
    levelStats,
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
    eventCounts,
    cards,
  };
}

/**
 * Simuliert `count` Matches mit den Seeds `startSeed`, `startSeed + 1`, … und aggregiert sie. Mit `compareLevels` spielt
 * jedes Match Leicht gegen Normal (siehe `levelsForSeed`).
 */
export function runSimulation(options: SimulationOptions): BalanceReport {
  const results: MatchResult[] = [];
  for (let index = 0; index < options.count; index += 1) {
    const seed = (options.startSeed + index) >>> 0;
    results.push(simulateMatch(seed, strategiesForSeed(seed), options.compareLevels ? levelsForSeed(seed) : undefined));
  }
  return buildReport(results, options.startSeed);
}
