import { useMemo, useState } from 'react';
import type { BehaviorBinding } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import type { BehaviorOption } from './useStudioCore';

type KeyChoice = {
  label: string;
  page: number;
  usage: number;
};

const LETTERS: KeyChoice[] = Array.from({ length: 26 }, (_, index) => ({
  label: String.fromCharCode(65 + index),
  page: 0x07,
  usage: 4 + index,
}));

const NUMBERS: KeyChoice[] = [
  ...Array.from({ length: 9 }, (_, index) => ({ label: String(index + 1), page: 0x07, usage: 30 + index })),
  { label: '0', page: 0x07, usage: 39 },
];

const MODIFIERS: KeyChoice[] = [
  { label: 'LCtrl', page: 0x07, usage: 224 },
  { label: 'LShift', page: 0x07, usage: 225 },
  { label: 'LAlt', page: 0x07, usage: 226 },
  { label: 'LGUI', page: 0x07, usage: 227 },
  { label: 'RCtrl', page: 0x07, usage: 228 },
  { label: 'RShift', page: 0x07, usage: 229 },
  { label: 'RAlt', page: 0x07, usage: 230 },
  { label: 'RGUI', page: 0x07, usage: 231 },
];

const NAVIGATION: KeyChoice[] = [
  { label: 'Esc', page: 0x07, usage: 41 },
  { label: 'Tab', page: 0x07, usage: 43 },
  { label: 'Enter', page: 0x07, usage: 40 },
  { label: 'Space', page: 0x07, usage: 44 },
  { label: 'Backspace', page: 0x07, usage: 42 },
  { label: 'Delete', page: 0x07, usage: 76 },
  { label: 'Insert', page: 0x07, usage: 73 },
  { label: 'Home', page: 0x07, usage: 74 },
  { label: 'End', page: 0x07, usage: 77 },
  { label: 'Page Up', page: 0x07, usage: 75 },
  { label: 'Page Down', page: 0x07, usage: 78 },
  { label: '←', page: 0x07, usage: 80 },
  { label: '↓', page: 0x07, usage: 81 },
  { label: '↑', page: 0x07, usage: 82 },
  { label: '→', page: 0x07, usage: 79 },
];

const SYMBOLS: KeyChoice[] = [
  { label: '-', page: 0x07, usage: 45 },
  { label: '=', page: 0x07, usage: 46 },
  { label: '[', page: 0x07, usage: 47 },
  { label: ']', page: 0x07, usage: 48 },
  { label: '\\', page: 0x07, usage: 49 },
  { label: ';', page: 0x07, usage: 51 },
  { label: "'", page: 0x07, usage: 52 },
  { label: '`', page: 0x07, usage: 53 },
  { label: ',', page: 0x07, usage: 54 },
  { label: '.', page: 0x07, usage: 55 },
  { label: '/', page: 0x07, usage: 56 },
  { label: 'Caps Lock', page: 0x07, usage: 57 },
];

const FUNCTION_KEYS: KeyChoice[] = Array.from({ length: 12 }, (_, index) => ({
  label: `F${index + 1}`,
  page: 0x07,
  usage: 58 + index,
}));

const MEDIA: KeyChoice[] = [
  { label: 'Play/Pause', page: 0x0c, usage: 0xcd },
  { label: 'Previous', page: 0x0c, usage: 0xb6 },
  { label: 'Next', page: 0x0c, usage: 0xb5 },
  { label: 'Mute', page: 0x0c, usage: 0xe2 },
  { label: 'Volume -', page: 0x0c, usage: 0xea },
  { label: 'Volume +', page: 0x0c, usage: 0xe9 },
];

function encodedUsage(choice: KeyChoice) {
  return ((choice.page & 0xff) << 16) | (choice.usage & 0xffff);
}

function findKeyPressBehavior(options: BehaviorOption[] | null) {
  if (!options) return undefined;
  return options.find((option) => /key\s*press|keypress/i.test(option.displayName));
}

function Section({ title, choices, onChoose, disabled }: {
  title: string;
  choices: KeyChoice[];
  onChoose: (choice: KeyChoice) => void;
  disabled: boolean;
}) {
  return (
    <section className="key-picker-section">
      <h4>{title}</h4>
      <div className="key-picker-grid">
        {choices.map((choice) => (
          <button
            type="button"
            className="key-picker-key"
            key={`${choice.page}:${choice.usage}`}
            disabled={disabled}
            onClick={() => onChoose(choice)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </section>
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
  const [advancedBinding, setAdvancedBinding] = useState<BehaviorBinding>({ ...currentBinding });
  const keyPressBehavior = useMemo(() => findKeyPressBehavior(behaviorOptions), [behaviorOptions]);

  function choose(choice: KeyChoice) {
    if (!keyPressBehavior) return;
    onChooseBinding({
      behaviorId: keyPressBehavior.id,
      param1: encodedUsage(choice),
      param2: 0,
    });
  }

  return (
    <section className="panel key-picker-panel">
      <div className="key-picker-heading">
        <div>
          <span>Editing position {position}</span>
          <h3>Choose a key</h3>
          <p>Selecting a key stages the change immediately and closes this picker.</p>
        </div>
        <div className="key-picker-heading-actions">
          <button type="button" className="button secondary" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? 'Quick keys' : 'Advanced'}
          </button>
          <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>

      {!keyPressBehavior && (
        <div className="notice">Key Press behavior metadata is unavailable. Use Advanced editing.</div>
      )}

      {!advanced ? (
        <div className="key-picker-sections">
          <Section title="Letters" choices={LETTERS} onChoose={choose} disabled={busy || !keyPressBehavior} />
          <Section title="Numbers" choices={NUMBERS} onChoose={choose} disabled={busy || !keyPressBehavior} />
          <Section title="Modifiers" choices={MODIFIERS} onChoose={choose} disabled={busy || !keyPressBehavior} />
          <Section title="Navigation" choices={NAVIGATION} onChoose={choose} disabled={busy || !keyPressBehavior} />
          <Section title="Symbols" choices={SYMBOLS} onChoose={choose} disabled={busy || !keyPressBehavior} />
          <Section title="Function" choices={FUNCTION_KEYS} onChoose={choose} disabled={busy || !keyPressBehavior} />
          <Section title="Media" choices={MEDIA} onChoose={choose} disabled={busy || !keyPressBehavior} />
        </div>
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
