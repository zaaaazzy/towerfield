# Anwendung: Iso-Umrechnung, Kamera und Slot-Platzierung

Diese Seite beschreibt, was der Auftrag „Designkonzept: Karten, Minions, Slots und Iso-Map“ im Code umgesetzt hat und
wie man es verwendet. Die Regeln und Begründungen stehen im [Designkonzept](designkonzept.md) (Abschnitte 5 und 6).

## Stand

| Bereich | Datei | Zustand |
| --- | --- | --- |
| Welt ↔ Iso, Kartengrenzen, Kamera, Zoom | `src/logic/iso.ts` (+ `iso.test.ts`) | fertig, getestet |
| Slots und Platzierungsregeln | `src/logic/placement.ts` (+ `placement.test.ts`) | fertig, getestet |
| Slot-Parameter in `playCard`, neu `moveMinion`, `undoSummon`, `placements` | `src/logic/match.ts` | fertig, getestet |
| Soll-Konstanten aus Designkonzept Abschnitt 3 | `match.ts`, `combat.ts` | **nicht** übernommen (Folgeauftrag 4) |
| Szene nutzt `iso.ts` und `placement.ts` | `src/scenes/main-scene.ts` | **nicht** angebunden (Folgeaufträge 1–3) |

## Iso-Umrechnung (`src/logic/iso.ts`)

Reine Funktionen ohne Phaser. Weltraum: Kachel-Einheiten, `x` quer zu den Lines, `y` entlang der Lines.
Bildschirmraum: Pixel bei Zoom 1.

- `worldToScreen(world)` und `screenToWorld(screen)` sind exakte Umkehrungen (Kacheln `TILE_WIDTH` 64 × `TILE_HEIGHT` 32).
- `linePointToWorld(playerIndex, line, position)` setzt eine Line-Position (0–100, vom eigenen Tower weg) in die Welt.
  Spieler 0 steht unten (`y = WORLD_SIZE.y`), Spieler 1 oben (`y = 0`). Eine Kachel = `UNITS_PER_TILE` (5) Line-Einheiten,
  eine Line ist `LANE_TILES` (4) Kacheln breit; die Welt ist 12 × 20 Kacheln.
- `mapBounds()` liefert das umschließende Rechteck der Karte bei Zoom 1 (1024 × 512 px).
- `clampZoom(zoom)` begrenzt auf `MIN_ZOOM` 0,35 bis `MAX_ZOOM` 2. Bei 0,35 passt die Kartenbreite auf 360 px.
- `clampScroll(scroll, view, zoom, bounds?)` hält den Ausschnitt in der Karte. Ist die Karte kleiner als der Ausschnitt,
  wird sie zentriert.

Beispiel (Szene, beim Ziehen):

```ts
import { clampScroll, clampZoom, screenToWorld } from '../logic/iso';

zoom = clampZoom(zoom * pinchFactor);
scroll = clampScroll({ x: scroll.x - dx / zoom, y: scroll.y - dy / zoom }, { width: 360, height: 380 }, zoom);
const tap = screenToWorld({ x: screenX / zoom + scroll.x, y: screenY / zoom + scroll.y });
```

Der Scroll-Offset ist die linke obere Ecke des Ausschnitts im Bildschirmraum bei Zoom 1.

## Slot-Platzierung (`src/logic/placement.ts`)

Platzierung wählt **Line und Slot**. Slot `n` liegt auf Position `SLOT_START + n × SLOT_SPACING` = `2 + 4n`, höchstens
bis `PLACEMENT_ZONE_END` (30). Die Zahl der Slots einer Line ist `lineCapacity(level)` = 2 + Stufe.

- `slotPosition(slot)`: Position auf der Line.
- `isValidSlot(slot, slotCount)`: ganzzahlig, ≥ 0, < `slotCount`, in der Zone.
- `isSlotFree(minions, line, slot)`: kein Minion der Line näher als `SLOT_SPACING / 2` (2) an der Slot-Position.
- `firstFreeSlot(minions, line, slotCount)`: niedrigster freier Slot oder `undefined`.

Die UI nutzt `isValidSlot` und `isSlotFree` für die Vorschau; beide ändern keinen Zustand.

## Platzierung im Match (`src/logic/match.ts`)

Alle Funktionen geben einen neuen Zustand zurück (`PlayResult`: `ok: true` mit `state`, oder `ok: false` mit `reason`
und unverändertem Zustand).

```ts
playCard(state, playerIndex, handIndex, lineIndex?, slot?)   // slot ohne Angabe = erster freier Slot
moveMinion(state, playerIndex, minionId, lineIndex, slot)    // kostenlos, nur Minions dieser Planung, nur vor „Bereit“
undoSummon(state, playerIndex, minionId)                     // erstattet Energie, Karte ans Ende der Hand
```

- `placements` in `PlayerState` merkt sich die in dieser Planung beschworenen Minions samt Karte. Nur sie lassen sich
  verschieben oder zurücknehmen. Upgrades sind nicht rückgängig zu machen.
- Fehlerreihenfolge bei der Beschwörung: `not-planning`, `already-ready`, `no-such-card`, `not-enough-energy`,
  `invalid-line`, `line-full`, `invalid-slot`, `slot-taken`. `moveMinion` und `undoSummon` melden zusätzlich
  `no-such-minion`.
- Nach „Bereit“ ist alles gesperrt (`already-ready`). Der Bot braucht keine Änderung: Er wählt weiter die Line mit
  den wenigsten Minions und den ersten freien Slot.

## Tests

- `iso.test.ts`: Roundtrip Welt → Bildschirm → Welt, Line-Punkte beider Spieler, Kamera- und Zoom-Begrenzung.
- `placement.test.ts`: Slot-Positionen, Kapazität, belegte Slots, Verhalten bei voller Line, Verschieben, Rückgängig,
  Sperre nach „Bereit“.
- Geprüft: `npm run typecheck`, `npx vitest run` für die drei Dateien (53 Tests) und `npm run test:smoke` laufen grün.
  Der Review war ohne blockierende Befunde.

## Worauf zu achten ist

- `line-full` greift vor `slot-taken`. Die Aussage im Designkonzept (Abschnitt 5), ohne Slot-Angabe und ohne freien Slot
  komme `slot-taken`, ist mit den heutigen Konstanten nicht erreichbar; sie sichert nur ab.
- Überzählige Handkarten werden in `match.ts` nur abgeschnitten, eine Ablage als Zustandsfeld gibt es noch nicht
  (Folgeauftrag 4). Der Kommentar zu `HAND_LIMIT` ("noch zu bestätigen") passt nicht mehr zum Dokument ("10, bestätigt").
- `placement.test.ts` enthält einen Platzhalter-Test zum Slotabstand (prüft nur `SLOT_SPACING > 0`). Er soll durch
  `SLOT_SPACING >= MINION_RANGE` oder `SLOT_SPACING / 2 < MINION_RANGE` ersetzt werden.
- Pointer-Events: Drag und Tippen trennen (ab 8 px Bewegung gilt Scrollen). Trefferprüfung in der Szene über
  `screenToWorld`, nicht über Sprite-Rechtecke.
- Zufall nur über den Seed, Zeit nur über `delta`; keine neuen Regeln in `update()`.

## Nächste Schritte

Die Szene muss `iso.ts` und `placement.ts` erst noch nutzen: Iso-Kamera (Folgeauftrag 1), Platzierungs-UI (2), Hand-UI (3),
danach Konstanten und Ablage (4). Die Liste steht in Abschnitt 9 des Designkonzepts.
