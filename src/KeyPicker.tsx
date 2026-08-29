import { useMemo, useState } from 'react';
import type { BehaviorBinding } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import type { BehaviorOption } from './useStudioCore';

type PickerLayout = 'US' | 'JP';

type KeyChoice = {
  label: string;
  page: number;
  usage: number;
  units?: number;
  secondary?: string;
};

const LAYOUT_STORAGE_KEY = 'my-zmk-studio-key-picker-layout';

const key = (label: string, usage: number, units = 1, secondary?: string): KeyChoice => ({
  label,
  page: 0x07,
  usage,
  units,
  secondary,
});

const letters: Record<string, number> = Object.fromEntries(
  Array.from({ length: 26 }, (_, index) => [String.fromCharCode(65 + index), 4 + index]),
);

const US_ROWS: KeyChoice[][] = [
  [
    key('Esc', 41, 1.25),
    ...Array.from({ length: 12 }, (_, index) => key(`F${index + 1}`, 58 + index)),
  ],
  [
    key('`', 53, 1, '~'), key('1', 30, 1, '!'), key('2', 31, 1, '@'), key('3', 32, 1, '#'),
    key('4', 33, 1, '$'), key('5', 34, 1, '%'), key('6', 35, 1, '^'), key('7', 36, 1, '&'),
    key('8', 37, 1, '*'), key('9', 38, 1, '('), key('0', 39, 1, ')'), key('-', 45, 1, '_'),
    key('=', 46, 1, '+'), key('Backspace', 42, 2),
  ],
  [
    key('Tab', 43, 1.5), ...'QWERTYUIOP'.split('').map((label) => key(label, letters[label])),
    key('[', 47, 1, '{'), key(']', 48, 1, '}'), key('\\', 49, 1.5, '|'),
  ],
  [
    key('Caps', 57, 1.8), ...'ASDFGHJKL'.split('').map((label) => key(label, letters[label])),
    key(';', 51, 1, ':'), key("'", 52, 1, '"'), key('Enter', 40, 2.2),
  ],
  [
    key('LShift', 225, 2.25), ...'ZXCVBNM'.split('').map((label) => key(label, letters[label])),
    key(',', 54, 1, '<'), key('.', 55, 1, '>'), key('/', 56, 1, '?'), key('RShift', 229, 2.75),
  ],
  [
    key('LCtrl', 224, 1.4), key('LGUI', 227, 1.4), key('LAlt', 226, 1.4), key('Space', 44, 6.2),
    key('RAlt', 230, 1.4), key('RGUI', 231, 1.4), key('RCtrl', 228, 1.4),
  ],
];

const JP_ROWS: KeyChoice[][] = [
  [
    key('Esc', 41, 1.25),
    ...Array.from({ length: 12 }, (_, index) => key(`F${index + 1}`, 58 + index)),
  ],
  [
    key('半角/全角', 53, 1.35), key('1', 30, 1, '!'), key('2', 31, 1, '"'), key('3', 32, 1, '#'),
    key('4', 33, 1, '$'), key('5', 34, 1, '%'), key('6', 35, 1, '&'), key('7', 36, 1, "'"),
    key('8', 37, 1, '('), key('9', 38, 1, ')'), key('0', 39), key('-', 45, 1, '='),
    key('^', 46, 1, '~'), key('¥', 137, 1, '|'), key('Backspace', 42, 1.8),
  ],
  [
    key('Tab', 43, 1.5), ...'QWERTYUIOP'.split('').map((label) => key(label, letters[label])),
    key('@', 47, 1, '`'), key('[', 48, 1, '{'), key('Enter', 40, 2),
  ],
  [
    key('Caps', 57, 1.8), ...'ASDFGHJKL'.split('').map((label) => key(label, letters[label])),
    key(';', 51, 1, '+'), key(':', 52, 1, '*'), key(']', 50, 1, '}'),
  ],
  [
    key('LShift', 225, 2.1), ...'ZXCVBNM'.split('').map((label) => key(label, letters[label])),
    key(',', 54, 1, '<'), key('.', 55, 1, '>'), key('/', 56, 1, '?'), key('\\', 135, 1, '_'),
    key('RShift', 229, 2.1),
  ],
  [
    key('LCtrl', 224, 1.3), key('LGUI', 227, 1.3), key('LAlt', 226, 1.3), key('無変換', 139, 1.45),
    key('Space', 44, 3.5), key('変換', 138, 1.45), key('かな', 136, 1.45), key('RAlt', 230, 1.3), key('RCtrl', 228, 1.3),
  ],
];

const MEDIA: KeyChoice[] = [
  { label: 'Play/Pause', page: 0x0c, usage: 0xcd, units: 1.5 },
  { label: 'Previous', page: 0x0c, usage: 0xb6, units: 1.4 },
  { label: 'Next', page: 0x0c, usage: 0xb5, units: 1.2 },
  { label: 'Mute', page: 0x0c, usage: 0xe2, units: 1.1 },
  { label: 'Volume -', page: 0x0c, usage: 0xea, units: 1.3 },
  { label: 'Volume +', page: 0x0c, usage: 0xe9, units: 1.3 },
];

function encodedUsage(choice: KeyChoice) {
  return ((choice.page & 0xff) << 16) | (choice.usage & 0xffff);
}

