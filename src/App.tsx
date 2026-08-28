import { useState } from 'react';
import {
  call_rpc,
  create_rpc_connection,
  type RpcConnection,
} from '@zmkfirmware/zmk-studio-ts-client';
import { connect as connectSerial } from '@zmkfirmware/zmk-studio-ts-client/transport/serial';
import type { RpcTransport } from '@zmkfirmware/zmk-studio-ts-client/transport';

const RUNTIME_COMBO_SUBSYSTEM_ID = 'cormoran__runtime_combo';

type CustomSubsystem = {
  index: number;
  identifier: string;
};

export default function App() {
  const [transport, setTransport] = useState<RpcTransport | null>(null);
  const [connection, setConnection] = useState<RpcConnection | null>(null);
  const [subsystems, setSubsystems] = useState<CustomSubsystem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Chrome / Edge Web Serial ready');

  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const connected = !!transport && !!connection;
  const runtimeCombo = subsystems.find(
    (subsystem) => subsystem.identifier === RUNTIME_COMBO_SUBSYSTEM_ID,
  );

  async function connectUsb() {
    setBusy(true);
    setMessage('Opening USB serial connection…');
    try {
      const nextTransport = await connectSerial();
      const nextConnection = create_rpc_connection(nextTransport);

      setMessage('USB connected. Querying Custom Subsystems…');

      const response = await call_rpc(nextConnection, {
        custom: { listCustomSubsystems: {} },
      });

      const detected = (response.custom?.listCustomSubsystems?.subsystems ?? []).map(
        (subsystem) => ({
          index: subsystem.index,
          identifier: subsystem.identifier,
        }),
      );

      setTransport(nextTransport);
      setConnection(nextConnection);
      setSubsystems(detected);

      const runtimeComboDetected = detected.find(
        (subsystem) => subsystem.identifier === RUNTIME_COMBO_SUBSYSTEM_ID,
      );

      if (runtimeComboDetected) {
        setMessage(
          `Connected. Runtime Combo detected at subsystem index ${runtimeComboDetected.index}.`,
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

  function disconnectUsb() {
    transport?.abortController.abort('Disconnected by user');
    setTransport(null);
    setConnection(null);
    setSubsystems([]);
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
          {busy ? 'Connecting…' : connected ? 'Disconnect' : 'Connect USB'}
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
              <h2>{connected ? 'Custom Subsystem discovery' : 'Connect your keyboard'}</h2>
              <p>My ZMK Studio uses cormoran's patched ZMK Studio TypeScript client directly.</p>
            </div>
          </div>

          <div className="panel" style={{ padding: 24 }}>
            {connected ? (
              <>
                <h3>ZMK Studio RPC is live</h3>
                <p>Transport label: <code>{transport?.label || 'unknown'}</code></p>

                {runtimeCombo ? (
                  <>
                    <h3>Runtime Combo detected</h3>
                    <p>
                      <code>{runtimeCombo.identifier}</code> is available at subsystem index{' '}
                      <strong>{runtimeCombo.index}</strong>.
                    </p>
                    <p>Next step: call the Runtime Combo subsystem and read the actual combo list.</p>
                  </>
                ) : (
                  <>
                    <h3>Runtime Combo not detected</h3>
                    <p>
                      Expected subsystem: <code>{RUNTIME_COMBO_SUBSYSTEM_ID}</code>
                    </p>
                  </>
                )}

                <h3>Advertised Custom Subsystems</h3>
                {subsystems.length ? (
                  <ul>
                    {subsystems.map((subsystem) => (
                      <li key={`${subsystem.index}-${subsystem.identifier}`}>
                        #{subsystem.index} <code>{subsystem.identifier}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No Custom Subsystems were advertised.</p>
                )}
              </>
            ) : (
              <>
                <h3>USB test</h3>
                <p>Use Chrome or Edge on localhost, click Connect USB, and select the LoTom serial port.</p>
                {!serialSupported && <p>Web Serial is not available in this browser.</p>}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
