/**
 * Replay eines Bot-gegen-Bot-Matches zu einem Seed, Schritt für Schritt über `delta`. Ohne Phaser, DOM und Canvas.
 * Ein Seed legt Deck und Strategien beider Bots fest (`strategiesForSeed`), keine menschlichen Züge. Die Regeln
 * kommen unverändert aus `match.ts` und `bot.ts`; hier laufen nur Takt (Pause zwischen Karten) und Zeitlupe dazu.
 */
import { botStep } from './bot';
import { type Strategies, strategiesForSeed } from './balance-sim';
import { getCardDef } from './cards';
import { advance, createMatch, type MatchState, type PlayerIndex, setReady } from './match';

/** Faktor, mit dem `delta` in der Kampfphase skaliert wird (kleiner als 1 = Zeitlupe). */
export const SLOWMO_FACTOR = 0.35;
/** Pause zwischen zwei gespielten Karten in der Planungsphase in Millisekunden. */
export const PLAY_PAUSE_MS = 700;

/** Eine im Replay gespielte Karte. `line` ist 0-basiert, `null` bei Karten ohne Zielline. */
export interface ReplayEvent {
  round: number;
  player: PlayerIndex;
  cardId: string;
  line: number | null;
}

export interface ReplayState {
  match: MatchState;
  strategies: Strategies;
  /** Alle bisher gespielten Karten in der Reihenfolge, in der sie gespielt wurden. */
  events: ReplayEvent[];
  /** Zeit seit der letzten Aktion in der Planungsphase. */
  pauseMs: number;
  /** Wer in der Planungsphase als Nächstes zieht. */
  turn: PlayerIndex;
}

export function createReplay(seed: number): ReplayState {
  return { match: createMatch(seed), strategies: strategiesForSeed(seed), events: [], pauseMs: 0, turn: 0 };
}

export function isReplayOver(replay: ReplayState): boolean {
  return replay.match.phase === 'over';
}

/** Spielzeit, die die Kampfphase im Replay bei `deltaMs` echter Zeit verbraucht. */
export function combatDelta(deltaMs: number): number {
  return deltaMs * SLOWMO_FACTOR;
}

/** Ein Planungsschritt: der Spieler am Zug spielt eine Karte oder meldet sich bereit, wenn er nichts mehr spielt. */
function planStep(replay: ReplayState): ReplayState {
  const { match, turn } = replay;
  const player: PlayerIndex = match.ready[turn] ? (turn === 0 ? 1 : 0) : turn;
  const next: PlayerIndex = player === 0 ? 1 : 0;
  const move = botStep(match, player, replay.strategies[player]);
  if (!move) return { ...replay, match: setReady(match, player), turn: next };
  const event: ReplayEvent = { round: match.round, player, cardId: move.cardId, line: move.line ?? null };
  return { ...replay, match: move.state, events: [...replay.events, event], turn: next };
}

/**
 * Lässt das Replay `deltaMs` Millisekunden weiterlaufen. In der Planung spielen die Bots abwechselnd je eine Karte
 * pro `PLAY_PAUSE_MS`, in der Kampfphase läuft `advance` mit der Zeit mal `SLOWMO_FACTOR`. Gibt einen neuen Zustand
 * zurück; der alte bleibt unverändert.
 */
export function stepReplay(replay: ReplayState, deltaMs: number): ReplayState {
  if (isReplayOver(replay) || !(deltaMs > 0)) return replay;
  let current = replay;
  if (current.match.phase === 'combat') {
    const match = advance(current.match, combatDelta(deltaMs));
    return match.phase === 'combat' ? { ...current, match } : { ...current, match, pauseMs: 0, turn: 0 };
  }
  current = { ...current, pauseMs: current.pauseMs + deltaMs };
  while (current.match.phase === 'planning' && current.pauseMs >= PLAY_PAUSE_MS) {
    current = planStep({ ...current, pauseMs: current.pauseMs - PLAY_PAUSE_MS });
  }
  return current.match.phase === 'planning' ? current : { ...current, pauseMs: 0 };
}

const PLAYER_NAMES = ['Blau', 'Orange'] as const;

export function playerName(player: PlayerIndex): string {
  return PLAYER_NAMES[player];
}

/** Kommentartext zu einem Ereignis, z. B. „Runde 2 · Blau spielt Minion auf Line 3“. */
export function describeEvent(event: ReplayEvent): string {
  const def = getCardDef(event.cardId);
  const target = event.line === null ? '' : ` auf Line ${event.line + 1}`;
  return `Runde ${event.round} · ${playerName(event.player)} spielt ${def.name}${target}`;
}