function findKeyPressBehavior(options: BehaviorOption[] | null) {
  if (!options) return undefined;
  return options.find((option) => /key\s*press|keypress/i.test(option.displayName));
}

function loadLayout(): PickerLayout {
  try {
    return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'JP' ? 'JP' : 'US';
  } catch {
    return 'US';
  }
}

function KeyboardKey({ choice, onChoose, disabled }: {
  choice: KeyChoice;
  onChoose: (choice: KeyChoice) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className="key-picker-key keyboard-layout-key"
      style={{ '--key-units': choice.units ?? 1 } as React.CSSProperties}
      disabled={disabled}
      onClick={() => onChoose(choice)}
      title={`HID ${choice.page.toString(16)}:${choice.usage.toString(16)}`}
    >
      {choice.secondary && <small>{choice.secondary}</small>}
      <strong>{choice.label}</strong>
    </button>
  );
}

export default function KeyPicker({
  position,
  currentBinding,
  behaviorOptions,
  busy,
  onChooseBinding,
  onCancel,
}: {
  position: number;
  currentBinding: BehaviorBinding;
  behaviorOptions: BehaviorOption[] | null;
  busy: boolean;
  onChooseBinding: (binding: BehaviorBinding) => void;
  onCancel: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [layout, setLayout] = useState<PickerLayout>(loadLayout);
  const [advancedBinding, setAdvancedBinding] = useState<BehaviorBinding>({ ...currentBinding });
  const keyPressBehavior = useMemo(() => findKeyPressBehavior(behaviorOptions), [behaviorOptions]);
  const rows = layout === 'JP' ? JP_ROWS : US_ROWS;

  function choose(choice: KeyChoice) {
    if (!keyPressBehavior) return;
    onChooseBinding({
      behaviorId: keyPressBehavior.id,
      param1: encodedUsage(choice),
      param2: 0,
    });
  }

  function changeLayout(next: PickerLayout) {
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
      // Keep the in-memory choice if localStorage is unavailable.
    }
  }

  return (
    <section className="panel key-picker-panel">
      <div className="key-picker-heading">
        <div>
          <span>Editing position {position}</span>
          <h3>Choose a key</h3>
          <p>Select a key from a standard {layout === 'JP' ? 'Japanese JIS' : 'US ANSI'} layout. The picker closes after staging it.</p>
        </div>
        <div className="key-picker-heading-actions">
          {!advanced && (
            <div className="key-layout-toggle" role="group" aria-label="Keyboard layout">
              <button type="button" className={layout === 'US' ? 'active' : ''} onClick={() => changeLayout('US')}>US</button>
              <button type="button" className={layout === 'JP' ? 'active' : ''} onClick={() => changeLayout('JP')}>JP</button>
            </div>
          )}
          <button type="button" className="button secondary" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? 'Keyboard' : 'Advanced'}
          </button>
          <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>

      {!keyPressBehavior && (
        <div className="notice">Key Press behavior metadata is unavailable. Use Advanced editing.</div>
      )}

      {!advanced ? (
        <>
          <div className={`standard-keyboard-picker layout-${layout.toLowerCase()}`}>
            {rows.map((row, rowIndex) => (
              <div className="standard-keyboard-row" key={`${layout}:${rowIndex}`}>
                {row.map((choice, choiceIndex) => (
                  <KeyboardKey
                    key={`${choice.page}:${choice.usage}:${choiceIndex}`}
                    choice={choice}
                    onChoose={choose}
                    disabled={busy || !keyPressBehavior}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="key-picker-extra">
            <span>Media</span>
            <div className="key-picker-extra-keys">
              {MEDIA.map((choice) => (
                <KeyboardKey key={`${choice.page}:${choice.usage}`} choice={choice} onChoose={choose} disabled={busy || !keyPressBehavior} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="key-picker-advanced">
          <label>
            Behavior
            {behaviorOptions?.length ? (
              <select
                value={advancedBinding.behaviorId}
                onChange={(event) => setAdvancedBinding({ behaviorId: Number(event.target.value), param1: 0, param2: 0 })}
              >
                {!behaviorOptions.some((option) => option.id === advancedBinding.behaviorId) && (
                  <option value={advancedBinding.behaviorId}>Unknown behavior (#{advancedBinding.behaviorId})</option>
                )}
                {behaviorOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.displayName} (#{option.id})</option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                value={advancedBinding.behaviorId}
                onChange={(event) => setAdvancedBinding({ ...advancedBinding, behaviorId: Number(event.target.value) })}
              />
            )}
          </label>
          <label>
            Param 1
            <input type="number" value={advancedBinding.param1} onChange={(event) => setAdvancedBinding({ ...advancedBinding, param1: Number(event.target.value) })} />
          </label>
          <label>
            Param 2
            <input type="number" value={advancedBinding.param2} onChange={(event) => setAdvancedBinding({ ...advancedBinding, param2: Number(event.target.value) })} />
          </label>
          <button type="button" className="button" disabled={busy} onClick={() => onChooseBinding(advancedBinding)}>
            {busy ? 'Applying…' : 'Apply advanced binding'}
          </button>
        </div>
      )}
    </section>
  );
}
