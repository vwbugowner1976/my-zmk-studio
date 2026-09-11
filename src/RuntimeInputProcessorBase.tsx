import { useEffect, useMemo, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import { subscribeNotifications } from './notificationHub';
import { useLanguage } from './i18n';
import {
  assertRuntimeInputResponse,
  decodeRuntimeInputNotification,
  encodeListInputProcessorsRequest,
  encodeSetRotationRequest,
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

const ROTATION_PROCESSOR_NAME = {
  Left: 'lrot',
  Right: 'rrot',
} as const;

type Side = keyof typeof ROTATION_PROCESSOR_NAME;

function clampAngle(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-180, Math.min(180, Math.round(value)));
}

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
  const { isJapanese } = useLanguage();
  const [processors, setProcessors] = useState<RuntimeInputProcessorRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [divisor, setDivisor] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [rotationDraft, setRotationDraft] = useState<Record<Side, number>>({ Left: 0, Right: 0 });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => processors.find((processor) => processor.id === selectedId) ?? null,
    [processors, selectedId],
  );

  const rotationProcessors = useMemo(() => ({
    Left: processors.find((processor) => processor.name === ROTATION_PROCESSOR_NAME.Left) ?? null,
    Right: processors.find((processor) => processor.name === ROTATION_PROCESSOR_NAME.Right) ?? null,
  }), [processors]);

  const sideLabel = (side: Side | 'Left' | 'Right') => isJapanese ? (side === 'Left' ? '左' : '右') : side;
  const modeLabel = (scroll: boolean) => isJapanese ? (scroll ? 'スクロール' : 'カーソル') : (scroll ? 'Scroll' : 'Cursor');

  const displayName = (processor: RuntimeInputProcessorRecord) => {
    const meta = PROCESSOR_META[processor.name];
    if (!meta) return processor.name;
    const layerName = layerNames[meta.layerIndex] || `Layer ${meta.layerIndex}`;
    return `${sideLabel(meta.side)} · ${layerName} · ${modeLabel(processor.xyToScrollEnabled)}`;
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
    setSelectedId(null);
    setMessage(isJapanese ? 'トラックボール設定を読み込み中…' : 'Reading runtime pointing processors…');
    try {
      await callRuntimeInput(encodeListInputProcessorsRequest(), 'list_input_processors');
      await new Promise((resolve) => setTimeout(resolve, 700));
      setMessage(isJapanese ? 'トラックボール設定を更新しました。' : 'Runtime pointing processors refreshed.');
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
        if (PROCESSOR_META[processor.name]) {
          setSelectedId((current) => current ?? processor.id);
        }
        onDebug('Runtime input processor notification', processor);
      } catch (cause) {
        onDebug('Runtime input notification decode failed', cause instanceof Error ? cause.message : String(cause));
      }
    });
    void loadProcessors();
    return unsubscribe;
  }, [connection, subsystemIndex]);

  useEffect(() => {
    setRotationDraft((current) => ({
      Left: rotationProcessors.Left?.rotationDegrees ?? current.Left,
      Right: rotationProcessors.Right?.rotationDegrees ?? current.Right,
    }));
  }, [rotationProcessors.Left?.rotationDegrees, rotationProcessors.Right?.rotationDegrees]);

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
      setError(isJapanese ? 'Multiplier と Divisor は1以上の整数にしてください。' : 'Multiplier and divisor must both be integers of 1 or greater.');
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
      setMessage(isJapanese
        ? `${displayName(selected)}: ${multiplier}/${divisor} を保存しました。`
        : `${displayName(selected)}: saved ${multiplier}/${divisor}.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Runtime input save failed', text);
    } finally {
      setBusy(false);
    }
  }

  async function applyRotation(side: Side) {
    const processor = rotationProcessors[side];
    if (!processor) return;
    const value = clampAngle(rotationDraft[side]);
    setRotationDraft((current) => ({ ...current, [side]: value }));
    if (value === processor.rotationDegrees) return;

    setBusy(true);
    setError(null);
    try {
      await callRuntimeInput(
        encodeSetRotationRequest(processor.id, value),
        `set_rotation(${processor.name}, ${value})`,
      );
      setProcessors((previous) => previous.map((item) => item.id === processor.id
        ? { ...item, rotationDegrees: value }
        : item));
      setMessage(isJapanese
        ? `${sideLabel(side)}トラックボールの向きを ${value}° に保存しました。`
        : `${side} trackball orientation saved: ${value}° relative to the current hardware alignment.`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Runtime rotation save failed', text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="custom-settings-view">
      <section className="panel custom-settings-toolbar">
        <div>
          <h3>{isJapanese ? 'トラックボール設定' : 'Trackball Runtime Settings'}</h3>
          <p>{isJapanese
            ? 'ファームウェアを書き直さずに、速度・向き・スクロール慣性を調整できます。'
            : 'Adjust speed, orientation and scroll inertia without rebuilding firmware.'}</p>
        </div>
        <div className="custom-settings-actions">
          <button className="button secondary" onClick={() => void loadProcessors()} disabled={busy || loading}>
            {loading ? (isJapanese ? '読込中…' : 'Reading…') : (isJapanese ? '更新' : 'Refresh')}
          </button>
        </div>
      </section>

      {error && <div className="notice">{error}</div>}
      {message && <div className="status-strip panel"><span>{message}</span></div>}

      {(rotationProcessors.Left || rotationProcessors.Right) && (
        <section className="panel trackball-orientation-panel">
          <div className="trackball-orientation-heading">
            <div>
              <h3>{isJapanese ? 'トラックボールの向き' : 'Trackball Orientation'}</h3>
              <p>{isJapanese
                ? '左右の物理トラックボールを任意角度で回転補正します。0°は現在確認済みの向きを維持します。'
                : 'Rotate each physical trackball by any angle. 0° keeps the currently tested direction.'}</p>
            </div>
          </div>
          <div className="trackball-orientation-grid">
            {(['Left', 'Right'] as Side[]).map((side) => {
              const processor = rotationProcessors[side];
              if (!processor) {
                return <div className="trackball-orientation-card missing" key={side}><strong>{sideLabel(side)}</strong><small>{isJapanese ? '回転プロセッサを利用できません' : 'Rotation processor unavailable'}</small></div>;
              }
              const draft = rotationDraft[side];
              const changed = draft !== processor.rotationDegrees;
              return (
                <div className="trackball-orientation-card" key={side}>
                  <div className="trackball-orientation-card-title">
                    <div><span>{sideLabel(side)}</span><strong>{draft}°</strong></div>
                    <small>{isJapanese ? '現在' : 'Current'} {processor.rotationDegrees}°</small>
                  </div>
                  <input
                    className="trackball-orientation-slider"
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={draft}
                    disabled={busy}
                    onChange={(event) => setRotationDraft((current) => ({
                      ...current,
                      [side]: clampAngle(Number(event.target.value)),
                    }))}
                  />
                  <div className="trackball-orientation-scale"><span>-180°</span><span>0°</span><span>180°</span></div>
                  <div className="trackball-orientation-entry">
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      step={1}
                      value={draft}
                      disabled={busy}
                      onChange={(event) => setRotationDraft((current) => ({
                        ...current,
                        [side]: clampAngle(Number(event.target.value)),
                      }))}
                    />
                    <span>{isJapanese ? '度' : 'degrees'}</span>
                  </div>
                  <div className="trackball-orientation-presets">
                    {[-90, 0, 90, 180].map((angle) => (
                      <button
                        className="button secondary"
                        type="button"
                        key={angle}
                        disabled={busy}
                        onClick={() => setRotationDraft((current) => ({ ...current, [side]: angle }))}
                      >
                        {angle}°
                      </button>
                    ))}
                  </div>
                  <div className="trackball-actions">
                    <button className="button" disabled={busy || !changed} onClick={() => void applyRotation(side)}>
                      {busy ? (isJapanese ? '保存中…' : 'Saving…') : (isJapanese ? '適用して保存' : 'Apply & Save')}
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || !changed}
                      onClick={() => setRotationDraft((current) => ({ ...current, [side]: processor.rotationDegrees }))}
                    >
                      {isJapanese ? '元に戻す' : 'Undo'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {processors.length === 0 && !loading ? (
        <div className="panel empty"><div><h3>{isJapanese ? 'Runtime processorが見つかりません' : 'No runtime processors found'}</h3><p>{isJapanese ? 'ファームウェア側で cormoran_rip subsystem と runtime input processor が必要です。' : 'The firmware must advertise the cormoran_rip subsystem and define runtime input processors.'}</p></div></div>
      ) : (
        <div className="trackball-layout">
          <section className="trackball-mode-grid">
            {[0, 1, 2].flatMap((layerIndex) => (
              (['Left', 'Right'] as const).map((side) => {
                const processor = processors.find((item) => {
                  const meta = PROCESSOR_META[item.name];
                  return meta?.layerIndex === layerIndex && meta.side === side;
                });
                const layerName = layerNames[layerIndex] || `Layer ${layerIndex}`;

                if (!processor) {
                  return (
                    <div className="trackball-mode-card missing" key={`${layerIndex}-${side}`}>
                      <span className="trackball-card-topline"><span className="trackball-side">{sideLabel(side)}</span></span>
                      <strong>{layerName}</strong>
                      <small>{isJapanese ? 'Runtime processorなし' : 'No runtime processor'}</small>
                    </div>
                  );
                }

                const currentSpeed = processor.scaleMultiplier / Math.max(1, processor.scaleDivisor);
                return (
                  <button
                    className={`trackball-mode-card ${selectedId === processor.id ? 'selected' : ''}`}
                    key={processor.id}
                    onClick={() => setSelectedId(processor.id)}
                  >
                    <span className="trackball-card-topline">
                      <span className="trackball-side">{sideLabel(side)}</span>
                      <span className={`trackball-mode-badge ${processor.xyToScrollEnabled ? 'scroll' : 'cursor'}`}>{modeLabel(processor.xyToScrollEnabled)}</span>
                    </span>
                    <strong>{layerName}</strong>
                    <span className="trackball-card-speed">{currentSpeed.toFixed(2)}×</span>
                    <small>{processor.name}</small>
                  </button>
                );
              })
            ))}
          </section>

          <section className="panel trackball-editor">
            {selected ? (
              <>
                <div className="trackball-editor-heading">
                  <div>
                    <div className="eyebrow">{PROCESSOR_META[selected.name] ? sideLabel(PROCESSOR_META[selected.name].side) : (isJapanese ? 'トラックボール' : 'Trackball')} · {modeLabel(selected.xyToScrollEnabled)}</div>
                    <h3>{PROCESSOR_META[selected.name] ? (layerNames[PROCESSOR_META[selected.name].layerIndex] || `Layer ${PROCESSOR_META[selected.name].layerIndex}`) : selected.name}</h3>
                    <p>{isJapanese ? 'スライダーでこのモードの速度を変更します。' : "Move the slider to change this mode's speed."}</p>
                  </div>
                  <div className="trackball-speed-readout">{speed.toFixed(2)}×</div>
                </div>

                <div className="trackball-speed-control">
                  <div className="trackball-speed-labels">
                    {[0.25, 1, 2, 3].map((value) => (
                      <span key={value} style={{ left: `${((value - 0.25) / (3 - 0.25)) * 100}%` }}>{value.toFixed(2)}×</span>
                    ))}
                  </div>
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
                    <span>{isJapanese ? '現在' : 'Current'} <strong>{(selected.scaleMultiplier / Math.max(1, selected.scaleDivisor)).toFixed(2)}×</strong></span>
                    <span>{isJapanese ? '変更後' : 'New'} <strong>{speed.toFixed(2)}×</strong></span>
                  </div>
                </div>

                <div className="trackball-actions">
                  <button
                    className="button"
                    disabled={busy || (multiplier === selected.scaleMultiplier && divisor === selected.scaleDivisor)}
                    onClick={() => void applyScale()}
                  >
                    {busy ? (isJapanese ? '保存中…' : 'Saving…') : (isJapanese ? '適用して保存' : 'Apply & Save')}
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
                    {isJapanese ? '元に戻す' : 'Reset'}
                  </button>
                </div>

                <button className="trackball-advanced-toggle" type="button" onClick={() => setAdvancedOpen((value) => !value)}>
                  {advancedOpen
                    ? (isJapanese ? '詳細設定を閉じる' : 'Hide advanced settings')
                    : (isJapanese ? '詳細設定' : 'Advanced settings')}
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
                      <strong>{isJapanese ? 'モード変換' : 'Mode transform'}</strong>
                      <span>{selected.rotationDegrees}° · swap {selected.xySwapEnabled ? 'on' : 'off'} · X invert {selected.xInvert ? 'on' : 'off'} · Y invert {selected.yInvert ? 'on' : 'off'}</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty">{isJapanese ? 'トラックボールモードを選択してください。' : 'Select a trackball mode.'}</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
