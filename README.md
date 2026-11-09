# Produktwissen

Lern-Web-App für Lernende bei Veloplus. Der Lernende bearbeitet Module zu Produktbereichen und sucht die Antworten auf veloplus.ch. Der Admin korrigiert die offenen Antworten.

- `index.html`: Ansicht für Lernende (ohne Login, Name antippen)
- `admin.html`: Admin-Bereich (Google-Login)
- Statische Seiten mit Vanilla JS, Firebase JS SDK v10 per CDN, kein Build-Schritt

## Einrichtung

### 1. Firebase-Projekt

1. In der [Firebase-Konsole](https://console.firebase.google.com) ein Projekt erstellen (Google Analytics wird nicht gebraucht).
2. **Firestore Database** → «Datenbank erstellen» → Standort `eur3` oder `europe-west6` (Zürich) → Produktionsmodus.
3. **Projekteinstellungen → Allgemein → Meine Apps** → Web-App (`</>`) hinzufügen. Die angezeigte `firebaseConfig` in `js/firebase-config.js` einfügen.

### 2. Anmeldung aktivieren

**Authentication → Sign-in method**:

- **Anonym** aktivieren (für die Lernenden, läuft unsichtbar im Hintergrund)
- **Google** aktivieren (für den Admin)

### 3. Admin-Adresse eintragen

Die Google-Adresse des Admins an **zwei** Stellen eintragen:

- `js/firebase-config.js` → `ADMIN_EMAIL`
- `firestore.rules` → Funktion `adminEmail()`

Massgebend für die Sicherheit sind die Regeln. Die Angabe in der Config steuert nur, ob die Admin-Oberfläche angezeigt wird.

### 4. GitHub Pages und autorisierte Domains

1. Repository auf GitHub pushen, dann **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
2. In Firebase unter **Authentication → Settings → Autorisierte Domains** die Pages-Domain eintragen, z. B. `deinname.github.io` (ohne `https://` und ohne Pfad). `localhost` ist bereits eingetragen.

Die Datei `.nojekyll` sorgt dafür, dass GitHub Pages alle Dateien unverändert ausliefert.

### 5. Regeln deployen

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # Projekt auswählen
firebase deploy --only firestore:rules
```

Nach jeder Änderung an `firestore.rules` erneut deployen.

### 6. Erstes Modul

`admin.html` öffnen → mit Google anmelden → **Import** → `beispiele/testmodul-velohelme.json` hochladen → Prüfen → Speichern. Danach auf `index.html` einen Namen registrieren und das Modul durchspielen.

Lokal testen (ES-Module brauchen einen Webserver):

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> und <http://localhost:8000/admin.html> öffnen.

**Ohne echtes Firebase-Projekt (Emulator):** `firebase emulators:start --only auth,firestore --project demo-produktwissen` starten (braucht Java 21+) und die Seiten mit `?emulator` öffnen, z. B. <http://localhost:8000/?emulator>. Der Schalter wirkt nur auf `localhost`. Im Admin-Bereich zeigt der Emulator beim Google-Login ein Testkonto-Formular. Dort die Adresse aus `adminEmail()` verwenden.

## Modul-JSON

```json
{
  "id": "velobekleidung-01",
  "title": "Velobekleidung",
  "description": "Kurzbeschreibung",
  "productArea": "Bekleidung",
  "sourceUrl": "https://www.veloplus.ch/...",
  "createdAt": "2026-11-09",
  "questions": [
    { "id": "q01", "type": "mc", "text": "…", "options": ["A", "B", "C", "D"],
      "correct": [1], "explanation": "…", "hintUrl": "https://www.veloplus.ch/..." },
    { "id": "q02", "type": "open", "text": "…", "modelAnswer": "…", "hintUrl": "https://www.veloplus.ch/..." }
  ]
}
```

- `correct` enthält die **Indizes ab 0**: `[1]` heisst, die zweite Antwort ist richtig. Mit mehreren Indizes wird es eine Mehrfachauswahl (der Lernende sieht «Mehrere Antworten möglich»).
- `id` des Moduls: nur Kleinbuchstaben, Ziffern und Bindestriche. Fragen-IDs: Buchstaben, Ziffern, `-` und `_`.
- Pflicht: `id`, `title`, `questions`, pro Frage `id`, `type`, `text`, bei MC `options` und `correct`, bei offenen Fragen `modelAnswer`. Fehlende Metadaten und eine Fragenzahl ausserhalb von 40–60 ergeben nur eine Warnung.
- Beim Import kann ein Modul oder ein Array von Modulen eingefügt werden, auch mehrere Dateien gleichzeitig. Ein Modul mit gleicher `id` wird ersetzt, Aktiv-Status und Reihenfolge bleiben dabei erhalten.

## Datenmodell (Firestore)

| Collection | Inhalt | Wer liest |
|---|---|---|
| `users/{userId}` | `name`, `createdAt` | alle (angemeldet) |
| `sessions/{authUid}` | `userId`: verknüpft die anonyme Anmeldung mit dem gewählten Namen | eigene, Admin |
| `modules/{moduleId}` | Modul **ohne Lösungen** + `active`, `order`, `importedAt`, `questionCount` | alle |
| `moduleSolutions/{moduleId}` | MC-Lösungen (`correct`) und Erklärungen | Admin, Lernender erst nach dem Einreichen |
| `moduleKeys/{moduleId}` | Musterantworten und das Original-JSON | nur Admin |
| `attempts/{userId}_{moduleId}` | `status`, `answers`, `startedAt`, `submittedAt`, `reviewedAt`, `score`, `maxScore` | alle |
| `attemptHistory/{autoId}` | archivierte Versuche nach einem Reset (+ `archivedAt`, `originalAttemptId`) | nur Admin |

Das Modul-JSON wird beim Import auf drei Dokumente verteilt. Im Browser des Lernenden ist alles lesbar, was die Regeln erlauben. Lägen Musterantworten und MC-Lösungen in `modules`, könnte er sie über die Entwicklertools sehen.

`answers[questionId]` = `{ value, correct?, review?: { rating, comment } }`. `value` ist bei MC ein Array von Indizes, bei offenen Fragen ein Text. `correct` (MC) setzt der Admin beim Abschliessen.

**Punkte:** MC richtig = 1, offene Frage richtig = 1, teilweise = 0,5, falsch = 0. Maximum = Anzahl Fragen. Unbeantwortete offene Fragen zählen 0 und müssen nicht bewertet werden.

## Sicherheit: was die Regeln garantieren

- Ohne Anmeldung (`request.auth == null`) ist nichts lesbar oder schreibbar.
- Lernende können:
  - sich registrieren (nur `name`)
  - einen Versuch nur für ein aktives Modul und nur für den gewählten Namen anlegen
  - pro Schreibvorgang genau eine Antwort `{ value }` speichern, solange der Versuch `in_progress` ist
  - einen Versuch von `in_progress` auf `submitted` setzen, danach nichts mehr
- Lernende können nicht: Bewertungen, `correct`, `score` oder `reviewedAt` setzen, eingereichte Versuche ändern, Versuche löschen, Module ändern, Musterantworten lesen oder MC-Lösungen vor dem Einreichen lesen.
- Module importieren, korrigieren, zurücksetzen und archivieren kann nur das Google-Konto aus `adminEmail()` (mit verifizierter E-Mail).

**Grenze des Modells ohne Passwort:** Wer die App öffnet, kann jeden Namen antippen. Ein Lernender könnte also unter fremdem Namen arbeiten oder einen Testnamen anlegen, ein Modul leer einreichen und danach die MC-Lösungen sehen. Für den Einsatz mit einem bekannten Lernenden ist das vertretbar. Der Admin sieht solche Testnamen in der Übersicht. Die Musterantworten bleiben in jedem Fall geschützt.

## Bedienung

**Lernender:** Name antippen → Modul starten → Fragen seitenweise (5 pro Seite) beantworten. Gespeichert wird automatisch, Unterbrechen ist jederzeit möglich. «Modul einreichen» macht das Modul schreibgeschützt und zeigt die MC-Auswertung mit Erklärungen. Nach der Korrektur erscheinen dort auch Bewertung und Kommentare.

**Admin:**

- **Übersicht:** eingereichte Module oben unter «Zu korrigieren». Darunter pro Lernendem alle Module mit Status, Fortschritt und Punkten.
- **Korrigieren:** MC wird automatisch ausgewertet. Bei offenen Fragen stehen Frage, Antwort und Musterantwort nebeneinander. Bewertet wird mit Richtig / Teilweise / Falsch, dazu ein optionaler Kommentar. Bewertungen werden sofort gespeichert. «Als korrigiert abschliessen» setzt Status und Punktzahl. Nachträgliche Änderungen mit «Korrektur aktualisieren» speichern.
- **Zurücksetzen:** archiviert den Versuch nach `attemptHistory` und löscht ihn aus `attempts`. Frühere Versuche sind in der Übersicht verlinkt.
- **Module:** aktivieren/deaktivieren, Reihenfolge mit ↑/↓, Original-JSON herunterladen.
