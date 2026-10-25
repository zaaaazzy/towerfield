/**
 * Replay eines Matches, Schritt für Schritt über `delta`. Ohne Phaser, DOM und Canvas.
 * Zwei Quellen für die Aktionen: ein Bot-gegen-Bot-Match zum Seed (`createReplay`, Strategien aus `strategiesForSeed`)
 * oder eine Aufzeichnung (`createRecordedReplay`, Züge aus `match-record.ts`). Beide teilen sich Takt, Zeitlupe,
 * `stepReplay` und `describeEvent`. Die Regeln kommen unverändert aus `match.ts`, `bot.ts` und `match-record.ts`.
 */
import { botStep } from './bot';
import { type Strategies, strategiesForSeed } from './balance-sim';
import { getCardDef } from './cards';
import { laneName } from './lanes';
import { advance, createMatch, type MatchState, type PlayerIndex, setReady } from './match';
import { type ActionError, applyAction, type RecordedAction, type RecordedMatch } from './match-record';

/** Faktor, mit dem `delta` in der Kampfphase skaliert wird (kleiner als 1 = Zeitlupe). */
export const SLOWMO_FACTOR = 0.35;
/** Pause zwischen zwei gespielten Karten in der Planungsphase in Millisekunden. */
export const PLAY_PAUSE_MS = 700;

export type ReplayActionType = RecordedAction['type'];

/**
 * Eine im Replay ausgeführte Aktion. Ohne `action` ist es eine gespielte Karte. `line` ist 0-basiert, `null` bei Karten
 * ohne Zielline. Beim Verschieben ist `line` das Ziel und `slot` der Platz; beim Verschieben und Zurücknehmen ist
 * `cardId` die Karte des Minions. Bei „bereit“ ist `cardId` leer.
 */
export interface ReplayEvent {
  round: number;
  player: PlayerIndex;
  cardId: string;
  line: number | null;
  action?: ReplayActionType;
  slot?: number;
}

/** Warum ein aufgezeichnetes Replay abgebrochen wurde. `index` ist die Position der Aktion in der Aufzeichnung. */
export type ReplayAbortReason = ActionError | 'truncated' | 'trailing-actions' | 'invalid-data';
export interface ReplayAbort {
  reason: ReplayAbortReason;
  index: number;
}

export interface ReplayState {
  match: MatchState;
  strategies: Strategies;
  /** Alle bisher gespielten Karten in der Reihenfolge, in der sie gespielt wurden. */
  events: ReplayEvent[];
  /** Zeit seit der letzten Aktion in der Planungsphase. */
  pauseMs: number;
  /** Wer in der Planungsphase als Nächstes zieht (nur beim Bot-Replay). */
  turn: PlayerIndex;
  /** Vorgegebene Aktionen einer Aufzeichnung; `null` beim Bot-Replay. */
  script: readonly RecordedAction[] | null;
  /** Nächste Aktion aus `script`. */
  cursor: number;
  /** Gesetzt, wenn das aufgezeichnete Replay nicht weiterläuft. */
  aborted: ReplayAbort | null;
}

/** Bot-Replay: ein Seed legt Deck und Strategien beider Bots fest. */
export function createReplay(seed: number): ReplayState {
  return {
    match: createMatch(seed),
    strategies: strategiesForSeed(seed),
    events: [],
    pauseMs: 0,
    turn: 0,
    script: null,
    cursor: 0,
    aborted: null,
  };
}

/** Replay einer Aufzeichnung: spielt ihre Aktionen der Reihe nach über die bestehenden Regeln nach. */
export function createRecordedReplay(record: RecordedMatch): ReplayState {
  return { ...createReplay(record.seed), script: record.actions };
}

/** Replay, das sofort mit `invalid-data` stehen bleibt (Zugdaten nicht lesbar). */
export function createInvalidReplay(seed: number): ReplayState {
  return { ...createReplay(seed), aborted: { reason: 'invalid-data', index: 0 } };
}

export function isReplayAborted(replay: ReplayState): boolean {
  return replay.aborted !== null;
}

export function isReplayOver(replay: ReplayState): boolean {
  return replay.match.phase === 'over';
}

/** Spielzeit, die die Kampfphase im Replay bei `deltaMs` echter Zeit verbraucht. */
export function combatDelta(deltaMs: number): number {
  return deltaMs * SLOWMO_FACTOR;
}

/** Ereignis zu einer Aktion; `before` ist der Zustand vor der Aktion (für die Karte eines Minions). */
function eventFor(before: MatchState, action: RecordedAction): ReplayEvent {
  const base = { round: action.round, player: action.player };
  const placed = (minionId: number) =>
    before.players[action.player].placements.find((p) => p.minionId === minionId)?.cardId ?? '';
  switch (action.type) {
    case 'play':
      return { ...base, cardId: action.cardId, line: action.line };
    case 'move':
      return { ...base, action: 'move', cardId: placed(action.minionId), line: action.line, slot: action.slot };
    case 'undo':
      return { ...base, action: 'undo', cardId: placed(action.minionId), line: null };
    case 'ready':
      return { ...base, action: 'ready', cardId: '', line: null };
  }
}

