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

const PROCESSOR_META: Record<string, { side: 'Left' | 'Right'; layerIndex: number }> = {
  lscroll: { side: 'Left', layerIndex: 0 },
  lmove: { side: 'Left', layerIndex: 1 },
  lprec: { side: 'Left', layerIndex: 2 },
  rmove: { side: 'Right', layerIndex: 0 },
  rprec: { side: 'Right', layerIndex: 1 },
  rscroll: { side: 'Right', layerIndex: 2 },
};

export default function RuntimeInputProcessor({
  connection,
  subsystemIndex,
  layerNames,
  onDebug,
}: {
  connection: RpcConnection;
  subsystemIndex: number;
  layerNames: string[];
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [processors, setProcessors] = useState<RuntimeInputProcessorRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [divisor, setDivisor] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => processors.find((processor) => processor.id === selectedId) ?? null,
    [processors, selectedId],
  );

  const displayName = (processor: RuntimeInputProcessorRecord) => {
    const meta = PROCESSOR_META[processor.name];
    if (!meta) return processor.name;
    const layerName = layerNames[meta.layerIndex] || `Layer ${meta.layerIndex}`;
    const mode = processor.xyToScrollEnabled ? 'Scroll' : 'Cursor';
    return `${meta.side} · ${layerName} · ${mode}`;
  };

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
    setSpeed(selected.scaleMultiplier / Math.max(1, selected.scaleDivisor));
    setAdvancedOpen(false);
  }, [selected, busy]);

  function ratioForSpeed(value: number) {
    const rounded = Math.max(0.25, Math.min(3, Math.round(value * 4) / 4));
    const numerator = Math.round(rounded * 4);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const divisorValue = gcd(numerator, 4);
    return {
      multiplier: numerator / divisorValue,
      divisor: 4 / divisorValue,
    };
  }

  function setSliderSpeed(value: number) {
    const ratio = ratioForSpeed(value);
    setSpeed(value);
    setMultiplier(ratio.multiplier);
    setDivisor(ratio.divisor);
  }

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
      setMessage(`${displayName(selected)}: saved ${multiplier}/${divisor}.`);
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
        <div className="trackball-layout">
          <section className="trackball-mode-grid">
            {processors.map((processor) => {
              const meta = PROCESSOR_META[processor.name];
              const layerName = meta ? (layerNames[meta.layerIndex] || `Layer ${meta.layerIndex}`) : processor.name;
              const side = meta?.side ?? 'Trackball';
              const mode = processor.xyToScrollEnabled ? 'Scroll' : 'Cursor';
              const currentSpeed = processor.scaleMultiplier / Math.max(1, processor.scaleDivisor);
              return (
                <button
                  className={`trackball-mode-card ${selectedId === processor.id ? 'selected' : ''}`}
                  key={processor.id}
                  onClick={() => setSelectedId(processor.id)}
                >
                  <span className="trackball-card-topline">
                    <span className="trackball-side">{side}</span>
                    <span className={`trackball-mode-badge ${processor.xyToScrollEnabled ? 'scroll' : 'cursor'}`}>{mode}</span>
                  </span>
                  <strong>{layerName}</strong>
                  <span className="trackball-card-speed">{currentSpeed.toFixed(2)}×</span>
                  <small>{processor.name}</small>
                </button>
              );
            })}
          </section>

          <section className="panel trackball-editor">
            {selected ? (
              <>
                <div className="trackball-editor-heading">
                  <div>
                    <div className="eyebrow">{PROCESSOR_META[selected.name]?.side ?? 'Trackball'} · {selected.xyToScrollEnabled ? 'Scroll' : 'Cursor'}</div>
                    <h3>{PROCESSOR_META[selected.name] ? (layerNames[PROCESSOR_META[selected.name].layerIndex] || `Layer ${PROCESSOR_META[selected.name].layerIndex}`) : selected.name}</h3>
                    <p>Move the slider to change this mode's speed.</p>
                  </div>
                  <div className="trackball-speed-readout">{speed.toFixed(2)}×</div>
                </div>

                <div className="trackball-speed-control">
                  <div className="trackball-speed-labels"><span>0.25×</span><span>1.00×</span><span>2.00×</span><span>3.00×</span></div>
                  <input
                    className="trackball-speed-slider"
                    type="range"
                    min="0.25"
                    max="3"
                    step="0.25"
                    value={speed}
                    disabled={busy}
                    onChange={(event) => setSliderSpeed(Number(event.target.value))}
                  />
                  <div className="trackball-speed-summary">
                    <span>Current <strong>{(selected.scaleMultiplier / Math.max(1, selected.scaleDivisor)).toFixed(2)}×</strong></span>
                    <span>New <strong>{speed.toFixed(2)}×</strong></span>
                  </div>
                </div>

                <div className="trackball-actions">
                  <button
                    className="button"
                    disabled={busy || (multiplier === selected.scaleMultiplier && divisor === selected.scaleDivisor)}
                    onClick={() => void applyScale()}
                  >
                    {busy ? 'Saving…' : 'Apply & Save'}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setMultiplier(selected.scaleMultiplier);
                      setDivisor(selected.scaleDivisor);
                      setSpeed(selected.scaleMultiplier / Math.max(1, selected.scaleDivisor));
                    }}
                  >
                    Reset
                  </button>
                </div>

                <button className="trackball-advanced-toggle" type="button" onClick={() => setAdvancedOpen((value) => !value)}>
                  {advancedOpen ? 'Hide advanced settings' : 'Advanced settings'}
                </button>

                {advancedOpen && (
                  <div className="trackball-advanced panel">
                    <div className="trackball-advanced-grid">
                      <label>
                        <span>Multiplier</span>
                        <input
                          type="number"
                          min={1}
                          value={multiplier}
                          disabled={busy}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setMultiplier(value);
                            setSpeed(value / Math.max(1, divisor));
                          }}
                        />
                      </label>
                      <label>
                        <span>Divisor</span>
                        <input
                          type="number"
                          min={1}
                          value={divisor}
                          disabled={busy}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setDivisor(value);
                            setSpeed(multiplier / Math.max(1, value));
                          }}
                        />
                      </label>
                    </div>
                    <div className="trackball-transform">
                      <strong>Transform</strong>
                      <span>{selected.rotationDegrees}° · swap {selected.xySwapEnabled ? 'on' : 'off'} · X invert {selected.xInvert ? 'on' : 'off'} · Y invert {selected.yInvert ? 'on' : 'off'}</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty">Select a trackball mode.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
