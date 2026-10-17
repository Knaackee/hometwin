# HomeTwin – Your home in 3D for Home Assistant

Konzept für das Open-Source-Projekt (bisheriger Arbeitsname: Raumwerk)

## 1. Ziel

- 3D-Dashboard für Home Assistant: Haus mit Etagen, Dach, Garten und Sonnenstand, in dem man Geräte direkt bedient.
- Kernbotschaft: **„Dein Haus in 15 Minuten in 3D“**.
- International: mehrsprachig, metrische und imperiale Einheiten.
- Die Community erweitert die Objekt-Bibliothek per Pull Request, unterstützt durch einen Agent-Skill.

## 2. Name und Marke

- Projektname: **HomeTwin**, Untertitel „Your home in 3D for Home Assistant“.
- „Home Assistant“ nur beschreibend verwenden („for Home Assistant“), nicht als Teil des Namens.
- Vor der Veröffentlichung prüfen, ob der Name frei ist: GitHub, HACS, Markenregister, Domain.
- Repository: **`knaackee/hometwin`** (GitHub), Integrations-Domain `hometwin`.

## 3. Repository-Aufbau

```
hometwin/
├─ custom_components/hometwin/      Integration (Python, Panel, WebSocket, KI-Agent)
├─ frontend/                        Quellcode des Panels (Three.js, esbuild)
│  └─ src/i18n/                     Übersetzungen der Oberfläche (en, de, fr, es, nl, it, pl)
├─ library/                         Objekt-Bibliothek
│  ├─ generic/
│  │  ├─ furniture/<kategorie>/<objekt>/
│  │  ├─ lighting/…
│  │  ├─ climate/…
│  │  ├─ appliances/…
│  │  ├─ outdoor/…
│  │  └─ devices/…
│  ├─ manufacturers/<hersteller>/<kategorie>/<objekt>/
│  ├─ schema/object.schema.json     Pflichtfelder und Regeln
│  └─ index.json                    wird von CI erzeugt
├─ examples/                        Beispielhäuser (Plan-JSON + Vorschaubild)
├─ skills/add-object/               Agent-Skill für neue Objekte inkl. PR
├─ docs/                            GitHub-Pages-Seite
├─ tools/                           Validator, Vorschau-Renderer, Index-Builder
├─ .github/
│  ├─ workflows/                    hassfest, HACS-Action, Library-CI, Pages-Deploy, Release
│  ├─ ISSUE_TEMPLATE/               Bug, Feature, Objekt-Wunsch
│  └─ PULL_REQUEST_TEMPLATE.md
├─ hacs.json
├─ README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  LICENSE  CHANGELOG.md
```

## 4. Objekt-Format (Library)

Jedes Objekt ist ein Ordner:

| Datei | Inhalt |
|---|---|
| `object.json` | ID, Name (mehrsprachig), Kategorie, Hersteller, Modell, Maße (B×T×H in m), Montage (Boden, Wand, Decke, Dach), passende HA-Domains (z. B. `light`, `climate`), Farben/Varianten, Lizenz, Autor, Quellen (nur Links) |
| `recipe.json` | Bauanleitung aus Grundformen: Quader, Zylinder, Kugel, Profile (Extrusion), abgerundete Kanten, Materialien. Standardweg. |
| `model.glb` | optional, für Objekte, die mit Grundformen nicht gehen. Größenlimit. |
| `preview.webp` | Vorschaubild, von CI aus dem Modell gerendert |

Warum `recipe.json` als Standard: klein, maßgenau, für Agenten zuverlässig erzeugbar, in Reviews lesbar, Farben und Maße bleiben anpassbar.

Regeln:
- Lizenz der Objekte: CC0 oder CC-BY 4.0.
- Keine fremden Produktfotos im Repo, nur Links als Quelle.
- Herstellernamen sind als Beschreibung erlaubt, keine Logos.

## 5. Qualität per CI