/** Ein Planungsschritt einer Aufzeichnung: die nächste Aktion ausführen oder das Replay kontrolliert abbrechen. */
function scriptStep(replay: ReplayState, script: readonly RecordedAction[]): ReplayState {
  const action = script[replay.cursor];
  if (!action) return { ...replay, aborted: { reason: 'truncated', index: replay.cursor } };
  const result = applyAction(replay.match, action);
  if (!result.ok) return { ...replay, aborted: { reason: result.reason, index: replay.cursor } };
  return {
    ...replay,
    match: result.state,
    events: [...replay.events, eventFor(replay.match, action)],
    cursor: replay.cursor + 1,
  };
}

/** Ein Planungsschritt: der Spieler am Zug spielt eine Karte oder meldet sich bereit, wenn er nichts mehr spielt. */
function planStep(replay: ReplayState): ReplayState {
  if (replay.script) return scriptStep(replay, replay.script);
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
  if (isReplayOver(replay) || isReplayAborted(replay) || !(deltaMs > 0)) return replay;
  let current = replay;
  if (current.match.phase === 'combat') {
    const match = advance(current.match, combatDelta(deltaMs));
    if (match.phase === 'combat') return { ...current, match };
    // Endet das Spiel, obwohl noch Aktionen übrig sind, passt die Aufzeichnung nicht zu den Regeln.
    const trailing = match.phase === 'over' && current.script !== null && current.cursor < current.script.length;
    return {
      ...current,
      match,
      pauseMs: 0,
      turn: 0,
      aborted: trailing ? { reason: 'trailing-actions', index: current.cursor } : null,
    };
  }
  current = { ...current, pauseMs: current.pauseMs + deltaMs };
  while (current.match.phase === 'planning' && !current.aborted && current.pauseMs >= PLAY_PAUSE_MS) {
    current = planStep({ ...current, pauseMs: current.pauseMs - PLAY_PAUSE_MS });
  }
  return current.match.phase === 'planning' ? current : { ...current, pauseMs: 0 };
}

const PLAYER_NAMES = ['Blau', 'Orange'] as const;

export function playerName(player: PlayerIndex): string {
  return PLAYER_NAMES[player];
}

/** Kommentartext zu einem Ereignis, z. B. „Runde 2 · Blau spielt Minion auf Lvl 2 oben“. */
export function describeEvent(event: ReplayEvent): string {
  const prefix = `Runde ${event.round} · ${playerName(event.player)}`;
  if (event.action === 'ready') return `${prefix} ist bereit`;
  const name = getCardDef(event.cardId).name;
  const target = event.line === null ? '' : ` auf ${laneName(event.line)}`;
  switch (event.action) {
    case 'move':
      return `${prefix} verschiebt ${name}${target}${event.slot === undefined ? '' : `, Platz ${event.slot + 1}`}`;
    case 'undo':
      return `${prefix} nimmt ${name} zurück`;
    default:
      return `${prefix} spielt ${name}${target}`;
  }
}

const ABORT_TEXT: Readonly<Record<ReplayAbortReason, string>> = {
  'invalid-data': 'Die Zugdaten sind ungültig.',
  truncated: 'Die Aufzeichnung endet vor dem Spielende.',
  'trailing-actions': 'Nach dem Spielende folgen noch Züge.',
  'wrong-round': 'Der Zug gehört zu einer anderen Runde.',
  'not-planning': 'Der Zug fällt nicht in die Planungsphase.',
  'already-ready': 'Der Spieler war schon bereit.',
  'no-such-card': 'Die Karte ist nicht auf der Hand.',
  'not-enough-energy': 'Zu wenig Energie.',
  'invalid-line': 'Ungültige oder noch nicht freie Lane.',
  'invalid-slot': 'Ungültiger Platz.',
  'slot-taken': 'Der Platz ist belegt.',
  'no-such-minion': 'Den Minion gibt es nicht.',
  'line-full': 'Die Lane ist voll.',
  'max-level': 'Das Feld hat die Höchststufe.',
  'invalid-target': 'Der Ziel-Minion ist ungültig.',
};

/** Hinweistext zum Abbruch, z. B. „Replay abgebrochen bei Zug 7: Zu wenig Energie.“ */
export function describeAbort(abort: ReplayAbort): string {
  if (abort.reason === 'invalid-data') return `Replay nicht möglich: ${ABORT_TEXT[abort.reason]}`;
  return `Replay abgebrochen bei Zug ${abort.index + 1}: ${ABORT_TEXT[abort.reason]}`;
}
