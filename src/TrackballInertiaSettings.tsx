import { useEffect, useMemo, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import { subscribeNotifications } from './notificationHub';
import {
  decodeCustomSettingsNotification,
  decodeCustomSettingsResponse,
  encodeListSettingsRequest,
  encodeWriteSettingPersistRequest,
  type CustomSettingRecord,
} from './customSettingsSafeProtocol';

type Values = { enabled: boolean; start: number; move: number; stop: number };
type ProfileId = 'lscroll' | 'lprec' | 'rscroll';

type ProfileDef = {
  id: ProfileId;
  label: string;
  subtitle: string;
  defaults: Values;
  keys: {
    enabled: string;
    start: string;
    move: string;
    stop: string;
  };
};

const PROFILES: ProfileDef[] = [
  {
    id: 'lscroll',
    label: 'Left · Base',
    subtitle: 'Scroll',
    defaults: { enabled: true, start: 13, move: 25, stop: 1 },
    keys: {
      enabled: 'lscroll.inertia.enabled',
      start: 'lscroll.inertia.start',
      move: 'lscroll.inertia.move',
      stop: 'lscroll.inertia.stop',
    },
  },
  {
    id: 'lprec',
    label: 'Left · Sym',
    subtitle: 'Precise Scroll',
    defaults: { enabled: true, start: 4, move: 8, stop: 1 },
    keys: {
      enabled: 'lprec.inertia.enabled',
      start: 'lprec.inertia.start',
      move: 'lprec.inertia.move',
      stop: 'lprec.inertia.stop',
    },
  },
  {
    id: 'rscroll',
    label: 'Right · Sym',
    subtitle: 'Scroll',
    defaults: { enabled: true, start: 13, move: 25, stop: 1 },
    keys: {
      enabled: 'rscroll.inertia.enabled',
      start: 'rscroll.inertia.start',
      move: 'rscroll.inertia.move',
      stop: 'rscroll.inertia.stop',
    },
  },
];

const INERTIA_KEY_SET = new Set<string>(PROFILES.flatMap((profile) => Object.values(profile.keys)));

function valueOf(setting: CustomSettingRecord | undefined) {
  if (!setting?.value || setting.value.type === 'array') return null;
  return setting.value;
}

function initialDrafts(): Record<ProfileId, Values> {
  return {
    lscroll: { ...PROFILES[0].defaults },
    lprec: { ...PROFILES[1].defaults },
    rscroll: { ...PROFILES[2].defaults },
  };
}

function sameValues(a: Values, b: Values) {
  return a.enabled === b.enabled && a.start === b.start && a.move === b.move && a.stop === b.stop;
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
  const [drafts, setDrafts] = useState<Record<ProfileId, Values>>(initialDrafts);
  const [selectedProfileId, setSelectedProfileId] = useState<ProfileId>('lscroll');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const receivedRef = useRef<Map<string, CustomSettingRecord>>(new Map());

  const byKey = useMemo(() => new Map(settings.map((setting) => [setting.key, setting])), [settings]);
  const availableProfiles = useMemo(
    () => PROFILES.filter((profile) => Object.values(profile.keys).every((key) => byKey.has(key))),
    [byKey],
  );

  const selectedProfile = useMemo(
    () => availableProfiles.find((profile) => profile.id === selectedProfileId) ?? availableProfiles[0] ?? null,
    [availableProfiles, selectedProfileId],
  );

  function savedValues(profile: ProfileDef): Values {
    const enabled = valueOf(byKey.get(profile.keys.enabled));
    const start = valueOf(byKey.get(profile.keys.start));
    const move = valueOf(byKey.get(profile.keys.move));
    const stop = valueOf(byKey.get(profile.keys.stop));
    return {
      enabled: enabled?.type === 'bool' ? enabled.value : profile.defaults.enabled,
      start: start?.type === 'int32' ? start.value : profile.defaults.start,
      move: move?.type === 'int32' ? move.value : profile.defaults.move,
      stop: stop?.type === 'int32' ? stop.value : profile.defaults.stop,
    };
  }

  function syncDraft(next: CustomSettingRecord[]) {
    const map = new Map(next.map((setting) => [setting.key, setting]));
    setDrafts((current) => {
      const updated = { ...current };
      for (const profile of PROFILES) {
        const enabled = valueOf(map.get(profile.keys.enabled));
        const start = valueOf(map.get(profile.keys.start));
        const move = valueOf(map.get(profile.keys.move));
        const stop = valueOf(map.get(profile.keys.stop));
        if (enabled?.type === 'bool' && start?.type === 'int32' && move?.type === 'int32' && stop?.type === 'int32') {
          updated[profile.id] = {
            enabled: enabled.value,
            start: start.value,
            move: move.value,
            stop: stop.value,
          };
        }
      }
      return updated;
    });
  }

  function updateDraft(id: ProfileId, patch: Partial<Values>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
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
      while (receivedRef.current.size < INERTIA_KEY_SET.size && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      publishSettings();
      const found = receivedRef.current.size;
      setMessage(found === INERTIA_KEY_SET.size
        ? 'Scroll inertia controls ready.'
        : `Firmware returned ${found}/${INERTIA_KEY_SET.size} inertia setting(s) (${status.affectedCount} total settings).`);
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

  useEffect(() => {
    if (availableProfiles.length > 0 && !availableProfiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(availableProfiles[0].id);
    }
  }, [availableProfiles, selectedProfileId]);

  async function persist(key: string, value: { type: 'int32'; value: number } | { type: 'bool'; value: boolean }) {
    const setting = byKey.get(key);
    if (!setting) throw new Error(`Firmware setting not found: ${key}`);
    await callCustomSettings(encodeWriteSettingPersistRequest(setting, value), `persist(${key})`);
  }

  async function applyAndSave(profile: ProfileDef) {
    const draft = drafts[profile.id];
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await persist(profile.keys.enabled, { type: 'bool', value: draft.enabled });
      await persist(profile.keys.start, { type: 'int32', value: draft.start });
      await persist(profile.keys.move, { type: 'int32', value: draft.move });
      await persist(profile.keys.stop, { type: 'int32', value: draft.stop });
      setMessage(`${profile.label} inertia saved.`);
      await load();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      onDebug('Trackball inertia save failed', { profile: profile.id, error: text });
    } finally {
      setBusy(false);
    }
  }

  if (loading && settings.length === 0) {
    return <div className="trackball-inertia panel"><strong>Scroll Inertia</strong><small> Reading settings…</small></div>;
  }

  if (availableProfiles.length === 0) {
    return (
      <div className="trackball-inertia panel">
        <div className="trackball-inertia-heading">
          <div><strong>Scroll Inertia</strong><small>No complete inertia profile was returned.</small></div>
          <button className="button secondary" onClick={() => void load()} disabled={busy}>Refresh</button>
        </div>
        {message && <div className="status-strip"><span>{message}</span></div>}
        {error && <div className="notice">{error}</div>}
      </div>
    );
  }

  if (!selectedProfile) return null;

  const draft = drafts[selectedProfile.id];
  const saved = savedValues(selectedProfile);
  const dirty = !sameValues(draft, saved);

  return (
    <div className="trackball-inertia panel">
      <div className="trackball-inertia-heading">
        <div>
          <strong>Scroll Inertia</strong>
          <small>Choose a scroll mode, then tune how easily momentum starts and how long it continues.</small>
        </div>
        <button className="button secondary" onClick={() => void load()} disabled={busy}>Reload</button>
      </div>

      <div className="trackball-inertia-tabs" role="tablist" aria-label="Scroll inertia profiles">
        {availableProfiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            role="tab"
            aria-selected={profile.id === selectedProfile.id}
            className={`trackball-inertia-tab ${profile.id === selectedProfile.id ? 'selected' : ''}`}
            onClick={() => setSelectedProfileId(profile.id)}
            disabled={busy}
          >
            <strong>{profile.label}</strong>
            <small>{profile.subtitle}</small>
          </button>
        ))}
      </div>

      <section className="trackball-inertia-editor">
        <div className="trackball-inertia-editor-heading">
          <div>
            <div className="eyebrow">{selectedProfile.subtitle}</div>
            <h3>{selectedProfile.label}</h3>
          </div>
          <label className="trackball-inertia-toggle">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(event) => updateDraft(selectedProfile.id, { enabled: event.target.checked })}
            />
            <span>{draft.enabled ? 'Inertia On' : 'Inertia Off'}</span>
          </label>
        </div>

        <div className={`trackball-inertia-controls ${draft.enabled ? '' : 'disabled-look'}`}>
          <label className="trackball-inertia-control">
            <span className="trackball-inertia-control-title">
              <span><strong>Trigger</strong><small>How strong the flick must be</small></span>
              <input
                type="number"
                min={1}
                max={200}
                value={draft.start}
                disabled={busy || !draft.enabled}
                onChange={(event) => updateDraft(selectedProfile.id, { start: Number(event.target.value) })}
              />
            </span>
            <div className="trackball-inertia-slider-labels"><span>Easier</span><span>Harder</span></div>
            <input
              className="trackball-inertia-slider"
              type="range"
              min={1}
              max={80}
              step={1}
              value={Math.min(80, draft.start)}
              disabled={busy || !draft.enabled}
              onChange={(event) => updateDraft(selectedProfile.id, { start: Number(event.target.value) })}
            />
          </label>

          <label className="trackball-inertia-control">
            <span className="trackball-inertia-control-title">
              <span><strong>Gesture</strong><small>Movement needed before momentum can arm</small></span>
              <input
                type="number"
                min={1}
                max={500}
                value={draft.move}
                disabled={busy || !draft.enabled}
                onChange={(event) => updateDraft(selectedProfile.id, { move: Number(event.target.value) })}
              />
            </span>
            <div className="trackball-inertia-slider-labels"><span>Shorter</span><span>Longer</span></div>
            <input
              className="trackball-inertia-slider"
              type="range"
              min={1}
              max={120}
              step={1}
              value={Math.min(120, draft.move)}
              disabled={busy || !draft.enabled}
              onChange={(event) => updateDraft(selectedProfile.id, { move: Number(event.target.value) })}
            />
          </label>

          <label className="trackball-inertia-control">
            <span className="trackball-inertia-control-title">
              <span><strong>Tail</strong><small>Threshold where momentum finally stops</small></span>
              <input
                type="number"
                min={0}
                max={50}
                value={draft.stop}
                disabled={busy || !draft.enabled}
                onChange={(event) => updateDraft(selectedProfile.id, { stop: Number(event.target.value) })}
              />
            </span>
            <div className="trackball-inertia-slider-labels"><span>Longer</span><span>Stops sooner</span></div>
            <input
              className="trackball-inertia-slider"
              type="range"
              min={0}
              max={20}
              step={1}
              value={Math.min(20, draft.stop)}
              disabled={busy || !draft.enabled}
              onChange={(event) => updateDraft(selectedProfile.id, { stop: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="trackball-inertia-footer">
          <div className="trackball-inertia-saved">
            <span>Saved</span>
            <strong>{saved.enabled ? 'On' : 'Off'} · {saved.start} / {saved.move} / {saved.stop}</strong>
            {dirty && <em>Unsaved changes</em>}
          </div>
          <div className="trackball-actions">
            <button
              className="button secondary"
              disabled={busy || !dirty}
              onClick={() => updateDraft(selectedProfile.id, saved)}
            >
              Reset
            </button>
            <button
              className="button"
              onClick={() => void applyAndSave(selectedProfile)}
              disabled={busy || !dirty}
            >
              {busy ? 'Saving…' : 'Apply & Save'}
            </button>
          </div>
        </div>
      </section>

      {message && <div className="status-strip"><span>{message}</span></div>}
      {error && <div className="notice">{error}</div>}
    </div>
  );
}
