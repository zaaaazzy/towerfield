/**
 * Balancing-Statistik aus simulierten Bot-gegen-Bot-Matches. Ohne Phaser, DOM und Canvas.
 * Die Zahlen beschreiben den Bot mit zufällig variierter Kartenreihenfolge, nicht menschliches Spielverhalten.
 * Zufall nur über `nextRandom` (Seed), daher ist jede Simulation reproduzierbar.
 */
import { type BotMove, botStep, ECONOMY_ACTIONS } from './bot';
import { laneUnlockLevel, MAX_FIELD_LEVEL } from './lanes';
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

/** Ein Einsatz oder Abwurf einer Karte (oder des Feld-Upgrades als `line-upgrade`) mit Zeitpunkt und Level. */
export interface PlayEvent {
  cardId: string;
  /** Runde (1-basiert), in der die Karte gespielt oder abgeworfen wurde. */
  round: number;
  /** Feldstufe des Spielers vor dem Zug. */
  fieldLevel: number;
  /** Lane-Level (`laneUnlockLevel`) der Ziel-Lane; fehlt bei Karten ohne Lane-Ziel und bei Abwürfen. */
  laneLevel?: number;
  /** `true`: abgeworfen statt gespielt. */
  discard?: true;
}

export interface MatchResult {
  seed: number;
  outcome: Outcome;
  rounds: number;
  /** `towers`: ein Tower-Satz zerstört, `round-limit`: Entscheidung nach der Rundengrenze. */
  endedBy: 'towers' | 'round-limit';
  /** Gespielte Karten-IDs je Spieler (eine Eintrag pro Einsatz). */
  played: [string[], string[]];
  /** Alle Einsätze und Abwürfe je Spieler in Spielreihenfolge. */
  log?: [PlayEvent[], PlayEvent[]];
  /** Karten, die in der letzten Runde ungespielt auf der Hand blieben (vor dem Ablegen), je Spieler. */
  held?: [string[], string[]];
  /** Ereignisse, die in diesem Match aufgetreten sind (eine Runde, ein Eintrag). */
  events?: RoundEventId[];
}

/** Häufigkeit je Ereignis des Pools (immer alle Ereignisse, auch mit 0). */
export type EventCounts = Record<RoundEventId, number>;

/** Wann und wo eine Karte gespielt oder abgeworfen wurde (über alle Spieler-Matches). */
export interface CardTiming {
  /** Einsätze je Runde; Index 0 = Runde 1. */
  playsByRound: number[];
  /** Einsätze je Lane-Level; Index 0 = Level 1. Karten ohne Lane-Ziel bleiben bei 0. */
  playsByLaneLevel: number[];
  /** Einsätze je Feldstufe des Spielers vor dem Zug; Index 0 = Stufe 1. */
  playsByFieldLevel: number[];
  /** Mittlere Runde der Einsätze (0 ohne Einsatz). */
  avgPlayRound: number;
  /** Abwürfe insgesamt und je Runde (Index 0 = Runde 1). */
  discards: number;
  discardsByRound: number[];
  /** Wie oft die Karte am Matchende noch auf der Hand lag. */
  held: number;
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
  timing: CardTiming;
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
  /** Wie oft jedes Runden-Ereignis über alle Matches aufgetreten ist. */
  eventCounts: EventCounts;
  cards: CardStats[];
}

export interface SimulationOptions {
  startSeed: number;
  count: number;
}

const emptyTiming = (): CardTiming => ({
  playsByRound: Array<number>(MAX_ROUNDS).fill(0),
  playsByLaneLevel: Array<number>(MAX_FIELD_LEVEL).fill(0),
  playsByFieldLevel: Array<number>(MAX_FIELD_LEVEL).fill(0),
  avgPlayRound: 0,
  discards: 0,
  discardsByRound: Array<number>(MAX_ROUNDS).fill(0),
  held: 0,
});

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
 * Protokolleintrag zu einem Zug des Bots, gemessen am Zustand vor dem Zug. Das Feld-Upgrade zählt als Einsatz von
 * `line-upgrade` (die Karte hat 0 Kopien im Deck); Lane-Kauf und Ziehen sind keine Karten und liefern `undefined`.
 */
export function playEvent(before: MatchState, index: PlayerIndex, move: BotMove): PlayEvent | undefined {
  const base = { round: before.round, fieldLevel: before.players[index].level };
  if (move.economy === 'upgrade') return { cardId: 'line-upgrade', ...base };
  if (move.economy) return undefined;
  if (move.discard) return { cardId: move.cardId, ...base, discard: true };
  return { cardId: move.cardId, ...base, ...(move.line === undefined ? {} : { laneLevel: laneUnlockLevel(move.line) }) };
}

/**
 * Spielt ein volles Match Bot gegen Bot. Je Runde planen beide, danach läuft die ganze Kampfphase in einem
 * `advance`-Aufruf (spart das Klonen des Zustands). Endet nach höchstens `MAX_ROUNDS` Runden mit `phase === 'over'`.
 */
export function simulateMatch(seed: number, strategies: Strategies): MatchResult {
  let state: MatchState = createMatch(seed);
  const played: [string[], string[]] = [[], []];
  const log: [PlayEvent[], PlayEvent[]] = [[], []];
  const events: RoundEventId[] = [];
  const held: [string[], string[]] = [[], []];
  let eventRound = 0;
  // Sicherung gegen Endlosschleifen: je Runde ein Planungs- und ein Kampfschritt.
  for (let step = 0; step < MAX_ROUNDS * 4 && state.phase !== 'over'; step += 1) {
    if (state.phase === 'planning') {
      if (state.event && state.round !== eventRound) events.push(state.event);
      eventRound = state.round;
      for (const index of [0, 1] as PlayerIndex[]) {
        // Schrittweise statt `botPlan`, damit auch eine gezogene und gleich gespielte Karte zählt.
        for (let move = botStep(state, index, strategies[index]); move; move = botStep(state, index, strategies[index])) {
          const entry = playEvent(state, index, move);
          if (entry) {
            log[index].push(entry);
            if (!entry.discard) played[index].push(entry.cardId);
          }
          state = move.state;
        }
        // `setReady` legt die Resthand ab und zieht neu; gemessen wird, was vor dem Ablegen ungespielt blieb.
        held[index] = [...state.players[index].hand];
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
    outcome: state.outcome,
    rounds: state.round,
    endedBy: destroyedOutcome(state) !== null ? 'towers' : 'round-limit',
    played,
    log,
    held,
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
    const timing = emptyTiming();
    let roundSum = 0;
    for (const result of results) {
      for (const index of [0, 1] as PlayerIndex[]) {
        for (const entry of result.log?.[index] ?? []) {
          if (entry.cardId !== def.id) continue;
          if (entry.discard) {
            timing.discards += 1;
            timing.discardsByRound[entry.round - 1]! += 1;
            continue;
          }
          timing.playsByRound[entry.round - 1]! += 1;
          timing.playsByFieldLevel[entry.fieldLevel - 1]! += 1;
          if (entry.laneLevel !== undefined) timing.playsByLaneLevel[entry.laneLevel - 1]! += 1;
          roundSum += entry.round;
        }
        timing.held += (result.held?.[index] ?? []).filter((id) => id === def.id).length;
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
      timing: { ...timing, avgPlayRound: ratio(roundSum, timing.playsByRound.reduce((sum, n) => sum + n, 0)) },
    };
  });

  const eventCounts = Object.fromEntries(ROUND_EVENTS.map((def) => [def.id, 0])) as EventCounts;
  for (const result of results) for (const id of result.events ?? []) eventCounts[id] += 1;

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
    eventCounts,
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
