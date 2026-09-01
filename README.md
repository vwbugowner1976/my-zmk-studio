# My Keeb Studio

A lightweight browser-based keyboard inspector and configuration tool for ZMK and QMK-family firmware.

My Keeb Studio started as a ZMK Studio developer/diagnostic companion. The project is now expanding toward a firmware-agnostic keyboard toolbox while keeping device access local to the browser.

## v0.7

### QMK / VIA / Vial preview

- Connect to the default QMK Raw HID interface with WebHID
- Filter on the QMK default Raw HID usage page `0xFF60` and usage `0x61`
- Show product name, VID, PID, HID collections, and report counts
- Keep descriptor inspection command-free until the user explicitly starts the VIA / Vial probe
- Read VIA protocol version with `GET_PROTOCOL_VERSION (0x01)`
- For VIA protocol v8+, read the dynamic layer count with `DYNAMIC_KEYMAP_GET_LAYER_COUNT (0x11)`
- Treat VIA v7 as the legacy four-layer baseline used by the current VIA application
- Detect Vial with the read-only `0xFE / GET_KEYBOARD_ID` command
- Read the Vial protocol version, 8-byte keyboard UID, and embedded definition size
- Fetch the embedded Vial keyboard definition in 32-byte blocks
- Decode the firmware-embedded XZ definition in the browser, so Vial keyboards normally do not need a separate `vial.json`
- Fall back to loading VIA / Vial / QMK JSON locally when no usable embedded or built-in definition is available
- Read every dynamic layer without modifying firmware state
  - VIA/Vial protocol v8+: `DYNAMIC_KEYMAP_GET_BUFFER (0x12)`
  - VIA v7: `DYNAMIC_KEYMAP_GET_KEYCODE (0x04)` fallback
- Display each layer as a row/column matrix with 16-bit QMK keycodes
- Show common basic keycodes such as `KC_A`, `KC_ENT`, modifiers, `KC_NO`, and `KC_TRNS`
- Release the WebHID interface cleanly on disconnect or when switching to ZMK

The QMK-family probe and Layer Viewer are read-only and explicit. They do not write EEPROM, change keymaps, reset macros, unlock Vial, or jump to the bootloader. Matching the QMK Raw HID usage alone is not treated as proof of VIA or Vial support; My Keeb Studio only reports a protocol after receiving a valid response.

Local JSON files and Vial definitions read from firmware are processed in the browser and are not uploaded.

### Yamada Willow source profile

`VID 0xFEED / PID 0x1519` is currently the first built-in QMK source profile.

- Auto-detect Yamada Willow from VID/PID
- Use the firmware source's actual `10 x 10` matrix instead of the older/minimal `11 x 11` JSON value
- Do not require a JSON file before reading dynamic layers
- Reconstruct `k01` through `k74` from the keyboard's QMK `LAYOUT` macro
- Show the source-order Willow rows and Ambi cluster
- Show the three encoder CCW/CW virtual key bindings
- Keep the raw `10 x 10` matrix available as a diagnostic view
- Treat the source profile's matrix dimensions as authoritative even if a loaded JSON disagrees

The matrix-to-key mapping is exact from the supplied QMK source. The source does not contain complete geometry for every key in the center cluster, so that portion is intentionally rendered as a schematic source-order view rather than claiming exact physical x/y placement.

### Generic ZMK Studio support

The ZMK connection path now treats **standard ZMK Studio RPC as the required base** and Custom RPC extensions as optional capabilities.

- Connect any keyboard that exposes the standard ZMK Studio Web Serial interface
- Validate the connection with standard `keymap.getPhysicalLayouts`
- Keep Layer Viewer and Keymap Backup available even when the firmware has no Custom RPC namespace
- Probe `custom.listCustomSubsystems` only as an optional extension step
- Do not fail the standard ZMK connection when Custom RPC probing fails
- Do not fail the standard ZMK connection when Runtime Combo initialization fails
- Default to Layer Viewer when no Runtime Combo extension is available
- Show Runtime Combo and Custom Settings navigation only when their matching subsystem is detected
- Release Web Serial cleanly on disconnect so another Studio can connect immediately

A firmware that does not enable ZMK Studio cannot be used through this path simply because it exposes some other serial interface; the standard Studio RPC probe must succeed.

### ZMK Runtime Combo

Runtime Combo is an optional firmware extension rather than a connection requirement.

- Detect the `cormoran__runtime_combo` Custom Studio RPC subsystem when present
- Read Runtime Combos
- Edit combo key positions from the firmware's physical layout
- Select behaviors by firmware-provided display name
- Save and re-read state from firmware
- Compatibility fallback for older/broken `list_combos` implementations
- Preserve standard ZMK Studio access if Runtime Combo RPC fails

### ZMK Layer Viewer

- Uses standard ZMK Studio RPC
- Reads the active physical layout from firmware
- Reads all layers with standard `keymap.getKeymap`
- View and edit the live keymap
- Displays behavior names and parameters
- Supports rotated physical-layout keys, including ZMK's centi-degree rotation units
- Computes the SVG bounds from rotated key corners so angled layouts remain in view
- Export layers as PNG or PDF

### Other ZMK tools

- Keymap backup / restore
- Custom Settings inspector/editor when `cormoran_custom_settings` is advertised
- Persistent Debug Console
- RPC timing/payload logs
- Clean Web Serial teardown so another Studio can connect immediately after disconnect

## Browser support

Use a desktop Chromium-based browser such as Chrome or Edge.

- ZMK uses Web Serial
- QMK / VIA / Vial inspection uses WebHID
- Vial embedded definitions are XZ-decoded locally in the browser
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
           ZMK firmware          QMK / VIA / Vial candidate
                 |                         |
      Standard ZMK Studio RPC        Raw HID descriptor
                 |                   + read-only VIA protocol
          +------+-------+           + read-only Vial protocol
          |              |           + embedded definition decode
          |              |           + dynamic keymap reads
    Standard tools   Optional Custom RPC
    Layer Viewer     Runtime Combo
    Keymap Backup    Custom Settings
          |              |
          +------+-------+
                 |
                 +-------------------------+
                              |
                       My Keeb Studio
```

## Future ideas

- Render generic VIA/Vial layers using physical `layouts.keymap` geometry from the keyboard definition
- Add more firmware/source profiles without coupling them to the WebHID transport
- Expand shared ZMK/QMK keycode names and presentation
- QMK/VIA/Vial keymap editing with explicit write confirmation
- Vial combo / tap dance / key override inspection and editing
- BLE Management diagnostics
- PMW3610 diagnostics/settings
- PAW3222 diagnostics/settings
- Generic ZMK Custom Subsystem inspector
