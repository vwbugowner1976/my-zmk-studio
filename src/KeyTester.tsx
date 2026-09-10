import { useEffect, useMemo, useState } from 'react';
import { call_rpc, create_rpc_connection } from '@zmkfirmware/zmk-studio-ts-client';
import type { KeyPhysicalAttrs } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import { connectSerial } from './serialTransport';
import './keyTester.css';

type KeyEntry = {
  id: number;
  type: 'down' | 'up';
  code: string;
  key: string;
  repeat: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  time: string;
};

type PhysicalKey = {
  position: number;
  attrs: KeyPhysicalAttrs;
  code: string | null;
  label: string;
};

type LoadedLayout = {
  deviceName: string;
  keys: PhysicalKey[];
};

const KEY_ROWS = [
  ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'Backspace'],
  ['Tab', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['CapsLock', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Enter'],
  ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'ShiftRight'],
  ['ControlLeft', 'MetaLeft', 'AltLeft', 'Space', 'AltRight', 'MetaRight', 'ContextMenu', 'ControlRight'],
  ['Insert', 'Home', 'PageUp', 'Delete', 'End', 'PageDown', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'],
];

const HID_TO_CODE: Record<number, string> = {
  40: 'Enter', 41: 'Escape', 42: 'Backspace', 43: 'Tab', 44: 'Space',
  45: 'Minus', 46: 'Equal', 47: 'BracketLeft', 48: 'BracketRight', 49: 'Backslash',
  51: 'Semicolon', 52: 'Quote', 53: 'Backquote', 54: 'Comma', 55: 'Period', 56: 'Slash',
  57: 'CapsLock', 73: 'Insert', 74: 'Home', 75: 'PageUp', 76: 'Delete', 77: 'End', 78: 'PageDown',
  79: 'ArrowRight', 80: 'ArrowLeft', 81: 'ArrowDown', 82: 'ArrowUp',
  224: 'ControlLeft', 225: 'ShiftLeft', 226: 'AltLeft', 227: 'MetaLeft',
  228: 'ControlRight', 229: 'ShiftRight', 230: 'AltRight', 231: 'MetaRight',
};

for (let usage = 4; usage <= 29; usage += 1) HID_TO_CODE[usage] = `Key${String.fromCharCode(65 + usage - 4)}`;
for (let usage = 30; usage <= 38; usage += 1) HID_TO_CODE[usage] = `Digit${usage - 29}`;
HID_TO_CODE[39] = 'Digit0';
for (let usage = 58; usage <= 69; usage += 1) HID_TO_CODE[usage] = `F${usage - 57}`;

const keyLabel = (code: string) => {
  const aliases: Record<string, string> = {
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Meta', MetaRight: 'R Meta',
    CapsLock: 'Caps', Backspace: 'Backspace', ContextMenu: 'Menu', Space: 'Space',
    PageUp: 'PgUp', PageDown: 'PgDn', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  if (aliases[code]) return aliases[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
};

function hidParamToCode(value: number): string | null {
  const page = (value >>> 16) & 0xff;
  const usage = value & 0xffff;
  if (page !== 0x07) return null;
  return HID_TO_CODE[usage] ?? null;
}

function physicalGeometry(keys: PhysicalKey[]) {
  const u = (value: number) => value / 100;
  const maxX = Math.max(...keys.map((key) => u(key.attrs.x) + u(key.attrs.width)));
  const maxY = Math.max(...keys.map((key) => u(key.attrs.y) + u(key.attrs.height)));
  return { u, width: Math.max(1, maxX), height: Math.max(1, maxY) };
}

export default function KeyTester() {
  const [pressed, setPressed] = useState<Set<string>>(() => new Set());
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState<KeyEntry[]>([]);
  const [eventId, setEventId] = useState(0);
  const [layout, setLayout] = useState<LoadedLayout | null>(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState('Optional: load the keyboard physical layout from ZMK Studio.');

  useEffect(() => {
    const record = (event: KeyboardEvent, type: 'down' | 'up') => {
      if (type === 'down') {
        setPressed((current) => new Set(current).add(event.code));
        setSeen((current) => new Set(current).add(event.code));
      } else {
        setPressed((current) => {
          const next = new Set(current);
          next.delete(event.code);
          return next;
        });
      }
      setEventId((id) => {
        const nextId = id + 1;
        setHistory((current) => [{
          id: nextId,
          type,
          code: event.code,
          key: event.key,
          repeat: event.repeat,
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          meta: event.metaKey,
          time: new Date().toLocaleTimeString([], { hour12: false }),
        }, ...current].slice(0, 80));
        return nextId;
      });
    };

    const onKeyDown = (event: KeyboardEvent) => record(event, 'down');
    const onKeyUp = (event: KeyboardEvent) => record(event, 'up');
    const clearPressed = () => setPressed(new Set());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearPressed);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearPressed);
    };
  }, []);

  const last = history[0];
  const modifiers = useMemo(() => {
    if (!last) return '—';
    return [last.ctrl && 'Ctrl', last.shift && 'Shift', last.alt && 'Alt', last.meta && 'Meta'].filter(Boolean).join(' + ') || 'None';
  }, [last]);

  const reset = () => {
    setPressed(new Set());
    setSeen(new Set());
    setHistory([]);
  };

  async function loadPhysicalLayout() {
    setLayoutBusy(true);
    setLayoutMessage('Opening ZMK Studio…');
    let transport: Awaited<ReturnType<typeof connectSerial>> | null = null;
    let abort: AbortController | null = null;
    try {
      transport = await connectSerial();
      abort = new AbortController();
      const connection = create_rpc_connection(transport, { signal: abort.signal });
      const lock = await call_rpc(connection, { core: { getLockState: true } });
      if (lock.core?.getLockState === 0) {
        throw new Error('ZMK Studio is locked. Press the Studio Unlock key, then try again.');
      }

      const [layoutsResp, keymapResp, behaviorListResp, deviceResp] = await Promise.all([
        call_rpc(connection, { keymap: { getPhysicalLayouts: true } }),
        call_rpc(connection, { keymap: { getKeymap: true } }),
        call_rpc(connection, { behaviors: { listAllBehaviors: true } }),
        call_rpc(connection, { core: { getDeviceInfo: true } }),
      ]);

      const layouts = layoutsResp.keymap?.getPhysicalLayouts;
      const attrs = layouts?.layouts[layouts.activeLayoutIndex]?.keys ?? [];
      const baseLayer = keymapResp.keymap?.getKeymap?.layers?.[0];
      const behaviorIds = behaviorListResp.behaviors?.listAllBehaviors?.behaviors ?? [];
      const details = await Promise.all(behaviorIds.map((behaviorId) =>
        call_rpc(connection, { behaviors: { getBehaviorDetails: { behaviorId } } }),
      ));
      const keyPressIds = new Set<number>();
      details.forEach((response, index) => {
        const name = response.behaviors?.getBehaviorDetails?.displayName ?? '';
        if (/key\s*press|keypress/i.test(name)) keyPressIds.add(behaviorIds[index]);
      });

      const keys: PhysicalKey[] = attrs.map((key, position) => {
        const binding = baseLayer?.bindings?.[position];
        const code = binding && keyPressIds.has(binding.behaviorId) ? hidParamToCode(binding.param1) : null;
        return { position, attrs: key, code, label: code ? keyLabel(code) : `#${position}` };
      });
      if (!keys.length) throw new Error('This keyboard did not return a physical layout.');

      const deviceName = deviceResp.core?.getDeviceInfo?.name?.trim() || 'ZMK Keyboard';
      setLayout({ deviceName, keys });
      setLayoutMessage(`Loaded ${keys.length} physical keys from ${deviceName}. Studio port released.`);
    } catch (error) {
      setLayoutMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (abort && !abort.signal.aborted) abort.abort('Key Tester layout loaded');
      if (transport) {
        try { await transport.close(); } catch { /* best effort */ }
      }
      setLayoutBusy(false);
    }
  }

  const geometry = layout ? physicalGeometry(layout.keys) : null;

  return (
    <div className="key-tester">
      <section className="panel tester-summary">
        <div>
          <span className="tester-label">LAST INPUT</span>
          <strong className="tester-last-key">{last ? last.key : 'Press any key'}</strong>
          <code>{last?.code || 'Waiting for keyboard input…'}</code>
        </div>
        <div className="tester-stats">
          <div><span>Pressed now</span><strong>{pressed.size}</strong></div>
          <div><span>Keys seen</span><strong>{seen.size}</strong></div>
          <div><span>Modifiers</span><strong>{modifiers}</strong></div>
        </div>
        <button className="button secondary" type="button" onClick={reset}>Clear</button>
      </section>

      <section className="panel tester-layout-loader">
        <div>
          <h3>{layout ? layout.deviceName : 'Keyboard physical layout'}</h3>
          <p>{layoutMessage}</p>
        </div>
        <div className="tester-layout-actions">
          {layout && <button className="button secondary" type="button" onClick={() => setLayout(null)}>Use standard layout</button>}
          <button className="button" type="button" onClick={() => void loadPhysicalLayout()} disabled={layoutBusy}>
            {layoutBusy ? 'Loading…' : layout ? 'Reload Layout' : 'Load Keyboard Layout'}
          </button>
        </div>
      </section>

      <section className="panel tester-board-panel">
        <div className="panel-heading">
          <div>
            <h3>{layout ? 'Physical keyboard checker' : 'Keyboard checker'}</h3>
            <p>{layout ? 'Layout comes from ZMK Studio. Base-layer key output is used to map browser HID events to physical positions.' : 'Green keys are currently held. Previously detected keys remain marked until Clear.'}</p>
          </div>
        </div>

        {layout && geometry ? (
          <div className="tester-physical-scroll">
            <div className="tester-physical-board" style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}>
              {layout.keys.map(({ position, attrs, code, label }) => {
                const x = geometry.u(attrs.x);
                const y = geometry.u(attrs.y);
                const width = geometry.u(attrs.width);
                const height = geometry.u(attrs.height);
                const active = !!code && pressed.has(code);
                const detected = !!code && seen.has(code);
                const rx = geometry.u(attrs.rx);
                const ry = geometry.u(attrs.ry);
                return (
                  <div
                    key={position}
                    className={`tester-physical-key ${active ? 'pressed' : ''} ${detected ? 'seen' : ''}`}
                    style={{
                      left: `${(x / geometry.width) * 100}%`,
                      top: `${(y / geometry.height) * 100}%`,
                      width: `${(width / geometry.width) * 100}%`,
                      height: `${(height / geometry.height) * 100}%`,
                      transform: attrs.r ? `rotate(${attrs.r}deg)` : undefined,
                      transformOrigin: attrs.r ? `${((rx - x) / width) * 100}% ${((ry - y) / height) * 100}%` : undefined,
                    }}
                    title={`Position ${position}${code ? ` · ${code}` : ''}`}
                  >
                    <span>{label}</span>
                    <small>{position}{code ? ` · ${code}` : ''}</small>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="tester-board" aria-label="Keyboard tester">
            {KEY_ROWS.map((row, rowIndex) => (
              <div className="tester-row" key={rowIndex}>
                {row.map((code) => (
                  <div key={code} className={`tester-key ${pressed.has(code) ? 'pressed' : ''} ${seen.has(code) ? 'seen' : ''}`} title={code}>
                    <span>{keyLabel(code)}</span><small>{code}</small>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {layout && <p className="tester-layout-note">Note: if the same HID key is assigned to multiple physical positions, all matching positions light together. A later Prospector Bridge position-event mode can remove this ambiguity.</p>}
      </section>

      <section className="panel tester-log-panel">
        <div className="panel-heading"><div><h3>Input history</h3><p>Latest 80 key down/up events received by the browser.</p></div></div>
        <div className="tester-log">
          {history.length === 0 ? <div className="tester-empty">No key events yet.</div> : history.map((entry) => (
            <div className="tester-log-row" key={entry.id}>
              <span className={`tester-event ${entry.type}`}>{entry.type.toUpperCase()}</span>
              <strong>{entry.key}</strong><code>{entry.code}</code><span>{entry.repeat ? 'REPEAT' : ''}</span>
              <span>{[entry.ctrl && 'Ctrl', entry.shift && 'Shift', entry.alt && 'Alt', entry.meta && 'Meta'].filter(Boolean).join('+')}</span><time>{entry.time}</time>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
