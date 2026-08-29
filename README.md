# TilePoster

Lokale Browser-Anwendung, die eine große PDF-Seite auf mehrere kleinere Druckseiten verteilt.

## Starten

```bash
cd ab/poster-printer
npm install
npm run dev
```

Anschließend die in der Konsole angezeigte lokale Adresse im Browser öffnen.

## Bedienung

1. Eine PDF auswählen oder in das Ablagefeld ziehen.
2. Papierformat, Rand, Überlappung und Skalierung einstellen.
3. Das Dokument in der Vorschau mit der Maus verschieben oder die X-/Y-Werte eingeben.
4. Optional zentrieren und Schnittmarken aktivieren.
5. **Gekachelte PDF exportieren** anklicken und diese bei 100 % / „Tatsächliche Größe“ drucken.

Die Verarbeitung erfolgt vollständig lokal im Browser. Aktuell wird die erste Seite der Quelldatei gekachelt.

## Mit Docker entwickeln

```bash
cd ab/poster-printer
docker compose -f docker-compose.dev.yml up -d --build
```

Die Anwendung ist danach unter `http://localhost:8080` erreichbar. Für einen öffentlichen
Betrieb kann vor Port 8080 ein Reverse Proxy mit HTTPS (beispielsweise Caddy, Traefik oder
Nginx Proxy Manager) gesetzt werden.
