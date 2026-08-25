# Mitwirken an F95 App

**Sprachen:** [English](CONTRIBUTING.md) · [Português (BR)](CONTRIBUTING.pt-BR.md) · Deutsch · [Русский](CONTRIBUTING.ru.md)

Danke, dass du dir den Code ansiehst. Dieses Dokument beschreibt Dev-Setup, Branch-Namen, Commits und Pull Requests.

Repository: [github.com/rares478/f95-app](https://github.com/rares478/f95-app)

---

## Bevor du startest

### Voraussetzungen

- Node.js 20+
- Rust stable ([rustup](https://rustup.rs/))
- Tauri v2 CLI (über `npm install` enthalten)
- Windows: WebView2, MSVC Build Tools (für native Crates und Overlay)

### Klonen und Starten

```bash
git clone https://github.com/rares478/f95-app.git
cd f95-app
npm install
npm --prefix src-tauri/sidecar install
npm run tauri dev
```

### `browser-rest-api`

Der Sidecar hängt von einem HTTP-Client-Paket ab. Wähle das Setup passend zu deinem Ziel:

**Lokale Entwicklung** — `browser-api`-Repo als Geschwister von `f95-app` klonen:

```
Projetos/
├── browser-api/
└── f95-app/
```

Der Sidecar löst es über `file:../../../browser-api` in `src-tauri/sidecar/package.json` auf.

**Release / npm** — Root-`package.json` nutzt `browser-rest-api@^1.0.0` aus dem Registry. Für Release-Builds Sidecar auf dieselbe veröffentlichte Version ausrichten.

### Nach Sidecar-Änderungen

```bash
npm --prefix src-tauri/sidecar run build
```

Dann neu starten oder `tauri dev` die Änderungen übernehmen lassen.

### Sidecar-Tests

```bash
npm --prefix src-tauri/sidecar test
```

---

## Wo bearbeiten

| Schicht | Pfad | Sprache |
|---------|------|---------|
| UI | `src/pages/`, `src/components/` | TypeScript/React |
| Frontend-Logik | `src/lib/`, `src/contexts/` | TypeScript |
| Tauri-Befehle | `src-tauri/src/commands/` | Rust |
| Downloads | `src-tauri/src/download/` | Rust |
| Overlay | `src-tauri/src/overlay*.rs` | Rust |
| F95/SAM-Parsing | `src-tauri/sidecar/src/domain/` | TypeScript |
| Host-Resolver | `src-tauri/sidecar/src/domain/resolvers/` | TypeScript |
| Übersetzungen | `src/locales/*.ts` | TypeScript |
| Datenbankschema | `src-tauri/src/migrations.rs` | SQL + Rust |

Architektur-Details: [docs/ARCHITECTURE.de.md](docs/ARCHITECTURE.de.md)

---

## Branches

Basis-Branch: `main`.

Ein Thema pro Branch. Mit `main` synchronisieren vor dem PR (Merge oder Rebase — deine Wahl, aber lesbare Historie).

| Präfix | Verwendung | Beispiel |
|--------|------------|----------|
| `feature/` | Neue Funktion | `feature/library-sort` |
| `fix/` | Bugfix | `fix/mega-download-resume` |
| `docs/` | Nur Dokumentation | `docs/readme-de` |
| `refactor/` | Code-Änderung, gleiches Verhalten | `refactor/ipc-types` |
| `chore/` | Build, Deps, Tooling | `chore/update-playwright` |

```bash
git checkout main
git pull origin main
git checkout -b feature/meine-aenderung
```

---

## Commits

Wir nutzen [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <kurze Beschreibung>

[optionaler Body — erkläre warum, nicht nur was]
```

### Types

| Type | Wann |
|------|------|
| `feat` | Neue Funktion |
| `fix` | Bugfix |
| `docs` | Dokumentation |
| `refactor` | Refactoring ohne Verhaltensänderung |
| `test` | Tests |
| `chore` | Wartung, Deps, CI |
| `perf` | Performance-Verbesserung |

### Scopes

Scope nutzen, wenn die Änderung klar abgegrenzt ist:

`frontend`, `tauri`, `sidecar`, `download`, `overlay`, `i18n`, `db`

Scope weglassen bei repo-weiten oder trivialen Änderungen.

### Beispiele

```
feat(download): add pixeldrain resolver
fix(overlay): anchor window on DPI change
docs: add German README
refactor(sidecar): split auth handler from registry
chore: bump playwright to 1.61
```

Regeln:

- Imperativ in der Betreffzeile (`add`, nicht `added`)
- Betreffzeile ≤ 72 Zeichen
- Eine logische Änderung pro Commit wenn möglich
- Keine Credentials, Session-Dateien oder persönlichen Daten committen

---

## Pull Requests

### Titel

Wie der Haupt-Commit: `feat(download): add pixeldrain resolver`

### Beschreibung

Enthalten:

1. **Was** sich geändert hat
2. **Warum** es nötig war
3. **Wie testen** — ausgeführte Befehle, manuelle Schritte

Issues verlinken mit `Fixes #123` oder `Refs #123`.

### Größe

PRs fokussiert halten. Große Änderungen in reviewbare Teile splitten (z. B. Rust-Resolver getrennt von UI-Verdrahtung).

### Checkliste

Das PR-Template (`.github/pull_request_template.md`) umfasst:

- [ ] `npm run build` erfolgreich
- [ ] `npm --prefix src-tauri/sidecar test` (bei Sidecar-Änderungen)
- [ ] Mit `npm run tauri dev` getestet (bei Rust/IPC/UI-Integration)
- [ ] Keine Secrets oder Session-Daten committed

### Review-Prozess

1. PR gegen `main` öffnen
2. Auf Review warten (kleines Projekt — etwas Geduld)
3. Feedback mit weiteren Commits adressieren
4. Squash-merge oder Merge-Commit — Maintainer entscheidet

---

## Code-Stil

Noch kein strenger Linter. An die umgebende Datei anpassen:

- **TypeScript/React** — funktionale Komponenten, Hooks, bestehende Namensgebung (`camelCase` Funktionen, `PascalCase` Komponenten)
- **Rust** — `rustfmt`-Defaults, `thiserror` für neue Fehlertypen
- **Sidecar** — Handler in `src/rpc/handlers/`, Domain-Logik in `src/domain/`

`npm run build` vor Frontend-Push. `cargo check` in `src-tauri/` für Rust-Änderungen.

---

## Bugs melden

GitHub-Issue öffnen mit:

- OS und App-Version
- Reproduktionsschritte
- Erwartetes vs. tatsächliches Verhalten
- Relevante Logs (Credentials und Session-Tokens entfernen)

---

## Lizenz

Mit deinem Beitrag stimmst du zu, dass deine Beiträge unter der [GNU GPL v3.0 oder später](LICENSE) lizenziert werden — derselben Lizenz wie das Projekt.
