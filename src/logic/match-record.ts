/**
 * Aufzeichnung eines Matches: jede Aktion beider Spieler (Karte spielen, Minion verschieben, Beschwörung
 * zurücknehmen, bereit) samt Runde, dazu ein kompaktes URL-Format und das Nachspielen mit Prüfung.
 * Ohne Phaser, DOM und Canvas. Die Regeln kommen unverändert aus `match.ts`; hier wird nur mitgeschrieben.
 *
 * Format (Version 8, nur Zeichen `0-9 a-z . -`, damit nichts maskiert werden muss):
 *   `v8` gefolgt von Aktionen, je mit `.` davor. Eine Aktion beginnt mit Typbuchstabe, Runde (1 Ziffer) und Spieler
 *   (0/1), danach Felder mit `-`:
 *   `p<R><P>-<Kartenindex>[-<Lane>[-<Slot>]]` Karte spielen (bei Karten mit Ziel-Minion steht an der Stelle der Lane
 *   die Minion-Id; der Turm-Slot einer Beschwörung steht nur, wenn er gewählt wurde, sonst gilt der erste freie) ·
 *   `m<R><P>-<Minion>-<Lane>-<Slot>` auf einen anderen Turm-Slot verschieben (kostet Energie) ·
 *   `u<R><P>-<Minion>` zurücknehmen · `s<R><P>-<Minion>` platzierte Figur verkaufen (bringt Energie) ·
 *   `d<R><P>-<Kartenindex>` Handkarte abwerfen (bringt Energie) · `r<R><P>` bereit ·
 *   `g<R><P>` Feld-Upgrade · `b<R><P>-<Lane>` Lane kaufen · `w<R><P>` Karte ziehen (alle drei kosten Energie).
 *   Der Slot ist `2 * Tower-Index + Seite` (0 oben, 1 unten), siehe `placement.ts`.
 * Der Kartenindex ist die Position in `CARD_DEFS`. Ändern sich Regeln oder Kartenliste, muss `RECORD_VERSION` steigen,
 * damit alte Links als ungültig erkannt werden (der Test in `match-record.test.ts` hält die Kartenliste fest).
 */
import { botStep } from './bot';
import { CARD_DEFS, getCardDef } from './cards';
import { TICK_MS } from './combat';
import {
  advance,
  buyLane,
  COMBAT_TICKS,
  createMatch,
  discardCard,
  drawCard,
  LINE_COUNT,
  type MatchState,
  MAX_ROUNDS,
  moveMinion,
  type PlayError,
  type PlayerIndex,
  playCard,
  sellMinion,
  setReady,
  undoSummon,
  upgradeField,
} from './match';

/**
 * Version 8: neue Spielregeln (Turm-Spawn, Türme auf allen Lanes, eine Karte pro Runde, fünf neue Karten nach der
 * Planung, Verkauf von Figuren als Aktion `sell`). Version 7: neues Wirtschaftskonzept (Einkommen, Upgrade, Lane-Kauf, Karte ziehen als eigene Aktionen; das Upgrade
 * ist keine Karte mehr im Deck). Version 6: Turm-Slots statt freier Positionen, Verschieben und Abwerfen kosten bzw. bringen Energie, Lane-Karten und
 * sieben neue Karten (Kartenliste und Deck ändern sich). Version 5 brachte die Tower-Spezialisierungen, Version 4
 * `buff-minion` (der Zug trägt statt der Lane die Minion-Id), Version 3 `summon-destroyer`, Version 2 das horizontale
 * Lane-Layout. Links aus älteren Versionen gelten nicht mehr, weil sie sonst ein anderes Match abspielten.
 */
export const RECORD_VERSION = 8;
/** Obergrenze für Länge und Aktionszahl beim Dekodieren; ein Match mit 8 Runden bleibt weit darunter. */
export const MAX_MOVES_LENGTH = 4000;
const MAX_ACTIONS = 800;

