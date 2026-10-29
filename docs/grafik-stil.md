# Grafik-Stil

Die Darstellung folgt einem Fantasy-Kartenspiel-Look: Kartenrahmen und Typografie wie bei Sammelkartenspielen, warme
Holz-, Metall- und Edelstein-Optik, kräftige Teamfarben mit Leuchten. Es werden **nur eigene, im Code erzeugte Grafiken**
verwendet; Originalgrafiken oder Logos von MTG, Hearthstone oder Heroes of the Storm sind nicht enthalten. Die Spielregeln
sind unberührt: Alle Werte, Reihenfolgen und der Seed bleiben gleich, Animationen laufen über `delta` bzw. Phaser-Tweens.

## Palette und Schrift

Zentral in `src/scenes/theme.ts` (`PALETTE`, `TEXT`, `FONTS`, `FRAME`); alle Szenen nehmen Farben und Schriften nur von dort.

| Rolle | Wert | Verwendung |
| --- | --- | --- |
| Hintergrund | `0x0b0820` / `0x1b1540` / `0x2d2460` | Verlauf, Panels |
| Gold | `0xf2c14e` (hell `0xffe08a`, dunkel `0x9c6b1f`) | Rahmen, Titel, Auswahl |
| Bronze | `0xb87333` (dunkel `0x5f3513`) | Nebenrahmen, Bauplätze |
| Team Blau (du) | `0x35b6ff` (dunkel `0x0f5a8f`) | Tower, Minions |
| Team Orange (Gegner) | `0xff6a3d` (dunkel `0x8f2a10`) | Tower, Minions |
| Gut / Schlecht | `0x6bd16f` / `0xef5350` | Lebensbalken, Meldungen, Ziehen |

Kartentypen (in `src/logic/card-style.ts`, reine Funktion `cardTypeStyle` mit Test):

| Typ | Rahmenfarbe | Symbol | Banner |
| --- | --- | --- | --- |
| `summon` | Rot `0xe0584a` | Schwert | BESCHWÖRUNG |
| `tower-upgrade` | Blau `0x4a90e2` | Turm | TOWER |
| `line-upgrade` | Grün `0x3fb68b` | Pfeil | LINE |
| `minion-upgrade` | Violett `0xb06be0` | Edelstein | MINIONS |

Schriften sind Systemschriften mit Fallback (kein Webfont, daher auch offline gleich): Überschriften und Kartennamen in
Georgia/Palatino (Serife), Fließtext in Trebuchet/Segoe UI/Verdana.

## Bausteine

- `theme.ts`: Palette, Schriften, Farbverlauf (`fillGradient`), Rahmen-Panel (`drawPanel`), Balken (`drawBar`), Knopf (`drawButton`).
- `textures.ts`: erzeugt den Hintergrund (Verlauf, Boden, Wege, Holztisch, Vignette) und Partikeltexturen zur Laufzeit per Canvas-Textur. Das Muster nutzt einen festen eigenen Zeichen-Zufall, nicht den Spiel-Seed.
- `card-view.ts`: Handkarte mit Rahmen, Kopfzeile (Name), Kosten-Kristall, Bildfläche mit Typ-Symbol, Textfeld und Typ-Banner. Hover und Auswahl heben die Karte an (Skalierung bis 110 %, Schatten, Leuchten; Gold bei Auswahl, Typfarbe bei Hover).
- `tower-look.ts` (Logik): `towerDamageStage(hp, maxHp)` und die Darstellungsdaten je Stufe. Intakt über 66 % HP; angeschlagen über 33 % (zwei Risse, eine Zinne fehlt); brennend darunter (vier Risse, zwei Zinnen fehlen, Rauch und flackernde Glut); Ruine bei 0 HP (niedrige Mauerreste, schwacher Rauch und Glut, keine Spezialisierungs-Markierung). Rauch und Glut laufen aus der Szenenzeit (`delta`), intakte Tower haben keine.
- `field-view.ts`: Tower (Mauerwerk, Wimpel und Schild in Teamfarbe, Schatten, Bodenschein, Schadensstufen siehe oben), Minions (Schatten, Leuchten, Form nach Rolle: Kreis, Raute für Fernkämpfer, Kreuz für Heiler, Stachelkugel mit Zündschnur für Zerstörer, Größe nach Leben, Lebensbalken bei Schaden) und Bauplätze.
- `effects.ts`: Treffer je Schadensquelle – Holzpfeile fliegen im Bogen heran (`arrow`), ein Schwert schwingt über
  das Ziel (`melee`), Blitze schlagen zickzack ein (`lightning`); Tower splittern wie Holz, Gefallene hinterlassen
  Staub (Texturen `arrow`, `sword`, `splinter` in `textures.ts`). Dazu Partikel und Leuchtringe für Beschwörung, Kamerawackeln beim Tower-Fall, aufsteigende Schadenszahlen (Schaden je Ziel gesammelt, höchstens 20 Zahlen und 150 lebende Partikel je Emitter gleichzeitig), kurze Animation beim Ausspielen einer Karte.
