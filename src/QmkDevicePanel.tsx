import { useEffect, useMemo, useState, type ChangeEvent } from 'react';

type HidReportInfo = {
  reportId: number;
};

type HidCollectionInfo = {
  usagePage: number;
  usage: number;
  inputReports?: HidReportInfo[];
  outputReports?: HidReportInfo[];
  featureReports?: HidReportInfo[];
  children?: HidCollectionInfo[];
};

type HidInputReportEvent = {
  data: DataView;
};

type HidInputReportListener = (event: HidInputReportEvent) => void;

type HidDevice = {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName?: string;
  collections: HidCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: 'inputreport', listener: HidInputReportListener): void;
  removeEventListener(type: 'inputreport', listener: HidInputReportListener): void;
};

type HidApi = {
  requestDevice(options: {
    filters: Array<{ usagePage?: number; usage?: number }>;
  }): Promise<HidDevice[]>;
};

type ViaDefinition = {
  name?: string;
  vendorId?: string | number;
  productId?: string | number;
  matrix?: {
    rows?: number;
    cols?: number;
  };
  layouts?: unknown;
};

const QMK_RAW_USAGE_PAGE = 0xff60;
const QMK_RAW_USAGE = 0x61;
const VIA_REPORT_ID = 0;
const VIA_REPORT_SIZE = 32;
const VIA_GET_PROTOCOL_VERSION = 0x01;
const VIA_GET_KEYCODE = 0x04;
const VIA_GET_LAYER_COUNT = 0x11;
const VIA_GET_KEYMAP_BUFFER = 0x12;
const VIA_PROTOCOL_ALPHA = 7;
const VIA_PROTOCOL_BETA = 8;
const VIA_MAX_BUFFER_BYTES = 28;

const hex4 = (value: number) => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

function getHidApi(): HidApi | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { hid?: HidApi }).hid ?? null;
}

function flattenCollections(collections: HidCollectionInfo[]): HidCollectionInfo[] {
  return collections.flatMap((collection) => [
    collection,
    ...flattenCollections(collection.children ?? []),
  ]);
}

function parseUsbId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, text.toLowerCase().startsWith('0x') ? 16 : 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function keycodeLabel(value: number) {
  if (value === 0x0000) return 'KC_NO';
  if (value === 0x0001) return 'KC_TRNS';
  if (value >= 0x0004 && value <= 0x001d) return `KC_${String.fromCharCode(65 + value - 0x0004)}`;
  if (value >= 0x001e && value <= 0x0026) return `KC_${value - 0x001d}`;
  if (value === 0x0027) return 'KC_0';
  const known: Record<number, string> = {
    0x0028: 'KC_ENT',
    0x0029: 'KC_ESC',
    0x002a: 'KC_BSPC',
    0x002b: 'KC_TAB',
    0x002c: 'KC_SPC',
    0x00e0: 'KC_LCTL',
    0x00e1: 'KC_LSFT',
    0x00e2: 'KC_LALT',
    0x00e3: 'KC_LGUI',
    0x00e4: 'KC_RCTL',
    0x00e5: 'KC_RSFT',
    0x00e6: 'KC_RALT',
    0x00e7: 'KC_RGUI',
  };
  return known[value] ?? hex4(value);
}

