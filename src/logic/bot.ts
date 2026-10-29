/**
 * Lokaler Gegner in zwei Stufen. „Leicht“ (`easy`) spielt nach einer festen Prioritätsliste (`PRIORITY`) ohne Zufall.
 * „Normal“ (`normal`) bewertet vorher die Lage (`assessSituation`: gefährdete Tower, gegnerische Minions je Lane, aktive
 * Synergien) und ordnet die Handkarten danach (`normalPriority`). Beide lesen nur den eigenen Spieler und die sichtbare
 * Lage (kein Blick auf die Hand des Gegners). Zufall gibt es nur bei „Normal“, nur über `nextRandom` und nur für
 * Gleichstände; der Seed folgt aus dem Matchzustand (`botSeed`), gleiche Eingabe liefert also denselben Zug.
 */
import { getCardDef } from './cards';
import { nextRandom } from './game-state';
import { laneUnlockLevel } from './lanes';
import type { Minion } from './combat';
import {
  buyLane,
  DISCARD_ENERGY,
  discardCard,
  DRAW_COST,
  drawCard,
  HAND_LIMIT,
  isLaneOpen,
  LANE_COST,
  MAX_ENERGY,
  MAX_ROUNDS,
  type MatchState,
  openLanes,
  type PlayerIndex,
  playCard,
  setReady,
  specializeTarget,
  SPECIALIZE_MIN_LEVEL,
  UPGRADE_COST,
  upgradeField,
} from './match';
import { firstFreeSlot } from './placement';
import { type ActiveSynergy, SYNERGY_DEFS } from './synergies';