Bei jedem PR automatisch:
1. Schema-Prüfung von `object.json` und `recipe.json`.
2. Maße plausibel (Begrenzungsbox des Modells = angegebene Maße ± Toleranz).
3. Dateigrößen, Anzahl Dreiecke.
4. Doppelte Objekte erkennen (gleicher Hersteller + Modell).
5. Vorschaubild rendern und als Kommentar in den PR posten.
6. `library/index.json` neu bauen.

Danach Review durch Maintainer. Gute Beiträge über die Galerie sichtbar machen.

## 6. Wie das Panel die Library nutzt

- Generische Grundobjekte sind fest eingebaut, damit es offline funktioniert.
- Die Community-Library wird optional über `index.json` geladen (GitHub Pages bzw. CDN).
- Gewählte Objekte werden lokal in Home Assistant gespeichert, damit der Plan auch ohne Internet läuft.
- Suche nach Kategorie, Hersteller, Maßen und HA-Domain.

## 7. Agent-Skill „Objekt hinzufügen“

Ablauf:
1. Nutzer nennt ein Produkt **oder** schickt ein Foto.
2. Agent identifiziert das Produkt; bei Unsicherheit fragt er nach (Hersteller, Modell, Variante).
3. Agent sucht Datenblatt, Maße und Referenzbilder im Netz.
4. Agent erzeugt `object.json` + `recipe.json` im richtigen Ordner.
5. Agent rendert ein Vorschaubild und zeigt es dem Nutzer; Korrekturschleife.
6. Agent führt den Validator lokal aus.
7. Agent erstellt Branch, Commit und Pull Request mit Quellen und Vorschau.

Der Skill wird gemeinsam ausgearbeitet und getestet, bevor das Repo öffentlich geht.

## 8. Mehrsprachigkeit

- Sprache automatisch aus Home Assistant (`hass.language`), Fallback Englisch.
- Start: Englisch, Deutsch. Danach: Französisch, Spanisch, Niederländisch, Italienisch, Polnisch.
- Übersetzungsdateien je Sprache; Community kann weitere Sprachen per PR ergänzen.
- Einheiten: metrisch und imperial (ft/in, °F), umschaltbar.

## 9. GitHub-Pages-Seite

- Startseite: „Your home in 3D in 15 minutes“, kurzes Video/GIF.
- **Live-Demo** im Browser (die vorhandene Demo-Version mit simuliertem Home Assistant).
- Library-Galerie mit Suche und Vorschaubildern.
- Beispielhäuser zum Ansehen und Herunterladen.
- Feature-Liste: was schon geht, was geplant ist (Roadmap).
- Installationsanleitung (HACS und manuell), Anleitung für Beiträge.

## 10. Veröffentlichung in HACS

1. Öffentliches GitHub-Repo mit `hacs.json`, vollständiger `manifest.json` (documentation, issue_tracker, codeowners, version).
2. GitHub-Releases mit Versionsnummer.
3. Sofort nutzbar als benutzerdefiniertes Repository in HACS.
4. Für den offiziellen HACS-Katalog: Workflows hassfest und HACS-Action grün, Repo-Beschreibung und Topics gesetzt, Icon im Brands-Repo, dann PR an `hacs/default`.

## 11. Fehlende Basics (Backlog)

- Rollos: `current_position` (0 = zu, 100 = offen) korrekt, Option „Position umkehren“ pro Rollo, Lamellen über `current_tilt_position` darstellen und steuern.
- Stil-Vorlage soll die gewählte Dachform behalten.
- Hell/Dunkel nach HA-Design, Touch-Bedienung auf Wandtablets, Leistungsmodus.
- Dashboard-Karte zusätzlich zum Panel; Leseansicht für Nicht-Admins.
- Umbenannte/gelöschte Entitäten erkennen und melden.
- Versioniertes Plan-Format mit Migration; Backup und Export.
- Tests und CI für Frontend und Backend.

## 12. Reihenfolge

