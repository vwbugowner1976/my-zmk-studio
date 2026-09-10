import { useEffect, useMemo, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import { subscribeNotifications } from './notificationHub';
import {
  assertCustomSettingsResponse,
  decodeCustomSettingNotification,
  decodeListSettingsResponse,
  encodeListSettingsRequest,
  encodeWriteSettingRequest,
  type CustomSettingRecord,
} from './customSettingsProtocol';

const INERTIA_KEYS = {
  enabled: 'rscroll.inertia.enabled',
  start: 'rscroll.inertia.start',
  move: 'rscroll.inertia.move',
  stop: 'rscroll.inertia.stop',
} as const;

type Values = { enabled: boolean; start: number; move: number; stop: number };

function valueOf(setting: CustomSettingRecord | undefined) {
  if (!setting?.value || setting.value.type === 'array') return null;
  return setting.value;
}

export default function TrackballInertiaSettings({
  connection,
  customSettingsSubsystemIndex,
  runtimeInputSubsystemIndex,
  selectedProcessorName,
  onDebug,
}: {
  connection: RpcConnection;
  customSettingsSubsystemIndex: number;
  runtimeInputSubsystemIndex: number;
  selectedProcessorName: string | null;
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [settings, setSettings] = useState<CustomSettingRecord[]>([]);
  const [draft, setDraft] = useState<Values>({ enabled: true, start: 13, move: 25, stop: 1 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const supported = selectedProcessorName === 'rscroll';
  const byKey = useMemo(() => new Map(settings.map((setting) => [setting.key, setting])), [settings]);

  function syncDraft(next: CustomSettingRecord[]) {
    const map = new Map(next.map((setting) => [setting.key, setting]));
    const enabled = valueOf(map.get(INERTIA_KEYS.enabled));
    const start = valueOf(map.get(INERTIA_KEYS.start));
    const move = valueOf(map.get(INERTIA_KEYS.move));
    const stop = valueOf(map.get(INERTIA_KEYS.stop));
    if (enabled?.type === 'bool' && start?.type === 'int32' && move?.type === 'int32' && stop?.type === 'int32') {
      setDraft({ enabled: enabled.value, start: start.value, move: move.value, stop: stop.value });
    }
  }

  async function callCustomSettings(payload: Uint8Array, label: string) {
    onDebug(`RPC -> trackball inertia ${label}`, { customSettingsSubsystemIndex, bytes: payload.length });
    const response = await call_rpc(connection, {
      custom: { call: { subsystemIndex: customSettingsSubsystemIndex, payload } },
    });
    const responsePayload = response.custom?.call?.payload;
    if (!responsePayload) throw new Error(`Custom Settings ${label} returned no payload.`);
    assertCustomSettingsResponse(responsePayload);
    onDebug(`RPC <- trackball inertia ${label}`, { bytes: responsePayload.length });
    return responsePayload;
  }

  async function load() {
    if (!supported) return;
    setError(null);
    try {
      const payload = await callCustomSettings(encodeListSettingsRequest(true), 'list_settings');
      const all = decodeListSettingsResponse(payload);
      const keySet = new Set(Object.values(INERTIA_KEYS));
      const ours = all.filter(
        (setting) => setting.customSubsystemIndex === runtimeInputSubsystemIndex && keySet.has(setting.key),
      );
      setSettings(ours);
      syncDraft(ours);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Trackball inertia load failed', text);
    }
  }

  useEffect(() => {
    if (!supported) return undefined;
    const unsubscribe = subscribeNotifications(connection, (notification) => {
      const custom = notification.custom?.customNotification;
      if (!custom || custom.subsystemIndex !== customSettingsSubsystemIndex) return;
      try {
        const decoded = decodeCustomSettingNotification(custom.payload);
        if (!decoded) return;
        const setting = decoded.setting;
        if (setting.customSubsystemIndex !== runtimeInputSubsystemIndex) return;
        if (!Object.values(INERTIA_KEYS).includes(setting.key as (typeof INERTIA_KEYS)[keyof typeof INERTIA_KEYS])) return;
        setSettings((previous) => {
          const next = previous.filter((item) => item.key !== setting.key);
          next.push(setting);
          syncDraft(next);
          return next;
        });
      } catch (cause) {
        onDebug('Trackball inertia notification decode failed', cause instanceof Error ? cause.message : String(cause));
      }
    });
    void load();
    return unsubscribe;
  }, [connection, customSettingsSubsystemIndex, runtimeInputSubsystemIndex, supported]);

  async function write(key: string, value: { type: 'int32'; value: number } | { type: 'bool'; value: boolean }) {
    const setting = byKey.get(key);
    if (!setting) throw new Error(`Firmware setting not found: ${key}`);
    await callCustomSettings(encodeWriteSettingRequest(setting, value), `write(${key})`);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await write(INERTIA_KEYS.enabled, { type: 'bool', value: draft.enabled });
      await write(INERTIA_KEYS.start, { type: 'int32', value: draft.start });
      await write(INERTIA_KEYS.move, { type: 'int32', value: draft.move });
      await write(INERTIA_KEYS.stop, { type: 'int32', value: draft.stop });
      setMessage('Inertia saved. New values apply from the next idle gesture.');
      await load();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Trackball inertia save failed', text);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  if (settings.length < 4) {
    return (
      <div className="trackball-inertia panel">
        <div className="trackball-inertia-heading">
          <div><strong>Scroll Inertia</strong><small>Firmware runtime controls are not available yet.</small></div>
          <button className="button secondary" onClick={() => void load()} disabled={busy}>Refresh</button>
        </div>
        {error && <div className="notice">{error}</div>}
      </div>
    );
  }

  return (
    <div className="trackball-inertia panel">
      <div className="trackball-inertia-heading">
        <div><strong>Scroll Inertia</strong><small>Right · Sym · Scroll</small></div>
        <label className="trackball-inertia-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span>{draft.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      <div className="trackball-inertia-grid">
        <label>
          <span>Start <small>Flick strength</small></span>
          <input type="number" min={1} max={200} value={draft.start} disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, start: Number(event.target.value) }))} />
        </label>
        <label>
          <span>Move <small>Gesture distance</small></span>
          <input type="number" min={1} max={500} value={draft.move} disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, move: Number(event.target.value) }))} />
        </label>
        <label>
          <span>Stop <small>End threshold</small></span>
          <input type="number" min={0} max={50} value={draft.stop} disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, stop: Number(event.target.value) }))} />
        </label>
      </div>

      <div className="trackball-actions">
        <button className="button" onClick={() => void apply()} disabled={busy}>{busy ? 'Saving…' : 'Apply & Save'}</button>
        <button className="button secondary" onClick={() => void load()} disabled={busy}>Reload</button>
      </div>
      {message && <div className="status-strip"><span>{message}</span></div>}
      {error && <div className="notice">{error}</div>}
    </div>
  );
}
