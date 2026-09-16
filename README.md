# OBS Studio Taskbar Control

A powerful Windows-inspired taskbar interface for managing OBS Studio sources in real-time through a browser. Control, position, and layer your OBS sources with an intuitive drag-and-drop window system that syncs bidirectionally at 120fps.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![OBS WebSocket](https://img.shields.io/badge/OBS%20WebSocket-5.0.3-purple.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

## ✨ Features

### Real-Time Synchronization
- **120fps Bidirectional Sync** - Move sources in OBS or the browser, changes reflect instantly
- **Live Position Updates** - Drag windows to reposition OBS sources in real-time
- **Automatic Size Detection** - Windows match exact source dimensions from OBS

### Window Management
- **Draggable Windows** - Each source becomes a movable window with titlebar
- **Taskbar Tabs** - Windows appear as tabs in the taskbar (active, minimized states)
- **Layer Control** - Click a window to bring its source to the top layer in OBS
- **Minimize/Close** - Full window controls for each source

### Visual Features
- **Transparent Background** - Clean alpha background for OBS browser sources
- **Adaptive Grid** - Grid size calculated using GCD for perfect alignment
- **Titlebar Offset** - Windows positioned so content aligns with OBS sources
- **Status Indicators** - Visual feedback for sync operations and connection status

### OBS Integration
- **WebSocket API** - Connects directly to OBS Studio via WebSocket
- **Scene Awareness** - Automatically detects and responds to scene changes
- **Source Properties** - Reads and updates position, size, and layer index
- **Multi-Source Support** - Manage unlimited sources simultaneously

## 🧩 Erweiterungen (`features.js`)

Liegt neben `script.js` und hängt sich an dessen Funktionen an, statt sie zu ersetzen.
Datei entfernen und die Zeile aus `index.html` löschen — das Tool verhält sich wieder
wie vorher.

**Verbindung merken.** Nach einer erfolgreichen Verbindung werden Adresse und
Einstellungen im `localStorage` abgelegt; beim nächsten Start verbindet sich das Tool
von allein. Zwei Häkchen im Verbindungsfenster steuern das. Das Passwort wird nur
gespeichert, wenn du es ausdrücklich erlaubst — im Klartext, wie bei allem im
localStorage. Für ein OBS im eigenen Netz ist das vertretbar, nur wissen solltest du es.

**Rechtsklick.** Auf einem Fenster oder seinem Tab öffnet die rechte Maustaste ein
kleines Menü: in den Vordergrund, minimieren, schließen. Absichtlich kein sofortiges
Schließen beim Rechtsklick — beim Schieben von Fenstern verklickt man sich zu leicht.

**Fenster ohne Quelle.** Lage und Größe jedes Fensters werden alle zwei Sekunden
gesichert. Quellen, die gerade nicht in der Szene liegen, erscheinen im Startmenü unter
*Zuletzt bekannt* und lassen sich trotzdem öffnen — gestrichelt umrandet, mit der zuletzt
gesehenen Position und Größe, ohne Verbindung zu OBS. Taucht die Quelle wieder auf,
koppelt sich das Fenster automatisch an und OBS übernimmt wieder die Hoheit.

Das funktioniert auch ganz ohne OBS: Startmenü öffnen, Fenster aus *Zuletzt bekannt*
setzen, Layout ansehen.

In der Konsole gibt es `taskbarSpeicher.lesen()`, `.vergessen("Quellenname")` und
`.leeren()`.


### Abgleich mit OBS

`features.js` ersetzt `syncWindowsFromOBS` und `startSyncLoop`. Der ursprüngliche Loop
rief den Abgleich mit 120 Hz auf, ohne die vorige Antwort abzuwarten, und fragte darin
jedes Fenster einzeln nacheinander ab. Bei fünf Fenstern sind das 600 Anfragen pro
Sekunde über einen Socket, der das nicht schafft — die Anfragen stauen sich und die
Fenster hängen der Quelle immer weiter hinterher, am deutlichsten bei einem Move-Filter.

Drei Änderungen:

- **Eine Anfrage für alle Fenster** über `callBatch` statt einer pro Fenster
- **Keine Überlappung** — die nächste Runde startet erst, wenn die vorige da ist
- **Takt nach Messung** — Ziel sind 60 Hz, dauert eine Runde länger, wird entsprechend
  langsamer getaktet statt weiter aufzustauen

In der Konsole zeigt `taskbarSync.status()` den tatsächlichen Takt und die Laufzeit
einer Runde, `taskbarSync.takt(30)` ändert das Ziel.


### Fenster → Quelle

Das Ziehen eines Fensters hat die Quelle nicht zuverlässig mitgenommen. Zwei Gründe:

Beim Loslassen setzt `script.js` `isDragging` sofort auf `false` und schickt die neue
Position erst danach los. In der Lücke liest die Leseschleife noch den alten Wert aus
OBS und schiebt das Fenster zurück — je zuverlässiger der Abgleich läuft, desto sicherer
gewinnt das Zurücklesen. Jedes Fenster bekommt nach einem Schreibvorgang deshalb eine
kurze Sperre, in der nicht zurückgelesen wird.

Außerdem lasen beide Schreibfunktionen vor dem Setzen erst den kompletten Transform aus
und schrieben ihn samt `bounds` und `alignment` zurück. Das kostet zwei Wege über den
Socket pro Bewegung — und scheitert, sobald `boundsType` auf `OBS_BOUNDS_NONE` steht:
dann sind `boundsWidth` und `boundsHeight` null, und OBS weist das mit *below the
minimum of 1.000000* zurück.

`SetSceneItemTransform` nimmt Teilangaben. Geschrieben werden jetzt nur `positionX` und
`positionY`; alles andere bleibt unangetastet. Das umgeht den Fehler und lässt den
Lesevorgang davor ganz entfallen.


### Apps im Startmenü

Oben im Startmenü sitzt eine Leiste für eigene Werkzeuge. Erster Eintrag ist die
**Progress Bar** — das Neo HUD aus dem Nachbarrepo
(<https://ludgar.github.io/fullscreen-progress-bar/>), das sich vollständig über
URL-Parameter steuern lässt.

Weil die Taskbar ohnehin am OBS-WebSocket hängt, stellt sie nicht nur die Adresse
zusammen, sondern schreibt sie auf Wunsch direkt in eine Browserquelle in OBS und löst
dort ein Neuladen aus. Countdown einstellen, *An Quelle senden*, fertig — OBS selbst
muss nicht angefasst werden.

- **Countdown** mit Start und Ende, dazu Schnellknöpfe für „jetzt“ und +15/30/60 Minuten
- **Dauer** in Sekunden mit den üblichen Stufen
- **Manuell** mit Regler und den chaotischen Sprüngen
- Fünf Farben, wie im HUD selbst
- *Vorschau als Fenster* bettet das HUD als Fenster in die Taskbar ein; es ist nur
  Vorschau, Klicks gehen an das Fenster, nicht an das HUD
- Die Basis-Adresse lässt sich ändern, falls du eine eigene Kopie betreibst

Gefundene Browserquellen holt die Liste über `GetInputList`; das Senden läuft über
`SetInputSettings`, das Neuladen über `PressInputPropertiesButton`. Ältere
OBS-Versionen ohne diesen Knopf laden beim Setzen der URL ohnehin neu.


## 🎨 Theme

Das Erscheinungsbild steckt vollständig in CSS-Tokens am Kopf von `styles.css`.
Farben, Schriften und Rundungen stehen dort als Variablen; wer den Look ändern will,
fasst nur diesen Block an.

```css
:root{
  --ci:      #00669c;   /* Akzent */
  --leiste:  #10151a;   /* Taskleiste */
  --schrift: "Space Grotesk", ...;
}
```

Space Grotesk und Space Mono liegen als Latin-Subset in `fonts.css` eingebettet, damit
die Seite auch als lokale Browserquelle ohne Netz richtig aussieht. Beide stehen unter
der SIL Open Font License 1.1. Zahlen — Uhr, Maße, Quellentypen — laufen in Space Mono,
damit sie beim Zählen nicht springen.

Unterhalb des Grundstils folgt ein Abschnitt mit den Eigenheiten des Looks: Eckwinkel am
aktiven Fenster, Akzentkanten an Startknopf und Tabs, Schraffur im Fensterinhalt. Der
Block lässt sich am Stück entfernen, ohne dass die Funktion leidet.


## 🚀 Getting Started

### Prerequisites

- **OBS Studio** (v28.0.0 or higher recommended)
- **OBS WebSocket Plugin** (v5.0+) - Usually bundled with OBS
- Modern web browser (Chrome, Firefox, Edge)

### Installation

1. **Enable OBS WebSocket**
   ```
   OBS Studio → Tools → WebSocket Server Settings
   ✓ Enable WebSocket server
   Port: 4455 (default)
   Password: (optional)
   ```

2. **Download the Project**
   ```bash
   git clone https://github.com/yourusername/obs-taskbar-control.git
   cd obs-taskbar-control
   ```

3. **Choose Your Setup**

   **Option A: Standalone HTML** (Easiest)
   - Open `obs-taskbar.html` directly in your browser
   - All code in one file, no server needed

   **Option B: Separated Files** (Recommended for development)
   - Open `index.html` in your browser
   - Requires all three files: `index.html`, `styles.css`, `script.js`

4. **Add to OBS**
   ```
   OBS Studio → Sources → + → Browser
   
   Settings:
   - Local file: ✓
   - Browse to: obs-taskbar.html (or index.html)
   - Width: Your canvas width (e.g., 3440)
   - Height: Your canvas height (e.g., 1440)
   - ✓ Shutdown source when not visible
   - ✓ Refresh browser when scene becomes active
   ```

## 📖 Usage

### First Connection

1. **Click the Start button** in the taskbar
2. **Click "Configure Connection"**
3. Enter your WebSocket details:
   - Address: `ws://localhost:4455` (default)
   - Password: (if you set one)
4. **Click Connect**

### Adding Windows

1. **Click Start** → **+ Add Window from Source**
2. **Select a source** from your current scene
3. A window appears matching the source's size and position
4. The source is now controllable from the browser!

### Managing Windows

| Action | Method |
|--------|--------|
| **Move Source** | Drag the window titlebar |
| **Bring to Front** | Click the window or its taskbar tab |
| **Minimize** | Click the minimize button (−) |
| **Restore** | Click the minimized tab in the taskbar |
| **Close** | Click the close button (✕) |

### Grid Alignment

The background grid automatically calculates based on your viewport dimensions using the Greatest Common Divisor (GCD):
- **3440×1440** → 80px grid
- **1920×1080** → Variable grid
- Grid lines always align perfectly with browser edges

## ⚙️ Configuration

### WebSocket Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Address | `ws://localhost:4455` | WebSocket server URL |
| Password | (empty) | Optional authentication |

### Window Behavior

- **Sync Rate (Browser→OBS)**: 60fps during drag, instant on release
- **Sync Rate (OBS→Browser)**: 120fps continuous
- **Titlebar Height**: 32px offset for content alignment
- **Grid Calculation**: Auto-adjusted based on viewport GCD

### Browser Source Settings

For best results in OBS:
- **Width/Height**: Match your OBS canvas resolution exactly
- **FPS**: Custom (60fps recommended)
- **CSS**: No custom CSS needed
- **Shutdown when not visible**: Enabled (saves resources)

## 🏗️ Technical Details

### Architecture

```
┌─────────────────┐
│   OBS Studio    │
│                 │
│  ┌───────────┐  │
│  │ WebSocket │◄─┼─── ws://localhost:4455
│  │  Server   │  │
│  └───────────┘  │
└────────┬────────┘
         │
         │ 120fps Sync Loop
         │
    ┌────▼────────────────┐
    │  Browser Source     │
    │  ┌──────────────┐   │
    │  │ Taskbar UI   │   │
    │  │ + Windows    │   │
    │  └──────────────┘   │
    └─────────────────────┘
```

### Technologies

- **Vanilla JavaScript** - No frameworks, pure ES6+
- **OBS WebSocket API** - Direct communication with OBS
- **CSS Grid/Flexbox** - Responsive layout
- **RequestAnimationFrame** - Smooth 120fps updates

### API Calls Used

| API Method | Purpose |
|------------|---------|
| `GetSceneItemList` | Fetch sources in current scene |
| `GetSceneItemTransform` | Read source position/size |
| `SetSceneItemTransform` | Update source position |
| `SetSceneItemIndex` | Change layer order |
| `GetCurrentProgramScene` | Detect active scene |

### File Structure

```
obs-taskbar-control/
├── index.html          # Main HTML structure
├── styles.css          # All styling (607 lines)
├── script.js           # All functionality (949 lines)
├── obs-taskbar.html    # Combined single-file version
├── favicon.svg         # Project icon
└── README.md           # This file
```

## 🎨 Customization

### Changing Grid Size

The grid is automatically calculated, but you can override it in `script.js`:

```javascript
function updateGridSize() {
  const gridSize = 100; // Force 100px grid
  mainContent.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  // ...
}
```

### Adjusting Sync Rate

Change the sync frequency in `script.js`:

```javascript
const targetFPS = 120; // Lower for better performance
const syncThrottle = 16; // Increase for less frequent drag updates
```

### Styling Windows

Modify window appearance in `styles.css`:

```css
.fake-window {
  background-color: #1e1e1e;
  border: 1px solid rgba(255, 255, 255, 0.2);
  /* Customize colors, shadows, etc. */
}
```

## 🐛 Troubleshooting

### Connection Issues

**Problem**: "Failed to connect" error

**Solutions**:
- Verify OBS WebSocket is enabled (Tools → WebSocket Server Settings)
- Check the port matches (default: 4455)
- Ensure no firewall is blocking localhost connections
- Try disabling password authentication temporarily

### Sources Not Syncing

**Problem**: Windows don't update when moving sources in OBS

**Solutions**:
- Check browser console for errors (F12)
- Verify the correct scene is active
- Refresh the browser source in OBS
- Ensure sources haven't been deleted/renamed

### Performance Issues

**Problem**: Lag or stuttering

**Solutions**:
- Lower sync rate from 120fps to 60fps
- Close unnecessary browser tabs
- Reduce number of active windows
- Check OBS isn't CPU-bound

### Grid Misalignment

**Problem**: Grid doesn't align with edges

**Solutions**:
- Ensure browser source dimensions match your canvas exactly
- Check for browser zoom (should be 100%)
- Verify no custom CSS is interfering

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **OBS Studio** - For the amazing streaming software
- **obs-websocket-js** - JavaScript library for OBS WebSocket API
- Inspired by Windows taskbar design

---

**Made with ❤️ for the OBS community**
