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

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/AmazingFeature`)
3. **Commit your changes** (`git commit -m 'Add some AmazingFeature'`)
4. **Push to the branch** (`git push origin feature/AmazingFeature`)
5. **Open a Pull Request**

### Development Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/obs-taskbar-control.git

# Create a branch
git checkout -b feature/my-feature

# Make changes and test locally
# Open index.html in browser with OBS running

# Commit and push
git add .
git commit -m "Description of changes"
git push origin feature/my-feature
```

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **OBS Studio** - For the amazing streaming software
- **obs-websocket-js** - JavaScript library for OBS WebSocket API
- Inspired by Windows taskbar design

## 📧 Contact

Project Link: [https://github.com/yourusername/obs-taskbar-control](https://github.com/yourusername/obs-taskbar-control)

---

**Made with ❤️ for the OBS community**
