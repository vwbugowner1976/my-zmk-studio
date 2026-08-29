import type { BehaviorParameterValueDescription } from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import type { BehaviorOption } from './useStudioCore';

type ParamNumber = 1 | 2;

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
  return byName[compact] ?? name || `Value ${value}`;
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
}: {
  option: BehaviorOption | undefined;
  param: ParamNumber;
  value: number;
  onChange: (value: number) => void;
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
          <input type="number" min={0} value={value} onChange={(event) => onChange(Number(event.target.value))} />
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
        <label className="behavior-param-input">
          HID usage
          <input type="number" min={0} value={value} onChange={(event) => onChange(Number(event.target.value))} />
          <small>Keyboard max {hid.keyboardMax} · Consumer max {hid.consumerMax}</small>
        </label>
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
