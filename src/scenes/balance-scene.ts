import Phaser from 'phaser';
import { buildReport, type BalanceReport, type MatchResult, simulateMatch, strategiesForSeed } from '../logic/balance-sim';
import { getCardDef } from '../logic/cards';
import { VIEW } from './main-scene';

/** Matches pro Simulation (Standard) und pro Frame, damit der Canvas nicht blockiert. */
const MATCH_COUNT = 200;
const MATCHES_PER_FRAME = 4;

const ROWS_TOP = 164;
const ROW_HEIGHT = 26;
/** Rechte Kanten der Zahlenspalten: Matches, Einsätze, Sieg, Remis, Niederlage, Abweichung. */
const COLUMNS = [156, 192, 238, 276, 314, 354];
const BUTTONS = {
  again: { x: 10, y: 592, width: 160, height: 40, label: 'Neu simulieren' },
  back: { x: 190, y: 592, width: 160, height: 40, label: 'Zurück' },
};
const SORT_HEADER = { x: 200, y: 140, width: 44, height: 20 };

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const signed = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}`;

/**
 * Dev-Szene (nur mit `npm run dev`, Aufruf `?scene=balance`): simuliert Bot-gegen-Bot-Matches blockweise und zeigt die
 * Kennzahlen. Liest nur Eingaben, ruft `balance-sim` auf und zeichnet.
 */
export class BalanceScene extends Phaser.Scene {
  private results: MatchResult[] = [];
  private startSeed = 1;
  private nextStartSeed = 1;
  private done = false;
  private report: BalanceReport | null = null;
  private sortDescending = true;
  private graphics!: Phaser.GameObjects.Graphics;
  private barGraphics!: Phaser.GameObjects.Graphics;
  /** Die Tabelle wird nur neu gebaut, wenn sich etwas an ihr ändert (nicht in jedem Frame). */
  private dirty = true;
  private dynamicTexts: Phaser.GameObjects.Text[] = [];
  private progressText!: Phaser.GameObjects.Text;

  constructor() {
    super('balance');
  }

  /** Aktueller Bericht (nur lesen, z. B. für den Smoke-Test); `null`, solange die Simulation läuft. */
  get current(): BalanceReport | null {
    return this.report;
  }

  create(): void {
    this.dynamicTexts = [];
    this.graphics = this.add.graphics();
    this.barGraphics = this.add.graphics();
    this.text(VIEW.width / 2, 8, 'Balancing (Dev)', 16, '#ffd54a').setOrigin(0.5, 0);
    this.progressText = this.text(8, 118, '', 11, '#cfd8dc');
    this.text(
      8,
      ROWS_TOP + 7 * ROW_HEIGHT + 8,
      'Bot-Statistik: beide Seiten spielen denselben Bot mit zufälliger Kartenreihenfolge, kein\nSpielerverhalten. Kartenwerte sind korreliert (gleiches Deck für beide).',
      9,
      '#90a4ae',
    );
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer.worldX, pointer.worldY));
    this.startSimulation(this.nextStartSeed);
  }

  update(): void {
    if (!this.done) {
      for (let index = 0; index < MATCHES_PER_FRAME && this.results.length < MATCH_COUNT; index += 1) {
        const seed = (this.startSeed + this.results.length) >>> 0;
        this.results.push(simulateMatch(seed, strategiesForSeed(seed)));
      }
      this.done = this.results.length >= MATCH_COUNT;
      if (this.done) {
        this.report = buildReport(this.results, this.startSeed);
        this.nextStartSeed = this.startSeed + MATCH_COUNT;
        this.dirty = true;
      }
    }
    this.renderProgress();
    if (this.dirty) this.renderTable();
  }

  private startSimulation(startSeed: number): void {
    this.startSeed = startSeed;
    this.results = [];
    this.done = false;
    this.report = null;
    this.dirty = true;
  }

  private onPointerDown(x: number, y: number): void {
    const hit = (rect: { x: number; y: number; width: number; height: number }) =>
      x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    if (hit(BUTTONS.back)) this.scene.start('main');
    else if (hit(BUTTONS.again) && this.done) this.startSimulation(this.nextStartSeed);
    else if (hit(SORT_HEADER)) {
      this.sortDescending = !this.sortDescending;
      this.dirty = true;
    }
  }

  private text(x: number, y: number, content: string, size: number, color = '#ffffff'): Phaser.GameObjects.Text {
    return this.add.text(x, y, content, { fontFamily: 'sans-serif', fontSize: `${size}px`, color });
  }

  private renderProgress(): void {
    const count = this.results.length;
    this.progressText.setText(`Seeds ${this.startSeed}–${this.startSeed + MATCH_COUNT - 1}   ${count}/${MATCH_COUNT} Matches`);
    this.barGraphics.clear();
    this.barGraphics.fillStyle(0x1d2333).fillRect(8, 134, 344, 4);
    this.barGraphics.fillStyle(0x66bb6a).fillRect(8, 134, (344 * count) / MATCH_COUNT, 4);
  }

  private renderTable(): void {
    this.dirty = false;
    const g = this.graphics;
    g.clear();
    for (const text of this.dynamicTexts) text.destroy();
    this.dynamicTexts = [];
    const add = (x: number, y: number, content: string, size = 11, color = '#ffffff', right = false) => {
      const text = this.text(x, y, content, size, color);
      if (right) text.setOrigin(1, 0);
      this.dynamicTexts.push(text);
    };

    const end = this.startSeed + MATCH_COUNT - 1;

    const report = this.report;
    if (report) {
      add(8, 32, `Matches: ${report.totalMatches}   Seeds ${report.startSeed}–${end}`);
      add(8, 48, `Sieg Spieler 0: ${percent(report.winRatePlayer0)}   Spieler 1: ${percent(report.winRatePlayer1)}   Remis: ${percent(report.drawRate)}`);
      add(8, 64, `Runden Ø ${report.avgRounds.toFixed(2)} (min ${report.minRounds}, max ${report.maxRounds})`);
      add(8, 80, `Ende durch Tower: ${percent(report.towerKillShare)}   nach Rundengrenze: ${percent(report.roundLimitShare)}`);
      add(8, 96, `Basis-Siegquote (je Spieler): ${percent(report.baselineWinRate)}`);

      add(6, 144, 'Karte', 10, '#90a4ae');
      ['Mat.', 'Eins.', this.sortDescending ? 'Sieg ▼' : 'Sieg ▲', 'Rem.', 'Nied.', 'Δ'].forEach((label, index) =>
        add(COLUMNS[index]!, 144, label, 10, index === 2 ? '#ffd54a' : '#90a4ae', true),
      );
      const sorted = [...report.cards].sort((a, b) => (this.sortDescending ? b.winRate - a.winRate : a.winRate - b.winRate));
      sorted.forEach((card, row) => {
        const y = ROWS_TOP + row * ROW_HEIGHT;
        g.fillStyle(0x2a3350).fillRect(6, y + 16, 100, 3);
        g.fillStyle(0x4fc3f7).fillRect(6, y + 16, 100 * card.winRate, 3);
        add(6, y, getCardDef(card.cardId).name, 11);
        const delta = card.deltaToBaseline;
        const values = [
          String(card.matchesWithCard),
          String(card.plays),
          percent(card.winRate),
          percent(card.drawRate),
          percent(card.lossRate),
          signed(delta),
        ];
        values.forEach((value, index) =>
          add(COLUMNS[index]!, y, value, 10, index === 5 ? (delta >= 0 ? '#66bb6a' : '#ef5350') : '#ffffff', true),
        );
      });
    }

    for (const [key, button] of Object.entries(BUTTONS)) {
      const enabled = key !== 'again' || this.done;
      g.fillStyle(enabled ? 0x2a3350 : 0x161b2b).fillRect(button.x, button.y, button.width, button.height);
      add(button.x + button.width / 2 - button.label.length * 3.3, button.y + 12, button.label, 13, enabled ? '#ffffff' : '#607d8b');
    }
  }
}
