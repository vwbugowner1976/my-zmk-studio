import { useEffect, useMemo, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import { subscribeNotifications } from './notificationHub';
import {
  assertRuntimeInputResponse,
  decodeRuntimeInputNotification,
  encodeListInputProcessorsRequest,
  encodeSetScaleDivisorRequest,
  encodeSetScaleMultiplierRequest,
  type RuntimeInputProcessorRecord,
} from './runtimeInputProtocol';

const FRIENDLY_NAMES: Record<string, string> = {
  lscroll: 'Left · Base Scroll',
  lmove: 'Left · Num Cursor',
  lprec: 'Left · Sym Precision Scroll',
  rmove: 'Right · Base Cursor',
  rprec: 'Right · Num Precision Cursor',
  rscroll: 'Right · Sym Scroll',
};

export default function RuntimeInputProcessor({
  connection,
  subsystemIndex,
  onDebug,
}: {
  connection: RpcConnection;
  subsystemIndex: number;
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [processors, setProcessors] = useState<RuntimeInputProcessorRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [divisor, setDivisor] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => processors.find((processor) => processor.id === selectedId) ?? null,
    [processors, selectedId],
  );

  async function callRuntimeInput(payload: Uint8Array, label: string) {
    onDebug(`RPC -> runtime input ${label}`, { subsystemIndex, bytes: payload.length });
    const response = await call_rpc(connection, {
      custom: { call: { subsystemIndex, payload } },
    });
    const responsePayload = response.custom?.call?.payload;
    if (!responsePayload) throw new Error(`Runtime Input Processor ${label} returned no payload.`);
    assertRuntimeInputResponse(responsePayload);
    onDebug(`RPC <- runtime input ${label}`, { bytes: responsePayload.length });
  }

  async function loadProcessors() {
    setLoading(true);
    setError(null);
    setProcessors([]);
    setMessage('Reading runtime pointing processors…');
    try {
      await callRuntimeInput(encodeListInputProcessorsRequest(), 'list_input_processors');
      await new Promise((resolve) => setTimeout(resolve, 700));
      setMessage('Runtime pointing processors refreshed.');
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Runtime input load failed', text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = subscribeNotifications(connection, (notification) => {
      const custom = notification.custom?.customNotification;
      if (!custom || custom.subsystemIndex !== subsystemIndex) return;
      try {
        const processor = decodeRuntimeInputNotification(custom.payload);
        if (!processor) return;
        setProcessors((previous) => {
          const next = previous.filter((item) => item.id !== processor.id);
          next.push(processor);
          next.sort((a, b) => a.id - b.id);
          return next;
        });
        setSelectedId((current) => current ?? processor.id);
        onDebug('Runtime input processor notification', processor);
      } catch (cause) {
        onDebug('Runtime input notification decode failed', cause instanceof Error ? cause.message : String(cause));
      }
    });
    void loadProcessors();
    return unsubscribe;
  }, [connection, subsystemIndex]);

  useEffect(() => {
    if (!selected || busy) return;
    setMultiplier(selected.scaleMultiplier);
    setDivisor(selected.scaleDivisor);
  }, [selected, busy]);

  async function applyScale() {
    if (!selected) return;
    if (!Number.isInteger(multiplier) || multiplier < 1 || !Number.isInteger(divisor) || divisor < 1) {
      setError('Multiplier and divisor must both be integers of 1 or greater.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (multiplier !== selected.scaleMultiplier) {
        await callRuntimeInput(
          encodeSetScaleMultiplierRequest(selected.id, multiplier),
          `set_scale_multiplier(${selected.name})`,
        );
      }
      if (divisor !== selected.scaleDivisor) {
        await callRuntimeInput(
          encodeSetScaleDivisorRequest(selected.id, divisor),
          `set_scale_divisor(${selected.name})`,
        );
      }
      setProcessors((previous) => previous.map((item) => item.id === selected.id
        ? { ...item, scaleMultiplier: multiplier, scaleDivisor: divisor }
        : item));
      setMessage(`${FRIENDLY_NAMES[selected.name] ?? selected.name}: saved ${multiplier}/${divisor}.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Runtime input save failed', text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="custom-settings-view">
      <section className="panel custom-settings-toolbar">
        <div>
          <h3>Trackball Runtime Settings</h3>
          <p>Adjust the six PG1KB cursor/scroll speed profiles without rebuilding firmware.</p>
        </div>
        <div className="custom-settings-actions">
          <button className="button secondary" onClick={() => void loadProcessors()} disabled={busy || loading}>
            {loading ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </section>

      {error && <div className="notice">{error}</div>}
      {message && <div className="status-strip panel"><span>{message}</span></div>}

      {processors.length === 0 && !loading ? (
        <div className="panel empty"><div><h3>No runtime processors found</h3><p>The firmware must advertise the cormoran_rip subsystem and define runtime input processors.</p></div></div>
      ) : (
        <div className="runtime-grid guided-runtime-grid">
          <section className="panel combo-panel">
            <div className="panel-heading"><div><h3>Trackball modes</h3><p>Select a mode to change its scale.</p></div></div>
            <div className="combo-scroll-box">
              {processors.map((processor) => (
                <button
                  className={`combo-row ${selectedId === processor.id ? 'selected' : ''}`}
                  key={processor.id}
                  onClick={() => setSelectedId(processor.id)}
                >
                  <span>
                    <strong>{FRIENDLY_NAMES[processor.name] ?? processor.name}</strong>
                    <small>
                      {processor.name} · {processor.xyToScrollEnabled ? 'scroll' : 'cursor'} · scale {processor.scaleMultiplier}/{processor.scaleDivisor}
                    </small>
                  </span>
                  <span className="pill">{(processor.scaleMultiplier / Math.max(1, processor.scaleDivisor)).toFixed(2)}×</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel editor">
            {selected ? (
              <div className="custom-settings-list">
                <div className="custom-setting-row">
                  <div className="custom-setting-info">
                    <div><strong>{FRIENDLY_NAMES[selected.name] ?? selected.name}</strong></div>
                    <small>Firmware processor: {selected.name} · ID {selected.id}</small>
                  </div>
                  <div className="custom-setting-editor">
                    <label className="custom-setting-number">
                      <input
                        type="number"
                        min={1}
                        value={multiplier}
                        disabled={busy}
                        onChange={(event) => setMultiplier(Number(event.target.value))}
                      />
                      <small>Multiplier</small>
                    </label>
                    <label className="custom-setting-number">
                      <input
                        type="number"
                        min={1}
                        value={divisor}
                        disabled={busy}
                        onChange={(event) => setDivisor(Number(event.target.value))}
                      />
                      <small>Divisor</small>
                    </label>
                    <button
                      className="button"
                      disabled={busy || (multiplier === selected.scaleMultiplier && divisor === selected.scaleDivisor)}
                      onClick={() => void applyScale()}
                    >
                      {busy ? 'Saving…' : 'Apply & Save'}
                    </button>
                  </div>
                </div>
                <div className="custom-setting-row">
                  <div className="custom-setting-info">
                    <div><strong>Current transform</strong></div>
                    <small>Read-only in this first PG1KB integration.</small>
                  </div>
                  <div className="custom-setting-readonly">
                    <strong>{selected.rotationDegrees}° · swap {selected.xySwapEnabled ? 'on' : 'off'} · X inv {selected.xInvert ? 'on' : 'off'} · Y inv {selected.yInvert ? 'on' : 'off'}</strong>
                    <small>CPI and PAW3222 polling interval remain firmware settings for now.</small>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty">Select a trackball mode.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
