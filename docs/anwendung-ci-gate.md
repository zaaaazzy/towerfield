# CI-Gate vor dem Deploy

## Ablauf

| Datei | Zweck |
|---|---|
| `.github/workflows/ci.yml` | Job `pruefen`: `npm ci`, `npm run build`, `npm test`, `npm run test:smoke` im Container `mcr.microsoft.com/playwright:v1.64.1-noble`. Trigger: `pull_request`, `workflow_dispatch`, `workflow_call`. |
| `.github/workflows/pages.yml` | Trigger: Push auf `main`, `workflow_dispatch`. Ruft `ci.yml` als Job `ci` auf; `build` und `deploy` hängen per `needs` davon ab. |

- **Push auf `main`:** `ci.yml` wird über `pages.yml` aufgerufen und nicht zusätzlich direkt per `push` ausgelöst. So läuft
  die Prüfung pro Push genau einmal, und `deploy` startet erst, wenn sie grün ist.
- **Pull Requests:** nur `ci.yml`; es gibt dort keinen Deploy-Job. Der Deploy-Job hat zusätzlich `if: github.ref == 'refs/heads/main'`.
- **Rechte:** `contents: read` für die Prüfungen; `pages: write` und `id-token: write` nur im Job `deploy`.
- **Concurrency:** `ci-<ref>`, bricht nur bei Pull Requests veraltete Läufe ab. Nicht die Gruppe `pages` verwenden, sonst
  blockiert der aufrufende Workflow den aufgerufenen.
- **Fehlerfall:** Bei Fehlschlag lädt `actions/upload-artifact` (`if: failure()`) `playwright-report/` und `test-results/`
  als Artefakt `playwright-bericht` hoch. In der CI schreibt `playwright.config.ts` dafür den HTML-Bericht
  (`[['line'], ['html', { open: 'never' }]]`). Läuft alles grün, entsteht kein Artefakt.

## Container-Version

Der Tag (`v1.64.1`) muss zur gepinnten Version von `@playwright/test` in `package.json` passen. Bei einer
Playwright-Anhebung beide Stellen gemeinsam ändern, sonst fehlen die passenden Browser-Binaries.

## Entscheidung zu den Screenshots: Variante B

`e2e/grafik.spec.ts` vergleicht Screenshots nur auf macOS (`process.platform === 'darwin'`, Hilfsfunktion `vergleiche`).
Auf anderen Plattformen laufen die Tests weiter, nur der `toHaveScreenshot`-Vergleich entfällt.

**Begründung:** Die vorhandenen Basisbilder sind `*-chromium-darwin.png`. Linux-Basisbilder müssen im selben Playwright-Container
erzeugt werden, den die CI nutzt. Die Entwicklungsumgebung des Agenten sperrt Docker, deshalb konnten sie nicht erzeugt werden.
Falsch erzeugte Bilder würden die CI dauerhaft rot machen.

**Lücke:** Die CI prüft keine Grafikregressionen. Diese werden nur lokal auf macOS gefunden (`npm run test:smoke`).

**Wechsel auf Variante A (bevorzugt, einmalige Aktion):**

```sh
docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.64.1-noble \
  npx playwright test e2e/grafik.spec.ts --update-snapshots
```

Danach die erzeugten `*-chromium-linux.png` unter `e2e/grafik.spec.ts-snapshots/` einchecken (`planung`, `kampf`,
`spielende-statistik`, `spielende-teilen`, `detailansicht`, `hand-neue-karten`), `HAT_BASISBILDER` und `vergleiche`
aus der Spec entfernen und `toHaveScreenshot` wieder direkt aufrufen. Das Basisbild muss dazu `npm ci` im Container
vorher bekommen (`npm ci` zuerst ausführen, falls `node_modules` vom Host nicht passt).

## Branch-Schutz (Repo-Einstellung, nicht im Code)

Das Gate verhindert den Deploy, schützt aber `main` erst, wenn der Branch-Schutz den Check `pruefen` (bzw. `CI / pruefen`)
als Pflicht-Check verlangt. Das ist in den GitHub-Repo-Einstellungen zu setzen; dieser Auftrag ändert sie nicht.

## Bekannte Instabilität

Beim lokalen Lauf von `npm run test:smoke` auf macOS schlugen unter Last in mehreren Läufen jeweils 1–3 verschiedene Specs
fehl (u. a. `turm-slots`, `gameplay`, `grafik` Langdruck, `smoke` Teilen-URL); einzeln bestanden alle. Als Abfederung nutzt die
CI `retries: 1` (nur bei `CI`); ein Test, der auch im zweiten Versuch fehlschlägt, macht den Lauf rot. Die Ursache (Last bei
zwei Workern und zwei Servern) ist nicht behoben, die Specs wurden nicht verändert. Im Container ist ein Probelauf vor dem Merge nötig.

## Tests ausführen

- Unit-Tests: `npm test` bzw. `npx vitest run <datei>.test.ts`.
- E2E: nur `npm run test:smoke` oder `npx playwright test <datei>`. `vitest run` auf `e2e/*.spec.ts` ergibt „No test files found“.