function viaCommand(
  device: HidDevice,
  command: number,
  bytes: number[] = [],
  timeoutMs = 1200,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const payload = new Uint8Array(VIA_REPORT_SIZE);
    payload[0] = command;
    bytes.slice(0, VIA_REPORT_SIZE - 1).forEach((value, index) => {
      payload[index + 1] = value & 0xff;
    });

    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      device.removeEventListener('inputreport', onInputReport);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onInputReport: HidInputReportListener = (event) => {
      const data = new Uint8Array(
        event.data.buffer,
        event.data.byteOffset,
        event.data.byteLength,
      );
      if (data[0] !== command) return;
      finish(() => resolve(new Uint8Array(data)));
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for VIA command ${hex(command)} response.`)));
    }, timeoutMs);

    device.addEventListener('inputreport', onInputReport);
    void device.sendReport(VIA_REPORT_ID, payload).catch((error) => {
      finish(() => reject(error));
    });
  });
}

async function readLayerFast(device: HidDevice, layer: number, rows: number, cols: number) {
  const keyCount = rows * cols;
  const layerByteSize = keyCount * 2;
  const bytes: number[] = [];

  for (let localOffset = 0; localOffset < layerByteSize; localOffset += VIA_MAX_BUFFER_BYTES) {
    const size = Math.min(VIA_MAX_BUFFER_BYTES, layerByteSize - localOffset);
    const absoluteOffset = layer * layerByteSize + localOffset;
    const response = await viaCommand(device, VIA_GET_KEYMAP_BUFFER, [
      (absoluteOffset >> 8) & 0xff,
      absoluteOffset & 0xff,
      size,
    ]);
    const chunk = Array.from(response.slice(4, 4 + size));
    if (chunk.length !== size) throw new Error(`Layer ${layer} returned a short keymap buffer.`);
    bytes.push(...chunk);
  }

  const keycodes: number[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    keycodes.push(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
  }
  return keycodes;
}

async function readLayerSlow(device: HidDevice, layer: number, rows: number, cols: number) {
  const keycodes: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const response = await viaCommand(device, VIA_GET_KEYCODE, [layer, row, col]);
      keycodes.push(((response[4] ?? 0) << 8) | (response[5] ?? 0));
    }
  }
  return keycodes;
}

export default function QmkDevicePanel() {
  const [device, setDevice] = useState<HidDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Ready to inspect a QMK Raw HID interface.');
  const [protocolVersion, setProtocolVersion] = useState<number | null>(null);
  const [layerCount, setLayerCount] = useState<number | null>(null);
  const [layerCountNote, setLayerCountNote] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [definition, setDefinition] = useState<ViaDefinition | null>(null);
  const [definitionName, setDefinitionName] = useState<string | null>(null);
  const [definitionWarning, setDefinitionWarning] = useState<string | null>(null);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [layerKeymaps, setLayerKeymaps] = useState<number[][]>([]);
  const [activeLayer, setActiveLayer] = useState(0);
  const [keymapError, setKeymapError] = useState<string | null>(null);

  const hidSupported = !!getHidApi();
  const secureContext = typeof window === 'undefined' || window.isSecureContext;
  const collections = useMemo(
    () => flattenCollections(device?.collections ?? []),
    [device],
  );
  const rawCollections = useMemo(
    () => collections.filter(
      (collection) => collection.usagePage === QMK_RAW_USAGE_PAGE && collection.usage === QMK_RAW_USAGE,
    ),
    [collections],
  );
  const viaDetected = protocolVersion !== null;
  const matrixRows = definition?.matrix?.rows ?? 0;
  const matrixCols = definition?.matrix?.cols ?? 0;
  const activeKeymap = layerKeymaps[activeLayer] ?? null;

  useEffect(() => () => {
    if (device?.opened) void device.close();
  }, [device]);

  function resetKeymap() {
    setLayerKeymaps([]);
    setActiveLayer(0);
    setKeymapError(null);
  }

  function resetDefinition() {
    setDefinition(null);
    setDefinitionName(null);
    setDefinitionWarning(null);
    setDefinitionError(null);
    resetKeymap();
  }

  function resetProbe() {
    setProtocolVersion(null);
    setLayerCount(null);
    setLayerCountNote(null);
    setProbeError(null);
    resetKeymap();
  }

  async function connect() {
    const hid = getHidApi();
    if (!hid) {
      setMessage('WebHID is not available in this browser. Use Chrome or Edge on desktop.');
      return;
    }

    setBusy(true);
    resetProbe();
    resetDefinition();
    setMessage('Choose a QMK / VIA Raw HID device…');
    try {
      const devices = await hid.requestDevice({
        filters: [{ usagePage: QMK_RAW_USAGE_PAGE, usage: QMK_RAW_USAGE }],
      });
      const selected = devices[0];
      if (!selected) {
        setMessage('No device selected.');
        return;
      }
      if (!selected.opened) await selected.open();
      setDevice(selected);
      setMessage('Raw HID interface opened. No VIA command has been sent yet.');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotFoundError') {
        setMessage('Device selection cancelled.');
      } else {
        setMessage(`WebHID connection failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function probeVia() {
    if (!device) return;
    setBusy(true);
    resetProbe();
    setMessage('Sending read-only VIA protocol probe…');
    try {
      const protocolResponse = await viaCommand(device, VIA_GET_PROTOCOL_VERSION);
      const version = (protocolResponse[1] << 8) | protocolResponse[2];
      if (version <= 0) throw new Error('Device returned an invalid VIA protocol version.');

      setProtocolVersion(version);

      if (version >= VIA_PROTOCOL_BETA) {
        const layerResponse = await viaCommand(device, VIA_GET_LAYER_COUNT);
        const count = layerResponse[1] ?? 0;
        if (count > 0) {
          setLayerCount(count);
          setLayerCountNote('queried with DYNAMIC_KEYMAP_GET_LAYER_COUNT');
        } else {
          setLayerCountNote('layer-count command returned zero');
        }
      } else if (version === VIA_PROTOCOL_ALPHA) {
        setLayerCount(4);
        setLayerCountNote('legacy VIA v7 default; layer count was not queried');
      } else {
        setLayerCountNote('older than the VIA v7 baseline used by the current VIA app');
      }

      setMessage(`VIA protocol response detected: version ${version}.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setProbeError(text);
      setMessage('No valid VIA protocol response was detected.');
    } finally {
      setBusy(false);
    }
  }

  async function loadDefinition(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setDefinitionError(null);
    setDefinitionWarning(null);
    resetKeymap();
    try {
      const parsed = JSON.parse(await file.text()) as ViaDefinition;
      const rows = Number(parsed.matrix?.rows ?? 0);
      const cols = Number(parsed.matrix?.cols ?? 0);
      if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0) {
        throw new Error('Definition does not contain a valid matrix.rows / matrix.cols.');
      }
      if (rows * cols > 512) throw new Error(`Matrix ${rows}x${cols} is unexpectedly large.`);

      setDefinition(parsed);
      setDefinitionName(parsed.name || file.name);

      if (device) {
        const defVid = parseUsbId(parsed.vendorId);
        const defPid = parseUsbId(parsed.productId);
        if ((defVid !== null && defVid !== device.vendorId) || (defPid !== null && defPid !== device.productId)) {
          setDefinitionWarning(
            `Definition VID/PID ${defVid === null ? '?' : hex4(defVid)}:${defPid === null ? '?' : hex4(defPid)} does not match connected device ${hex4(device.vendorId)}:${hex4(device.productId)}.`,
          );
        }
      }
      setMessage(`Loaded VIA definition “${parsed.name || file.name}” with matrix ${rows}x${cols}.`);
    } catch (error) {
      setDefinition(null);
      setDefinitionName(null);
      setDefinitionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function readLayers() {
    if (!device || protocolVersion === null || !layerCount || !definition) return;
    if (!matrixRows || !matrixCols) return;

    setBusy(true);
    setKeymapError(null);
    setLayerKeymaps([]);
    setActiveLayer(0);
    try {
      const loaded: number[][] = [];
      for (let layer = 0; layer < layerCount; layer += 1) {
        setMessage(`Reading VIA layer ${layer + 1}/${layerCount} (read-only)…`);
        loaded.push(
          protocolVersion >= VIA_PROTOCOL_BETA
            ? await readLayerFast(device, layer, matrixRows, matrixCols)
            : await readLayerSlow(device, layer, matrixRows, matrixCols),
        );
      }
      setLayerKeymaps(loaded);
      setMessage(`Read ${loaded.length} layer(s), ${matrixRows}x${matrixCols} matrix, without writing firmware state.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setKeymapError(text);
      setMessage('VIA keymap read failed.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!device) return;
    setBusy(true);
    try {
      if (device.opened) await device.close();
      setDevice(null);
      resetProbe();
      resetDefinition();
      setMessage('QMK / VIA Raw HID interface released.');
    } catch (error) {
      setMessage(`WebHID disconnect warning: ${error instanceof Error ? error.message : String(error)}`);
      setDevice(null);
      resetProbe();
      resetDefinition();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel qmk-device-panel">
      <div className="panel-heading qmk-panel-heading">
        <div>
          <div className="eyebrow">QMK / VIA</div>
          <h3>Raw HID inspector</h3>
          <p>
            Selects only the default QMK Raw HID usage page {hex4(QMK_RAW_USAGE_PAGE)} / usage {hex(QMK_RAW_USAGE)}.
            After connecting, VIA protocol and keymap reads are explicit read-only actions.
          </p>
        </div>
        <div className="qmk-actions">
          {device && (
            <button className="button" type="button" onClick={() => void probeVia()} disabled={busy}>
              {busy ? 'Working…' : viaDetected ? 'Probe VIA again' : 'Probe VIA (read-only)'}
            </button>
          )}
          <button
            className={device ? 'button secondary' : 'button'}
            type="button"
            onClick={() => void (device ? disconnect() : connect())}
            disabled={busy || !hidSupported || !secureContext}
          >
            {busy ? 'Working…' : device ? 'Disconnect QMK' : 'Connect QMK / VIA'}
          </button>
        </div>
      </div>

      {!secureContext && (
        <div className="notice">WebHID requires a secure HTTPS context (localhost is also allowed).</div>
      )}
      {!hidSupported && (
        <div className="notice">WebHID is unavailable. Use desktop Chrome or Edge.</div>
      )}

      <div className="qmk-message">{message}</div>
      {probeError && <div className="notice">VIA probe: {probeError}</div>}

      {device && (
        <div className="qmk-device-details">
          <div className="qmk-summary-grid">
            <div><small>Product</small><strong>{device.productName || 'Unknown HID device'}</strong></div>
            <div><small>VID</small><strong><code>{hex4(device.vendorId)}</code></strong></div>
            <div><small>PID</small><strong><code>{hex4(device.productId)}</code></strong></div>
            <div><small>Raw HID match</small><strong>{rawCollections.length ? 'Yes' : 'Descriptor not exposed'}</strong></div>
            <div><small>VIA protocol</small><strong>{protocolVersion === null ? 'Not probed' : `v${protocolVersion}`}</strong></div>
            <div><small>Dynamic layers</small><strong>{layerCount ?? 'Unknown'}</strong>{layerCountNote && <small>{layerCountNote}</small>}</div>
          </div>

          {viaDetected && layerCount && (
            <section className="qmk-definition-box">
              <div className="qmk-definition-heading">
                <div>
                  <h4>VIA definition & Layer Viewer</h4>
                  <p>Load the keyboard's VIA JSON locally so My Keeb Studio knows the matrix rows and columns. The file is not uploaded anywhere.</p>
                </div>
                <label className="button secondary qmk-file-button">
                  Load VIA JSON
                  <input type="file" accept="application/json,.json" onChange={(event) => void loadDefinition(event)} />
                </label>
              </div>

              {definitionError && <div className="notice">Definition: {definitionError}</div>}
              {definitionWarning && <div className="notice">{definitionWarning}</div>}

              {definition && (
                <>
                  <div className="qmk-definition-summary">
                    <span><small>Definition</small><strong>{definitionName}</strong></span>
                    <span><small>Matrix</small><strong>{matrixRows} × {matrixCols}</strong></span>
                    <span><small>Layers</small><strong>{layerCount}</strong></span>
                    <button className="button" type="button" onClick={() => void readLayers()} disabled={busy}>
                      {busy ? 'Reading…' : 'Read all layers (read-only)'}
                    </button>
                  </div>
                  <small className="qmk-definition-help">
                    Protocol v8+ uses DYNAMIC_KEYMAP_GET_BUFFER. VIA v7 falls back to DYNAMIC_KEYMAP_GET_KEYCODE for each matrix position.
                  </small>
                </>
              )}
            </section>
          )}

          {keymapError && <div className="notice">Layer Viewer: {keymapError}</div>}

          {activeKeymap && definition && (
            <section className="qmk-layer-viewer">
              <div className="qmk-layer-heading">
                <div>
                  <h4>QMK / VIA Layer Viewer</h4>
                  <p>Matrix view for now. Physical VIA layout rendering can be layered on next.</p>
                </div>
                <div className="qmk-layer-tabs">
                  {layerKeymaps.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      className={`qmk-layer-tab ${activeLayer === index ? 'active' : ''}`}
                      onClick={() => setActiveLayer(index)}
                    >
                      Layer {index}
                    </button>
                  ))}
                </div>
              </div>
              <div className="qmk-matrix-scroll">
                <div className="qmk-matrix-grid" style={{ gridTemplateColumns: `repeat(${matrixCols}, minmax(78px, 1fr))` }}>
                  {activeKeymap.map((keycode, index) => {
                    const row = Math.floor(index / matrixCols);
                    const col = index % matrixCols;
                    return (
                      <div className={`qmk-keycode-cell ${keycode === 0 ? 'empty' : ''}`} key={`${row}-${col}`}>
                        <small>r{row} c{col}</small>
                        <strong>{keycodeLabel(keycode)}</strong>
                        <code>{hex4(keycode)}</code>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          <div className="qmk-collections">
            <h4>HID collections</h4>
            {collections.length ? collections.map((collection, index) => (
              <div className="qmk-collection-row" key={`${collection.usagePage}-${collection.usage}-${index}`}>
                <span>
                  <code>{hex4(collection.usagePage)}</code> / <code>{hex(collection.usage)}</code>
                  {collection.usagePage === QMK_RAW_USAGE_PAGE && collection.usage === QMK_RAW_USAGE && (
                    <span className="pill">QMK Raw HID default</span>
                  )}
                </span>
                <small>
                  in {collection.inputReports?.length ?? 0} · out {collection.outputReports?.length ?? 0} · feature {collection.featureReports?.length ?? 0}
                </small>
              </div>
            )) : <p>No collection metadata was exposed by the browser.</p>}
          </div>

          <div className="qmk-readonly-note">
            VIA access is read-only in this preview. The app uses GET_PROTOCOL_VERSION, GET_LAYER_COUNT, and keymap GET commands only. It does not write EEPROM, modify the keymap, reset macros, or enter the bootloader.
          </div>
        </div>
      )}
    </section>
  );
}
