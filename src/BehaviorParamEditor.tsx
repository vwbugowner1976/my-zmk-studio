import type { BehaviorParameterValueDescription } from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import type { BehaviorOption } from './useStudioCore';

type ParamNumber = 1 | 2;
type HidChoice = { label: string; page: number; usage: number };

const HID_KEY_ROWS: HidChoice[][] = [
  [
    { label: 'Esc', page: 0x07, usage: 41 },
    ...Array.from({ length: 12 }, (_, index) => ({ label: `F${index + 1}`, page: 0x07, usage: 58 + index })),
  ],
  [
    { label: '`', page: 0x07, usage: 53 },
    ...Array.from({ length: 9 }, (_, index) => ({ label: String(index + 1), page: 0x07, usage: 30 + index })),
    { label: '0', page: 0x07, usage: 39 },
    { label: '-', page: 0x07, usage: 45 },
    { label: '=', page: 0x07, usage: 46 },
    { label: 'Backspace', page: 0x07, usage: 42 },
  ],
  [
    { label: 'Tab', page: 0x07, usage: 43 },
    ...'QWERTYUIOP'.split('').map((label, index) => ({ label, page: 0x07, usage: 20 + index })),
    { label: '[', page: 0x07, usage: 47 },
    { label: ']', page: 0x07, usage: 48 },
    { label: '\\', page: 0x07, usage: 49 },
  ],
  [
    { label: 'Caps', page: 0x07, usage: 57 },
    ...'ASDFGHJKL'.split('').map((label, index) => ({ label, page: 0x07, usage: 4 + index })),
    { label: ';', page: 0x07, usage: 51 },
    { label: "'", page: 0x07, usage: 52 },
    { label: 'Enter', page: 0x07, usage: 40 },
  ],
  [
    { label: 'LShift', page: 0x07, usage: 225 },
    ...'ZXCVBNM'.split('').map((label, index) => ({ label, page: 0x07, usage: 29 - index })),
    { label: ',', page: 0x07, usage: 54 },
    { label: '.', page: 0x07, usage: 55 },
    { label: '/', page: 0x07, usage: 56 },
    { label: 'RShift', page: 0x07, usage: 229 },
  ],
  [
    { label: 'LCtrl', page: 0x07, usage: 224 },
    { label: 'LGUI', page: 0x07, usage: 227 },
    { label: 'LAlt', page: 0x07, usage: 226 },
    { label: 'Space', page: 0x07, usage: 44 },
    { label: 'RAlt', page: 0x07, usage: 230 },
    { label: 'RGUI', page: 0x07, usage: 231 },
    { label: 'RCtrl', page: 0x07, usage: 228 },
  ],
];

const MEDIA_CHOICES: HidChoice[] = [
  { label: 'Play/Pause', page: 0x0c, usage: 0xcd },
  { label: 'Previous', page: 0x0c, usage: 0xb6 },
  { label: 'Next', page: 0x0c, usage: 0xb5 },
  { label: 'Mute', page: 0x0c, usage: 0xe2 },
  { label: 'Volume -', page: 0x0c, usage: 0xea },
  { label: 'Volume +', page: 0x0c, usage: 0xe9 },
];

function encodeHid(choice: HidChoice) {
  return ((choice.page & 0xff) << 16) | (choice.usage & 0xffff);
}

