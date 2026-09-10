import { useEffect, useMemo, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import { subscribeNotifications } from './notificationHub';
import {
  decodeCustomSettingsNotification,
  decodeCustomSettingsResponse,
  encodeListSettingsRequest,
  encodeSaveSettingsRequest,
  encodeWriteSettingRequest,
  type CustomSettingRecord,
} from './customSettingsSafeProtocol';

const INERTIA_KEYS = {
  enabled: 'rscroll.inertia.enabled',
  start: 'rscroll.inertia.start',
  move: 'rscroll.inertia.move',
  stop: 'rscroll.inertia.stop',
} as const;

const INERTIA_KEY_SET = new Set<string>(Object.values(INERTIA_KEYS));
type Values = { enabled: boolean; start: number; move: number; stop: number };

function valueOf(setting: CustomSettingRecord | undefined) {
  if (!setting?.value || setting.value.type === 'array') return null;
  return setting.value;
}

export default function TrackballInertiaSettings({
  connection,
  customSettingsSubsystemIndex,
  runtimeInputSubsystemIndex,
  onDebug,
}: {
  connection: RpcConnection;
  customSettingsSubsystemIndex: number;
  runtimeInputSubsystemIndex: number;
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [settings, setSettings] = useState<CustomSettingRecord[]>([]);
  const [draft, setDraft] = useState<Values>({ enabled: true, start: 13, move: 25, stop: 1 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const receivedRef = useRef<Map<string, CustomSettingRecord>>(new Map());

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
    const status = decodeCustomSettingsResponse(responsePayload);
    onDebug(`RPC <- trackball inertia ${label}`, status);
    return status;
  }

  function publishSettings() {
    const next = [...receivedRef.current.values()].sort((a, b) => a.key.localeCompare(b.key));
    setSettings(next);
    syncDraft(next);
  }

  async function load() {
    setLoading(true);
    setError(null);
    setMessage('Reading inertia settings…');
    receivedRef.current = new Map();
    setSettings([]);
    try {
      const status = await callCustomSettings(encodeListSettingsRequest(true), 'list_settings');
      const deadline = performance.now() + 1200;
      while (receivedRef.current.size < 4 && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      publishSettings();
      const found = receivedRef.current.size;
      setMessage(found === 4
        ? 'Right · Sym inertia controls ready.'
        : `Firmware returned ${found}/4 Right · Sym inertia setting(s) (${status.affectedCount} total settings).`);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      setMessage('');
      onDebug('Trackball inertia load failed', text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = subscribeNotifications(connection, (notification) => {
      const custom = notification.custom?.customNotification;
      if (!custom || custom.subsystemIndex !== customSettingsSubsystemIndex) return;
      try {
        const decoded = decodeCustomSettingsNotification(custom.payload);
        if (!decoded) return;
        const setting = decoded.setting;
        if (setting.customSubsystemIndex !== runtimeInputSubsystemIndex ||
            setting.source !== 0 || !INERTIA_KEY_SET.has(setting.key)) return;
        receivedRef.current.set(setting.key, setting);
        publishSettings();
        onDebug('Trackball inertia notification', { kind: decoded.kind, key: setting.key });
      } catch (cause) {
        onDebug('Trackball inertia notification decode failed', cause instanceof Error ? cause.message : String(cause));
      }
    });
    void load();
    return unsubscribe;
  }, [connection, customSettingsSubsystemIndex, runtimeInputSubsystemIndex]);

  async function stage(key: string, value: { type: 'int32'; value: number } | { type: 'bool'; value: boolean }) {
    const setting = byKey.get(key);
    if (!setting) throw new Error(`Firmware setting not found: ${key}`);
    await callCustomSettings(encodeWriteSettingRequest(setting, value), `stage(${key})`);
  }

  async function applyAndSave() {
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await stage(INERTIA_KEYS.enabled, { type: 'bool', value: draft.enabled });
      await stage(INERTIA_KEYS.start, { type: 'int32', value: draft.start });
      await stage(INERTIA_KEYS.move, { type: 'int32', value: draft.move });
      await stage(INERTIA_KEYS.stop, { type: 'int32', value: draft.stop });
      const saved = await callCustomSettings(encodeSaveSettingsRequest(), 'save_settings');
      setMessage(`Inertia saved (${saved.affectedCount} setting(s)). It takes effect from the next idle gesture.`);
      await load();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Trackball inertia save failed', text);
    } finally {
      setBusy(false);
    }
  }

  if (loading && settings.length === 0) {
    return <div className="trackball-inertia panel"><strong>Scroll Inertia</strong><small> Reading settings…</small></div>;
  }

  if (settings.length < 4) {
    return (
      <div className="trackball-inertia panel">
        <div className="trackball-inertia-heading">
          <div><strong>Scroll Inertia</strong><small>Right · Sym · Scroll</small></div>
          <button className="button secondary" onClick={() => void load()} disabled={busy}>Refresh</button>
        </div>
        {message && <div className="status-strip"><span>{message}</span></div>}
        {error && <div className="notice">{error}</div>}
      </div>
    );
  }

  return (
    <div className="trackball-inertia panel">
      <div className="trackball-inertia-heading">
        <div><strong>Scroll Inertia</strong><small>Right · Sym · Scroll</small></div>
        <label className="trackball-inertia-toggle">
          <input type="checkbox" checked={draft.enabled} disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />
          <span>{draft.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      <div className="trackball-inertia-grid">
        <label><span>Start <small>Flick strength</small></span>
          <input type="number" min={1} max={200} value={draft.start} disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, start: Number(event.target.value) }))} /></label>
        <label><span>Move <small>Gesture distance</small></span>
          <input type="number" min={1} max={500} value={draft.move} disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, move: Number(event.target.value) }))} /></label>
        <label><span>Stop <small>End threshold</small></span>
          <input type="number" min={0} max={50} value={draft.stop} disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, stop: Number(event.target.value) }))} /></label>
      </div>

      <div className="trackball-actions">
        <button className="button" onClick={() => void applyAndSave()} disabled={busy}>{busy ? 'Saving…' : 'Apply & Save'}</button>
        <button className="button secondary" onClick={() => void load()} disabled={busy}>Reload</button>
      </div>
      {message && <div className="status-strip"><span>{message}</span></div>}
      {error && <div className="notice">{error}</div>}
    </div>
  );
}
