import Phaser from 'phaser';
import { botPlan } from '../logic/bot';
import { getCardDef } from '../logic/cards';
import { LINE_LENGTH } from '../logic/combat';
import {
  advance,
  createMatch,
  HAND_LIMIT,
  LINE_COUNT,
  type MatchState,
  MAX_ROUNDS,
  playCard,
  setReady,
} from '../logic/match';

/** Spielfläche im Hochformat; Phaser skaliert sie per `Scale.FIT` auf den Bildschirm. */
export const VIEW = { width: 360, height: 640 };

const HUMAN = 0;
const BOT = 1;

const LAYOUT = {
  lineCenters: [60, 180, 300],
  lineHalfWidth: 50,
  enemyTowerY: 90,
  ownTowerY: 400,
  cardWidth: 66,
  cardHeight: 62,
  cardGap: 4,
  cardsPerRow: 5,
  handTop: 440,
  button: { x: 230, y: 592, width: 120, height: 40 },
};

const COLORS = { human: 0x4fc3f7, bot: 0xff7043, line: 0x1d2333, card: 0x2a3350, selected: 0xffd54a };

function cardRect(index: number): { x: number; y: number; width: number; height: number } {
  const column = index % LAYOUT.cardsPerRow;
  const row = Math.floor(index / LAYOUT.cardsPerRow);
  return {
    x: 7 + column * (LAYOUT.cardWidth + LAYOUT.cardGap),
    y: LAYOUT.handTop + row * (LAYOUT.cardHeight + LAYOUT.cardGap),
    width: LAYOUT.cardWidth,
    height: LAYOUT.cardHeight,
  };
}

