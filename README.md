# My ZMK Studio

A lightweight local web UI for inspecting, testing, and exporting data from ZMK Studio enabled firmware.

My ZMK Studio is intentionally useful as a developer/diagnostic companion to DYA Studio rather than a replacement for it.

## v0.4

### Runtime Combo

- Connect to ZMK Studio over Web Serial
- Detect DYA-compatible Custom Studio RPC subsystems
- Read Runtime Combos
- Edit combo key positions from the firmware's physical layout
- Select behaviors by firmware-provided display name
- Save and re-read state from firmware
- Compatibility fallback for older/broken `list_combos` implementations

### Layer Viewer

The keymap viewer is read-only.

- Reads the active physical layout from firmware
- Reads all layers with standard `keymap.getKeymap`
- Switch between layers without editing them
- Displays behavior names when available
- Shows raw behavior parameters below the behavior label
- Supports rotated physical-layout keys
- Export the current layer as PNG
- Export every layer as individual PNG files
- Export all layers as one PDF, one layer per page

### Developer tools

- Persistent Debug Console
- RPC timing/payload logs
- Logs survive disconnect and page reload
- Copy / Clear / Hide controls
- Clean Web Serial teardown so another Studio can connect immediately after disconnect

## Development

After pulling a version that changes dependencies, run:

```bash
npm install
npm run dev
```

On Windows PowerShell in environments where `npm.ps1` is blocked:

```powershell
npm.cmd install
npm.cmd run dev
```

Production build:

```bash
npm run build
```

## Architecture

```text
ZMK firmware
  |
  | ZMK Studio RPC / DYA-compatible Custom RPC
  v
My ZMK Studio
  |- Runtime Combo inspector/editor
  |- Layer Viewer
  |- PNG/PDF exporter
  `- Debug Console
```

The Layer Viewer does not call keymap mutation RPCs. Runtime Combo saves always re-read the firmware state after saving instead of assuming local state matches persistent storage.

## Future ideas

- Rich keycode names instead of raw numeric parameters
- Custom Settings inspector
- BLE Management diagnostics
- PMW3610 diagnostics/settings
- PAW3222 diagnostics/settings
- Generic Custom Subsystem inspector