function descriptionsFor(option: BehaviorOption | undefined, param: ParamNumber) {
  if (!option) return [];
  const all = option.metadata.flatMap((set) => param === 1 ? set.param1 : set.param2);
  const seen = new Set<string>();
  return all.filter((item) => {
    const key = `${item.name}|${item.constant ?? ''}|${item.range?.min ?? ''}:${item.range?.max ?? ''}|${!!item.hidUsage}|${!!item.layerId}|${!!item.nil}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mouseButtonLabel(name: string, value: number) {
  const compact = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const byName: Record<string, string> = {
    MB1: 'Left', MOUSEBUTTON1: 'Left', BUTTON1: 'Left',
    MB2: 'Right', MOUSEBUTTON2: 'Right', BUTTON2: 'Right',
    MB3: 'Middle', MOUSEBUTTON3: 'Middle', BUTTON3: 'Middle',
    MB4: 'Back', MOUSEBUTTON4: 'Back', BUTTON4: 'Back',
    MB5: 'Forward', MOUSEBUTTON5: 'Forward', BUTTON5: 'Forward',
  };
  return byName[compact] ?? (name || `Value ${value}`);
}

function displayConstant(option: BehaviorOption | undefined, item: BehaviorParameterValueDescription) {
  const name = item.name || String(item.constant ?? 0);
  if (option && /mouse|button|click/i.test(option.displayName)) {
    return mouseButtonLabel(name, item.constant ?? 0);
  }
  return name;
}

export default function BehaviorParamEditor({
  option,
  param,
  value,
  onChange,
  layerNames = [],
}: {
  option: BehaviorOption | undefined;
  param: ParamNumber;
  value: number;
  onChange: (value: number) => void;
  layerNames?: string[];
}) {
  const descriptions = descriptionsFor(option, param);
  const constants = descriptions.filter((item) => item.constant !== undefined);
  const range = descriptions.find((item) => item.range)?.range;
  const layer = descriptions.some((item) => item.layerId);
  const hid = descriptions.find((item) => item.hidUsage)?.hidUsage;
  const nilOnly = descriptions.length > 0 && descriptions.every((item) => !!item.nil);
  const label = `Param ${param}`;

  if (nilOnly) {
    return (
      <div className="behavior-param-card disabled-param">
        <span>{label}</span>
        <strong>Not used</strong>
        <small>This behavior does not use this parameter.</small>
      </div>
    );
  }

  return (
    <div className="behavior-param-card">
      <div className="behavior-param-heading">
        <span>{label}</span>
        <code>{value}</code>
      </div>

      {constants.length > 0 && (
        <div className="behavior-param-choices">
          {constants.map((item, index) => {
            const constant = item.constant ?? 0;
            return (
              <button
                type="button"
                key={`${constant}:${item.name}:${index}`}
                className={value === constant ? 'active' : ''}
                onClick={() => onChange(constant)}
              >
                <strong>{displayConstant(option, item)}</strong>
                {item.name && displayConstant(option, item) !== item.name && <small>{item.name}</small>}
              </button>
            );
          })}
        </div>
      )}

      {layer && (
        <label className="behavior-param-input">
          Layer
          {layerNames.length ? (
            <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
              {layerNames.map((name, index) => (
                <option key={`${index}:${name}`} value={index}>{name || `Layer ${index}`}</option>
              ))}
            </select>
          ) : (
            <input type="number" min={0} value={value} onChange={(event) => onChange(Number(event.target.value))} />
          )}
          {layerNames[value] && <small>Layer {value} · {layerNames[value]}</small>}
        </label>
      )}

      {range && (
        <label className="behavior-param-input">
          Value <small>{range.min} – {range.max}</small>
          <input
            type="number"
            min={range.min}
            max={range.max}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </label>
      )}

      {hid && constants.length === 0 && (
        <div className="behavior-hid-picker">
          <div className="behavior-hid-picker-head">
            <strong>Key</strong>
            <span>Choose from the keyboard</span>
          </div>
          <div className="behavior-hid-keyboard">
            {HID_KEY_ROWS.map((row, rowIndex) => (
              <div className="behavior-hid-row" key={rowIndex}>
                {row.map((choice) => {
                  const encoded = encodeHid(choice);
                  return (
                    <button
                      type="button"
                      key={`${choice.page}:${choice.usage}`}
                      className={value === encoded ? 'active' : ''}
                      onClick={() => onChange(encoded)}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="behavior-hid-media">
            {MEDIA_CHOICES.map((choice) => {
              const encoded = encodeHid(choice);
              return <button type="button" key={`${choice.page}:${choice.usage}`} className={value === encoded ? 'active' : ''} onClick={() => onChange(encoded)}>{choice.label}</button>;
            })}
          </div>
          <details className="behavior-param-advanced">
            <summary>Advanced / raw HID value</summary>
            <label className="behavior-param-input compact">
              HID usage
              <input type="number" min={0} value={value} onChange={(event) => onChange(Number(event.target.value))} />
              <small>Keyboard max {hid.keyboardMax} · Consumer max {hid.consumerMax}</small>
            </label>
          </details>
        </div>
      )}

      {!constants.length && !layer && !range && !hid && (
        <label className="behavior-param-input">
          Raw value
          <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
          <small>No structured metadata was provided for this parameter.</small>
        </label>
      )}

      {constants.length > 0 && !constants.some((item) => item.constant === value) && (
        <label className="behavior-param-input compact">
          Custom value
          <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
        </label>
      )}
    </div>
  );
}