/** Bot-Stufen: `easy` = feste Prioritätsliste (bisheriger Bot), `normal` = Lagebewertung. */
export const BOT_LEVELS = ['easy', 'normal'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
/** Anzeigenamen der Stufen. */
export const BOT_LEVEL_NAMES: Readonly<Record<BotLevel, string>> = { easy: 'Leicht', normal: 'Normal' };

/**
 * Wirtschaftsaktionen, die neben den Karten-IDs in einer Prioritätsliste stehen dürfen: Feld-Upgrade, Lane kaufen
 * (die niedrigste kaufbare) und eine Karte ziehen. Fehlen sie in der Liste, nutzt der Bot sie nicht.
 */
export const ECONOMY_ACTIONS = ['upgrade', 'buy-lane', 'draw'] as const;
export type EconomyAction = (typeof ECONOMY_ACTIONS)[number];

/** Reihenfolge, in der der Bot Karten und Wirtschaftsaktionen bevorzugt. */
export const PRIORITY = [
  'upgrade',
  'summon-minion',
  'summon-archer',
  'summon-healer',
  'summon-destroyer',
  'summon-scout',
  'tower-hp',
  'buy-lane',
  'minion-upgrade-line',
  'summon-brute',
  'summon-mage',
  'lane-buff',
  'buff-minion',
  'tower-damage',
  'summon-guard',
  'lane-shield',
  'tower-armor',
  'tower-lightning',
  'tower-shield',
  'minion-upgrade-elite',
  'minion-upgrade-all',
  'draw',
];

/** Bedrohung ab der ein Tower auch bei vielen HP als gefährdet gilt (etwa drei einfache Minions oder ein Brocken). */
export const THREAT_LIMIT = 90;
/** Eigene Stärke einer Lane, ab der sie als stark gilt (etwa zwei einfache Minions), sofern sie die Bedrohung übertrifft. */
export const STRONG_LIMIT = 70;

/** Bewertung einer Lane des Bots, siehe `assessSituation`. */
export interface LaneAssessment {
  line: number;
  /** Gekaufte Lane (nur auf ihr lassen sich Karten spielen). */
  open: boolean;
  /** Summe aus HP und Schild der lebenden Tower. */
  towerHp: number;
  /** Lebende gegnerische Minions in der Lane. */
  enemyMinions: number;
  /** Summe der Stärke der gegnerischen Minions in der Lane. */
  threat: number;
  /** `threat - towerHp`: je größer, desto gefährdeter (negativ = Tower hält mehr aus, als droht). */
  danger: number;
  /** Gegner in der Lane und `threat` übersteigt die Tower-HP oder erreicht `THREAT_LIMIT`. */
  endangered: boolean;
  /** Lebende eigene Minions in der Lane. */
  ownMinions: number;
  /** Summe der Stärke der eigenen Minions. */
  ownPower: number;
  /** Nicht gefährdet, eigene Stärke ab `STRONG_LIMIT` und größer als die Bedrohung. */
  strong: boolean;
}

/** Lage des Bots: Bewertung je Lane (Index = Lane) und Synergien. */
export interface Situation {
  lanes: LaneAssessment[];
  /** Aktive Synergien des Bots in dieser Runde (`player.synergies`). */
  synergies: ActiveSynergy[];
  /** Karten-IDs, die jetzt eine noch nicht aktive Synergie auslösen würden (Partnerkarte ist in `player.played`). */
  triggers: string[];
  /** Karten-IDs von Synergien, die schon aktiv sind; weitere davon erhalten die Synergie. */
  keeps: string[];
}

/** Stärke eines Minions: Schaden zählt fünffach, HP zu einem Viertel (damit sie mit Tower-HP vergleichbar ist). */
const minionStrength = (m: Minion): number => m.damage * 5 + m.hp / 4;

/**
 * Bewertet die Lage von `playerIndex` allein aus dem sichtbaren Zustand: gegnerische Minions in einer Lane bedrohen die
 * Tower derselben Lane. Liest nur, kopiert den Zustand nicht und nutzt keinen Zufall.
 */
export function assessSituation(state: MatchState, playerIndex: PlayerIndex): Situation {
  const player = state.players[playerIndex];
  const enemy = state.players[playerIndex === 0 ? 1 : 0];
  const sum = (minions: Minion[]) => minions.reduce((total, m) => total + minionStrength(m), 0);
  const lanes = player.lines.map((lane, line): LaneAssessment => {
    const foes = enemy.minions.filter((m) => m.line === line && m.hp > 0);
    const own = player.minions.filter((m) => m.line === line && m.hp > 0);
    const towerHp = lane.towers.reduce((total, tower) => total + Math.max(0, tower.hp) + (tower.shield ?? 0), 0);
    const threat = sum(foes);
    const ownPower = sum(own);
    const open = isLaneOpen(player, line);
    const endangered = open && foes.length > 0 && (threat > towerHp || threat >= THREAT_LIMIT);
    return {
      line,
      open,
      towerHp,
      enemyMinions: foes.length,
      threat,
      danger: threat - towerHp,
      endangered,
      ownMinions: own.length,
      ownPower,
      strong: open && !endangered && ownPower >= STRONG_LIMIT && ownPower > threat,
    };
  });
  const active = new Set(player.synergies.map((s) => s.id));
  const played = new Set(player.played.map((p) => p.cardId));
  const triggers = new Set<string>();
  const keeps = new Set<string>();
  for (const def of SYNERGY_DEFS) {
    const [a, b] = def.cards;
    if (active.has(def.id)) {
      keeps.add(a);
      keeps.add(b);
    } else {
      // Fehlt noch eine der beiden Karten und die andere ist schon gespielt, löst die fehlende die Synergie aus.
      if (played.has(b)) triggers.add(a);
      if (played.has(a)) triggers.add(b);
    }
  }
  return { lanes, synergies: [...player.synergies], triggers: [...triggers], keeps: [...keeps] };
}

/** Karten, die Tower oder Lane schützen; dazu zählen alle Beschwörungen. */
const DEFENSE_IDS: ReadonlySet<string> = new Set(['tower-hp', 'tower-shield', 'tower-armor', 'lane-shield']);
/** Karten, die angreifen oder Minions stärken. */
const ATTACK_IDS: ReadonlySet<string> = new Set([
  'tower-damage',
  'tower-lightning',
  'lane-buff',
  'buff-minion',
  'minion-upgrade-line',
  'minion-upgrade-all',
  'minion-upgrade-elite',
]);

/** Punkte für „Normal“: Grundwert, Zuschläge nach Lage und die Wirtschaftsaktionen. */
const SCORE = {
  base: 10,
  defenseEndangered: 40,
  attackStrong: 20,
  synergyTrigger: 15,
  synergyKeep: 5,
  upgrade: 25,
  buyLane: 12,
} as const;

const isDefense = (id: string): boolean => DEFENSE_IDS.has(id) || getCardDef(id).type === 'summon';

/** Punkte einer Handkarte in der gegebenen Lage. */
function cardScore(id: string, situation: Situation): number {
  let score: number = SCORE.base;
  if (isDefense(id) && situation.lanes.some((lane) => lane.endangered)) score += SCORE.defenseEndangered;
  if (ATTACK_IDS.has(id) && situation.lanes.some((lane) => lane.strong)) score += SCORE.attackStrong;
  if (situation.triggers.includes(id)) score += SCORE.synergyTrigger;
  else if (situation.keeps.includes(id)) score += SCORE.synergyKeep;
  return score;
}

/**
 * Seed für die Gleichstände von „Normal“, allein aus dem Matchzustand: Match-Seed, Runde, Spieler und die Größen, die
 * sich mit jedem Zug ändern (Energie, Hand, gespielte Karten, Minions). Gleicher Zustand ergibt denselben Seed.
 */
export function botSeed(state: MatchState, playerIndex: PlayerIndex): number {
  const player = state.players[playerIndex];
  return (
    (Math.imul(state.seed, 31) +
      state.round * 1009 +
      playerIndex * 7919 +
      player.energy * 101 +
      player.hand.length * 17 +
      player.played.length * 7 +
      player.minions.length * 3) >>>
    0
  );
}

/**
 * Reihenfolge für „Normal“: die Handkarten (jede ID einmal) und die Wirtschaftsaktionen `upgrade` und `buy-lane` nach
 * Punkten der Lage (siehe `SCORE`), bei Gleichstand nach einem Los aus `nextRandom(seed)`; `draw` steht immer zuletzt.
 * Die Wirtschaftsaktionen laufen danach wie bei „Leicht“ über `tryEconomy`. Gleiche Eingabe ergibt dieselbe Liste.
 */
export function normalPriority(
  state: MatchState,
  playerIndex: PlayerIndex,
  seed: number,
  situation: Situation = assessSituation(state, playerIndex),
): string[] {
  const hand = [...new Set(state.players[playerIndex].hand)].sort();
  const entries = [
    ...hand.map((id) => ({ id, score: cardScore(id, situation) })),
    { id: 'upgrade', score: SCORE.upgrade },
    { id: 'buy-lane', score: SCORE.buyLane },
  ];
  let random = seed >>> 0;
  const ranked = entries.map((entry) => {
    const next = nextRandom(random);
    random = next.seed;
    return { ...entry, tie: next.value };
  });
  ranked.sort((x, y) => y.score - x.score || x.tie - y.tie);
  return [...ranked.map((entry) => entry.id), 'draw'];
}

/** Ziel-Minion einer Karte: der lebende eigene mit dem meisten `maxHp` (bei Gleichstand die kleinste Id), oder `undefined`. */
function chooseMinion(state: MatchState, playerIndex: PlayerIndex): number | undefined {
  const size = (m: Minion) => m.maxHp ?? m.hp;
  return state.players[playerIndex].minions
    .filter((m) => m.hp > 0)
    .reduce<Minion | undefined>(
      (best, m) => (best === undefined || size(m) > size(best) || (size(m) === size(best) && m.id < best.id) ? m : best),
      undefined,
    )?.id;
}

/**
 * Ziel-Lane einer Karte (die freie mit dem kleinsten Wert, bei Gleichstand die niedrigste), oder `undefined`. Mit
 * `situation` („Normal“) wählen Beschwörungen und Tower-Upgrades die gefährdetste Lane (größtes `danger`, bei Gleichstand
 * die mit weniger eigenen Minions), Lane-Karten je nach Wirkung: Schild die gefährdetste, Buff die stärkste Lane.
 */
function chooseLine(
  state: MatchState,
  playerIndex: PlayerIndex,
  cardId: string,
  situation: Situation | null,
): number | undefined {
  const player = state.players[playerIndex];
  const def = getCardDef(cardId);
  const lines = openLanes(player);
  const minions = (line: number) => player.minions.filter((m) => m.line === line).length;
  const pick = (candidates: number[], score: (line: number) => number): number | undefined =>
    candidates.reduce<number | undefined>(
      (best, line) => (best === undefined || score(line) < score(best) ? line : best),
      undefined,
    );
  const assessed = (line: number): LaneAssessment => situation!.lanes[line]!;
  const mostDanger = (line: number) => -assessed(line).danger * 1000 + assessed(line).ownMinions;
  switch (def.type) {
    case 'summon':
      return pick(
        lines.filter((line) => firstFreeSlot(player.minions, line, player.lines[line]!.towers) !== undefined),
        situation ? mostDanger : minions,
      );
    case 'lane-card':
      // Nur Lanes mit eigenen Minions und freiem Lane-Slot; die mit den meisten Minions, bei Gleichstand die niedrigste.
      return pick(
        lines.filter((line) => minions(line) > 0 && player.lines[line]!.laneEffect === undefined),
        !situation
          ? (line) => -minions(line)
          : def.effect === 'shield'
            ? mostDanger
            : (line) => -assessed(line).ownPower,
      );
    case 'tower-upgrade':
      return pick(
        lines,
        situation ? mostDanger : (line) => player.lines[line]!.towers.reduce((sum, tower) => sum + tower.hp, 0),
      );
    case 'tower-specialize':
      // Nur Lanes ab dem Mindest-Level mit freiem Tower; die mit dem höchsten Level, bei Gleichstand die niedrigste.
      return pick(
        lines.filter(
          (line) =>
            laneUnlockLevel(line) >= SPECIALIZE_MIN_LEVEL && specializeTarget(player.lines[line]!.towers) !== undefined,
        ),
        (line) => -laneUnlockLevel(line),
      );
    case 'minion-upgrade':
      return pick(lines, (line) => -player.lines[line]!.bonus.hp);
  }
}

/**
 * Ein einzelner Zug des Bots: gespielte Karte, Zielline und Ziel-Minion (`undefined` ohne Ziel) und der Zustand danach.
 * Mit `discard` hat der Bot die Karte abgeworfen statt gespielt (`line` ist dann `undefined`). Mit `economy` war es
 * eine Wirtschaftsaktion: `cardId` ist dann leer, bei `buy-lane` steht die gekaufte Lane in `line`.
 */
export interface BotMove {
  cardId: string;
  line: number | undefined;
  minionId?: number;
  discard?: true;
  economy?: EconomyAction;
  state: MatchState;
}

/**
 * Führt die Wirtschaftsaktion `id` aus, falls sie in `priority` vorgesehen und jetzt sinnvoll und legal ist; sonst
 * `null`. Sinnvoll heißt: Upgrade und Lane-Kauf nur, solange ihr Preis bis zum Spielende wieder hereinkommt; Ziehen nur,
 * wenn nach dem Ziehen noch Energie für eine Karte bleibt.
 */
function tryEconomy(state: MatchState, playerIndex: PlayerIndex, id: string): BotMove | null {
  const player = state.players[playerIndex];
  const roundsLeft = MAX_ROUNDS - state.round;
  const done = (action: EconomyAction, result: ReturnType<typeof upgradeField>, line?: number): BotMove | null =>
    result.ok ? { cardId: '', line, economy: action, state: result.state } : null;
  switch (id) {
    case 'upgrade':
      return roundsLeft >= UPGRADE_COST ? done('upgrade', upgradeField(state, playerIndex)) : null;
    case 'buy-lane': {
      if (roundsLeft < LANE_COST) return null;
      const lane = player.lines.findIndex((l, index) => !l.bought && player.level >= laneUnlockLevel(index));
      return lane < 0 ? null : done('buy-lane', buyLane(state, playerIndex, lane), lane);
    }
    case 'draw':
      return player.energy > DRAW_COST && player.hand.length < HAND_LIMIT
        ? done('draw', drawCard(state, playerIndex))
        : null;
    default:
      return null;
  }
}

/** Spielt die Handkarte `id`, falls der Bot sie jetzt legal spielen kann; sonst `null`. */
function tryPlay(state: MatchState, playerIndex: PlayerIndex, id: string, situation: Situation | null): BotMove | null {
  const handIndex = state.players[playerIndex].hand.indexOf(id);
  if (handIndex < 0) return null;
  const def = getCardDef(id);
  const line = def.target === 'line' ? chooseLine(state, playerIndex, id, situation) : undefined;
  if (def.target === 'line' && line === undefined) return null;
  const minionId = def.target === 'minion' ? chooseMinion(state, playerIndex) : undefined;
  if (def.target === 'minion' && minionId === undefined) return null;
  const result = playCard(state, playerIndex, handIndex, line, undefined, minionId);
  return result.ok ? { cardId: id, line, ...(minionId === undefined ? {} : { minionId }), state: result.state } : null;
}

/** Kopie des Zustands, in der `playerIndex` die Energie `energy` (höchstens `MAX_ENERGY`) hat. */
function withEnergy(state: MatchState, playerIndex: PlayerIndex, energy: number): MatchState {
  const copy = structuredClone(state);
  copy.players[playerIndex].energy = Math.min(MAX_ENERGY, energy);
  return copy;
}

/**
 * Wirft eine nutzlose Karte ab, wenn die dafür erhaltene Energie eine bevorzugte Karte spielbar macht, die jetzt knapp
 * nicht bezahlbar ist. Nutzlos ist eine Karte, die nicht in `priority` steht oder auch mit voller Energie kein Ziel hat.
 * Sonst `null`.
 */
function discardStep(
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[],
  situation: Situation | null,
): BotMove | null {
  const player = state.players[playerIndex];
  if (player.energy >= MAX_ENERGY) return null;
  const boosted = withEnergy(state, playerIndex, player.energy + DISCARD_ENERGY);
  const wanted = priority.find((id) => player.hand.includes(id) && tryPlay(boosted, playerIndex, id, situation) !== null);
  if (wanted === undefined) return null;
  const full = withEnergy(state, playerIndex, MAX_ENERGY);
  const handIndex = player.hand.findIndex(
    (id) => id !== wanted && (!priority.includes(id) || tryPlay(full, playerIndex, id, situation) === null),
  );
  if (handIndex < 0) return null;
  // Die Karte steht auf der Hand und der Bot plant noch (sonst wäre `wanted` nicht spielbar): das Abwerfen gelingt immer.
  const { state: next } = discardCard(state, playerIndex, handIndex);
  return { cardId: player.hand[handIndex]!, line: undefined, discard: true, state: next };
}

/** Gemeinsamer Zug beider Stufen; `situation` ist bei „Leicht“ `null` (Zielwahl wie bisher). */
function stepWith(
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[],
  situation: Situation | null,
): BotMove | null {
  for (const id of priority) {
    // Ziehen ist nur der Rückfall (siehe unten), egal wo es in der Liste steht.
    if (id === 'draw') continue;
    const move = tryEconomy(state, playerIndex, id) ?? tryPlay(state, playerIndex, id, situation);
    if (move) return move;
  }
  // Ziehen nur, wenn sonst nichts spielbar ist. Jedes Ziehen kostet Energie, daher endet die Planung auch dann, wenn
  // Abwerfen (+Energie) und Ziehen (−Energie) einander abwechseln könnten.
  const drawn = priority.includes('draw') ? tryEconomy(state, playerIndex, 'draw') : null;
  return drawn ?? discardStep(state, playerIndex, priority, situation);
}

/**
 * Spielt die nächste Karte des Bots („Leicht“) nach `priority`; geht das nicht, wirft er gegebenenfalls eine nutzlose
 * Karte ab (siehe `discardStep`). `null`, wenn er nichts mehr tun kann.
 */
export function botStep(
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[] = PRIORITY,
): BotMove | null {
  return stepWith(state, playerIndex, priority, null);
}

/**
 * Nächster Zug der Stufe `level`. „Leicht“ ist exakt `botStep` mit `priority`; „Normal“ ignoriert `priority`, bewertet
 * die Lage einmal und spielt nach `normalPriority` (Seed: `botSeed`) mit lagebezogener Zielwahl.
 */
export function botStepFor(
  level: BotLevel,
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[] = PRIORITY,
): BotMove | null {
  if (level === 'easy') return botStep(state, playerIndex, priority);
  const situation = assessSituation(state, playerIndex);
  return stepWith(state, playerIndex, normalPriority(state, playerIndex, botSeed(state, playerIndex), situation), situation);
}

/**
 * Spielt die Karten des Bots für diese Runde und meldet ihn bereit. `priority` ist die Kartenreihenfolge
 * (Standard: `PRIORITY`); Karten, die darin fehlen, spielt der Bot nicht.
 */
export function botPlan(
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[] = PRIORITY,
): MatchState {
  let current = state;
  for (let move = botStep(current, playerIndex, priority); move; move = botStep(current, playerIndex, priority)) {
    current = move.state;
  }
  return setReady(current, playerIndex);
}

/** Wie `botPlan`, aber für die Stufe `level` (siehe `botStepFor`); „Leicht“ ist identisch zu `botPlan`. */
export function botPlanFor(
  level: BotLevel,
  state: MatchState,
  playerIndex: PlayerIndex,
  priority: readonly string[] = PRIORITY,
): MatchState {
  let current = state;
  for (let move = botStepFor(level, current, playerIndex, priority); move; move = botStepFor(level, current, playerIndex, priority)) {
    current = move.state;
  }
  return setReady(current, playerIndex);
}
