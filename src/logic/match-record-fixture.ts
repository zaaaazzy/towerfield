/**
 * Testhilfe für `match-record.test.ts` und `replay.test.ts`: spielt ein vollständiges Match, in dem Spieler 0 wie ein
 * Mensch zieht (abwerfen, spielen auf gewählte Turm-Slots, verschieben, zurücknehmen, bereit) und der Bot per
 * `botPlanRecorded` mitschreibt.
 */
import { getCardDef } from './cards';
import { unlockedLanes } from './lanes';
import { advance, createMatch, type MatchState } from './match';
import {
  type ActionBody,
  botPlanRecorded,
  createRecord,
  performAction,
  type RecordedMatch,
} from './match-record';
import { freeSlots } from './placement';

export interface PlayedMatch {
  state: MatchState;
  record: RecordedMatch;
}

/** Spielt `seed` bis zum Ende und zeichnet dabei alle Aktionen beider Spieler auf. */
export function playScriptedMatch(seed: number): PlayedMatch {
  let state = createMatch(seed);
  let record = createRecord(seed);
  const act = (body: ActionBody): boolean => {
    const outcome = performAction(state, record, 0, body);
    state = outcome.result.state;
    record = outcome.record;
    return outcome.result.ok;
  };
  for (let guard = 0; guard < 1000 && state.phase !== 'over'; guard += 1) {
    if (state.phase === 'planning') {
      // Nur freie Lanes (aufsteigend nach Index); das Feld wächst, sobald „Lane ausbauen“ gespielt wird.
      const freeLanes = () => unlockedLanes(state.players[0].level).sort((a, b) => a - b);
      // In geraden Runden wirft der Mensch zuerst seine letzte Karte ab.
      if (state.round % 2 === 0 && state.players[0].hand.length > 0) {
        act({ type: 'discard', cardId: state.players[0].hand.at(-1)! });
      }
      for (const cardId of [...state.players[0].hand]) {
        const def = getCardDef(cardId);
        const lanes = freeLanes();
        const line = def.target === 'line' ? lanes[state.round % lanes.length]! : null;
        const minionId = state.players[0].minions.find((m) => m.hp > 0)?.id;
        // Beschwörungen in ungeraden Runden auf den letzten freien Turm-Slot der Lane, sonst auf den ersten.
        const slots = line === null ? [] : freeSlots(state.players[0].minions, line, state.players[0].lines[line]!.towers);
        const slot = def.type === 'summon' && state.round % 2 === 1 ? slots.at(-1) : undefined;
        act({
          type: 'play',
          cardId,
          line,
          ...(def.target === 'minion' && minionId !== undefined ? { minionId } : {}),
          ...(slot === undefined ? {} : { slot }),
        });
      }
      const placements = state.players[0].placements;
      if (placements.length > 0) {
        // Verschieben auf den ersten freien Turm-Slot einer anderen Lane kostet Energie (schlägt ohne sie fehl).
        const lanes = freeLanes();
        const line = lanes[(state.round + 1) % lanes.length]!;
        const slot = freeSlots(state.players[0].minions, line, state.players[0].lines[line]!.towers)[0];
        if (slot !== undefined) act({ type: 'move', minionId: placements[0]!.minionId, line, slot });
      }
      if (state.round % 2 === 0 && placements.length > 1) {
        act({ type: 'undo', minionId: placements[placements.length - 1]!.minionId });
      }
      act({ type: 'ready' });
      const planned = botPlanRecorded(state, record, 1);
      state = planned.state;
      record = planned.record;
    } else {
      state = advance(state, 1000);
    }
  }
  return { state, record };
}
