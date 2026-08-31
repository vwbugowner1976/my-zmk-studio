# My Keeb Studio

A lightweight browser-based keyboard inspector and configuration tool for ZMK and QMK-family firmware.

My Keeb Studio started as a ZMK Studio developer/diagnostic companion. The project is now expanding toward a firmware-agnostic keyboard toolbox while keeping device access local to the browser.

## v0.7

### QMK / VIA preview

- Connect to the default QMK Raw HID interface with WebHID
- Filter on the QMK default Raw HID usage page `0xFF60` and usage `0x61`
- Show product name, VID, PID, HID collections, and report counts
- Keep descriptor inspection command-free until the user explicitly starts the VIA probe
- Read VIA protocol version with `GET_PROTOCOL_VERSION (0x01)`
- For VIA protocol v8+, read the dynamic layer count with `DYNAMIC_KEYMAP_GET_LAYER_COUNT (0x11)`
- Treat VIA v7 as the legacy four-layer baseline used by the current VIA application
- Load a VIA definition JSON locally to obtain the keyboard matrix dimensions
- Read every dynamic layer without modifying firmware state
  - VIA v8+: `DYNAMIC_KEYMAP_GET_BUFFER (0x12)`
  - VIA v7: `DYNAMIC_KEYMAP_GET_KEYCODE (0x04)` fallback
- Display each layer as a row/column matrix with 16-bit QMK keycodes
- Show common basic keycodes such as `KC_A`, `KC_ENT`, modifiers, `KC_NO`, and `KC_TRNS`
- Release the WebHID interface cleanly on disconnect or when switching to ZMK

The VIA probe and Layer Viewer are read-only and explicit. They do not write EEPROM, change keymaps, reset macros, or jump to the bootloader. Matching the QMK Raw HID usage alone is not treated as proof of VIA support; My Keeb Studio only reports VIA after receiving a valid protocol response.

The VIA definition JSON is read locally in the browser and is not uploaded. It currently provides matrix rows and columns for the QMK Layer Viewer. Physical-layout rendering from `layouts.keymap` is planned as the next step.

### ZMK Runtime Combo

- Connect to ZMK Studio over Web Serial
- Detect DYA-compatible Custom Studio RPC subsystems
- Read Runtime Combos
- Edit combo key positions from the firmware's physical layout
- Select behaviors by firmware-provided display name
- Save and re-read state from firmware
- Compatibility fallback for older/broken `list_combos` implementations

### ZMK Layer Viewer

- Reads the active physical layout from firmware
- Reads all layers with standard `keymap.getKeymap`
- View and edit the live keymap
- Displays behavior names and parameters
- Supports rotated physical-layout keys
- Export layers as PNG or PDF

### Other ZMK tools

- Keymap backup / restore
- Custom Settings inspector/editor
- Persistent Debug Console
- RPC timing/payload logs
- Clean Web Serial teardown so another Studio can connect immediately after disconnect

## Browser support

Use a desktop Chromium-based browser such as Chrome or Edge.

- ZMK uses Web Serial
- QMK / VIA inspection uses WebHID
- A secure context is required when hosted; HTTPS is recommended and is provided automatically by hosts such as Cloudflare Pages

Device communication stays between the browser and the locally connected keyboard. The current application does not require a backend server.

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
                           Browser
                              |
                 +------------+------------+
                 |                         |
             Web Serial                  WebHID
                 |                         |
                 v                         v
           ZMK firmware              QMK / VIA candidate
                 |                         |
         ZMK Studio RPC              Raw HID descriptor
         + Custom RPC                + read-only VIA protocol
                 |                   + dynamic keymap reads
                 |                         |
                 +------------+------------+
                              |
                       My Keeb Studio
```

## Future ideas

- Render QMK/VIA layers using the physical `layouts.keymap` geometry from VIA definitions
- Expand shared ZMK/QMK keycode names and presentation
- QMK/VIA keymap editing with explicit write confirmation
- BLE Management diagnostics
- PMW3610 diagnostics/settings
- PAW3222 diagnostics/settings
- Generic ZMK Custom Subsystem inspector
