import { useMemo, useState } from 'react';
import type { KeyPhysicalAttrs } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import type { RuntimeComboRecord } from './runtimeComboProtocol';
import type { BehaviorOption } from './useStudioCore';
import KeyPicker from './KeyPicker';

const KEY_UNIT_PX = 48;

function keyUsageLabel(value: number) {
  const page = (value >>> 16) & 0xff;
  const usage = value & 0xffff;
  if (page === 0x07) {
    if (usage >= 4 && usage <= 29) return String.fromCharCode(65 + usage - 4);
    if (usage >= 30 && usage <= 38) return String(usage - 29);
    if (usage === 39) return '0';
    if (usage >= 58 && usage <= 69) return `F${usage - 57}`;
    const names: Record<number, string> = {
      40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space', 45: '-', 46: '=',
      47: '[', 48: ']', 49: '\\', 50: '#', 51: ';', 52: "'", 53: '`', 54: ',', 55: '.', 56: '/',
      57: 'Caps Lock', 73: 'Insert', 74: 'Home', 75: 'Page Up', 76: 'Delete', 77: 'End',
      78: 'Page Down', 79: 'Right', 80: 'Left', 81: 'Down', 82: 'Up',
      224: 'LCtrl', 225: 'LShift', 226: 'LAlt', 227: 'LGUI', 228: 'RCtrl', 229: 'RShift', 230: 'RAlt', 231: 'RGUI',
      135: 'JIS \\', 136: 'Kana', 137: 'JIS ¥', 138: 'Henkan', 139: 'Muhenkan',
    };
    return names[usage] ?? `Key 0x${usage.toString(16).toUpperCase()}`;
  }
  if (page === 0x0c) {
    const media: Record<number, string> = { 0xcd: 'Play/Pause', 0xb6: 'Previous', 0xb5: 'Next', 0xe2: 'Mute', 0xea: 'Volume -', 0xe9: 'Volume +' };
    return media[usage] ?? `Consumer 0x${usage.toString(16).toUpperCase()}`;
  }
  return `0x${value.toString(16).toUpperCase()}`;
}

