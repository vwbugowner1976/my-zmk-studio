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
  encodeGetComboRequest,
  encodeGetGlobalSettingsRequest,
  encodeListCombosRequest,
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

export default function App() {
  const [transport, setTransport] = useState<RpcTransport | null>(null);
  const [connection, setConnection] = useState<RpcConnection | null>(null);
  const [subsystems, setSubsystems] = useState<CustomSubsystem[]>([]);
  const [combos, setCombos] = useState<RuntimeComboRecord[]>([]);
  const [comboError, setComboError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Chrome / Edge Web Serial ready');

  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const connected = !!transport && !!connection;
  const runtimeCombo = subsystems.find(
    (subsystem) => subsystem.identifier === RUNTIME_COMBO_SUBSYSTEM_ID,
  );

  async function callRuntimeCombo(
    nextConnection: RpcConnection,
    subsystemIndex: number,
    payload: Uint8Array,
  ) {
    const response = await call_rpc(nextConnection, {
      custom: { call: { subsystemIndex, payload } },
    });
    const responsePayload = response.custom?.call?.payload;
    if (!responsePayload) throw new Error('Runtime Combo returned no payload');
    return responsePayload;
  }

  async function readRuntimeCombos(nextConnection: RpcConnection, subsystemIndex: number) {
    try {
      const payload = await callRuntimeCombo(
        nextConnection,
        subsystemIndex,
        encodeListCombosRequest(),
      );
      return {
        combos: decodeRuntimeComboResponse(payload),
        mode: 'list' as const,
      };
    } catch (error) {
      const listError = error instanceof Error ? error.message : String(error);

      const settingsPayload = await callRuntimeCombo(
        nextConnection,
        subsystemIndex,
        encodeGetGlobalSettingsRequest(),
      );
      const settings = decodeGlobalSettingsResponse(settingsPayload);
      const maxCombo = settings.maxCombo || 16;
      const loaded: RuntimeComboRecord[] = [];

      for (let index = 0; index < maxCombo; index += 1) {
        try {
          const comboPayload = await callRuntimeCombo(
            nextConnection,
            subsystemIndex,
            encodeGetComboRequest(index),
          );
          const combo = decodeGetComboResponse(comboPayload);
          if (combo) loaded.push(combo);
        } catch (comboReadError) {
          const text = comboReadError instanceof Error ? comboReadError.message : String(comboReadError);
          if (text.includes('-2')) continue;
          if (text.includes('-22')) continue;
          throw comboReadError;
        }
      }

      return {
        combos: loaded,
        mode: 'indexed' as const,
        listError,
        maxCombo,
      };
    }
  }

  async function connectUsb() {
    setBusy(true);
    setComboError(null);
    setMessage('Opening USB serial connection…');
    try {
      const nextTransport = await connectSerial();
      const nextConnection = create_rpc_connection(nextTransport);
      setMessage('USB connected. Querying Custom Subsystems…');

      const response = await call_rpc(nextConnection, {
        custom: { listCustomSubsystems: {} },
      });
      const detected = (response.custom?.listCustomSubsystems?.subsystems ?? []).map(
        (subsystem) => ({ index: subsystem.index, identifier: subsystem.identifier }),
      );
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

  function disconnectUsb() {
    transport?.abortController.abort('Disconnected by user');
    setTransport(null);
    setConnection(null);
    setSubsystems([]);
    setCombos([]);
    setComboError(null);
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
            <div><div className="eyebrow">Runtime configuration</div><h2>{connected ? 'Runtime Combo' : 'Connect your keyboard'}</h2><p>My ZMK Studio talks directly to the DYA-compatible Custom Studio RPC.</p></div>
            {connected && runtimeCombo && <button className="button" onClick={refreshCombos} disabled={busy}>Refresh</button>}
          </div>

          <div className="panel" style={{ padding: 24 }}>
            {connected ? (
              <>
                <h3>ZMK Studio RPC is live</h3>
                <p>Transport label: <code>{transport?.label || 'unknown'}</code></p>
                {runtimeCombo ? (
                  <>
                    <h3>Runtime Combo detected</h3>
                    <p><code>{runtimeCombo.identifier}</code> is available at subsystem index <strong>{runtimeCombo.index}</strong>.</p>
                    {comboError && <p>Runtime Combo note: <code>{comboError}</code></p>}
                    <h3>Combos from firmware</h3>
                    <p>{combos.length} combo(s) returned by the device.</p>
                    {combos.length ? (
                      <div className="combo-list">
                        {combos.map((combo) => (
                          <div className="combo-row" key={combo.index}>
                            <span>
                              <strong>#{combo.index} {combo.name || 'Unnamed combo'}</strong>
                              <small>{combo.keyPositions.join(' + ') || 'No positions'} · behavior #{combo.behaviorId} ({combo.param1}, {combo.param2}) · timeout {combo.timeoutMs} ms</small>
                            </span>
                            <span className={combo.enabled ? 'pill' : 'pill muted'}>{sourceLabel(combo.source)} / {combo.enabled ? 'On' : 'Off'}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p>No Runtime Combos were returned.</p>}
                  </>
                ) : <><h3>Runtime Combo not detected</h3><p>Expected subsystem: <code>{RUNTIME_COMBO_SUBSYSTEM_ID}</code></p></>}

                <h3>Advertised Custom Subsystems</h3>
                {subsystems.length ? <ul>{subsystems.map((subsystem) => <li key={`${subsystem.index}-${subsystem.identifier}`}>#{subsystem.index} <code>{subsystem.identifier}</code></li>)}</ul> : <p>No Custom Subsystems were advertised.</p>}
              </>
            ) : (
              <><h3>USB test</h3><p>Use Chrome or Edge on localhost, click Connect USB, and select the LoTom serial port.</p>{!serialSupported && <p>Web Serial is not available in this browser.</p>}</>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