1. Nacharbeiten im Produkt (Rollos, Dachform, Englisch + i18n-Gerüst).
2. Objekt-Format und Validator; vorhandene 60 Möbel + Geräte in die Library überführen.
3. Skill „Objekt hinzufügen“ gemeinsam ausarbeiten und testen.
4. Repo aufbauen (Struktur, Workflows, Vorlagen, README).
5. GitHub-Pages-Seite mit Live-Demo und Galerie.
6. Erstes Release, HACS als benutzerdefiniertes Repo, danach Antrag für den HACS-Katalog.

## 13. Festgehalten (Entscheidungen)

- **Repo:** `knaackee/hometwin`. Der Skill `hometwin-add-object` folgt dem offenen Agent-Skill-Standard (SKILL.md mit Frontmatter `name`/`description`), damit er mit Claude, Codex und anderen Agenten läuft.
- **Skill-Test als Showcase für README und Website:** Am 16.10.2026 hat der Skill aus einem einzigen Handyfoto eine **Martin Ed Sheeran ÷ Signature Edition** erkannt, mit nur zwei Rückfragen (Modell bestätigen, nur Gitarre ohne Ständer), Maße und Spezifikationen recherchiert und ein maßgenaues 3D-Objekt gebaut (20 Bünde an echten Positionen, ÷-Einlagen, Rosette, Steg, Kopfplatte mit 6 Mechaniken; 0,306 × 0,089 × 0,865 m, ~10 700 Dreiecke). **Dauer: ca. 5 Minuten vom Foto bis zur geprüften Vorschau.** Foto, Prüfbogen und Ergebnis kommen als Vorher/Nachher in README und Website.
- **Startbibliothek:** Die Gitarre (`manufacturers/martin/music/instruments/ed-sheeran-divide-signature`) ist Teil der ersten Bibliothek, zusammen mit den 5 Beispielobjekten (Sofa, Würfelregal, Bogenleuchte, Wandthermostat, Flachheizkörper Typ 22) und den überführten 60 Möbeln/Geräten.
- **Erkenntnisse aus dem Test, bereits umgesetzt:** `pow`/`let` in Rezepten, längere Beschreibungen, Kategorie `music/instruments`.
- **Erster Start (Onboarding):** Beim ersten Öffnen erscheint über der Demo ein Overlay: „Mit Demo starten“ (Beispielhaus ansehen) oder „Neu starten“ (leerer Plan, optional direkt mit KI-Assistent oder Bauplan-Bild).
- **KI-Agent schärfen (aus erstem Test):** Räume überlappen. Systemprompt und Server-Prüfung verbessern: keine Überlappungen, gemeinsame Wände exakt deckungsgleich, Raster 5 cm, Räume lückenlos aneinander, Gesamtumriss prüfen; bei Konflikt selbst korrigieren oder nachfragen.
- **Ebenen-Baum:** Rechtsklick-Kontextmenü (Umbenennen, Duplizieren, Ausblenden, Sperren, Löschen, Zur Etage verschieben, Hierher zoomen), Doppelklick zum Umbenennen, Sortieren per Drag & Drop (Etagen, Räume, Objekte; Objekte auch in anderen Raum/andere Etage ziehen).
- **Bauplan-Wizard (Modal, 5 Schritte):**
  1. *Quelle:* Drag & Drop, Datei, Zwischenablage (Strg+V), Handy-Kamera, PDF (pdf.js mitgeliefert, nur bei Bedarf geladen; Seitenauswahl mit Vorschau). Etage wählen oder neu anlegen.
  2. *Ausrichten:* Zuschneiden, Drehen (90° + fein), optional Perspektive über 4 Ecken, Kontrast-/Schwarzweiß-Filter für blasse Pläne.
  3. *Maßstab:* großer zoombarer Plan, Lupe, Einrasten auf Linien/Ecken, dicke Messlinie mit Griffen, Länge direkt an der Linie; optional zweite Kontrollstrecke (Abweichung in %); Vorschlag: KI liest Maßketten und schlägt den Maßstab vor.
  4. *Erkennen:* Einstellungen vorab (Räume, Türen, Fenster, Treppen, Raumnamen; Wandstärken außen/innen; Raster; Hinweise als Freitext), dann Start; Ergebnisse erscheinen live als Overlay.
  5. *Prüfen & übernehmen:* Overlay mit Deckkraft-Regler, Raumliste mit m² und Warnungen (Überlappung, Lücke, Fläche weicht von Beschriftung ab), Ecken ziehen, umbenennen, zusammenfassen/teilen, einzelne Räume neu erkennen lassen, korrekte Räume sperren und Rest neu erkennen. Übernehmen: ersetzen oder ergänzen, HA-Bereiche automatisch zuordnen, weiter mit nächster Etage oder Geräte-Zuordnung.
  - Ohne KI: gleicher Wizard, Schritt 4/5 als manuelles Nachzeichnen.
