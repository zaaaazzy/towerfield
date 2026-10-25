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
- `field-view.ts`: Tower (Mauerwerk, Wimpel und Schild in Teamfarbe, Schatten, Bodenschein), Minions (Schatten, Leuchten, Form nach Rolle: Kreis, Raute für Fernkämpfer, Kreuz für Heiler, Stachelkugel mit Zündschnur für Zerstörer, Größe nach Leben, Lebensbalken bei Schaden) und Bauplätze.
- `effects.ts`: Partikel und Leuchtringe für Treffer, Tod, Beschwörung und fallende Tower, Kamerawackeln beim Tower-Fall, aufsteigende Schadenszahlen (Schaden je Ziel gesammelt, höchstens 20 Zahlen und 150 lebende Partikel je Emitter gleichzeitig), kurze Animation beim Ausspielen einer Karte.
- `src/logic/fx-events.ts`: reine Funktion `diffFx`, die aus zwei Spielzuständen die Effekt-Ereignisse ableitet (mit Test).
- `src/logic/card-style.ts`: Kartentyp-Stil und Kurztext (`describeCard`) aus den Kartenwerten (mit Test).

## Assets und Lizenzen

`public/assets/` enthält keine Dateien; alle Grafiken entstehen aus Phaser-Grafik-API und Canvas-Verläufen im Code und
stehen unter derselben Lizenz wie das Projekt. Fremde Dateien (Bilder, Schriften) werden nicht verwendet. Kommen später
Dateien hinzu, werden sie unter `public/assets/` abgelegt, im `preload()` der Szene geladen (Pfad ohne `public/`) und hier
mit Quelle und Lizenz eingetragen.

## Hinweise

- Die Szene `replay` und die Dev-Szene `balance` nutzen dieselbe Theme- und Hintergrundlogik.
- Bei Zeitsprüngen über 500 ms (z. B. Tab im Hintergrund) entfallen Effekte, damit nichts aufgestaut wird.
- Die Schrift der Labels wird mit doppelter Auflösung gerendert, damit sie bei Skalierung scharf bleibt.
