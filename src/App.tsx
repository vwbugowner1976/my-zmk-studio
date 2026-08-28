import { useContext } from 'react';
import {
  ZMKAppContext,
  ZMKConnection,
  connectSerial,
  isWebSerialSupported,
} from '@cormoran/zmk-studio-react-hook';

const RUNTIME_COMBO_SUBSYSTEM_ID = 'cormoran__runtime_combo';

function ConnectedWorkspace({ disconnect, deviceName }: { disconnect: () => void; deviceName?: string }) {
  const zmkApp = useContext(ZMKAppContext);
  const runtimeCombo = zmkApp?.findSubsystem(RUNTIME_COMBO_SUBSYSTEM_ID);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ZMK configuration UI</div>
          <h1>My ZMK Studio</h1>
        </div>
        <button className="button secondary" onClick={disconnect}>Disconnect</button>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="section-title">Device</div>
          <div className="device-card">
            <span className="status online" />
            <div>
              <strong>{deviceName || 'ZMK device'}</strong>
              <small>Connected over USB / Web Serial</small>
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
              <h2>Combos</h2>
              <p>USB connection is live. Runtime Combo RPC support is the next step.</p>
            </div>
          </div>

          <div className="panel" style={{ padding: 24 }}>
            <div className="section-title">Custom Subsystem</div>
            {runtimeCombo ? (
              <>
                <h3>Runtime Combo detected</h3>
                <p>
                  <code>{RUNTIME_COMBO_SUBSYSTEM_ID}</code> was found at subsystem index{' '}
                  <strong>{runtimeCombo.index}</strong>.
                </p>
                <p>
                  The next implementation will call this subsystem directly to list, edit, and save combos.
                </p>
              </>
            ) : (
              <>
                <h3>Runtime Combo not detected</h3>
                <p>
                  The keyboard connected successfully, but <code>{RUNTIME_COMBO_SUBSYSTEM_ID}</code> was not advertised.
                </p>
                <p>Confirm the Runtime Combo Studio RPC option is enabled in the firmware.</p>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function DisconnectedWorkspace({ connect, isLoading }: { connect: (factory: typeof connectSerial) => Promise<void>; isLoading: boolean }) {
  const serialSupported = isWebSerialSupported();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ZMK configuration UI</div>
          <h1>My ZMK Studio</h1>
        </div>
        <button
          className="button"
          onClick={() => connect(connectSerial)}
          disabled={!serialSupported || isLoading}
        >
          {isLoading ? 'Connecting…' : 'Connect USB'}
        </button>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="section-title">Device</div>
          <div className="device-card">
            <span className="status" />
            <div>
              <strong>Not connected</strong>
              <small>{serialSupported ? 'Chrome / Edge Web Serial ready' : 'Web Serial is not available'}</small>
            </div>
          </div>
        </aside>

        <section className="content">
          <div className="content-header">
            <div>
              <div className="eyebrow">Runtime configuration</div>
              <h2>Connect your keyboard</h2>
              <p>
                My ZMK Studio now uses the same patched ZMK Studio transport stack as DYA Studio.
              </p>
            </div>
          </div>

          <div className="panel" style={{ padding: 24 }}>
            <h3>USB test</h3>
            <p>Use Chrome or Edge on localhost, click Connect USB, and select the LoTom serial port.</p>
            {!serialSupported && (
              <p>Web Serial requires a Chromium-based browser and localhost or HTTPS.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ZMKConnection
      autoReconnect
      renderDisconnected={({ connect, isLoading }) => (
        <DisconnectedWorkspace connect={connect} isLoading={isLoading} />
      )}
      renderConnected={({ disconnect, deviceName }) => (
        <ConnectedWorkspace disconnect={disconnect} deviceName={deviceName} />
      )}
    />
  );
}
