import { useEffect, useMemo, useState } from 'react';
import {
  call_rpc,
  create_rpc_connection,
  type RpcConnection,
} from '@zmkfirmware/zmk-studio-ts-client';
import type { KeyPhysicalAttrs } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import { connect as connectSerial } from '@zmkfirmware/zmk-studio-ts-client/transport/serial';
import type { RpcTransport } from '@zmkfirmware/zmk-studio-ts-client/transport';
import {
  decodeGetComboResponse,
  decodeGlobalSettingsResponse,
  decodeRuntimeComboResponse,
  decodeStatusResponse,
  encodeGetComboRequest,
  encodeGetGlobalSettingsRequest,
  encodeListCombosRequest,
  encodeSaveRequest,
  encodeSetComboNameRequest,
  encodeSetComboRequest,
  type RuntimeComboRecord,
} from './runtimeComboProtocol';
import { useBehaviorOptions } from './useStudioCore';

const RUNTIME_COMBO_SUBSYSTEM_ID = 'cormoran__runtime_combo';
const KEY_UNIT_PX = 42;

type CustomSubsystem = {
  index: number;
  identifier: string;
};

const sourceLabel = (source: number) => {
  if (source === 1) return 'Default';
  if (source === 2) return 'Overridden';
  if (source === 3) return 'Runtime';
  return 'Empty';
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join(' ');

function PositionPicker({
  keys,
  selected,
  onChange,
}: {
  keys: KeyPhysicalAttrs[] | null;
  selected: number[];
  onChange: (positions: number[]) => void;
}) {
  if (!keys?.length) {
    return <p>Physical layout is not available from this firmware.</p>;
  }

  const toUnits = (value: number) => value / 100;
  const maxX = Math.max(...keys.map((key) => toUnits(key.x) + toUnits(key.width)));
  const maxY = Math.max(...keys.map((key) => toUnits(key.y) + toUnits(key.height)));

  const toggle = (position: number) => {
    const next = selected.includes(position)
      ? selected.filter((value) => value !== position)
      : [...selected, position].sort((a, b) => a - b);
    onChange(next);
  };

  return (
    <div className="layout-scroll">
      <div
        className="position-picker"
        style={{ width: maxX * KEY_UNIT_PX, height: maxY * KEY_UNIT_PX }}
      >
        {keys.map((key, position) => (
          <button
            key={position}
            type="button"
            className={`position-key ${selected.includes(position) ? 'selected' : ''}`}
            style={{
              left: toUnits(key.x) * KEY_UNIT_PX,
              top: toUnits(key.y) * KEY_UNIT_PX,
              width: Math.max(30, toUnits(key.width) * KEY_UNIT_PX - 3),
              height: Math.max(30, toUnits(key.height) * KEY_UNIT_PX - 3),
            }}
            onClick={() => toggle(position)}
            title={`Position ${position}`}
          >
            {position}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [transport, setTransport] = useState<RpcTransport | null>(null);
  const [connection, setConnection] = useState<RpcConnection | null>(null);
  const [subsystems, setSubsystems] = useState<CustomSubsystem[]>([]);
  const [combos, setCombos] = useState<RuntimeComboRecord[]>([]);
  const [comboError, setComboError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<RuntimeComboRecord | null>(null);
  const [physicalKeys, setPhysicalKeys] = useState<KeyPhysicalAttrs[] | null>(null);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Chrome / Edge Web Serial ready');

  const behaviorOptions = useBehaviorOptions(connection);
  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const connected = !!transport && !!connection;
  const runtimeCombo = useMemo(
    () => subsystems.find((subsystem) => subsystem.identifier === RUNTIME_COMBO_SUBSYSTEM_ID),
    [subsystems],
  );
  const selectedBehaviorName = useMemo(() => {
    if (!draft || !behaviorOptions) return '';
    return behaviorOptions.find((option) => option.id === draft.behaviorId)?.displayName ?? '';
  }, [draft, behaviorOptions]);

  function debug(event: string, detail?: unknown) {
    const timestamp = new Date().toISOString().slice(11, 23);
    const suffix = detail === undefined
      ? ''
      : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    const line = `${timestamp} ${event}${suffix}`;
    console.info(`[MyZMKStudio] ${line}`);
    setDebugLines((current) => [...current.slice(-199), line]);
  }

  async function callRuntimeCombo(
    nextConnection: RpcConnection,
    subsystemIndex: number,
    payload: Uint8Array,
    label: string,
  ) {
    const started = performance.now();
    debug(`RPC -> ${label}`, `index=${subsystemIndex} bytes=[${hex(payload)}]`);
    try {
      const response = await call_rpc(nextConnection, {
        custom: { call: { subsystemIndex, payload } },
      });
      const responsePayload = response.custom?.call?.payload;
      if (!responsePayload) throw new Error('Runtime Combo returned no payload');
      debug(
        `RPC <- ${label}`,
        `${Math.round(performance.now() - started)}ms bytes=[${hex(responsePayload)}]`,
      );
      return responsePayload;
    } catch (error) {
      debug(
        `RPC !! ${label}`,
        `${Math.round(performance.now() - started)}ms ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function readPhysicalLayout(nextConnection: RpcConnection) {
    try {
      debug('RPC -> keymap.getPhysicalLayouts');
      const resp = await call_rpc(nextConnection, { keymap: { getPhysicalLayouts: true } });
      const layouts = resp?.keymap?.getPhysicalLayouts;
      if (!layouts) {
        debug('Physical layout unavailable');
        return null;
      }
      const layout = layouts.layouts[layouts.activeLayoutIndex];
      const keys = layout?.keys ?? null;
      debug('Physical layout loaded', {
        activeLayoutIndex: layouts.activeLayoutIndex,
        keyCount: keys?.length ?? 0,
      });
      return keys;
    } catch (error) {
      debug('Physical layout failed', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function readRuntimeCombos(nextConnection: RpcConnection, subsystemIndex: number) {
    try {
      const payload = await callRuntimeCombo(
        nextConnection,
        subsystemIndex,
        encodeListCombosRequest(),
        'list_combos',
      );
      const loaded = decodeRuntimeComboResponse(payload);
      debug('list_combos decoded', { count: loaded.length });
      return { combos: loaded, mode: 'list' as const };
    } catch (error) {
      const listError = error instanceof Error ? error.message : String(error);
      debug('list_combos fallback', listError);

      const settingsPayload = await callRuntimeCombo(
        nextConnection,
        subsystemIndex,
        encodeGetGlobalSettingsRequest(),
        'get_global_settings',
      );
      const settings = decodeGlobalSettingsResponse(settingsPayload);
      const maxCombo = settings.maxCombo || 16;
      debug('global settings', settings);
      const loaded: RuntimeComboRecord[] = [];

      for (let index = 0; index < maxCombo; index += 1) {
        try {
          const comboPayload = await callRuntimeCombo(
            nextConnection,
            subsystemIndex,
            encodeGetComboRequest(index),
            `get_combo(${index})`,
          );
          const combo = decodeGetComboResponse(comboPayload);
          if (combo) {
            loaded.push(combo);
            debug('combo decoded', {
              index: combo.index,
              name: combo.name,
              positions: combo.keyPositions,
              behaviorId: combo.behaviorId,
              source: combo.source,
            });
          }
        } catch (comboReadError) {
          const text = comboReadError instanceof Error ? comboReadError.message : String(comboReadError);
          if (text.includes('-2') || text.includes('-22')) {
            debug(`get_combo(${index}) skipped`, text);
            continue;
          }
          throw comboReadError;
        }
      }

      debug('indexed fallback complete', { count: loaded.length, maxCombo });
      return { combos: loaded, mode: 'indexed' as const, listError, maxCombo };
    }
  }

  function selectCombo(combo: RuntimeComboRecord) {
    setSelectedIndex(combo.index);
    setDraft({ ...combo, keyPositions: [...combo.keyPositions] });
    debug('Editor selected combo', { index: combo.index, name: combo.name });
  }

  function changeBehavior(behaviorId: number) {
    if (!draft) return;
    const option = behaviorOptions?.find((item) => item.id === behaviorId);
    debug('Behavior changed', {
      from: draft.behaviorId,
      to: behaviorId,
      name: option?.displayName ?? '',
      resetParams: true,
    });
    setDraft({
      ...draft,
      behaviorId,
      param1: 0,
      param2: 0,
    });
  }

  useEffect(() => {
    if (!connection) setPhysicalKeys(null);
  }, [connection]);

  async function connectUsb() {
    setBusy(true);
    setComboError(null);
    setDebugLines([]);
    setMessage('Opening USB serial connection…');
    try {
      debug('Connect USB requested');
      const nextTransport = await connectSerial();
      debug('Serial transport open', { label: nextTransport.label });
      const nextConnection = create_rpc_connection(nextTransport);

      const [subsystemResponse, keys] = await Promise.all([
        call_rpc(nextConnection, { custom: { listCustomSubsystems: {} } }),
        readPhysicalLayout(nextConnection),
      ]);

      const detected = (subsystemResponse.custom?.listCustomSubsystems?.subsystems ?? []).map(
        (subsystem) => ({ index: subsystem.index, identifier: subsystem.identifier }),
      );
      debug('Custom Subsystems', detected);
      const runtimeComboDetected = detected.find(
        (subsystem) => subsystem.identifier === RUNTIME_COMBO_SUBSYSTEM_ID,
      );

      let loadedCombos: RuntimeComboRecord[] = [];
      let localComboError: string | null = null;
      let readMode = '';

      if (runtimeComboDetected) {
        const result = await readRuntimeCombos(nextConnection, runtimeComboDetected.index);
        loadedCombos = result.combos;
        readMode = result.mode;
        if (result.mode === 'indexed') {
          localComboError = `list_combos failed (${result.listError}); recovered ${loadedCombos.length} combo(s) via get_combo over ${result.maxCombo} slots.`;
        }
      }

      setTransport(nextTransport);
      setConnection(nextConnection);
      setSubsystems(detected);
      setPhysicalKeys(keys);
      setCombos(loadedCombos);
      setComboError(localComboError);

      if (runtimeComboDetected) {
        setMessage(
          `Connected. Read ${loadedCombos.length} Runtime Combo(s)${readMode === 'indexed' ? ' using indexed fallback' : ''}.`,
        );
      } else {
        setMessage(`Connected. ${detected.length} Custom Subsystem(s) detected.`);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      debug('Connection failed', text);
      setMessage(`Connection / RPC failed: ${text}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshCombos() {
    if (!connection || !runtimeCombo) return;
    setBusy(true);
    setComboError(null);
    try {
      const result = await readRuntimeCombos(connection, runtimeCombo.index);
      setCombos(result.combos);
      if (result.mode === 'indexed') {
        setComboError(
          `list_combos failed (${result.listError}); recovered ${result.combos.length} combo(s) via indexed fallback.`,
        );
      }
      const selected = selectedIndex === null
        ? null
        : result.combos.find((combo) => combo.index === selectedIndex) ?? null;
      if (selected) selectCombo(selected);
      setMessage(`Refreshed ${result.combos.length} Runtime Combo(s).`);
    } catch (error) {
      setComboError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!connection || !runtimeCombo || !draft) return;
    if (draft.keyPositions.length < 2) {
      setComboError('Select at least two keys for a combo.');
      return;
    }

    setBusy(true);
    setComboError(null);
    try {
      debug('Save flow begin', draft);

      const setPayload = await callRuntimeCombo(
        connection,
        runtimeCombo.index,
        encodeSetComboRequest(draft, false),
        `set_combo(${draft.index})`,
      );
      debug('set_combo status', decodeStatusResponse(setPayload));

      const namePayload = await callRuntimeCombo(
        connection,
        runtimeCombo.index,
        encodeSetComboNameRequest(draft.index, draft.name, false),
        `set_combo_name(${draft.index})`,
      );
      debug('set_combo_name status', decodeStatusResponse(namePayload));

      const saveStarted = performance.now();
      const savePayload = await callRuntimeCombo(
        connection,
        runtimeCombo.index,
        encodeSaveRequest(),
        'save',
      );
      const saveStatus = decodeStatusResponse(savePayload);
      debug('save status', {
        ...saveStatus,
        elapsedMs: Math.round(performance.now() - saveStarted),
      });

      const result = await readRuntimeCombos(connection, runtimeCombo.index);
      setCombos(result.combos);
      const saved = result.combos.find((combo) => combo.index === draft.index) ?? null;
      if (saved) selectCombo(saved);
      setMessage(`Saved combo #${draft.index} and re-read ${result.combos.length} combo(s).`);
      if (result.mode === 'indexed') {
        setComboError(`list_combos still failed (${result.listError}); indexed re-read succeeded.`);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      debug('Save flow failed', text);
      setComboError(text);
      setMessage('Save failed. See Debug Log.');
    } finally {
      setBusy(false);
    }
  }

  async function copyDebugLog() {
    await navigator.clipboard.writeText(debugLines.join('\n'));
    setMessage('Debug Log copied to clipboard.');
  }

  function disconnectUsb() {
    debug('Disconnect');
    transport?.abortController.abort('Disconnected by user');
    setTransport(null);
    setConnection(null);
    setSubsystems([]);
    setCombos([]);
    setPhysicalKeys(null);
    setComboError(null);
    setSelectedIndex(null);
    setDraft(null);
    setMessage('Disconnected');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ZMK configuration UI</div>
          <h1>My ZMK Studio</h1>
        </div>
        <button
          className={connected ? 'button secondary' : 'button'}
          onClick={connected ? disconnectUsb : connectUsb}
          disabled={busy || (!connected && !serialSupported)}
        >
          {busy ? 'Working…' : connected ? 'Disconnect' : 'Connect USB'}
        </button>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="section-title">Device</div>
          <div className="device-card">
            <span className={connected ? 'status online' : 'status'} />
            <div>
              <strong>{connected ? 'ZMK device connected' : 'Not connected'}</strong>
              <small>{message}</small>
            </div>
          </div>
          <nav className="nav-list">
            <button className="nav-item active">Runtime Combo</button>
            <button className="nav-item" disabled>PMW3610</button>
            <button className="nav-item" disabled>PAW3222</button>
            <button className="nav-item" disabled>BLE Management</button>
          </nav>
        </aside>

        <section className="content">
          <div className="content-header">
            <div>
              <div className="eyebrow">Runtime configuration</div>
              <h2>{connected ? 'Runtime Combo' : 'Connect your keyboard'}</h2>
              <p>Direct DYA-compatible Custom Studio RPC.</p>
            </div>
            {connected && runtimeCombo && (
              <button className="button" onClick={refreshCombos} disabled={busy}>Refresh</button>
            )}
          </div>

          {!connected ? (
            <div className="panel empty">
              <div>
                <h3>USB test</h3>
                <p>Connect a ZMK Studio enabled keyboard with Chrome or Edge.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="status-strip panel">
                <span>ZMK Studio RPC live</span>
                <code>{transport?.label || 'unknown'}</code>
                {runtimeCombo && <code>{runtimeCombo.identifier} #{runtimeCombo.index}</code>}
              </div>

              {comboError && <div className="notice">{comboError}</div>}

              <div className="runtime-grid">
                <section className="panel combo-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Combos from firmware</h3>
                      <p>{combos.length} combo(s). Click one to edit.</p>
                    </div>
                  </div>
                  <div className="combo-scroll-box">
                    {combos.length ? combos.map((combo) => (
                      <button
                        className={`combo-row ${selectedIndex === combo.index ? 'selected' : ''}`}
                        key={combo.index}
                        onClick={() => selectCombo(combo)}
                      >
                        <span>
                          <strong>#{combo.index} {combo.name || 'Unnamed combo'}</strong>
                          <small>{combo.keyPositions.join(' + ') || 'No positions'} · behavior #{combo.behaviorId}</small>
                        </span>
                        <span className={combo.enabled ? 'pill' : 'pill muted'}>
                          {sourceLabel(combo.source)} / {combo.enabled ? 'On' : 'Off'}
                        </span>
                      </button>
                    )) : <p>No Runtime Combos were returned.</p>}
                  </div>
                </section>

                <section className="panel editor">
                  {draft ? (
                    <>
                      <div className="editor-title">
                        <div>
                          <h3>Edit Combo #{draft.index}</h3>
                          <p>Select keys directly from the keyboard layout.</p>
                        </div>
                        <span className="selection-count">{draft.keyPositions.length} keys selected</span>
                      </div>

                      <label>
                        Name
                        <input
                          type="text"
                          value={draft.name}
                          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        />
                      </label>

                      <div>
                        <div className="field-label">Key positions</div>
                        <PositionPicker
                          keys={physicalKeys}
                          selected={draft.keyPositions}
                          onChange={(keyPositions) => setDraft({ ...draft, keyPositions })}
                        />
                        <p>Selected: {draft.keyPositions.join(', ') || 'none'}</p>
                      </div>

                      <div className="form-grid">
                        <label className="behavior-field">
                          Behavior
                          {behaviorOptions === null ? (
                            <div className="select-placeholder">Loading behaviors…</div>
                          ) : behaviorOptions.length ? (
                            <select
                              value={draft.behaviorId}
                              onChange={(event) => changeBehavior(Number(event.target.value))}
                            >
                              {!behaviorOptions.some((option) => option.id === draft.behaviorId) && (
                                <option value={draft.behaviorId}>Unknown behavior (#{draft.behaviorId})</option>
                              )}
                              {behaviorOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.displayName} (#{option.id})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="number"
                              value={draft.behaviorId}
                              onChange={(event) => changeBehavior(Number(event.target.value))}
                            />
                          )}
                          <small>{selectedBehaviorName ? `Selected: ${selectedBehaviorName}` : `Behavior ID: ${draft.behaviorId}`}</small>
                        </label>

                        <label>
                          Param 1
                          <input
                            type="number"
                            value={draft.param1}
                            onChange={(event) => setDraft({ ...draft, param1: Number(event.target.value) })}
                          />
                        </label>
                        <label>
                          Param 2
                          <input
                            type="number"
                            value={draft.param2}
                            onChange={(event) => setDraft({ ...draft, param2: Number(event.target.value) })}
                          />
                        </label>
                        <label>
                          Timeout ms
                          <input
                            type="number"
                            value={draft.timeoutMs}
                            onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })}
                          />
                        </label>
                        <label>
                          Layer mask
                          <input
                            type="number"
                            value={draft.layerMask}
                            onChange={(event) => setDraft({ ...draft, layerMask: Number(event.target.value) })}
                          />
                        </label>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                          />
                          Enabled
                        </label>
                      </div>

                      <div className="actions">
                        <button className="button" onClick={saveDraft} disabled={busy || draft.keyPositions.length < 2}>
                          Save to firmware
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty">Select a combo from the list.</div>
                  )}
                </section>
              </div>

              <section className="panel debug-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Debug Log</h3>
                    <p>RPC timings and payload trace for development.</p>
                  </div>
                  <button className="button secondary" onClick={copyDebugLog} disabled={!debugLines.length}>
                    Copy Debug Log
                  </button>
                </div>
                <pre>{debugLines.join('\n') || 'No debug events yet.'}</pre>
              </section>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
