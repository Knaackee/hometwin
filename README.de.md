<p align="center"><img src="docs/assets/logo.svg" width="96" alt="HomeTwin-Logo"></p>

<h1 align="center">HomeTwin</h1>

<p align="center"><b>Dein Zuhause in 3D für Home Assistant.</b><br>
Bauplan hochladen, KI liest die Räume, jedes Gerät dort bedienen, wo es ist.</p>

<p align="center">
  <a href="https://knaackee.github.io/hometwin/demo/"><b>▶️ Live-Demo</b></a> ·
  <a href="https://knaackee.github.io/hometwin/">🌐 Website</a> ·
  <a href="README.md">🇬🇧 English</a>
</p>

<p align="center"><img src="docs/assets/screenshot-room.png" alt="HomeTwin: beleuchteter Raum in der interaktiven 3D-Ansicht" width="100%"></p>

> [!WARNING]
> **HomeTwin ist eine öffentliche Beta.** Es läuft im Alltag, Datenformate können sich aber noch ändern. Bitte ab und zu ein Backup exportieren (*Bearbeiten → Haus → Backup*). HomeTwin unterstützt derzeit **Englisch und Deutsch**. Englisch ist die Standardsprache; Deutsch wählst du in den Integrationsoptionen. Hilfe bei der Einrichtung findest du unter [Installation](#-installation). Du möchtest HomeTwin verbessern? Dann lies [In 5 Minuten beitragen](#-in-5-minuten-beitragen).

## ✨ Was es kann
- 🏠 **Dein Haus in 3D**: Etagen, Räume, Wände, Fenster, Türen, Treppen, Dächer und Garten. Aus dem Bauplan oder selbst gezeichnet.
- 💡 **Raumsteuerung**: Geräte nach Kategorien, dazu Temperatur, Luftfeuchtigkeit und Kontaktstatus auf einen Blick. Lichter und Rollläden bedienen, Gerätedetails öffnen, Szenen starten und Automationen aktivieren oder deaktivieren. Raumbezogene Szenen und Automationen verwenden die Bereichszuordnung aus Home Assistant.
- 📱 **Für Handy und Wand-Tablet**: Die Raumleiste wird mobil zum Bottom Sheet mit kompakter und erweiterter Ansicht.
- 🤖 **Bauplan-KI**: liest Räume, Türen, Fenster und Maßstab aus dem Architektenplan, mit zweitem Prüfdurchgang. Das Ergebnis lässt sich im Editor prüfen und korrigieren.
- 🚪 **Türen und Fenster**: Modelle aus der Bibliothek wählen, generische Rahmenfarben anpassen und Rollladenfarben separat festlegen. Hinweise beim Überfahren und der Objektbaum erleichtern die Auswahl kleiner Öffnungen.
- ☀️ **PV und Dächer**: Sattel-, Walm-, Pult- und Flachdach, Gauben, Dachfenster und Regenrinnen. Einzelne PV-Module oder Reihen anordnen, Maße sowie Hoch- oder Querformat wählen.
- 🌤️ **Echter Sonnenstand** mit Schatten für Standort und Tageszeit.
- 🚶 **Begehen**: in Augenhöhe durchs Haus gehen, unterwegs bedienen und umstellen.
- 🧩 **Objekt-Bibliothek der Community**: echte Produkte und generische Objekte, einschließlich Türen und Fenstern. Neue gemergte Objekte werden über die Bibliothek verfügbar.
- ⌨️ **Platzierung**: ausgewählte Objekte mit Maus oder Pfeiltasten bewegen; bei geeigneten Objekten Höhe und automatisches Aufsetzen verwenden.
- 💾 **Backup**: komplette Konfiguration exportieren und importieren.

| Raumsteuerung | Bauplan-Assistent | Begehen | Smartphone |
|---|---|---|---|
| ![Demo-Raumsteuerung](docs/assets/screenshot-room.png) | ![Bauplan-Assistent](docs/assets/screenshot-wizard.png) | ![Demo-Rundgang](docs/assets/screenshot-walk.png) | ![Mobile Demo-Raumsteuerung](docs/assets/screenshot-mobile.png) |

Alle Screenshots zeigen das integrierte Demohaus, kein privates Zuhause.

**In Entwicklung:** Roboter-Arbeitsbereiche bleiben bis zum erfolgreichen Gerätetest ausgeblendet. Gespeicherte Bereiche bleiben erhalten; eine Gerätekompatibilität wird noch nicht zugesagt. Siehe [Implementierungsstand und Grenzen](docs/robot-work-areas.md).

## ⚡ Vom Bauplan zum 3D-Haus in ca. 2 Minuten

Im eigenen Test hat `google/gemini-3.8-flash` einen echten Architektenplan mit 12 Räumen und 16 Öffnungen in etwa zwei Minuten gelesen. Den Maßstab hat die KI aus den Maßketten übernommen, Messen war nicht nötig. Danach folgen die Prüfung (Flächen gegen die m²-Angaben, Ecken ziehen, Türen und Fenster per Klick), weitere Etagen und das Dach. Zum Schluss wachsen die Mauern hoch.

## 🚀 Installation

1. HACS → ⋮ → *Benutzerdefinierte Repositories* → `knaackee/hometwin` als **Integration** hinzufügen.
2. **HomeTwin** installieren und Home Assistant neu starten.
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → **HomeTwin***.
4. **HomeTwin** in der Seitenleiste öffnen.

KI (optional): ein OpenAI-kompatibler Endpunkt mit Bildverständnis, empfohlen **Opus 5.5 oder ein vergleichbar leistungsfähiges Modell mit Bildverständnis**.

> Von der Vorabversion **Raumwerk**? HomeTwin übernimmt Plan, Bauplan-Bilder und KI-Einstellungen beim ersten Start automatisch. Alternativ: *Backup → exportieren/importieren*.

**Oberflächensprache:** Einstellungen → Geräte & Dienste → HomeTwin → Konfigurieren → Oberflächensprache. Englisch ist der Standard; Deutsch bleibt auswählbar. Die Auswahl gilt unabhängig von der Home-Assistant-Profilsprache. Eigene Raum- und Gerätenamen bleiben unverändert.

## 🧩 In 5 Minuten beitragen

Gib deinem Agenten (Claude, Codex …) den Skill [`skills/add-object/SKILL.md`](skills/add-object/SKILL.md) und ein Produkt oder ein Foto. Er recherchiert die Maße, baut das Objekt, zeigt dir eine Vorschau und stellt den Pull Request. Aus **einem Handyfoto** entstand so in etwa **fünf Minuten** eine maßgenaue *Martin Ed Sheeran ÷ Signature Edition*.

**Noch ein paar Tokens übrig? Mach etwas für die Community daraus.** Schau dich zu Hause um: Welche Möbel und Geräte fehlen noch in HomeTwin? Mit ein paar Produktfotos, unserem [Contribution-Guide](CONTRIBUTING.md) und **Opus 5.5 oder einem vergleichbar leistungsfähigen Modell** kannst du sie zur Bibliothek beitragen. Gerne gleich als Sammlung für einen ganzen Raum, gebündelt in einem Pull Request. So machen wir HomeTwin gemeinsam besser.

**Übersetzungen willkommen:** Englisch und Deutsch werden unterstützt. KI darf beim Übersetzen helfen; vor der Aufnahme muss ein Native Speaker jeden Text manuell prüfen und die Oberfläche testen. Dateien, Prüfungen und Review-Anforderungen stehen im [Leitfaden für Übersetzungen](CONTRIBUTING.md#translation-contributions).
## 🗺️ Roadmap

Weitere Community-Übersetzungen neben Englisch und Deutsch · „Braucht Aufmerksamkeit“ (Batterie, Ausfälle, Alarme) · Geräte-Sheets · parametrische Objekte · Kiosk-Modus.

## 📜 Lizenz

Code [MIT](LICENSE), Bibliothek [CC0-1.0](library/LICENSE). Unabhängiges Community-Projekt, nicht mit Home Assistant verbunden.
