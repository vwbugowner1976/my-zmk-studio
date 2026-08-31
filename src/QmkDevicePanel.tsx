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

type HidDevice = {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName?: string;
  collections: HidCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
};

type HidApi = {
  requestDevice(options: {
    filters: Array<{ usagePage?: number; usage?: number }>;
  }): Promise<HidDevice[]>;
};

const QMK_RAW_USAGE_PAGE = 0xff60;
const QMK_RAW_USAGE = 0x61;

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

export default function QmkDevicePanel() {
  const [device, setDevice] = useState<HidDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Ready to inspect a QMK Raw HID interface.');

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

  useEffect(() => () => {
    if (device?.opened) void device.close();
  }, [device]);

  async function connect() {
    const hid = getHidApi();
    if (!hid) {
      setMessage('WebHID is not available in this browser. Use Chrome or Edge on desktop.');
      return;
    }

    setBusy(true);
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
      setMessage('Raw HID interface opened. Descriptor inspection only; no HID commands were sent.');
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

  async function disconnect() {
    if (!device) return;
    setBusy(true);
    try {
      if (device.opened) await device.close();
      setDevice(null);
      setMessage('QMK / VIA Raw HID interface released.');
    } catch (error) {
      setMessage(`WebHID disconnect warning: ${error instanceof Error ? error.message : String(error)}`);
      setDevice(null);
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
            This first implementation reads USB HID descriptors only.
          </p>
        </div>
        <button
          className={device ? 'button secondary' : 'button'}
          type="button"
          onClick={() => void (device ? disconnect() : connect())}
          disabled={busy || !hidSupported || !secureContext}
        >
          {busy ? 'Working…' : device ? 'Disconnect QMK' : 'Connect QMK / VIA'}
        </button>
      </div>

      {!secureContext && (
        <div className="notice">WebHID requires a secure HTTPS context (localhost is also allowed).</div>
      )}
      {!hidSupported && (
        <div className="notice">WebHID is unavailable. Use desktop Chrome or Edge.</div>
      )}

      <div className="qmk-message">{message}</div>

      {device && (
        <div className="qmk-device-details">
          <div className="qmk-summary-grid">
            <div><small>Product</small><strong>{device.productName || 'Unknown HID device'}</strong></div>
            <div><small>VID</small><strong><code>{hex4(device.vendorId)}</code></strong></div>
            <div><small>PID</small><strong><code>{hex4(device.productId)}</code></strong></div>
            <div><small>Raw HID match</small><strong>{rawCollections.length ? 'Yes' : 'Descriptor not exposed'}</strong></div>
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
            No VIA protocol request is sent automatically. A later step can add an explicit read-only VIA probe and keymap reader.
          </div>
        </div>
      )}
    </section>
  );
}