- **Reihenfolge:** zuerst Zwischenversion **0.3.1** (KI-Prompt + Prüfung, Bauplan-Assistent, Kontextmenü, Onboarding-Overlay, Rollo-Fixes, Dachform bei Stil), danach Englisch/Umbenennung und Repository.
- **Noch offen:** Prüfbogen bei schmalen, hohen Objekten besser ausnutzen; Korpustiefe der Gitarre vom Besitzer nachmessen lassen.

## 13b. Begehungsmodus (gewünscht)

- Ego-Perspektive: Körpergröße angeben (Augenhöhe ≈ Größe − 0,1 m), dann durch die Räume gehen.
- Steuerung: WASD/Pfeile + Maus (Pointer-Lock) am Desktop; am Handy/Tablet virtueller Joystick + Wischen; Kollision mit Wänden, Türen sind passierbar, Treppen wechseln die Etage.
- Einstieg: im Grundriss auf einen Punkt tippen „Hier hineingehen“; Ausstieg mit Esc.
- In der Begehung bedienen: Lampen/Rollos antippen wie in der Ansicht.
- Wenn einfach machbar: im Editor auch in der Begehung Objekte/Entitäten platzieren und verschieben (Fadenkreuz zeigt auf Boden/Wand, Objekt folgt, Klick setzt ab; Wandgeräte rasten an der Wand ein).

## 14. Offene Fehler (Fix vor Release 0.5 bzw. 1.0) aus Test 0.3.1-preview (16.10.2026)

- **Wizard, Schritt Maßstab:** Lupe erscheint, aber weder Klick–Klick noch Ziehen erzeugt eine Messlinie; danach lässt sich der Messmodus nicht mehr starten. Wahrscheinliche Ursache: Nach dem ersten Klick rastet der zweite Punkt schon bei minimaler Mausbewegung auf eine nahe Linie ein, der Klick zählt dann als fertig gezogene (wenige Pixel lange) Strecke und das Längenfeld wird fokussiert. Fix: Klick vs. Ziehen nach Bildschirmweg des Zeigers (> 6 px) entscheiden, nicht nach gerasterten Punkten; Mindestlänge der Strecke; Längenfeld erst nach zwei gesetzten Punkten. Außerdem prüfen (Pointer-Handling in `wizard.js` wire2/PlanView, Zustand `measuring`/`awaitB`), mit Playwright durchklicken. Zusätzlich: sichtbarer Modus-Schalter „Strecke messen“, Hinweis zum aktuellen Schritt („1. Punkt setzen“ → „2. Punkt setzen“ → „Länge eingeben“), Linie nach jedem Klick sofort zeichnen, Esc bricht ab.
- **Altes Bauplan-Bild:** Etagen mit Vorlage aus 0.3.0 zeigen das alte Bild; im Inspektor fehlt dann der Wizard-Knopf. Knopf immer anzeigen, Wizard ersetzt die Vorlage.
- Noch offen für 0.3.1: Kontextmenü + Drag & Drop im Ebenen-Baum, Onboarding-Overlay, Rollos (umkehren, Lamellen), Wizard komplett im Browser testen.

## 15. Aus Test 0.3.1 (KI-Erkennung)

