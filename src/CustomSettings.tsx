import { useEffect, useMemo, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import type { BehaviorOption } from './useStudioCore';
import { subscribeNotifications } from './notificationHub';
import {
  cloneCustomSettingValue,
  decodeCustomSettingsNotification,
  decodeCustomSettingsResponse,
  encodeDiscardSettingsRequest,
  encodeListSettingsRequest,
  encodeSaveSettingsRequest,
  encodeWriteSettingRequest,
  settingValueText,
  type CustomSettingRecord,
  type CustomSettingScalar,
  type CustomSettingValue,
} from './customSettingsSafeProtocol';
import {
  encodeDiscardSettingsForSourceRequest,
  encodeListSettingsForSubsystemAllRequest,
  encodeSaveSettingsForSourceRequest,
  encodeWriteSettingSplitRequest,
} from './customSettingsSplitProtocol';

type SubsystemInfo = { index: number; identifier: string };

const RUNTIME_COMBO_SUBSYSTEM_ID = 'cormoran__runtime_combo';
const TARGETED_SPLIT_SUBSYSTEM_IDS = new Set(['lotom__pmw3610']);

function settingToken(setting: CustomSettingRecord) {
  return `${setting.customSubsystemIndex}:${setting.source}:${setting.key}:${setting.value?.type === 'array' ? setting.value.index : ''}`;
}

function subsystemDisplayName(identifier: string | undefined, index: number) {
  if (!identifier) return `Unknown subsystem ${index}`;
  const known: Record<string, string> = {
    cormoran__runtime_combo: 'Runtime Combo',
    cormoran_ble: 'BLE Management',
    cormoran_custom_settings: 'Custom Settings',
    cormoran_rip: 'Runtime Input Processor',
    cormoran_rsr: 'Runtime Sensor Rotation',
    lotom__pmw3610: 'PMW3610',
    tom_oled__codex_status: 'Tom OLED / Codex Status',
    zmk__battery_history: 'Battery History',
    zmk__settings: 'ZMK Settings',
  };
  if (known[identifier]) return known[identifier];
  return identifier
    .replace(/^cormoran_+/, '')
    .replace(/^zmk_+/, 'ZMK ')
    .replace(/_+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scalarEqual(a: CustomSettingScalar, b: CustomSettingScalar) {
  if (a.type !== b.type) return false;
  if (a.type === 'bytes' && b.type === 'bytes') {
    return a.value.length === b.value.length && a.value.every((value, index) => value === b.value[index]);
  }
  return a.value === b.value;
}

function valueEqual(a: CustomSettingValue | null, b: CustomSettingValue | null) {
  if (!a || !b || a.type !== b.type) return a === b;
  if (a.type === 'array' && b.type === 'array') {
    return a.index === b.index && a.size === b.size && scalarEqual(a.value, b.value);
  }
  if (a.type === 'array' || b.type === 'array') return false;
  return scalarEqual(a, b);
}

function optionLabel(value: CustomSettingScalar, fallback: string) {
  if (value.type === 'bool') return value.value ? 'On' : 'Off';
  if (value.type === 'bytes') return fallback || `${value.value.length} bytes`;
  return fallback || String(value.value);
}

function SettingEditor({
  setting,
  behaviorOptions,
  busy,
  onApply,
}: {
  setting: CustomSettingRecord;
  behaviorOptions: BehaviorOption[] | null;
  busy: boolean;
  onApply: (setting: CustomSettingRecord, value: CustomSettingValue) => void;
}) {
  const [draft, setDraft] = useState<CustomSettingValue | null>(() => cloneCustomSettingValue(setting.value));

  useEffect(() => {
    setDraft(cloneCustomSettingValue(setting.value));
  }, [setting.value, setting.hasUnsavedValue]);

  const options = setting.meta?.constraints.find((constraint) => constraint.type === 'options');
  const range = setting.meta?.constraints.find((constraint) => constraint.type === 'range');
  const isLayer = setting.meta?.constraints.some((constraint) => constraint.type === 'layer') ?? false;
  const isBehavior = setting.meta?.constraints.some((constraint) => constraint.type === 'behavior') ?? false;
  const secureWrite = setting.meta?.writePermission === 1;
  const changed = !valueEqual(draft, setting.value);

  if (!draft || draft.type === 'bytes' || draft.type === 'array') {
    return (
      <div className="custom-setting-readonly">
        <strong>{settingValueText(setting.value)}</strong>
        <small>{draft?.type === 'array' ? 'Array editing is available through the dedicated tool when one exists.' : 'Bytes/record values are read-only in the generic editor.'}</small>
      </div>
    );
  }

  function updateScalar(next: string | number | boolean) {
    if (!draft || draft.type === 'bytes' || draft.type === 'array') return;
    if (draft.type === 'bool') setDraft({ type: 'bool', value: Boolean(next) });
    else if (draft.type === 'int32') setDraft({ type: 'int32', value: Number(next) });
    else setDraft({ type: 'string', value: String(next) });
  }

  const min = range?.type === 'range' && range.min?.type === 'int32' ? range.min.value : undefined;
  const max = range?.type === 'range' && range.max?.type === 'int32' ? range.max.value : undefined;

  return (
    <div className="custom-setting-editor">
      {options?.type === 'options' ? (
        <select
          value={String(draft.value)}
          disabled={busy || secureWrite}
          onChange={(event) => {
            const selected = options.values[Number(event.target.selectedOptions[0]?.dataset.index ?? 0)];
            if (!selected || selected.type === 'bytes') return;
            setDraft({ ...selected });
          }}
        >
          {options.values.map((value, index) => (
            <option key={index} data-index={index} value={String(value.value)}>
              {optionLabel(value, options.labels[index] ?? '')}
            </option>
          ))}
        </select>
      ) : draft.type === 'bool' ? (
        <label className="custom-setting-toggle">
          <input type="checkbox" checked={draft.value} disabled={busy || secureWrite} onChange={(event) => updateScalar(event.target.checked)} />
          <span>{draft.value ? 'On' : 'Off'}</span>
        </label>
      ) : draft.type === 'int32' && isBehavior && behaviorOptions?.length ? (
        <select value={draft.value} disabled={busy || secureWrite} onChange={(event) => updateScalar(Number(event.target.value))}>
          {!behaviorOptions.some((option) => option.id === draft.value) && <option value={draft.value}>Behavior #{draft.value}</option>}
          {behaviorOptions.map((option) => <option key={option.id} value={option.id}>{option.displayName} (#{option.id})</option>)}
        </select>
      ) : draft.type === 'int32' ? (
        <label className="custom-setting-number">
          <input
            type="number"
            value={draft.value}
            min={min}
            max={max}
            disabled={busy || secureWrite}
            onChange={(event) => updateScalar(Number(event.target.value))}
          />
          {isLayer && <small>Layer ID</small>}
          {min !== undefined && max !== undefined && <small>{min} – {max}</small>}
        </label>
      ) : (
        <input type="text" value={draft.value} disabled={busy || secureWrite} onChange={(event) => updateScalar(event.target.value)} />
      )}

      <button className="button" type="button" disabled={busy || secureWrite || !changed} onClick={() => draft && onApply(setting, draft)}>
        Stage change
      </button>
      {secureWrite && <small className="custom-setting-secure">Studio unlock required for writes.</small>}
    </div>
  );
}

export default function CustomSettings({
  connection,
  customSettingsSubsystemIndex,
  subsystems,
  behaviorOptions,
  onDebug,
}: {
  connection: RpcConnection;
  customSettingsSubsystemIndex: number;
  subsystems: SubsystemInfo[];
  behaviorOptions: BehaviorOption[] | null;
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [settings, setSettings] = useState<CustomSettingRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const receivedRef = useRef<Map<string, CustomSettingRecord>>(new Map());
  const initialLoadRef = useRef<{ connection: RpcConnection; subsystemIndex: number } | null>(null);

  const subsystemNames = useMemo(
    () => new Map(subsystems.map((subsystem) => [subsystem.index, subsystem.identifier])),
    [subsystems],
  );
  const targetedSplitSubsystems = useMemo(
    () => subsystems.filter((subsystem) => TARGETED_SPLIT_SUBSYSTEM_IDS.has(subsystem.identifier)),
    [subsystems],
  );
  const grouped = useMemo(() => {
    const groups = new Map<number, CustomSettingRecord[]>();
    for (const setting of settings) {
      const group = groups.get(setting.customSubsystemIndex) ?? [];
      group.push(setting);
      groups.set(setting.customSubsystemIndex, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.key.localeCompare(b.key) || a.source - b.source || ((a.value?.type === 'array' ? a.value.index : -1) - (b.value?.type === 'array' ? b.value.index : -1)));
    }
    return [...groups.entries()].sort((a, b) => {
      const aName = subsystemDisplayName(subsystemNames.get(a[0]), a[0]);
      const bName = subsystemDisplayName(subsystemNames.get(b[0]), b[0]);
      return aName.localeCompare(bName);
    });
  }, [settings, subsystemNames]);
  const unsavedCount = settings.filter((setting) => setting.hasUnsavedValue).length;

  async function callCustomSettings(payload: Uint8Array, label: string) {
    onDebug(`RPC -> custom settings ${label}`, { subsystemIndex: customSettingsSubsystemIndex, bytes: payload.length });
    const response = await call_rpc(connection, {
      custom: { call: { subsystemIndex: customSettingsSubsystemIndex, payload } },
    });
    const responsePayload = response.custom?.call?.payload;
    if (!responsePayload) throw new Error(`Custom Settings ${label} returned no payload.`);
    const status = decodeCustomSettingsResponse(responsePayload);
    onDebug(`RPC <- custom settings ${label}`, status);
    return status;
  }

  useEffect(() => {
    const unsubscribe = subscribeNotifications(connection, (notification) => {
      const custom = notification.custom?.customNotification;
      if (!custom || custom.subsystemIndex !== customSettingsSubsystemIndex) return;
      try {
        const decoded = decodeCustomSettingsNotification(custom.payload);
        if (!decoded) return;
        const token = settingToken(decoded.setting);
        receivedRef.current.set(token, decoded.setting);
        setSettings([...receivedRef.current.values()].sort((a, b) => a.customSubsystemIndex - b.customSubsystemIndex || a.key.localeCompare(b.key) || a.source - b.source));
        onDebug('Custom Settings notification', {
          kind: decoded.kind,
          key: decoded.setting.key,
          owner: decoded.setting.customSubsystemIndex,
          ownerName: subsystemDisplayName(subsystemNames.get(decoded.setting.customSubsystemIndex), decoded.setting.customSubsystemIndex),
          source: decoded.setting.source,
        });
      } catch (cause) {
        onDebug('Custom Settings notification decode failed', cause instanceof Error ? cause.message : String(cause));
      }
    });
    return unsubscribe;
  }, [connection, customSettingsSubsystemIndex, subsystemNames]);

  async function waitForLocalNotifications(expected: number) {
    const deadline = performance.now() + 1200;
    while (receivedRef.current.size < expected && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function loadTargetedSplitSettings() {
    for (const subsystem of targetedSplitSubsystems) {
      const before = receivedRef.current.size;
      await callCustomSettings(
        // Keep the relayed request as small as possible. Metadata can be added
        // after the split transport path is confirmed stable.
        encodeListSettingsForSubsystemAllRequest(subsystem.index, false),
        `list_settings(${subsystem.identifier}, split)`,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      onDebug('Custom Settings split supplement loaded', {
        subsystem: subsystem.identifier,
        received: receivedRef.current.size - before,
        requireMeta: false,
      });
    }
  }

  async function loadSettings() {
    setLoading(true);
    setError(null);
    setMessage('Reading Custom Settings from firmware…');
    receivedRef.current = new Map();
    setSettings([]);
    try {
      const status = await callCustomSettings(encodeListSettingsRequest(true), 'list_settings(local)');
      await waitForLocalNotifications(status.affectedCount);
      await loadTargetedSplitSettings();
      const loaded = [...receivedRef.current.values()].sort((a, b) => a.customSubsystemIndex - b.customSubsystemIndex || a.key.localeCompare(b.key) || a.source - b.source);
      setSettings(loaded);
      const remoteCount = loaded.filter((item) => item.source !== 0).length;
      setMessage(`Loaded ${loaded.length} setting notification(s) from ${new Set(loaded.map((item) => item.customSubsystemIndex)).size} subsystem(s)${remoteCount ? `, including ${remoteCount} split-peripheral setting(s)` : ''}.`);
      onDebug('Custom Settings loaded', {
        localExpected: status.affectedCount,
        received: loaded.length,
        remote: remoteCount,
        scope: targetedSplitSubsystems.length ? 'local+targeted-split' : 'local-only',
      });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('');
      onDebug('Custom Settings load failed', text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const previous = initialLoadRef.current;
    if (previous?.connection === connection && previous.subsystemIndex === customSettingsSubsystemIndex) return;
    initialLoadRef.current = { connection, subsystemIndex: customSettingsSubsystemIndex };
    void loadSettings();
  }, [connection, customSettingsSubsystemIndex]);

  async function stageSetting(setting: CustomSettingRecord, value: CustomSettingValue) {
    setBusy(true);
    setError(null);
    try {
      const payload = setting.source === 0
        ? encodeWriteSettingRequest(setting, value)
        : encodeWriteSettingSplitRequest(setting, value);
      await callCustomSettings(payload, `write_setting(${setting.key}, source=${setting.source})`);
      const token = settingToken(setting);
      const next = { ...setting, value: cloneCustomSettingValue(value), hasUnsavedValue: true };
      receivedRef.current.set(token, next);
      setSettings([...receivedRef.current.values()].sort((a, b) => a.customSubsystemIndex - b.customSubsystemIndex || a.key.localeCompare(b.key) || a.source - b.source));
      setMessage(`${setting.key} staged in RAM on source ${setting.source}.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Custom Settings write failed', text);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    try {
      const localUnsaved = settings.some((setting) => setting.source === 0 && setting.hasUnsavedValue);
      let saved = 0;
      if (localUnsaved) {
        const status = await callCustomSettings(encodeSaveSettingsRequest(), 'save_settings(local)');
        saved += status.affectedCount;
      }
      const remoteScopes = new Map<string, { customSubsystemIndex: number; source: number }>();
      for (const setting of settings) {
        if (!setting.hasUnsavedValue || setting.source === 0) continue;
        remoteScopes.set(`${setting.customSubsystemIndex}:${setting.source}`, {
          customSubsystemIndex: setting.customSubsystemIndex,
          source: setting.source,
        });
      }
      for (const scope of remoteScopes.values()) {
        const status = await callCustomSettings(
          encodeSaveSettingsForSourceRequest(scope.customSubsystemIndex, scope.source),
          `save_settings(owner=${scope.customSubsystemIndex}, source=${scope.source})`,
        );
        saved += status.affectedCount;
      }
      setMessage(`Save requested for ${saved} local setting(s) plus ${remoteScopes.size} split scope(s).`);
      await loadSettings();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
    } finally {
      setBusy(false);
    }
  }

  async function discardAll() {
    setBusy(true);
    setError(null);
    try {
      const localUnsaved = settings.some((setting) => setting.source === 0 && setting.hasUnsavedValue);
      let discarded = 0;
      if (localUnsaved) {
        const status = await callCustomSettings(encodeDiscardSettingsRequest(), 'discard_settings(local)');
        discarded += status.affectedCount;
      }
      const remoteScopes = new Map<string, { customSubsystemIndex: number; source: number }>();
      for (const setting of settings) {
        if (!setting.hasUnsavedValue || setting.source === 0) continue;
        remoteScopes.set(`${setting.customSubsystemIndex}:${setting.source}`, {
          customSubsystemIndex: setting.customSubsystemIndex,
          source: setting.source,
        });
      }
      for (const scope of remoteScopes.values()) {
        const status = await callCustomSettings(
          encodeDiscardSettingsForSourceRequest(scope.customSubsystemIndex, scope.source),
          `discard_settings(owner=${scope.customSubsystemIndex}, source=${scope.source})`,
        );
        discarded += status.affectedCount;
      }
      setMessage(`Discard requested for ${discarded} local setting(s) plus ${remoteScopes.size} split scope(s).`);
      await loadSettings();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="custom-settings-view">
      <section className="panel custom-settings-toolbar">
        <div>
          <h3>Custom Settings</h3>
          <p>Firmware settings grouped by subsystem. Split peripherals are queried one small request at a time.</p>
        </div>
        <div className="custom-settings-actions">
          {unsavedCount > 0 && <span className="layer-unsaved-badge">{unsavedCount} staged</span>}
          <button className="button secondary" onClick={() => void loadSettings()} disabled={busy || loading}>Refresh</button>
          <button className="button secondary" onClick={() => void discardAll()} disabled={busy || unsavedCount === 0}>Discard</button>
          <button className="button" onClick={() => void saveAll()} disabled={busy || unsavedCount === 0}>Save to firmware</button>
        </div>
      </section>

      {error && <div className="notice">{error}</div>}
      {message && <div className="status-strip panel"><span>{message}</span></div>}

      {loading ? (
        <div className="panel empty"><div><h3>Reading Custom Settings…</h3><p>Collecting local settings first, then a minimal split-peripheral probe.</p></div></div>
      ) : grouped.length === 0 ? (
        <div className="panel empty"><div><h3>No registered settings yet</h3><p>The Custom Settings subsystem is active, but no editable setting was returned.</p></div></div>
      ) : (
        <div className="custom-settings-groups">
          {grouped.map(([ownerIndex, items]) => {
            const identifier = subsystemNames.get(ownerIndex);
            const displayName = subsystemDisplayName(identifier, ownerIndex);
            const managedByRuntimeCombo = identifier === RUNTIME_COMBO_SUBSYSTEM_ID;
            const groupUnsaved = items.filter((item) => item.hasUnsavedValue).length;
            return (
              <details className={`panel custom-settings-group ${managedByRuntimeCombo ? 'managed-group' : ''}`} key={ownerIndex} open={!managedByRuntimeCombo}>
                <summary className="custom-settings-group-title">
                  <div>
                    <span>Subsystem #{ownerIndex}{identifier ? ` · ${identifier}` : ''}</span>
                    <h3>{displayName}</h3>
                    {managedByRuntimeCombo && <small>Managed primarily by the Runtime Combo editor.</small>}
                  </div>
                  <div className="custom-settings-group-counts">
                    {groupUnsaved > 0 && <em>{groupUnsaved} staged</em>}
                    <strong>{items.length} setting(s)</strong>
                  </div>
                </summary>
                {managedByRuntimeCombo && (
                  <div className="custom-settings-managed-note">
                    Combo records and names are easier and safer to edit in Runtime Combo. This generic view is kept for inspection and advanced scalar settings.
                  </div>
                )}
                <div className="custom-settings-list">
                  {items.map((setting) => (
                    <div className={`custom-setting-row ${setting.hasUnsavedValue ? 'staged' : ''}`} key={settingToken(setting)}>
                      <div className="custom-setting-info">
                        <div><strong>{setting.key}</strong>{setting.hasUnsavedValue && <span>Staged</span>}</div>
                        <small>Current: {settingValueText(setting.value)} · source {setting.source}{setting.source === 0 ? ' (local)' : ' (split peripheral)'}</small>
                      </div>
                      <SettingEditor setting={setting} behaviorOptions={behaviorOptions} busy={busy} onApply={stageSetting} />
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {unsavedCount > 0 && (
        <section className="panel layer-save-strip">
          <div><strong>Unsaved Custom Settings</strong><span>{unsavedCount} setting(s) are staged in RAM.</span></div>
          <div className="layer-save-strip-actions">
            <button className="button secondary" onClick={() => void discardAll()} disabled={busy}>Discard</button>
            <button className="button" onClick={() => void saveAll()} disabled={busy}>Save to firmware</button>
          </div>
        </section>
      )}
    </div>
  );
}