/** Der Teil einer Aktion, den der Spieler bestimmt; Runde und Spieler ergänzt `performAction`. */
export type ActionBody =
  | { type: 'play'; cardId: string; line: number | null; minionId?: number; slot?: number }
  | { type: 'move'; minionId: number; line: number; slot: number }
  | { type: 'undo'; minionId: number }
  | { type: 'sell'; minionId: number }
  | { type: 'discard'; cardId: string }
  | { type: 'upgrade' }
  | { type: 'buy-lane'; line: number }
  | { type: 'draw' }
  | { type: 'ready' };

export type RecordedAction = ActionBody & { round: number; player: PlayerIndex };

export interface RecordedMatch {
  version: number;
  seed: number;
  actions: RecordedAction[];
}

export type ActionError = PlayError | 'wrong-round';
export type ActionResult = { ok: true; state: MatchState } | { ok: false; state: MatchState; reason: ActionError };

export function createRecord(seed: number): RecordedMatch {
  return { version: RECORD_VERSION, seed, actions: [] };
}

export function appendAction(record: RecordedMatch, action: RecordedAction): RecordedMatch {
  return { ...record, actions: [...record.actions, action] };
}

function fail(state: MatchState, reason: ActionError): ActionResult {
  return { ok: false, state, reason };
}

/**
 * Wendet eine Aktion über die bestehenden Regeln an. Ein Fehler (auch eine Aktion aus der falschen Runde) lässt den
 * Zustand unverändert. Karten werden über ihre ID in der Hand gefunden, nicht über den Handindex.
 */
export function applyAction(state: MatchState, action: RecordedAction): ActionResult {
  if (action.round !== state.round) return fail(state, 'wrong-round');
  const { player } = action;
  switch (action.type) {
    case 'play': {
      const handIndex = state.players[player].hand.indexOf(action.cardId);
      if (handIndex < 0) return fail(state, 'no-such-card');
      if (getCardDef(action.cardId).target !== 'line' && action.line !== null) return fail(state, 'invalid-line');
      return playCard(state, player, handIndex, action.line ?? undefined, action.slot, action.minionId);
    }
    case 'discard': {
      const handIndex = state.players[player].hand.indexOf(action.cardId);
      if (handIndex < 0) return fail(state, 'no-such-card');
      return discardCard(state, player, handIndex);
    }
    case 'move':
      return moveMinion(state, player, action.minionId, action.line, action.slot);
    case 'undo':
      return undoSummon(state, player, action.minionId);
    case 'sell':
      return sellMinion(state, player, action.minionId);
    case 'upgrade':
      return upgradeField(state, player);
    case 'buy-lane':
      return buyLane(state, player, action.line);
    case 'draw':
      return drawCard(state, player);
    case 'ready':
      if (state.phase !== 'planning') return fail(state, 'not-planning');
      if (state.ready[player]) return fail(state, 'already-ready');
      return { ok: true, state: setReady(state, player) };
  }
}

/**
 * Führt eine Aktion von `player` in der aktuellen Runde aus und hängt sie bei Erfolg an die Aufzeichnung an. Bei einem
 * Fehler bleiben Zustand und Aufzeichnung unverändert. Der Spielzustand selbst weiß nichts von der Aufzeichnung.
 */
export function performAction(
  state: MatchState,
  record: RecordedMatch,
  player: PlayerIndex,
  body: ActionBody,
): { result: ActionResult; record: RecordedMatch } {
  const action = { ...body, round: state.round, player } as RecordedAction;
  const result = applyAction(state, action);
  return { result, record: result.ok ? appendAction(record, action) : record };
}

