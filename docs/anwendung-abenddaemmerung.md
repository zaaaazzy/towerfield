# Abenddämmerung: Lichtschicht über 8 Runden

Das Spielfeld bekommt eine Lichtschicht, die von goldenem Abendlicht (Runde 1) zur Fackelnacht (Runde 8, `MAX_ROUNDS`)
wechselt. Es ändert sich nur die Darstellung, keine Spielregel.

## Logik (`src/logic/ambience.ts`, Test `ambience.test.ts`)

Reine Funktionen ohne Phaser, DOM und Canvas; Zufall nur über `nextRandom`, Zeit nur über `delta`.

| Funktion | Aufgabe |
| --- | --- |
| `ambienceForRound(round, maxRounds, stops?)` | Lichtfarbe `color`, Tönung `tint`, `darkness`, `fog`, `fireflies` für eine Runde |
| `blendAmbience(current, target, deltaMs, tauMs)` | weiches Überblenden beim Rundenwechsel (exponentiell, bildratenunabhängig) |
| `advanceDrift(offset, speed, deltaMs, period)` | ziehender Nebel, der im Kreis läuft |
| `flickerParams(seed)`, `flickerAt(params, timeMs, strength)`, `flickerStrength(ambience)` | Fackelflackern: Helligkeit um 1 |
| `fireflyStart(seed, index, bounds)`, `stepFirefly`, `fireflyGlow`, `fireflyCount(share)` | Glühwürmchen: Start, Bewegung, Puls, Anzahl |

Verlauf: Fortschritt `t = (round - 1) / (maxRounds - 1)`, begrenzt auf 0..1.

- Abdunklung 0,06 bis `MAX_DARKNESS` (0,5, Obergrenze für die Lesbarkeit), mit Glättung (smoothstep).
- Nebeldichte 0,08 bis 0,7, Anteil der Glühwürmchen 0,1 bis 1 (höchstens `MAX_FIREFLIES` = 24), jeweils linear.
- Lichtfarbe von Abendgold zu Fackelorange; Tönung Abendgold, Dämmerviolett, Nachtblau.
- `round` unter 1 oder über `maxRounds` ergibt den Randwert. `maxRounds <= 1`, `NaN` und unendliche Werte ergeben die
  Werte von Runde 1, nie `NaN`.

## Licht-Tokens (`src/scenes/theme.ts`)

`LIGHT`: Abendgold `0xf2b84b`, Dämmerviolett `0x5b3a8e`, Nachtblau `0x0d1536`, Fackelorange `0xff8a2b`, Nebelgrau
`0xa9aec4`, Glühwürmchen-Gelb `0xe8ff7a`. `LIGHT_STOPS` übergibt die vier Verlaufsfarben an `ambienceForRound`.
`ambience.ts` importiert `theme.ts` nicht (es hängt von Phaser ab); `DEFAULT_LIGHT_STOPS` dort hat dieselben Werte und
ist nur der Vorgabewert für Tests.

## Szene (`src/scenes/ambience-layer.ts`)

`AmbienceLayer` wird in `MainScene` und `ReplayScene` angelegt (Seed = `match.seed`, Runde = `match.round`), bekommt je
Bild `setRound(round)` und `update(deltaMs)` und zeichnet:

- Tönung: ein Rechteck in Tönungsfarbe mit der Abdunklung als Deckkraft.
- Lichtkegel: drei je Lane (Tower links, Tower rechts, breites Lane-Licht), additiv gemischt, mit Flackern, das in
  späteren Runden stärker ist. Textur `light-cone` (radialer Verlauf, einmal erzeugt).
- Nebel: drei Bänder (`TileSprite`, Textur `fog`) mit verschiedener Richtung und Geschwindigkeit.
- Glühwürmchen: 24 Sprites (Textur `spark`), sichtbar ist der Anteil laut Logik.

Tiefe: -50 bis -47, also über dem Hintergrund (-100) und unter dem Spielfeld, den Einheiten, Karten, Knöpfen und Texten
(Tiefe 0 und höher). Die Schicht dunkelt deshalb nur den Boden ab; Karten, Einheiten und Texte bleiben unverändert lesbar.
Die Texturen entstehen über `ensureTextures` einmal (`createCanvasTexture` prüft, ob der Schlüssel schon existiert).
