Vorbereitung für HomeTwin 0.7.0 (21. Oktober 2026):

- **Produktgeschichte aktualisieren:** „Your home in 3D. One integration. A community that builds with you.“ führt README und Website. HomeTwin wird als gemeinschaftlich entwickeltes Open-Source-3D-Dashboard für Home Assistant beschrieben; KI bleibt optional.
- **Neue Funktionen erklären:** verbundene Etagen mit Treppenöffnungen, Etagenwechsel in der Begehung, das vollständige geschlossene Haus, optionale Wandkollision und Gravitation, das Begehungsmenü, die responsive Raumauswahl und acht anpassbare Bodenmaterialien.
- **Werkzeuge klar trennen:** Der Bauplan-Assistent erstellt und prüft den eigenen Plan. Der Contribution Skill hilft der Community, Objekte, Türen, Fenster und Bodenmaterialien zu HomeTwin beizutragen.
- **Changelog und „Was ist neu?“ pflegen:** verständliche Release-Texte auf Englisch und Deutsch, einschließlich des behobenen Leerbildschirms unter Home Assistant 2026.10 aus Issue #12 sowie der Korrekturen an Durchbrüchen, Decken und Laufrichtung.
- **Version synchronisieren:** `const.py`, `manifest.json`, `CHANGELOG.md` und `frontend/src/releases.json` führen Version 0.7.0 mit Datum 2026-10-21.
- **Release separat abschließen:** Frontend und Demo bauen, die vorgeschriebenen Tests und Screenshots prüfen und erst nach Freigabe committen, pushen, taggen und veröffentlichen.

Diese Vorbereitung erstellt weder Commit noch Tag oder Veröffentlichung. Für die HACS-Verfügbarkeit werden später der freigegebene Release-Tag, das erfolgreich erzeugte Release-Paket und die Prüfung der Workflows benötigt.

## Freigabe für 0.7.0

Am 2026-10-21 hat der Nutzer Commit, Push und Veröffentlichung von 0.7.0 einschließlich README, Website, GitHub-Beschreibung und Demo-Screenshots ausdrücklich beauftragt. Der geschützte Hauptbranch wird über einen Release-Branch und erfolgreiche Pflichtprüfungen aktualisiert; anschließend folgen Release und Paketprüfung.
