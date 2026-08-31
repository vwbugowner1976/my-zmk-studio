import { useEffect, useMemo, useState } from 'react';

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

const QMK_RAW_USAGE_PAGE = 0xff60;
const QMK_RAW_USAGE = 0x61;
const VIA_REPORT_ID = 0;
const VIA_REPORT_SIZE = 32;
const VIA_GET_PROTOCOL_VERSION = 0x01;
const VIA_GET_LAYER_COUNT = 0x11;
const VIA_PROTOCOL_ALPHA = 7;
const VIA_PROTOCOL_BETA = 8;

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

export default function QmkDevicePanel() {
  const [device, setDevice] = useState<HidDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Ready to inspect a QMK Raw HID interface.');
  const [protocolVersion, setProtocolVersion] = useState<number | null>(null);
  const [layerCount, setLayerCount] = useState<number | null>(null);
  const [layerCountNote, setLayerCountNote] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

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

  useEffect(() => () => {
    if (device?.opened) void device.close();
  }, [device]);

  function resetProbe() {
    setProtocolVersion(null);
    setLayerCount(null);
    setLayerCountNote(null);
    setProbeError(null);
  }

  async function connect() {
    const hid = getHidApi();
    if (!hid) {
      setMessage('WebHID is not available in this browser. Use Chrome or Edge on desktop.');
      return;
    }

    setBusy(true);
    resetProbe();
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

  async function disconnect() {
    if (!device) return;
    setBusy(true);
    try {
      if (device.opened) await device.close();
      setDevice(null);
      resetProbe();
      setMessage('QMK / VIA Raw HID interface released.');
    } catch (error) {
      setMessage(`WebHID disconnect warning: ${error instanceof Error ? error.message : String(error)}`);
      setDevice(null);
      resetProbe();
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
            After connecting, the VIA probe is an explicit read-only action.
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
            The VIA probe sends only GET_PROTOCOL_VERSION and, for protocol v8+, DYNAMIC_KEYMAP_GET_LAYER_COUNT. It does not write EEPROM, modify the keymap, or enter the bootloader.
          </div>
        </div>
      )}
    </section>
  );
}