/** Wie `botPlan` (gleiche Züge, gleicher Zustand), schreibt aber jede Karte und das „Bereit“ des Bots mit. */
export function botPlanRecorded(
  state: MatchState,
  record: RecordedMatch,
  player: PlayerIndex,
  priority?: readonly string[],
): { state: MatchState; record: RecordedMatch } {
  let current = state;
  let recorded = record;
  for (let move = botStep(current, player, priority); move; move = botStep(current, player, priority)) {
    const base = { round: current.round, player };
    const action: RecordedAction = move.economy
      ? move.economy === 'buy-lane'
        ? { ...base, type: 'buy-lane', line: move.line! }
        : { ...base, type: move.economy }
      : move.discard
        ? { ...base, type: 'discard', cardId: move.cardId }
        : {
            ...base,
            type: 'play',
            cardId: move.cardId,
            line: move.line ?? null,
            ...(move.minionId === undefined ? {} : { minionId: move.minionId }),
          };
    recorded = appendAction(recorded, action);
    current = move.state;
  }
  const ready = performAction(current, recorded, player, { type: 'ready' });
  return { state: ready.result.state, record: ready.record };
}

export type ReplayFailure = ActionError | 'truncated' | 'trailing-actions';
export type ReplayResult =
  | { ok: true; state: MatchState }
  | { ok: false; state: MatchState; index: number; reason: ReplayFailure };

/** Lässt eine laufende Kampfphase bis zu ihrem Ende laufen (nächste Planung oder Spielende). */
function finishCombat(state: MatchState): MatchState {
  let current = state;
  for (let guard = 0; guard < MAX_ROUNDS + 2 && current.phase === 'combat'; guard += 1) {
    current = advance(current, COMBAT_TICKS * TICK_MS);
  }
  return current;
}

/**
 * Spielt eine Aufzeichnung ohne Zeitlupe bis zum Ende nach. Die Kampfphasen laufen zwischen den Aktionen ab. Bricht
 * an der ersten regelwidrigen Aktion ab (`index` ist ihre Position), ebenso bei Aktionen nach dem Spielende oder wenn
 * die Aufzeichnung vor dem Spielende aufhört. Wirft nie.
 */
export function replayRecorded(record: RecordedMatch): ReplayResult {
  let state = createMatch(record.seed);
  for (let index = 0; index < record.actions.length; index += 1) {
    state = finishCombat(state);
    if (state.phase === 'over') return { ok: false, state, index, reason: 'trailing-actions' };
    const result = applyAction(state, record.actions[index]!);
    if (!result.ok) return { ok: false, state, index, reason: result.reason };
    state = result.state;
  }
  state = finishCombat(state);
  if (state.phase !== 'over') return { ok: false, state, index: record.actions.length, reason: 'truncated' };
  return { ok: true, state };
}

const VERSION_PREFIX = `v${RECORD_VERSION}`;
const TYPE_LETTER = { play: 'p', move: 'm', undo: 'u', sell: 's', discard: 'd', ready: 'r', upgrade: 'g', 'buy-lane': 'b', draw: 'w' } as const;

function encodeAction(action: RecordedAction): string {
  const head = `${TYPE_LETTER[action.type]}${action.round}${action.player}`;
  switch (action.type) {
    case 'play': {
      const index = CARD_DEFS.findIndex((def) => def.id === action.cardId);
      if (index < 0) throw new Error(`Unbekannte Karte: ${action.cardId}`);
      const target = action.minionId ?? action.line;
      const slot = action.slot === undefined || action.line === null ? '' : `-${action.slot}`;
      return `${head}-${index}${target === null ? '' : `-${target}`}${slot}`;
    }
    case 'discard': {
      const index = CARD_DEFS.findIndex((def) => def.id === action.cardId);
      if (index < 0) throw new Error(`Unbekannte Karte: ${action.cardId}`);
      return `${head}-${index}`;
    }
    case 'move':
      return `${head}-${action.minionId}-${action.line}-${action.slot}`;
    case 'undo':
    case 'sell':
      return `${head}-${action.minionId}`;
    case 'buy-lane':
      return `${head}-${action.line}`;
    case 'upgrade':
    case 'draw':
    case 'ready':
      return head;
  }
}

/** Kodiert die Aktionen einer Aufzeichnung als URL-tauglichen String (der Seed steht separat in `?replay=`). */
export function encodeMatch(record: RecordedMatch): string {
  return [VERSION_PREFIX, ...record.actions.map(encodeAction)].join('.');
}