function PositionPicker({ keys, selected, onChange }: {
  keys: KeyPhysicalAttrs[] | null;
  selected: number[];
  onChange: (positions: number[]) => void;
}) {
  if (!keys?.length) return <p className="combo-help">Physical layout is not available from this firmware.</p>;
  const u = (value: number) => value / 100;
  const maxX = Math.max(...keys.map((key) => u(key.x) + u(key.width)));
  const maxY = Math.max(...keys.map((key) => u(key.y) + u(key.height)));

  return (
    <div className="combo-position-scroll">
      <div className="combo-position-picker" style={{ width: maxX * KEY_UNIT_PX, height: maxY * KEY_UNIT_PX }}>
        {keys.map((key, position) => {
          const order = selected.indexOf(position);
          const isSelected = order >= 0;
          return (
            <button
              key={position}
              type="button"
              className={`combo-position-key ${isSelected ? 'selected' : ''}`}
              style={{
                left: u(key.x) * KEY_UNIT_PX,
                top: u(key.y) * KEY_UNIT_PX,
                width: Math.max(32, u(key.width) * KEY_UNIT_PX - 3),
                height: Math.max(32, u(key.height) * KEY_UNIT_PX - 3),
              }}
              onClick={() => onChange(isSelected ? selected.filter((value) => value !== position) : [...selected, position])}
              title={`Position ${position}`}
            >
              <span>{position}</span>
              {isSelected && <strong>{order + 1}</strong>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Presets({ value, values, onChange, suffix = 'ms' }: {
  value: number;
  values: number[];
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="combo-presets">
      {values.map((item) => (
        <button key={item} type="button" className={value === item ? 'active' : ''} onClick={() => onChange(item)}>
          {item}{suffix}
        </button>
      ))}
    </div>
  );
}

export default function ComboEditor({
  draft,
  setDraft,
  physicalKeys,
  behaviorOptions,
  busy,
  onSave,
}: {
  draft: RuntimeComboRecord;
  setDraft: (draft: RuntimeComboRecord) => void;
  physicalKeys: KeyPhysicalAttrs[] | null;
  behaviorOptions: BehaviorOption[] | null;
  busy: boolean;
  onSave: () => void;
}) {
  const [showOutputPicker, setShowOutputPicker] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const behaviorName = useMemo(
    () => behaviorOptions?.find((option) => option.id === draft.behaviorId)?.displayName ?? `Behavior #${draft.behaviorId}`,
    [behaviorOptions, draft.behaviorId],
  );
  const resultLabel = /key\s*press|keypress/i.test(behaviorName) ? keyUsageLabel(draft.param1) : behaviorName;

  return (
    <div className="combo-editor-guided">
      <div className="combo-editor-title">
        <div>
          <span>Runtime Combo #{draft.index}</span>
          <h3>{draft.name || 'Unnamed combo'}</h3>
          <p>Choose the trigger keys, output, timing and options. Save once when everything looks right.</p>
        </div>
        <label className="combo-enabled-switch">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
          <span>{draft.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>

      <section className="combo-step">
        <div className="combo-step-number">1</div>
        <div className="combo-step-body">
          <div className="combo-step-heading">
            <div><h4>Combo keys</h4><p>Click two or more keys. Selected order is shown on each key.</p></div>
            <span className={`combo-count ${draft.keyPositions.length >= 2 ? 'ok' : ''}`}>{draft.keyPositions.length} selected</span>
          </div>
          <PositionPicker keys={physicalKeys} selected={draft.keyPositions} onChange={(keyPositions) => setDraft({ ...draft, keyPositions })} />
          <div className="combo-selected-list">
            {draft.keyPositions.length ? draft.keyPositions.map((position, index) => <span key={position}>{index + 1}. Pos {position}</span>) : <span>Select at least 2 keys</span>}
          </div>
        </div>
      </section>

      <section className="combo-step">
        <div className="combo-step-number">2</div>
        <div className="combo-step-body">
          <div className="combo-step-heading">
            <div><h4>Output</h4><p>What should the combo send?</p></div>
          </div>
          <button type="button" className="combo-output-card" onClick={() => setShowOutputPicker(true)} disabled={busy}>
            <span>Current output</span>
            <strong>{resultLabel}</strong>
            <small>{behaviorName}{draft.param2 ? ` · p2=${draft.param2}` : ''}</small>
            <em>Change output →</em>
          </button>
          {showOutputPicker && (
            <KeyPicker
              currentBinding={{ behaviorId: draft.behaviorId, param1: draft.param1, param2: draft.param2 }}
              behaviorOptions={behaviorOptions}
              busy={busy}
              contextLabel={`Combo #${draft.index} output`}
              title="Choose combo output"
              description="Pick a normal key from the keyboard, or use Advanced for another ZMK behavior."
              onChooseBinding={(binding) => {
                setDraft({ ...draft, behaviorId: binding.behaviorId, param1: binding.param1, param2: binding.param2 });
                setShowOutputPicker(false);
              }}
              onCancel={() => setShowOutputPicker(false)}
            />
          )}
        </div>
      </section>

      <section className="combo-step">
        <div className="combo-step-number">3</div>
        <div className="combo-step-body">
          <div className="combo-step-heading"><div><h4>Timing</h4><p>How quickly the combo keys must be pressed.</p></div></div>
          <div className="combo-timing-grid">
            <label>
              <span>Timeout</span>
              <div className="combo-number-input"><input type="number" min="1" value={draft.timeoutMs} onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })} /><b>ms</b></div>
              <Presets value={draft.timeoutMs} values={[30, 50, 75, 100, 150]} onChange={(timeoutMs) => setDraft({ ...draft, timeoutMs })} />
              <small>Lower = keys must be pressed closer together.</small>
            </label>
            <label>
              <span>Require prior idle</span>
              <div className="combo-number-input"><input type="number" min="0" value={draft.requirePriorIdleMs} onChange={(event) => setDraft({ ...draft, requirePriorIdleMs: Number(event.target.value) })} /><b>ms</b></div>
              <Presets value={draft.requirePriorIdleMs} values={[0, 50, 100, 125, 200]} onChange={(requirePriorIdleMs) => setDraft({ ...draft, requirePriorIdleMs })} />
              <small>0 disables the prior-idle requirement.</small>
            </label>
          </div>
        </div>
      </section>

      <section className="combo-step">
        <div className="combo-step-number">4</div>
        <div className="combo-step-body">
          <div className="combo-step-heading">
            <div><h4>Options</h4><p>Name and release behavior.</p></div>
            <button type="button" className="combo-advanced-toggle" onClick={() => setAdvanced((value) => !value)}>{advanced ? 'Hide advanced' : 'Advanced'}</button>
          </div>
          <div className="combo-options-grid">
            <label>Name<input type="text" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>Slow release
              <div className="combo-segmented">
                {[[0, 'Inherit'], [1, 'On'], [2, 'Off']].map(([value, label]) => (
                  <button key={value} type="button" className={draft.slowReleaseOverride === value ? 'active' : ''} onClick={() => setDraft({ ...draft, slowReleaseOverride: Number(value) })}>{label}</button>
                ))}
              </div>
            </label>
          </div>
          {advanced && (
            <div className="combo-advanced-fields">
              <label>Behavior ID<input type="number" value={draft.behaviorId} onChange={(event) => setDraft({ ...draft, behaviorId: Number(event.target.value) })} /></label>
              <label>Param 1<input type="number" value={draft.param1} onChange={(event) => setDraft({ ...draft, param1: Number(event.target.value) })} /></label>
              <label>Param 2<input type="number" value={draft.param2} onChange={(event) => setDraft({ ...draft, param2: Number(event.target.value) })} /></label>
              <label>Layer mask<input type="number" value={draft.layerMask} onChange={(event) => setDraft({ ...draft, layerMask: Number(event.target.value) })} /><small>Raw runtime-combo layer bitmask.</small></label>
            </div>
          )}
        </div>
      </section>

      <div className="combo-save-bar">
        <div>
          <strong>Ready to save?</strong>
          <span>{draft.keyPositions.length >= 2 ? `${draft.keyPositions.length} keys → ${resultLabel}` : 'Select at least two combo keys.'}</span>
        </div>
        <button className="button" onClick={onSave} disabled={busy || draft.keyPositions.length < 2}>{busy ? 'Saving…' : 'Save combo to firmware'}</button>
      </div>
    </div>
  );
}
