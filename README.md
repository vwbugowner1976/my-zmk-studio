# My ZMK Studio

A lightweight, independent web UI for configuring ZMK keyboards at runtime.

## Initial goal

The first milestone focuses on Runtime Combo editing:

- Connect to a ZMK keyboard
- Load the current combo list
- Add / edit / delete combos
- Save changes
- Re-read the combo list from firmware after save

The UI is intentionally separated from the transport/RPC implementation so USB and BLE backends can be added without rewriting the editor.

## Current status

The repository currently contains:

- React + TypeScript + Vite app shell
- Runtime Combo editor UI
- RuntimeComboClient transport/service abstraction
- Demo client for UI development
- Save flow designed as `set -> save -> reload`

The real DYA/ZMK Studio compatible RPC transport is the next step.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Planned roadmap

### v0.1
- Runtime Combo
- USB transport
- BLE transport

### Later
- PMW3610 settings
- PAW3222 settings
- BLE management
- Additional ZMK custom settings modules

## Design rule

After a successful save, My ZMK Studio should always fetch the state again from firmware instead of assuming the local UI state matches persistent storage.
