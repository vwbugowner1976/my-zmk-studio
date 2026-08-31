import { useEffect, useMemo, useRef, useState } from 'react';
import {
  call_rpc,
  create_rpc_connection,
  type RpcConnection,
} from '@zmkfirmware/zmk-studio-ts-client';
import type { KeyPhysicalAttrs } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import {
  connectSerial,
  type ClosableRpcTransport,
} from './serialTransport';
import LayerViewer from './LayerViewer';
import KeymapBackup from './KeymapBackup';
import ComboEditor from './ComboEditor';
import CustomSettings from './CustomSettings';
import QmkDevicePanel from './QmkDevicePanel';
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
  type RuntimeComboGlobalSettings,
  type RuntimeComboRecord,
} from './runtimeComboProtocol';
import { useBehaviorOptions } from './useStudioCore';

const RUNTIME_COMBO_SUBSYSTEM_ID = 'cormoran__runtime_combo';
const CUSTOM_SETTINGS_SUBSYSTEM_ID = 'cormoran_custom_settings';

type CustomSubsystem = { index: number; identifier: string };
type ActiveTool = 'runtime-combo' | 'layer-viewer' | 'keymap-backup' | 'custom-settings';

const sourceLabel = (source: number) => {
  if (source === 1) return 'Default';
  if (source === 2) return 'Overridden';
  if (source === 3) return 'Runtime';
  return 'Empty';
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join(' ');

export default function App() {
  const [transport, setTransport] = useState<ClosableRpcTransport | null>(null);
  const [connection, setConnection] = useState<RpcConnection | null>(null);
  const [subsystems, setSubsystems] = useState<CustomSubsystem[]>([]);
  const [combos, setCombos] = useState<RuntimeComboRecord[]>([]);
  const [comboSettings, setComboSettings] = useState<RuntimeComboGlobalSettings | null>(null);
  const [comboError, setComboError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<RuntimeComboRecord | null>(null);
  const [physicalKeys, setPhysicalKeys] = useState<KeyPhysicalAttrs[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Chrome / Edge Web Serial ready');
  const [activeTool, setActiveTool] = useState<ActiveTool>('runtime-combo');
  const [menuOpen, setMenuOpen] = useState(() => {
    const saved = localStorage.getItem('my-keeb-studio-menu-open')
      ?? localStorage.getItem('my-zmk-studio-menu-open');
    return saved !== 'false';
  });
  const rpcAbortRef = useRef<AbortController | null>(null);

  const behaviorOptions = useBehaviorOptions(connection);
  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const connected = !!transport && !!connection;
  const runtimeCombo = useMemo(
    () => subsystems.find((subsystem) => subsystem.identifier === RUNTIME_COMBO_SUBSYSTEM_ID),
    [subsystems],
  );
  const customSettings = useMemo(
    () => subsystems.find((subsystem) => subsystem.identifier === CUSTOM_SETTINGS_SUBSYSTEM_ID),
    [subsystems],
  );
  const maxCombos = comboSettings?.maxCombo || 16;
  const nextFreeComboIndex = useMemo(() => {
    const used = new Set(combos.map((combo) => combo.index));
    for (let index = 0; index < maxCombos; index += 1) {
      if (!used.has(index)) return index;
    }
    return null;
  }, [combos, maxCombos]);

  useEffect(() => {
    localStorage.setItem('my-keeb-studio-menu-open', String(menuOpen));
  }, [menuOpen]);

  useEffect(() => {
    if (!connection) setPhysicalKeys(null);
  }, [connection]);

  function debug(event: string, detail?: unknown) {
    const timestamp = new Date().toISOString().slice(11, 23);
    const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    console.info(`[MyKeebStudio] ${timestamp} ${event}${suffix}`);
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
      const response = await call_rpc(nextConnection, { custom: { call: { subsystemIndex, payload } } });
      const responsePayload = response.custom?.call?.payload;
      if (!responsePayload) throw new Error('Runtime Combo returned no payload');
      debug(`RPC <- ${label}`, `${Math.round(performance.now() - started)}ms bytes=[${hex(responsePayload)}]`);
      return responsePayload;
    } catch (error) {
      debug(`RPC !! ${label}`, `${Math.round(performance.now() - started)}ms ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async function readPhysicalLayout(nextConnection: RpcConnection) {
    try {
      debug('RPC -> keymap.getPhysicalLayouts');
      const resp = await call_rpc(nextConnection, { keymap: { getPhysicalLayouts: true } });
      const layouts = resp?.keymap?.getPhysicalLayouts;
      if (!layouts) return null;
      const keys = layouts.layouts[layouts.activeLayoutIndex]?.keys ?? null;
      debug('Physical layout loaded', { activeLayoutIndex: layouts.activeLayoutIndex, keyCount: keys?.length ?? 0 });
      return keys;
    } catch (error) {
      debug('Physical layout failed', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function readRuntimeCombos(nextConnection: RpcConnection, subsystemIndex: number) {
    const settingsPayload = await callRuntimeCombo(nextConnection, subsystemIndex, encodeGetGlobalSettingsRequest(), 'get_global_settings');
    const settings = decodeGlobalSettingsResponse(settingsPayload);
    const maxCombo = settings.maxCombo || 16;
    try {
      const payload = await callRuntimeCombo(nextConnection, subsystemIndex, encodeListCombosRequest(), 'list_combos');
      const loaded = decodeRuntimeComboResponse(payload);
      debug('list_combos decoded', { count: loaded.length, maxCombo });
      return { combos: loaded, settings, mode: 'list' as const };
    } catch (error) {
      const listError = error instanceof Error ? error.message : String(error);
      debug('list_combos fallback', listError);
      const loaded: RuntimeComboRecord[] = [];
      for (let index = 0; index < maxCombo; index += 1) {
        try {
          const comboPayload = await callRuntimeCombo(nextConnection, subsystemIndex, encodeGetComboRequest(index), `get_combo(${index})`);
          const combo = decodeGetComboResponse(comboPayload);
          if (combo) loaded.push(combo);
        } catch (comboReadError) {
          const text = comboReadError instanceof Error ? comboReadError.message : String(comboReadError);
          if (text.includes('-2') || text.includes('-22')) continue;
          throw comboReadError;
        }
      }
      debug('indexed fallback complete', { count: loaded.length, maxCombo });
      return { combos: loaded, settings, mode: 'indexed' as const, listError, maxCombo };
    }
  }

  function selectCombo(combo: RuntimeComboRecord) {
    setSelectedIndex(combo.index);
    setDraft({ ...combo, keyPositions: [...combo.keyPositions] });
    setComboError(null);
    debug('Editor selected combo', { index: combo.index, name: combo.name });
  }

  function createNewCombo() {
    if (nextFreeComboIndex === null) return;
    const keyPressBehavior = behaviorOptions?.find((option) => /key\s*press|keypress/i.test(option.displayName));
    const next: RuntimeComboRecord = {
      index: nextFreeComboIndex,
      name: `New Combo ${nextFreeComboIndex}`,
      keyPositions: [],
      behaviorId: keyPressBehavior?.id ?? 0,
      param1: 0,
      param2: 0,
      layerMask: 0,
      enabled: true,
      timeoutMs: comboSettings?.timeoutMs || 50,
      requirePriorIdleMs: comboSettings?.requirePriorIdleMs || 0,
      slowReleaseOverride: 0,
      source: 3,
    };
    setSelectedIndex(next.index);
    setDraft(next);
    setComboError(null);
    debug('New combo draft created', { index: next.index, maxCombos });
  }

  async function connectUsb() {
    setBusy(true);
    setComboError(null);
    setMessage('Opening ZMK USB serial connection…');
    let nextTransport: ClosableRpcTransport | null = null;
    let rpcAbort: AbortController | null = null;
    try {
      debug('Connect ZMK USB requested');
      nextTransport = await connectSerial();
      debug('Serial transport open', { label: nextTransport.label });
      rpcAbort = new AbortController();
      rpcAbortRef.current = rpcAbort;
      const nextConnection = create_rpc_connection(nextTransport, { signal: rpcAbort.signal });
      debug('RPC pipelines started with dedicated AbortSignal');

      const [subsystemResponse, keys] = await Promise.all([
        call_rpc(nextConnection, { custom: { listCustomSubsystems: {} } }),
        readPhysicalLayout(nextConnection),
      ]);
      const detected = (subsystemResponse.custom?.listCustomSubsystems?.subsystems ?? []).map((subsystem) => ({
        index: subsystem.index,
        identifier: subsystem.identifier,
      }));
      debug('Custom Subsystems', detected);
      const runtimeComboDetected = detected.find((subsystem) => subsystem.identifier === RUNTIME_COMBO_SUBSYSTEM_ID);
      let loadedCombos: RuntimeComboRecord[] = [];
      let loadedSettings: RuntimeComboGlobalSettings | null = null;
      let localComboError: string | null = null;
      if (runtimeComboDetected) {
        const result = await readRuntimeCombos(nextConnection, runtimeComboDetected.index);
        loadedCombos = result.combos;
        loadedSettings = result.settings;
        if (result.mode === 'indexed') {
          localComboError = `list_combos failed (${result.listError}); recovered ${loadedCombos.length} combo(s) via indexed fallback.`;
        }
      }
      setTransport(nextTransport);
      setConnection(nextConnection);
      setSubsystems(detected);
      setPhysicalKeys(keys);
      setCombos(loadedCombos);
      setComboSettings(loadedSettings);
      setComboError(localComboError);
      setMessage(runtimeComboDetected ? `Connected. Read ${loadedCombos.length} Runtime Combo(s).` : `Connected. ${detected.length} Custom Subsystem(s) detected.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      debug('Connection failed', text);
      setMessage(`Connection / RPC failed: ${text}`);
      if (rpcAbort && !rpcAbort.signal.aborted) rpcAbort.abort('Connection setup failed');
      rpcAbortRef.current = null;
      if (nextTransport) {
        try {
          await nextTransport.close();
          debug('Serial port released after connection failure');
        } catch (closeError) {
          debug('Serial close after connection failure failed', closeError instanceof Error ? closeError.message : String(closeError));
        }
      }
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
      setComboSettings(result.settings);
      if (result.mode === 'indexed') setComboError(`list_combos failed (${result.listError}); indexed fallback succeeded.`);
      const selected = selectedIndex === null ? null : result.combos.find((combo) => combo.index === selectedIndex) ?? null;
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
    if (!draft.behaviorId) {
      setComboError('Choose an output for the combo before saving.');
      return;
    }
    setBusy(true);
    setComboError(null);
    try {
      debug('Save flow begin', draft);
      const setPayload = await callRuntimeCombo(connection, runtimeCombo.index, encodeSetComboRequest(draft, false), `set_combo(${draft.index})`);
      debug('set_combo status', decodeStatusResponse(setPayload));
      const namePayload = await callRuntimeCombo(connection, runtimeCombo.index, encodeSetComboNameRequest(draft.index, draft.name, false), `set_combo_name(${draft.index})`);
      debug('set_combo_name status', decodeStatusResponse(namePayload));
      const saveStarted = performance.now();
      const savePayload = await callRuntimeCombo(connection, runtimeCombo.index, encodeSaveRequest(), 'save');
      debug('save status', { ...decodeStatusResponse(savePayload), elapsedMs: Math.round(performance.now() - saveStarted) });
      const result = await readRuntimeCombos(connection, runtimeCombo.index);
      setCombos(result.combos);
      setComboSettings(result.settings);
      const saved = result.combos.find((combo) => combo.index === draft.index) ?? null;
      if (saved) selectCombo(saved);
      setMessage(`Saved combo #${draft.index} and re-read ${result.combos.length} combo(s).`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      debug('Save flow failed', text);
      setComboError(text);
      setMessage('Save failed. See Debug Console.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnectUsb() {
    if (!transport) return;
    setBusy(true);
    setMessage('Disconnecting and releasing serial port…');
    debug('Disconnect requested');
    const currentTransport = transport;
    const currentConnection = connection;
    const rpcAbort = rpcAbortRef.current;
    try {
      debug('RPC pipelines stopping');
      if (rpcAbort && !rpcAbort.signal.aborted) rpcAbort.abort('Disconnected by user');
      rpcAbortRef.current = null;
      try { await currentConnection?.request_writable.close(); } catch { /* expected after abort */ }
      try { await currentConnection?.request_response_readable.cancel(); } catch { /* expected after abort */ }
      try { await currentConnection?.notification_readable.cancel(); } catch { /* expected after abort */ }
      debug('RPC pipelines stopped');
      debug('Serial transport closing');
      await currentTransport.close();
      debug('Serial port released');
      setMessage('Disconnected. Serial port released for another Studio.');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      debug('Disconnect cleanup failed', text);
      setMessage(`Disconnected with cleanup warning: ${text}`);
    } finally {
      setTransport(null);
      setConnection(null);
      setSubsystems([]);
      setCombos([]);
      setComboSettings(null);
      setPhysicalKeys(null);
      setComboError(null);
      setSelectedIndex(null);
      setDraft(null);
      setBusy(false);
    }
  }

  const title = activeTool === 'layer-viewer'
    ? 'Layer Viewer'
    : activeTool === 'keymap-backup'
      ? 'Keymap Backup'
      : activeTool === 'custom-settings'
        ? 'Custom Settings'
        : 'Runtime Combo';
  const description = activeTool === 'layer-viewer'
    ? 'View and edit the live firmware keymap, with PNG and PDF export.'
    : activeTool === 'keymap-backup'
      ? 'Backup the live keymap to JSON or restore a matching backup.'
      : activeTool === 'custom-settings'
        ? 'Edit typed settings exposed by firmware modules, then save or discard staged changes.'
        : 'Create and tune Runtime Combos with a guided editor.';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <button className="menu-toggle" type="button" onClick={() => setMenuOpen((value) => !value)} title={menuOpen ? 'Hide menu' : 'Show menu'}>☰</button>
          <div>
            <div className="eyebrow">Keyboard firmware inspector</div>
            <h1>My Keeb Studio <small className="version-badge">v0.7</small></h1>
          </div>
        </div>
        <button className={connected ? 'button secondary' : 'button'} onClick={connected ? disconnectUsb : connectUsb} disabled={busy || (!connected && !serialSupported)}>
          {busy ? 'Working…' : connected ? 'Disconnect ZMK' : 'Connect ZMK'}
        </button>
      </header>

      <main className={`workspace ${menuOpen ? '' : 'menu-collapsed'}`}>
        {menuOpen && (
          <aside className="sidebar">
            <div className="section-title">Device</div>
            <div className="device-card">
              <span className={connected ? 'status online' : 'status'} />
              <div><strong>{connected ? 'ZMK device connected' : 'Not connected'}</strong><small>{message}</small></div>
            </div>
            <div className="section-title tool-title">ZMK Tools</div>
            <nav className="nav-list tool-nav">
              <button className={`nav-item ${activeTool === 'runtime-combo' ? 'active' : ''}`} onClick={() => setActiveTool('runtime-combo')}>Runtime Combo</button>
              <button className={`nav-item ${activeTool === 'layer-viewer' ? 'active' : ''}`} onClick={() => setActiveTool('layer-viewer')}>Layer Viewer</button>
              <button className={`nav-item ${activeTool === 'keymap-backup' ? 'active' : ''}`} onClick={() => setActiveTool('keymap-backup')}>Keymap Backup</button>
              <button className={`nav-item ${activeTool === 'custom-settings' ? 'active' : ''}`} onClick={() => setActiveTool('custom-settings')}>Custom Settings</button>
              <button className="nav-item" disabled>BLE Management</button>
              <button className="nav-item" disabled>PMW3610</button>
              <button className="nav-item" disabled>PAW3222</button>
            </nav>
          </aside>
        )}

        <section className="content">
          <div className="content-header">
            <div>
              <div className="eyebrow">Read / inspect / edit</div>
              <h2>{connected ? title : 'Connect your keyboard'}</h2>
              <p>{connected ? description : 'Use Web Serial for ZMK Studio, or inspect a QMK / VIA Raw HID interface with WebHID.'}</p>
            </div>
            {connected && activeTool === 'runtime-combo' && runtimeCombo && (
              <div className="content-header-actions">
                <button className="button secondary" onClick={refreshCombos} disabled={busy}>Refresh</button>
                <button className="button" onClick={createNewCombo} disabled={busy || nextFreeComboIndex === null} title={nextFreeComboIndex === null ? `All ${maxCombos} combo slots are in use` : `Create combo #${nextFreeComboIndex}`}>
                  + New Combo
                </button>
              </div>
            )}
          </div>

          {!connected ? (
            <div>
              <div className="panel empty"><div><h3>ZMK Studio</h3><p>Connect a ZMK Studio enabled keyboard with desktop Chrome or Edge using the “Connect ZMK” button.</p></div></div>
              <QmkDevicePanel />
            </div>
          ) : activeTool === 'layer-viewer' && connection ? (
            <LayerViewer connection={connection} physicalKeys={physicalKeys} behaviorOptions={behaviorOptions} onDebug={debug} />
          ) : activeTool === 'keymap-backup' && connection ? (
            <KeymapBackup connection={connection} onDebug={debug} />
          ) : activeTool === 'custom-settings' && connection ? (
            customSettings ? (
              <CustomSettings
                connection={connection}
                customSettingsSubsystemIndex={customSettings.index}
                subsystems={subsystems}
                behaviorOptions={behaviorOptions}
                onDebug={debug}
              />
            ) : (
              <div className="panel empty"><div><h3>Custom Settings unavailable</h3><p>This firmware does not advertise cormoran_custom_settings.</p></div></div>
            )
          ) : (
            <>
              <div className="status-strip panel">
                <span>ZMK Studio RPC live</span>
                <code>{transport?.label || 'unknown'}</code>
                {runtimeCombo && <code>{runtimeCombo.identifier} #{runtimeCombo.index}</code>}
                {runtimeCombo && <code>{combos.length}/{maxCombos} slots used</code>}
              </div>
              {comboError && <div className="notice">{comboError}</div>}
              {!runtimeCombo ? (
                <div className="panel empty"><div><h3>Runtime Combo unavailable</h3><p>This firmware does not advertise cormoran__runtime_combo.</p></div></div>
              ) : (
                <div className="runtime-grid guided-runtime-grid">
                  <section className="panel combo-panel">
                    <div className="panel-heading"><div><h3>Combos from firmware</h3><p>{combos.length} of {maxCombos} slot(s) used. Choose one to edit or create a new combo.</p></div></div>
                    <div className="combo-scroll-box">
                      {combos.length ? combos.map((combo) => (
                        <button className={`combo-row ${selectedIndex === combo.index ? 'selected' : ''}`} key={combo.index} onClick={() => selectCombo(combo)}>
                          <span><strong>#{combo.index} {combo.name || 'Unnamed combo'}</strong><small>{combo.keyPositions.length} keys · {combo.timeoutMs}ms · behavior #{combo.behaviorId}</small></span>
                          <span className={combo.enabled ? 'pill' : 'pill muted'}>{sourceLabel(combo.source)} / {combo.enabled ? 'On' : 'Off'}</span>
                        </button>
                      )) : <p>No Runtime Combos yet. Use “+ New Combo” to create the first one.</p>}
                    </div>
                  </section>

                  <section className="panel editor combo-editor-host">
                    {draft ? (
                      <ComboEditor draft={draft} setDraft={setDraft} physicalKeys={physicalKeys} behaviorOptions={behaviorOptions} busy={busy} onSave={() => void saveDraft()} />
                    ) : <div className="empty">Select a combo from the list or click “+ New Combo”.</div>}
                  </section>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
