import { useMemo, useState } from 'react';

type Combo = {
  id: number;
  name: string;
  positions: number[];
  behavior: string;
  timeoutMs: number;
  enabled: boolean;
};

const demoCombos: Combo[] = [
  { id: 0, name: 'Escape', positions: [12, 13], behavior: '&kp ESC', timeoutMs: 40, enabled: true },
  { id: 1, name: 'Tab', positions: [20, 21], behavior: '&kp TAB', timeoutMs: 45, enabled: true },
];

export default function App() {
  const [connected, setConnected] = useState(false);
  const [combos, setCombos] = useState<Combo[]>(demoCombos);
  const [selectedId, setSelectedId] = useState(0);
  const [dirty, setDirty] = useState(false);

  const selected = useMemo(
    () => combos.find((combo) => combo.id === selectedId) ?? combos[0],
    [combos, selectedId],
  );

  function updateSelected(patch: Partial<Combo>) {
    setCombos((current) =>
      current.map((combo) => (combo.id === selectedId ? { ...combo, ...patch } : combo)),
    );
    setDirty(true);
  }

  function addCombo() {
    const nextId = combos.length ? Math.max(...combos.map((combo) => combo.id)) + 1 : 0;
    const next: Combo = {
      id: nextId,
      name: `Combo ${nextId}`,
      positions: [],
      behavior: '&kp ESC',
      timeoutMs: 40,
      enabled: true,
    };
    setCombos((current) => [...current, next]);
    setSelectedId(nextId);
    setDirty(true);
  }

  function removeCombo() {
    setCombos((current) => current.filter((combo) => combo.id !== selectedId));
    setSelectedId(0);
    setDirty(true);
  }

  function save() {
    // RPC integration comes next. The final flow will be:
    // SetCombo -> success -> ListCombos -> replace UI state.
    setDirty(false);
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
          onClick={() => setConnected((value) => !value)}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </button>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="section-title">Device</div>
          <div className="device-card">
            <span className={connected ? 'status online' : 'status'} />
            <div>
              <strong>{connected ? 'Connected' : 'Not connected'}</strong>
              <small>{connected ? 'Transport placeholder' : 'USB / BLE support next'}</small>
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
              <p>Edit combos without rebuilding firmware.</p>
            </div>
            <button className="button" onClick={addCombo}>+ Add Combo</button>
          </div>

          <div className="combo-layout">
            <div className="combo-list panel">
              {combos.map((combo) => (
                <button
                  key={combo.id}
                  className={combo.id === selectedId ? 'combo-row selected' : 'combo-row'}
                  onClick={() => setSelectedId(combo.id)}
                >
                  <span>
                    <strong>{combo.name}</strong>
                    <small>#{combo.id} · {combo.positions.join(' + ') || 'No positions'}</small>
                  </span>
                  <span className={combo.enabled ? 'pill' : 'pill muted'}>
                    {combo.enabled ? 'On' : 'Off'}
                  </span>
                </button>
              ))}
            </div>

            {selected ? (
              <div className="editor panel">
                <label>
                  Name
                  <input
                    value={selected.name}
                    onChange={(event) => updateSelected({ name: event.target.value })}
                  />
                </label>

                <label>
                  Key positions
                  <input
                    value={selected.positions.join(', ')}
                    onChange={(event) =>
                      updateSelected({
                        positions: event.target.value
                          .split(',')
                          .map((value) => Number(value.trim()))
                          .filter((value) => Number.isFinite(value)),
                      })
                    }
                    placeholder="12, 13"
                  />
                </label>

                <label>
                  Behavior
                  <input
                    value={selected.behavior}
                    onChange={(event) => updateSelected({ behavior: event.target.value })}
                    placeholder="&kp ESC"
                  />
                </label>

                <label>
                  Timeout (ms)
                  <input
                    type="number"
                    min={1}
                    value={selected.timeoutMs}
                    onChange={(event) => updateSelected({ timeoutMs: Number(event.target.value) })}
                  />
                </label>

                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(event) => updateSelected({ enabled: event.target.checked })}
                  />
                  Enabled
                </label>

                <div className="actions">
                  <button className="button danger" onClick={removeCombo}>Delete</button>
                  <button className="button" disabled={!dirty} onClick={save}>
                    {dirty ? 'Save changes' : 'Saved'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="panel empty">No combo selected.</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