- **Maße aus dem Plan nutzen:** Erkennungs-Prompt soll Maßketten und Raummaße/m²-Angaben lesen und gegenüber Pixelmessung bevorzugen; Maßstab automatisch aus Maßketten vorschlagen bzw. gegenprüfen.
- **Fortschritt sichtbar:** Sekundenzähler, Statuszeilen (Bild gesendet → Modell liest → Räume prüfen), Streaming der Antwort, Abbrechen-Knopf, Hinweis bei > 60 s, klare Fehlermeldung bei Timeout (Server-Timeout aktuell 240 s).
- **Flächenvergleich korrigieren:** Polygone liegen auf Wandmitte, Plan-m² sind lichte Maße. Vergleich mit Netto-Fläche (Polygon um halbe Wandstärke nach innen versetzt: außen 12 cm, innen 5,5 cm); erst danach warnen (Test: 8 von 12 Räumen mit Warnung, z. B. Flur 15,1 statt 10,6 m² – teils echte Fehler).
- **Maße aus dem Plan übernehmen:** Modell liefert pro Raum gelesene lichte Maße (z. B. 3,51 × 2,76) und m²; Server passt die Räume daran an (Rechtecke exakt, Wände auf Lichtmaß + Wandstärke), Nachbarn bleiben bündig. Nur bei Widersprüchen (Maß ↔ Fläche ↔ Nachbarräume) im Prüfschritt nachfragen.
- **Empfohlenes Modell:** Opus 5.5 oder ein vergleichbar leistungsfähiges Modell mit Bildverständnis in Optionen, README und Wizard nennen; Modellprüfung (Bild-Fähigkeit) beim Speichern der Optionen.

## 16. Wizard als Haus-Assistent (Test 0.3.6)

- Ablauf: Bauplan-Knopf → Wahl „Neue Etage“ / „Diese Etage ersetzen“ → Etage nach Erkennung benennen/Höhe aus Plan → „Nächste Etage“ → am Ende Schritt „Dach“ (Dachform, Neigung, Firstrichtung; aus Ansicht/Schnitt lesbar) → Fertig. Etagen sortierbar (vorhanden).
- Bauplan-Vorlage nach Übernahme: nur in 2D/Editor zeigen, in 3D-Ansicht ausblenden, Deckkraft-Regler.
- Fehlende Wände: KI liefert zusätzlich freie Wandsegmente (Wände innerhalb von Räumen, Teilwände); Raumwerk braucht dafür „freie Wände“.
- Treppe: KI liefert Laufrichtung (Pfeil), Antritt und Breite; Treppe als richtiges Objekt, Deckenloch darüber.
- Dach: nur über dem Hauptgebäude, Garage/Carport eigenes Flachdach; Dachform/Neigung aus Plan oder Rückfrage.
- Selbstkorrektur-Durchgang: erkannte Räume als Overlay ins Bild zeichnen und dem Modell zur Prüfung zurückgeben (zweiter, kurzer Durchgang).

## 17. Nach 0.4.0 vorgemerkt (16.10.2026)
- **„Braucht Aufmerksamkeit“ (0.4.x):** Batterie < Schwelle (Standard 20 %), Gerät > 30 min nicht verfügbar, Wasser/Rauch/Alarm, optional Fenster offen bei Regen/nachts. Abzeichen oben, Liste nach Dringlichkeit, pulsierende Markierung im 3D.
- **Eigene Bottom Sheets** für Licht (Helligkeit, Farbtemperatur, Farbrad), Rollladen (Position/Lamellen), Heizung, Mediaplayer; Rest über HA-Detaildialog.
- **Kiosk-Modus** für Wand-Tablets.
- **Mauern hochziehen pro Wand** (gestaffelt) statt ganzer Etage.
- **Skill-Regel „konkret oder generisch“:** Produkt eindeutig → Hersteller-Objekt; nur Art erkennbar → kein Produkt raten, vorhandenes generisches Objekt + Parameter (Maße abfragen); neues generisches Objekt nur, wenn keine Form passt.
- **Parametrische generische Objekte im Panel:** Regler für Maße, Varianten (L-Form, Recamiere), Farbe/Material; später „Aus Foto anpassen“ (KI wählt generisches Objekt + Parameter, ohne PR).
