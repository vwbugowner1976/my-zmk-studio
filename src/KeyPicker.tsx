import { useMemo, useState, type CSSProperties } from 'react';
import type { BehaviorBinding } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import type { BehaviorOption } from './useStudioCore';
import BehaviorParamEditor from './BehaviorParamEditor';

type PickerLayout = 'US' | 'JP';
type BindingCategory = 'keyboard' | 'mouse' | 'media' | 'layers' | 'bluetooth' | 'other';

type KeyChoice = {
  label: string;
  page: number;
  usage: number;
  units?: number;
  secondary?: string;
};

const LAYOUT_STORAGE_KEY = 'my-zmk-studio-key-picker-layout';

const CATEGORIES: Array<{ id: BindingCategory; label: string }> = [
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'mouse', label: 'Mouse' },
  { id: 'media', label: 'Media' },
  { id: 'layers', label: 'Layers' },
  { id: 'bluetooth', label: 'Bluetooth' },
  { id: 'other', label: 'Other' },
];

const key = (label: string, usage: number, units = 1, secondary?: string): KeyChoice => ({ label, page: 0x07, usage, units, secondary });

const letters: Record<string, number> = Object.fromEntries(
  Array.from({ length: 26 }, (_, index) => [String.fromCharCode(65 + index), 4 + index]),
);

const US_ROWS: KeyChoice[][] = [
  [key('Esc', 41, 1.25), ...Array.from({ length: 12 }, (_, index) => key(`F${index + 1}`, 58 + index))],
  [
    key('`', 53, 1, '~'), key('1', 30, 1, '!'), key('2', 31, 1, '@'), key('3', 32, 1, '#'),
    key('4', 33, 1, '$'), key('5', 34, 1, '%'), key('6', 35, 1, '^'), key('7', 36, 1, '&'),
    key('8', 37, 1, '*'), key('9', 38, 1, '('), key('0', 39, 1, ')'), key('-', 45, 1, '_'),
    key('=', 46, 1, '+'), key('Backspace', 42, 2),
  ],
  [key('Tab', 43, 1.5), ...'QWERTYUIOP'.split('').map((label) => key(label, letters[label])), key('[', 47, 1, '{'), key(']', 48, 1, '}'), key('\\', 49, 1.5, '|')],
  [key('Caps', 57, 1.8), ...'ASDFGHJKL'.split('').map((label) => key(label, letters[label])), key(';', 51, 1, ':'), key("'", 52, 1, '"'), key('Enter', 40, 2.2)],
  [key('LShift', 225, 2.25), ...'ZXCVBNM'.split('').map((label) => key(label, letters[label])), key(',', 54, 1, '<'), key('.', 55, 1, '>'), key('/', 56, 1, '?'), key('RShift', 229, 2.75)],
  [key('LCtrl', 224, 1.4), key('LGUI', 227, 1.4), key('LAlt', 226, 1.4), key('Space', 44, 6.2), key('RAlt', 230, 1.4), key('RGUI', 231, 1.4), key('RCtrl', 228, 1.4)],
];