/** Ganze Zahl in kanonischer Schreibweise (keine führenden Nullen, höchstens 6 Stellen), sonst `null`. */
function parseNumber(text: string): number | null {
  return /^(?:0|[1-9]\d{0,5})$/.test(text) ? Number(text) : null;
}

function decodeAction(token: string): RecordedAction | null {
  const [head = '', ...fields] = token.split('-');
  if (!/^[pmusdrgbw][1-9][01]$/.test(head)) return null;
  const round = Number(head[1]);
  const player = Number(head[2]) as PlayerIndex;
  if (round > MAX_ROUNDS) return null;
  const numbers: number[] = [];
  for (const field of fields) {
    const value = parseNumber(field);
    if (value === null) return null;
    numbers.push(value);
  }
  const [first = 0, second = 0, third = 0] = numbers;
  switch (head[0]) {
    case 'p': {
      if (numbers.length < 1 || numbers.length > 3) return null;
      const def = CARD_DEFS[first];
      if (!def) return null;
      if (def.target === 'minion') {
        return numbers.length === 2 ? { type: 'play', round, player, cardId: def.id, line: null, minionId: second } : null;
      }
      if (numbers.length >= 2 && second >= LINE_COUNT) return null;
      if (numbers.length === 3 && def.type !== 'summon') return null;
      return {
        type: 'play',
        round,
        player,
        cardId: def.id,
        line: numbers.length >= 2 ? second : null,
        ...(numbers.length === 3 ? { slot: third } : {}),
      };
    }
    case 'd': {
      const def = CARD_DEFS[first];
      return numbers.length === 1 && def ? { type: 'discard', round, player, cardId: def.id } : null;
    }
    case 'm':
      if (numbers.length !== 3 || second >= LINE_COUNT) return null;
      return { type: 'move', round, player, minionId: first, line: second, slot: third };
    case 'u':
      return numbers.length === 1 ? { type: 'undo', round, player, minionId: first } : null;
    case 's':
      return numbers.length === 1 ? { type: 'sell', round, player, minionId: first } : null;
    case 'b':
      return numbers.length === 1 && first < LINE_COUNT ? { type: 'buy-lane', round, player, line: first } : null;
    case 'g':
      return numbers.length === 0 ? { type: 'upgrade', round, player } : null;
    case 'w':
      return numbers.length === 0 ? { type: 'draw', round, player } : null;
    default:
      return numbers.length === 0 ? { type: 'ready', round, player } : null;
  }
}

/**
 * Liest den String aus `encodeMatch` zurück. Leere, zu lange, abgeschnittene, manipulierte oder aus einer anderen
 * Version stammende Daten und ein unzulässiger Seed ergeben `null`; es wird nie geworfen. Ob die Aktionen zu den Regeln
 * passen, prüft erst das Nachspielen (`replayRecorded`, Replay-Szene).
 */
export function decodeMatch(seed: number, text: string): RecordedMatch | null {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_MOVES_LENGTH) return null;
  const [version, ...tokens] = text.split('.');
  if (version !== VERSION_PREFIX || tokens.length > MAX_ACTIONS) return null;
  const actions: RecordedAction[] = [];
  for (const token of tokens) {
    const action = decodeAction(token);
    if (!action) return null;
    actions.push(action);
  }
  return { version: RECORD_VERSION, seed, actions };
}

/** Query-String zum Teilen: `?replay=<seed>&moves=<kodiert>`. */
export function shareQuery(record: RecordedMatch): string {
  return `?replay=${record.seed}&moves=${encodeMatch(record)}`;
}

/** Bricht einen langen Text ohne Leerzeichen (z. B. eine URL) in Zeilen zu höchstens `perLine` Zeichen. */
export function wrapText(text: string, perLine: number): string[] {
  const size = Math.max(1, Math.floor(perLine));
  const lines: string[] = [];
  for (let start = 0; start < text.length; start += size) lines.push(text.slice(start, start + size));
  return lines;
}
