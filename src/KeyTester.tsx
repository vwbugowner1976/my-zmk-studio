import { useEffect, useMemo, useState } from 'react';
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

const KEY_ROWS = [
  ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'Backspace'],
  ['Tab', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['CapsLock', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Enter'],
  ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'ShiftRight'],
  ['ControlLeft', 'MetaLeft', 'AltLeft', 'Space', 'AltRight', 'MetaRight', 'ContextMenu', 'ControlRight'],
  ['Insert', 'Home', 'PageUp', 'Delete', 'End', 'PageDown', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'],
];

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

export default function KeyTester() {
  const [pressed, setPressed] = useState<Set<string>>(() => new Set());
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState<KeyEntry[]>([]);
  const [eventId, setEventId] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      setPressed((current) => {
        const next = new Set(current);
        next.add(event.code);
        return next;
      });
      setSeen((current) => {
        const next = new Set(current);
        next.add(event.code);
        return next;
      });
      setEventId((id) => {
        const nextId = id + 1;
        setHistory((current) => [{
          id: nextId,
          type: 'down',
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

    const onKeyUp = (event: KeyboardEvent) => {
      setPressed((current) => {
        const next = new Set(current);
        next.delete(event.code);
        return next;
      });
      setEventId((id) => {
        const nextId = id + 1;
        setHistory((current) => [{
          id: nextId,
          type: 'up',
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

      <section className="panel tester-board-panel">
        <div className="panel-heading">
          <div>
            <h3>Keyboard checker</h3>
            <p>Green/active keys are currently held. Previously detected keys remain marked until Clear.</p>
          </div>
        </div>
        <div className="tester-board" aria-label="Keyboard tester">
          {KEY_ROWS.map((row, rowIndex) => (
            <div className="tester-row" key={rowIndex}>
              {row.map((code) => (
                <div
                  key={code}
                  className={`tester-key ${pressed.has(code) ? 'pressed' : ''} ${seen.has(code) ? 'seen' : ''}`}
                  title={code}
                >
                  <span>{keyLabel(code)}</span>
                  <small>{code}</small>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="panel tester-log-panel">
        <div className="panel-heading">
          <div><h3>Input history</h3><p>Latest 80 key down/up events received by the browser.</p></div>
        </div>
        <div className="tester-log">
          {history.length === 0 ? (
            <div className="tester-empty">No key events yet.</div>
          ) : history.map((entry) => (
            <div className="tester-log-row" key={entry.id}>
              <span className={`tester-event ${entry.type}`}>{entry.type.toUpperCase()}</span>
              <strong>{entry.key}</strong>
              <code>{entry.code}</code>
              <span>{entry.repeat ? 'REPEAT' : ''}</span>
              <span>{[entry.ctrl && 'Ctrl', entry.shift && 'Shift', entry.alt && 'Alt', entry.meta && 'Meta'].filter(Boolean).join('+')}</span>
              <time>{entry.time}</time>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