const JP_ROWS: KeyChoice[][] = [
  [key('Esc', 41, 1.25), ...Array.from({ length: 12 }, (_, index) => key(`F${index + 1}`, 58 + index))],
  [
    key('半角/全角', 53, 1.35), key('1', 30, 1, '!'), key('2', 31, 1, '"'), key('3', 32, 1, '#'),
    key('4', 33, 1, '$'), key('5', 34, 1, '%'), key('6', 35, 1, '&'), key('7', 36, 1, "'"),
    key('8', 37, 1, '('), key('9', 38, 1, ')'), key('0', 39), key('-', 45, 1, '='),
    key('^', 46, 1, '~'), key('¥', 137, 1, '|'), key('Backspace', 42, 1.8),
  ],
  [key('Tab', 43, 1.5), ...'QWERTYUIOP'.split('').map((label) => key(label, letters[label])), key('@', 47, 1, '`'), key('[', 48, 1, '{'), key('Enter', 40, 2)],
  [key('Caps', 57, 1.8), ...'ASDFGHJKL'.split('').map((label) => key(label, letters[label])), key(';', 51, 1, '+'), key(':', 52, 1, '*'), key(']', 50, 1, '}')],
  [key('LShift', 225, 2.1), ...'ZXCVBNM'.split('').map((label) => key(label, letters[label])), key(',', 54, 1, '<'), key('.', 55, 1, '>'), key('/', 56, 1, '?'), key('\\', 135, 1, '_'), key('RShift', 229, 2.1)],
  [key('LCtrl', 224, 1.3), key('LGUI', 227, 1.3), key('LAlt', 226, 1.3), key('無変換', 139, 1.45), key('Space', 44, 3.5), key('変換', 138, 1.45), key('かな', 136, 1.45), key('RAlt', 230, 1.3), key('RCtrl', 228, 1.3)],
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

function behaviorCategory(option: BehaviorOption): BindingCategory {
  const name = option.displayName.toLowerCase();
  if (/mouse|pointer|scroll|wheel|move/.test(name)) return 'mouse';
  if (/bluetooth|\bbt\b/.test(name)) return 'bluetooth';
  if (/layer|momentary|toggle.*layer|to layer/.test(name)) return 'layers';
  if (/media|consumer|volume|play|mute|next|previous/.test(name)) return 'media';
  if (/key\s*press|keypress/.test(name)) return 'keyboard';
  return 'other';
}

function categoryForBinding(binding: BehaviorBinding, options: BehaviorOption[] | null): BindingCategory {
  const option = options?.find((item) => item.id === binding.behaviorId);
  return option ? behaviorCategory(option) : 'keyboard';
}

function loadLayout(): PickerLayout {
  try { return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'JP' ? 'JP' : 'US'; }
  catch { return 'US'; }
}

function KeyboardKey({ choice, onChoose, disabled }: { choice: KeyChoice; onChoose: (choice: KeyChoice) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      className="key-picker-key keyboard-layout-key"
      style={{ '--key-units': choice.units ?? 1 } as CSSProperties}
      disabled={disabled}
      onClick={() => onChoose(choice)}
      title={`HID ${choice.page.toString(16)}:${choice.usage.toString(16)}`}
    >
      {choice.secondary && <small>{choice.secondary}</small>}
      <strong>{choice.label}</strong>
    </button>
  );
}

function BehaviorCards({
  options,
  selectedId,
  onSelect,
}: {
  options: BehaviorOption[];
  selectedId: number;
  onSelect: (option: BehaviorOption) => void;
}) {
  if (!options.length) return <div className="binding-category-empty">No behaviors in this category.</div>;
  return (
    <div className="binding-behavior-grid">
      {options.map((option) => (
        <button
          type="button"
          key={option.id}
          className={`binding-behavior-card ${selectedId === option.id ? 'active' : ''}`}
          onClick={() => onSelect(option)}
        >
          <strong>{option.displayName}</strong>
          <small>Behavior #{option.id}</small>
        </button>
      ))}
    </div>
  );
}

export default function KeyPicker({
  position,
  currentBinding,
  behaviorOptions,
  busy,
  onChooseBinding,
  onCancel,
  contextLabel,
  title = 'Choose output',
  description,
}: {
  position?: number;
  currentBinding: BehaviorBinding;
  behaviorOptions: BehaviorOption[] | null;
  busy: boolean;
  onChooseBinding: (binding: BehaviorBinding) => void;
  onCancel: () => void;
  contextLabel?: string;
  title?: string;
  description?: string;
}) {
  const [layout, setLayout] = useState<PickerLayout>(loadLayout);
  const [binding, setBinding] = useState<BehaviorBinding>({ ...currentBinding });
  const [category, setCategory] = useState<BindingCategory>(() => categoryForBinding(currentBinding, behaviorOptions));
  const keyPressBehavior = useMemo(() => findKeyPressBehavior(behaviorOptions), [behaviorOptions]);
  const selectedBehavior = useMemo(
    () => behaviorOptions?.find((option) => option.id === binding.behaviorId),
    [behaviorOptions, binding.behaviorId],
  );
  const grouped = useMemo(() => {
    const result: Record<BindingCategory, BehaviorOption[]> = {
      keyboard: [], mouse: [], media: [], layers: [], bluetooth: [], other: [],
    };
    for (const option of behaviorOptions ?? []) result[behaviorCategory(option)].push(option);
    return result;
  }, [behaviorOptions]);
  const rows = layout === 'JP' ? JP_ROWS : US_ROWS;
  const label = contextLabel ?? (position === undefined ? 'Choose binding' : `Editing position ${position}`);

  function chooseKey(choice: KeyChoice) {
    if (!keyPressBehavior) return;
    onChooseBinding({ behaviorId: keyPressBehavior.id, param1: encodedUsage(choice), param2: 0 });
  }

  function changeLayout(next: PickerLayout) {
    setLayout(next);
    try { window.localStorage.setItem(LAYOUT_STORAGE_KEY, next); } catch { /* keep in memory */ }
  }

  function selectBehavior(option: BehaviorOption) {
    setBinding({ behaviorId: option.id, param1: 0, param2: 0 });
  }

  const showBehaviorEditor = category !== 'keyboard' && selectedBehavior && behaviorCategory(selectedBehavior) === category;

  return (
    <section className="panel key-picker-panel binding-picker-panel">
      <div className="key-picker-heading">
        <div>
          <span>{label}</span>
          <h3>{title}</h3>
          <p>{description ?? 'Choose a category, then select the output or behavior.'}</p>
        </div>
        <div className="key-picker-heading-actions">
          {category === 'keyboard' && (
            <div className="key-layout-toggle" role="group" aria-label="Keyboard layout">
              <button type="button" className={layout === 'US' ? 'active' : ''} onClick={() => changeLayout('US')}>US</button>
              <button type="button" className={layout === 'JP' ? 'active' : ''} onClick={() => changeLayout('JP')}>JP</button>
            </div>
          )}
          <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>

      <div className="binding-category-tabs" role="tablist" aria-label="Binding category">
        {CATEGORIES.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={category === item.id}
            key={item.id}
            className={category === item.id ? 'active' : ''}
            onClick={() => setCategory(item.id)}
          >
            {item.label}
            {item.id !== 'keyboard' && grouped[item.id].length > 0 && <small>{grouped[item.id].length}</small>}
          </button>
        ))}
      </div>

      {category === 'keyboard' ? (
        <>
          {!keyPressBehavior && <div className="notice">Key Press behavior metadata is unavailable.</div>}
          <div className={`standard-keyboard-picker layout-${layout.toLowerCase()}`}>
            {rows.map((row, rowIndex) => (
              <div className="standard-keyboard-row" key={`${layout}:${rowIndex}`}>
                {row.map((choice, choiceIndex) => (
                  <KeyboardKey key={`${choice.page}:${choice.usage}:${choiceIndex}`} choice={choice} onChoose={chooseKey} disabled={busy || !keyPressBehavior} />
                ))}
              </div>
            ))}
          </div>
        </>
      ) : category === 'media' ? (
        <>
          <div className="binding-quick-section">
            <div className="binding-quick-heading"><strong>Media keys</strong><span>Quick choices</span></div>
            <div className="key-picker-extra-keys">
              {MEDIA.map((choice) => <KeyboardKey key={`${choice.page}:${choice.usage}`} choice={choice} onChoose={chooseKey} disabled={busy || !keyPressBehavior} />)}
            </div>
          </div>
          <div className="binding-behavior-section">
            <div className="binding-quick-heading"><strong>Media behaviors</strong><span>Firmware behaviors</span></div>
            <BehaviorCards options={grouped.media} selectedId={binding.behaviorId} onSelect={selectBehavior} />
          </div>
        </>
      ) : (
        <div className="binding-behavior-section">
          <BehaviorCards options={grouped[category]} selectedId={binding.behaviorId} onSelect={selectBehavior} />
        </div>
      )}

      {showBehaviorEditor && (
        <div className="binding-parameter-editor">
          <div className="binding-selected-behavior">
            <div><span>Selected behavior</span><strong>{selectedBehavior.displayName}</strong></div>
            <code>#{selectedBehavior.id}</code>
          </div>
          <div className="binding-param-grid">
            <BehaviorParamEditor
              option={selectedBehavior}
              param={1}
              value={binding.param1}
              onChange={(param1) => setBinding({ ...binding, param1 })}
            />
            <BehaviorParamEditor
              option={selectedBehavior}
              param={2}
              value={binding.param2}
              onChange={(param2) => setBinding({ ...binding, param2 })}
            />
          </div>
          <button type="button" className="button metadata-use-binding" disabled={busy} onClick={() => onChooseBinding(binding)}>
            {busy ? 'Applying…' : 'Use this binding'}
          </button>
        </div>
      )}
    </section>
  );
}
