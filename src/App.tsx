import { useState } from 'react';
import {
  call_rpc,
  create_rpc_connection,
  type RpcConnection,
} from '@zmkfirmware/zmk-studio-ts-client';
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

const RUNTIME_COMBO_SUBSYSTEM_ID = 'cormoran__runtime_combo';

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

export default function App() {
  const [transport, setTransport] = useState<RpcTransport | null>(null);
  const [connection, setConnection] = useState<RpcConnection | null>(null);
  const [subsystems, setSubsystems] = useState<CustomSubsystem[]>([]);
  const [combos, setCombos] = useState<RuntimeComboRecord[]>([]);
  const [comboError, setComboError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<RuntimeComboRecord | null>(null);
  const [positionsText, setPositionsText] = useState('');
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Chrome / Edge Web Serial ready');

  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const connected = !!transport && !!connection;
  const runtimeCombo = subsystems.find(
    (subsystem) => subsystem.identifier === RUNTIME_COMBO_SUBSYSTEM_ID,
  );

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
      setMessage('USB connected. Querying Custom Subsystems…');

      const response = await call_rpc(nextConnection, {
        custom: { listCustomSubsystems: {} },
      });
      const detected = (response.custom?.listCustomSubsystems?.subsystems ?? []).map(
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
        setMessage(`Runtime Combo detected at index ${runtimeComboDetected.index}. Reading combos…`);
        try {
          const result = await readRuntimeCombos(nextConnection, runtimeComboDetected.index);
          loadedCombos = result.combos;
          readMode = result.mode;
          if (result.mode === 'indexed') {
            localComboError = `list_combos failed (${result.listError}); recovered ${loadedCombos.length} combo(s) via get_combo over ${result.maxCombo} slots.`;
          }
        } catch (error) {
          localComboError = error instanceof Error ? error.message : String(error);
        }
      }

      setTransport(nextTransport);
      setConnection(nextConnection);
      setSubsystems(detected);
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
          `list_combos failed (${result.listError}); recovered ${result.combos.length} combo(s) via get_combo over ${result.maxCombo} slots.`,
        );
      }
      const selected = selectedIndex === null
        ? null
        : result.combos.find((combo) => combo.index === selectedIndex) ?? null;
      if (selected) selectCombo(selected);
      setMessage(
        `Refreshed ${result.combos.length} Runtime Combo(s)${result.mode === 'indexed' ? ' using indexed fallback' : ''}.`,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setComboError(text);
    } finally {
      setBusy(false);
    }
  }

  function selectCombo(combo: RuntimeComboRecord) {
    setSelectedIndex(combo.index);
    setDraft({ ...combo, keyPositions: [...combo.keyPositions] });
    setPositionsText(combo.keyPositions.join(', '));
    debug('Editor selected combo', { index: combo.index, name: combo.name });
  }

  function parsePositions(): number[] {
    const values = positionsText
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => Number.parseInt(value, 10));
    if (values.length < 2 || values.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Positions must contain at least two non-negative numbers.');
    }
    return values;
  }

  async function saveDraft() {
    if (!connection || !runtimeCombo || !draft) return;
    setBusy(true);
    setComboError(null);
    try {
      const nextDraft = { ...draft, keyPositions: parsePositions() };
      debug('Save flow begin', nextDraft);

      const setPayload = await callRuntimeCombo(
        connection,
        runtimeCombo.index,
        encodeSetComboRequest(nextDraft, false),
        `set_combo(${nextDraft.index})`,
      );
      debug('set_combo status', decodeStatusResponse(setPayload));

      const namePayload = await callRuntimeCombo(
        connection,
        runtimeCombo.index,
        encodeSetComboNameRequest(nextDraft.index, nextDraft.name, false),
        `set_combo_name(${nextDraft.index})`,
      );
      debug('set_combo_name status', decodeStatusResponse(namePayload));

      setMessage('Combo updated in RAM. Saving to flash…');
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

      setMessage(`Saved. Firmware reported ${saveStatus.affectedCount} affected setting(s). Re-reading…`);
      const result = await readRuntimeCombos(connection, runtimeCombo.index);
      setCombos(result.combos);
      const saved = result.combos.find((combo) => combo.index === nextDraft.index) ?? null;
      if (saved) selectCombo(saved);
      setMessage(`Saved combo #${nextDraft.index} and re-read ${result.combos.length} combo(s).`);
      if (result.mode === 'indexed') {
        setComboError(
          `list_combos still failed (${result.listError}); re-read succeeded via indexed fallback.`,
        );
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
    setComboError(null);
    setSelectedIndex(null);
    setDraft(null);
    setMessage('Disconnected');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><div className="eyebrow">ZMK configuration UI</div><h1>My ZMK Studio</h1></div>
        <button className={connected ? 'button secondary' : 'button'} onClick={connected ? disconnectUsb : connectUsb} disabled={busy || (!connected && !serialSupported)}>
          {busy ? 'Working…' : connected ? 'Disconnect' : 'Connect USB'}
        </button>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="section-title">Device</div>
          <div className="device-card">
            <span className={connected ? 'status online' : 'status'} />
            <div><strong>{connected ? 'ZMK device connected' : 'Not connected'}</strong><small>{message}</small></div>
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
            <div><div className="eyebrow">Runtime configuration</div><h2>{connected ? 'Runtime Combo' : 'Connect your keyboard'}</h2><p>Direct DYA-compatible Custom Studio RPC.</p></div>
            {connected && runtimeCombo && <button className="button" onClick={refreshCombos} disabled={busy}>Refresh</button>}
          </div>

          <div className="panel" style={{ padding: 24 }}>
            {connected ? (
              <>
                <h3>ZMK Studio RPC is live</h3>
                <p>Transport label: <code>{transport?.label || 'unknown'}</code></p>
                {runtimeCombo ? (
                  <>
                    <p><code>{runtimeCombo.identifier}</code> · subsystem <strong>#{runtimeCombo.index}</strong></p>
                    {comboError && <p>Runtime Combo note: <code>{comboError}</code></p>}
                    <h3>Combos from firmware</h3>
                    <p>{combos.length} combo(s) returned by the device. Click one to edit.</p>
                    {combos.length ? (
                      <div className="combo-list">
                        {combos.map((combo) => (
                          <button className="combo-row" key={combo.index} onClick={() => selectCombo(combo)} style={{ width: '100%', textAlign: 'left' }}>
                            <span>
                              <strong>#{combo.index} {combo.name || 'Unnamed combo'}</strong>
                              <small>{combo.keyPositions.join(' + ') || 'No positions'} · behavior #{combo.behaviorId} ({combo.param1}, {combo.param2}) · timeout {combo.timeoutMs} ms</small>
                            </span>
                            <span className={combo.enabled ? 'pill' : 'pill muted'}>{sourceLabel(combo.source)} / {combo.enabled ? 'On' : 'Off'}</span>
                          </button>
                        ))}
                      </div>
                    ) : <p>No Runtime Combos were returned.</p>}
                  </>
                ) : <><h3>Runtime Combo not detected</h3><p>Expected subsystem: <code>{RUNTIME_COMBO_SUBSYSTEM_ID}</code></p></>}
              </>
            ) : (
              <><h3>USB test</h3><p>Use Chrome or Edge on localhost, click Connect USB, and select the LoTom serial port.</p>{!serialSupported && <p>Web Serial is not available in this browser.</p>}</>
            )}
          </div>

          {connected && draft && (
            <div className="panel" style={{ padding: 24, marginTop: 16 }}>
              <h3>Edit combo #{draft.index}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                <label>Positions<input value={positionsText} onChange={(e) => setPositionsText(e.target.value)} placeholder="12, 13" /></label>
                <label>Behavior ID<input type="number" min="0" value={draft.behaviorId} onChange={(e) => setDraft({ ...draft, behaviorId: Number(e.target.value) })} /></label>
                <label>Param 1<input type="number" min="0" value={draft.param1} onChange={(e) => setDraft({ ...draft, param1: Number(e.target.value) })} /></label>
                <label>Param 2<input type="number" min="0" value={draft.param2} onChange={(e) => setDraft({ ...draft, param2: Number(e.target.value) })} /></label>
                <label>Timeout ms<input type="number" min="0" max="65535" value={draft.timeoutMs} onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) })} /></label>
                <label>Layer mask<input type="number" min="0" value={draft.layerMask} onChange={(e) => setDraft({ ...draft, layerMask: Number(e.target.value) })} /></label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />Enabled</label>
              </div>
              <div style={{ marginTop: 16 }}>
                <button className="button" onClick={saveDraft} disabled={busy}>Save to firmware</button>
              </div>
            </div>
          )}

          {connected && (
            <div className="panel" style={{ padding: 24, marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <h3>Debug Log</h3>
                <button className="button secondary" onClick={copyDebugLog} disabled={!debugLines.length}>Copy Debug Log</button>
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: 12 }}>{debugLines.join('\n') || 'No debug events yet.'}</pre>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
