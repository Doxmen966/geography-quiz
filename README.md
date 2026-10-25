# Geo-Quiz

Eine Web-App mit Geographie-Quizzes, optimiert fürs Smartphone und gedacht für den Betrieb als Docker-Container (z. B. auf Unraid).

## Spielmodi

- Flagge → Land
- Land → Flagge
- Land → Hauptstadt
- Karte → Land
- Bundesland → Landeshauptstadt
- Deutschlandkarte → Bundesland

Jedes Spiel beginnt mit 3 Leben. Pro Frage gibt es 4 Antworten, eine falsche Antwort kostet ein Leben. Die Fragen beginnen leicht und werden im Laufe des Spiels schwerer. Pro Modus werden die besten 10 Runs mit Name, Datum, Anzahl Fragen und Dauer gespeichert.

## Installation auf Unraid

Das Image wird von GitHub Actions gebaut und unter `ghcr.io/doxmen966/geography-quiz:latest` veröffentlicht.

In Unraid unter **Docker → Add Container**:

| Feld | Wert |
| --- | --- |
| Repository | `ghcr.io/doxmen966/geography-quiz:latest` |
| Port | Container-Port `3000` → z. B. Host-Port `3000` |
| Path | Container-Pfad `/data` → `/mnt/user/appdata/geography-quiz` |

Die Bestenliste liegt in `/data/highscores.json`. Ist das Repository privat, muss das Paket auf GitHub öffentlich gestellt oder Unraid bei `ghcr.io` angemeldet werden.

Alternativ mit Docker Compose:

```yaml
services:
  geography-quiz:
    image: ghcr.io/doxmen966/geography-quiz:latest
    ports:
      - "3000:3000"
    volumes:
      - /mnt/user/appdata/geography-quiz:/data
    restart: unless-stopped
```

## Daten

Alle Daten stammen aus öffentlichen Quellen und werden mit dem Image ausgeliefert. Zur Laufzeit braucht die App kein Internet.

| Inhalt | Quelle | Lizenz |
| --- | --- | --- |
| Länder, Hauptstädte, deutsche Ländernamen | [mledoze/countries](https://github.com/mledoze/countries) | ODbL 1.0 |
| Flaggen | [flag-icons](https://github.com/lipis/flag-icons) | MIT |
| Weltkarte, Bundesländer, Einwohnerzahlen, deutsche Städtenamen | [Natural Earth](https://www.naturalearthdata.com/) | gemeinfrei |
| Bekanntheit für den Schwierigkeitsgrad | Wikipedia-Seitenaufrufe (de) über [Wikimedia Pageviews API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/) und [Wikidata](https://www.wikidata.org/) | CC0 |

### Schwierigkeitsgrad

`scripts/build-data.mjs` berechnet für jedes Land einen Score aus den Seitenaufrufen der deutschen Wikipedia der letzten 12 Monate (70 %) und der Einwohnerzahl (30 %). Die bekanntesten Drittel sind *Leicht*, das mittlere *Mittel*, der Rest *Schwer*. Bei den Bundesländern zählen nur die Seitenaufrufe.

Einzelne Einträge lassen sich in `data/difficulty-overrides.json` von Hand festlegen, z. B.:

```json
{
  "countries": { "AUT": "easy" },
  "bundeslaender": { "DE-SL": "hard" }
}
```

Die Schlüssel sind ISO-3166-Codes (Länder: alpha-3, Bundesländer: `DE-xx`).

### Daten neu erzeugen

```bash
npm ci
npm run build-data             # mit Wikipedia-Seitenaufrufen
npm run build-data -- --offline  # ohne Wikimedia, Schwierigkeit nur nach Einwohnerzahl
```

Die GitHub Action **Daten aktualisieren** führt das Skript bei Änderungen am Skript oder an den Overrides automatisch aus und committet das Ergebnis. Sie lässt sich auch manuell starten.

## Entwicklung

```bash
npm ci
npm start   # http://localhost:3000, Bestenliste in ./storage
```

Umgebungsvariablen: `PORT` (Standard `3000`), `DATA_DIR` (Standard `./storage`, im Container `/data`).