function inside(rect: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Y-Koordinate einer Position (0 bis `LINE_LENGTH`) vom Tower des jeweiligen Spielers aus. */
function lineY(owner: number, position: number): number {
  const span = LAYOUT.ownTowerY - LAYOUT.enemyTowerY;
  const fraction = position / LINE_LENGTH;
  return owner === HUMAN ? LAYOUT.ownTowerY - fraction * span : LAYOUT.enemyTowerY + fraction * span;
}

/**
 * Spielbare Basis-Szene: liest Touch/Maus, ruft die Match-Logik auf und zeichnet das Ergebnis.
 * Spieler 0 (unten) ist der Mensch, Spieler 1 (oben) der lokale Bot.
 */
export class MainScene extends Phaser.Scene {
  private state: MatchState = createMatch(1);
  private graphics!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private textCursor = 0;
  /** Index der angetippten Karte, die auf eine Line wartet. */
  private selected: number | null = null;
  private message = '';

  constructor() {
    super('main');
  }

  /** Aktueller Spielzustand (nur lesen), z. B. für den Smoke-Test. */
  get current(): MatchState {
    return this.state;
  }

  create(): void {
    this.state = createMatch(Date.now() >>> 0);
    this.texts = [];
    this.selected = null;
    this.message = '';
    this.graphics = this.add.graphics();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleTap(pointer.worldX, pointer.worldY));
    this.render();
  }

  update(_time: number, deltaMs: number): void {
    if (this.state.phase === 'planning' && !this.state.ready[BOT]) {
      this.state = botPlan(this.state, BOT);
    }
    this.state = advance(this.state, deltaMs);
    if (this.state.phase !== 'planning') this.selected = null;
    this.render();
  }

  private handleTap(x: number, y: number): void {
    if (this.state.phase === 'over') {
      this.scene.restart();
      return;
    }
    if (this.state.phase !== 'planning') return;
    if (inside(LAYOUT.button, x, y)) {
      this.selected = null;
      this.message = '';
      this.state = setReady(this.state, HUMAN);
      return;
    }
    const hand = this.state.players[HUMAN].hand;
    for (let index = 0; index < hand.length; index += 1) {
      if (!inside(cardRect(index), x, y)) continue;
      this.message = '';
      const def = getCardDef(hand[index]!);
      if (def.target === 'none') {
        this.play(index);
      } else {
        this.selected = this.selected === index ? null : index;
      }
      return;
    }
    if (this.selected === null) return;
    const line = LAYOUT.lineCenters.findIndex((center) => Math.abs(x - center) <= LAYOUT.lineHalfWidth);
    if (line >= 0 && y >= LAYOUT.enemyTowerY - 30 && y <= LAYOUT.handTop - 4) this.play(this.selected, line);
  }

  private play(handIndex: number, line?: number): void {
    const result = playCard(this.state, HUMAN, handIndex, line);
    this.state = result.state;
    this.selected = null;
    this.message = result.ok ? '' : this.explain(result.reason);
  }

  private explain(reason: string): string {
    switch (reason) {
      case 'not-enough-energy':
        return 'Nicht genug Energie';
      case 'line-full':
        return 'Line ist voll';
      case 'max-level':
        return 'Line ist auf Höchststufe';
      default:
        return '';
    }
  }

  private label(
    text: string,
    x: number,
    y: number,
    options: { size?: number; color?: string; origin?: number; width?: number } = {},
  ): void {
    let object = this.texts[this.textCursor];
    if (!object) {
      object = this.add.text(0, 0, '', { fontFamily: 'sans-serif', align: 'center' });
      this.texts.push(object);
    }
    this.textCursor += 1;
    object
      .setText(text)
      .setPosition(x, y)
      .setFontSize(options.size ?? 12)
      .setColor(options.color ?? '#ffffff')
      .setOrigin(options.origin ?? 0.5, 0.5)
      .setWordWrapWidth(options.width ?? 0)
      .setVisible(true);
  }

  private render(): void {
    const g = this.graphics;
    g.clear();
    this.textCursor = 0;
    const state = this.state;
    const human = state.players[HUMAN];
    const bot = state.players[BOT];

    g.fillStyle(0x10141f, 1).fillRect(0, 0, VIEW.width, VIEW.height);

    const phaseText =
      state.phase === 'planning' ? 'Planung' : state.phase === 'combat' ? 'Kampf' : 'Ende';
    this.label(`Runde ${state.round}/${MAX_ROUNDS} · ${phaseText}`, VIEW.width / 2, 16, { size: 14 });
    this.label(`Gegner: ${bot.hand.length} Karten`, VIEW.width / 2, 40, { size: 11, color: '#9aa4bf' });

    for (let line = 0; line < LINE_COUNT; line += 1) {
      const center = LAYOUT.lineCenters[line]!;
      g.fillStyle(COLORS.line, 1).fillRect(
        center - 14,
        LAYOUT.enemyTowerY,
        28,
        LAYOUT.ownTowerY - LAYOUT.enemyTowerY,
      );
      if (this.selected !== null) {
        g.lineStyle(2, COLORS.selected, 0.6).strokeRect(
          center - LAYOUT.lineHalfWidth,
          LAYOUT.enemyTowerY - 30,
          LAYOUT.lineHalfWidth * 2,
          LAYOUT.ownTowerY - LAYOUT.enemyTowerY + 60,
        );
      }
      this.drawTower(center, LAYOUT.enemyTowerY, bot.lines[line]!, COLORS.bot, -1);
      this.drawTower(center, LAYOUT.ownTowerY, human.lines[line]!, COLORS.human, 1);
      this.label(`Line ${line + 1} · Stufe ${human.lines[line]!.level}`, center, LAYOUT.ownTowerY + 38, {
        size: 10,
        color: '#9aa4bf',
      });
    }

    for (const owner of [BOT, HUMAN]) {
      for (const minion of state.players[owner]!.minions) {
        const x = LAYOUT.lineCenters[minion.line]! + (minion.id % 2 === 0 ? 8 : -8);
        g.fillStyle(owner === HUMAN ? COLORS.human : COLORS.bot, 1).fillCircle(x, lineY(owner, minion.position), 7);
      }
    }

    // Handkarten
    human.hand.slice(0, HAND_LIMIT).forEach((id, index) => {
      const def = getCardDef(id);
      const rect = cardRect(index);
      const affordable = human.energy >= def.cost;
      g.fillStyle(COLORS.card, affordable ? 1 : 0.45).fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 6);
      if (this.selected === index) {
        g.lineStyle(3, COLORS.selected, 1).strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 6);
      }
      this.label(`${def.cost}`, rect.x + 9, rect.y + 9, { size: 12, color: '#ffd54a' });
      this.label(def.name, rect.x + rect.width / 2, rect.y + rect.height / 2 + 6, {
        size: 10,
        width: rect.width - 6,
      });
    });

    // Leiste unten
    this.label(`Energie ${human.energy}`, 70, 612, { size: 16, color: '#ffd54a' });
    if (this.message) this.label(this.message, 70, 632, { size: 10, color: '#ff8a80' });
    const button = LAYOUT.button;
    const waiting = state.phase !== 'planning' || state.ready[HUMAN];
    g.fillStyle(waiting ? 0x3a4256 : 0x2e7d32, 1).fillRoundedRect(button.x, button.y, button.width, button.height, 8);
    this.label(waiting ? 'Kampf läuft' : 'Bereit', button.x + button.width / 2, button.y + button.height / 2, {
      size: 14,
    });

    if (state.phase === 'over') {
      g.fillStyle(0x000000, 0.7).fillRect(0, 220, VIEW.width, 140);
      const text =
        state.outcome === 'draw' ? 'Unentschieden' : state.outcome === 'player0' ? 'Du gewinnst!' : 'Du verlierst';
      this.label(text, VIEW.width / 2, 270, { size: 26 });
      this.label('Tippen für ein neues Spiel', VIEW.width / 2, 320, { size: 13, color: '#9aa4bf' });
    }

    for (let index = this.textCursor; index < this.texts.length; index += 1) this.texts[index]!.setVisible(false);
  }

  private drawTower(
    x: number,
    y: number,
    line: { tower: { hp: number; maxHp: number } },
    color: number,
    direction: 1 | -1,
  ): void {
    const g = this.graphics;
    const { hp, maxHp } = line.tower;
    const top = y - 12;
    g.fillStyle(hp > 0 ? color : 0x444b5e, 1).fillRect(x - 28, top, 56, 24);
    g.fillStyle(0x000000, 0.5).fillRect(x - 28, top + (direction === 1 ? 26 : -8), 56, 5);
    g.fillStyle(0x66bb6a, 1).fillRect(x - 28, top + (direction === 1 ? 26 : -8), 56 * (hp / maxHp), 5);
    this.label(`${Math.ceil(hp)}`, x, y, { size: 12, color: '#10141f' });
  }
}