- `ambience-layer.ts` und `src/logic/ambience.ts`: Lichtschicht der Abenddämmerung, Details in [`anwendung-abenddaemmerung.md`](anwendung-abenddaemmerung.md). Licht-Tokens `LIGHT` und `LIGHT_STOPS` stehen in `theme.ts`, Texturen `light-cone` und `fog` in `textures.ts`.
- `src/logic/fx-events.ts`: reine Funktion `diffFx`, die aus zwei Spielzuständen die Effekt-Ereignisse ableitet (mit Test).
- `src/logic/card-style.ts`: Kartentyp-Stil und Kurztext (`describeCard`) aus den Kartenwerten (mit Test).

## Assets und Lizenzen

`public/assets/` enthält zwei Ordner:

- `cards/`: 11 Karten-SVGs (siehe [Karten-SVGs](#karten-svgs)).
- `audio/`: Sounddateien (`.wav`, dazu zwei Schleifen als `.m4a`), geladen von der Audio-Steuerung, Details in [`anwendung-audio.md`](anwendung-audio.md).

Alle übrigen Grafiken entstehen aus Phaser-Grafik-API und Canvas-Verläufen im Code. Fremde Bilder und Schriften werden
nicht verwendet. Neue Dateien kommen unter `public/assets/`, werden im `preload()` der Szene geladen (Pfad ohne `public/`)
und hier mit Quelle und Lizenz eingetragen.

**Quelle und Lizenz der Dateien in `public/assets/`:** Im Repository ist dazu nichts vermerkt (keine Lizenzdatei, kein
Autorenhinweis; die Git-Historie nennt nur den Agenten-Commit). Ob sie selbst erzeugt oder übernommen wurden, ist
**offen** und muss vom Projektinhaber geklärt werden; eine Lizenz wird hier nicht angenommen.

## Karten-SVGs

- **Ablage:** `public/assets/cards/<id>.svg`, geladen in `main-scene.ts` (`preload()`) als Textur `card-art-<id>` mit
  `this.load.svg(..., { width: 268, height: 144 })`.
- **Format:** 268×144 Pixel Zielgröße. Die Dateien selbst sind 134×72 (`viewBox 0 0 134 72`), also genau halb so groß und
  im gleichen Seitenverhältnis; beim Laden werden sie verdoppelt. Alle Maße unten beziehen sich auf die 134×72-Datei.
- **Dateinamen:** entsprechen den Einträgen von `CARD_ART_IDS` in `src/logic/card-style.ts`: `summon-minion`,
  `summon-brute`, `summon-archer`, `summon-healer`, `summon-destroyer`, `line-upgrade`, `tower-hp`, `tower-damage`,
  `minion-upgrade-line`, `minion-upgrade-all`, `buff-minion`. Karten ohne Eintrag zeigen das Typ-Symbol.
- **Quelle und Lizenz:** unbekannt, siehe oben; hier nicht erfunden. Offen.
- Die Szene schneidet das Bild mittig zu (keine Verzerrung) und legt es in die Bildfläche der Karte.

## Bildsprache

Abgeleitet aus den vorhandenen SVGs und `FRAME`; neue Karten-SVGs halten sich daran.

- **Lichtrichtung:** Licht kommt von oben. Hintergründe sind senkrechte Verläufe (oben hell, unten dunkel, z. B. `#6c3a2a` → `#241410`), am Boden liegt ein dunkles Band (`opacity 0.7`), Figuren werfen eine flache Schattenellipse darunter (`#000`, `opacity 0.4`). Ein weicher Lichtfleck (`opacity ≈ 0.18`) sitzt hinter der Figur. In `theme.ts` entsprechend: Schatten nach unten rechts versetzt (`drawPanel`: +1/+3), Glanzlicht als weißer 1-px-Streifen oben (`drawBar`).
- **Konturstärke:** Hauptformen haben eine dunkle Kontur von 2 (grosse Flächen bis 3), Details 1,5, Linienzeichnung 1–1,3 in der 134×72-Datei (also 4/3/2 px auf der Karte). Die Kontur ist ein abgedunkelter Ton der Füllfarbe, nie Schwarz. Rahmen im Code: aussen `FRAME.outer` = 2, innen `FRAME.inner` = 1.
- **Sättigung:** Flächen sind mittel gesättigt, der Hintergrund dunkel und gedämpft, nur ein Akzent pro Bild (Hauptfigur oder Symbol) ist kräftig (z. B. Herz `#e0384a`, Bogen `#8a5a2a`). Pro Bild höchstens ein Akzent, keine Neonfarben; Leuchten kommt über Transparenz (0,15–0,45), nicht über zusätzliche Sättigung. Die Kartentyp-Farben bleiben in `logic/card-style.ts`.

## Theme-Tokens nach Rollen

`theme.ts` gliedert die Farben nach Rollen; jede Gruppe ist ein eigenes Objekt und lässt sich später als Ganzes
austauschen (Grundlage für Nacht- oder Rundenstimmungen, die selbst noch nicht umgesetzt sind). `PALETTE` bleibt als
flache Sicht auf diese Gruppen erhalten.

| Gruppe | Inhalt |
| --- | --- |
| `SURFACE` (Oberfläche) | Hintergründe, Panels, Boden, Wege, Knopfverläufe (Bereit, Abwerfen, Filter) |
| `LIGHT` (Licht) | Abenddämmerung-Stützpunkte, Glut, Energie-Blau, Weiß/Schwarz für Glanz und Schatten |
| `MATERIAL` (Material) | Gold, Bronze, Stahl, Stein, Rauch |
| `TEAM_COLOR` (Team) | Spieler, Gegner, Gut/Schlecht, Spezialisierungsmarken der Tower |

In `card-view.ts`, `field-view.ts` und `main-scene.ts` stehen keine Hex-Farbliterale mehr. Nicht umgestellt sind
`textures.ts`, `minion-figure.ts`, `effects.ts`, `replay-scene.ts` und `balance-scene.ts`.

Das Layout der Energie-Leiste (Rahmen, Kristall, Textpositionen) steht in `src/logic/energy-layout.ts`
(`energyCrystalLayout` liefert die Eckpunkte der Raute, der inneren Raute und des Glanzdreiecks; mit Test).

## Hinweise

- Die Szene `replay` und die Dev-Szene `balance` nutzen dieselbe Theme- und Hintergrundlogik.
- Bei Zeitsprüngen über 500 ms (z. B. Tab im Hintergrund) entfallen Effekte, damit nichts aufgestaut wird.
- Die Schrift der Labels wird mit doppelter Auflösung gerendert, damit sie bei Skalierung scharf bleibt.
