import { useEffect, useMemo, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import { subscribeNotifications } from './notificationHub';
import { useLanguage } from './i18n';
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
  keys: { enabled: string; start: string; move: string; stop: string };
};

const PROFILES: ProfileDef[] = [
  {
    id: 'lscroll', label: 'Left · Base', subtitle: 'Scroll',
    defaults: { enabled: true, start: 13, move: 25, stop: 1 },
    keys: {
      enabled: 'lscroll.inertia.enabled', start: 'lscroll.inertia.start',
      move: 'lscroll.inertia.move', stop: 'lscroll.inertia.stop',
    },
  },
  {
    id: 'lprec', label: 'Left · Sym', subtitle: 'Precise Scroll',
    defaults: { enabled: true, start: 4, move: 8, stop: 1 },
    keys: {
      enabled: 'lprec.inertia.enabled', start: 'lprec.inertia.start',
      move: 'lprec.inertia.move', stop: 'lprec.inertia.stop',
    },
  },
  {
    id: 'rscroll', label: 'Right · Sym', subtitle: 'Scroll',
    defaults: { enabled: true, start: 13, move: 25, stop: 1 },
    keys: {
      enabled: 'rscroll.inertia.enabled', start: 'rscroll.inertia.start',
      move: 'rscroll.inertia.move', stop: 'rscroll.inertia.stop',
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
  const { isJapanese } = useLanguage();
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

  const profileLabel = (profile: ProfileDef) => {
    if (!isJapanese) return profile.label;
    if (profile.id === 'lscroll') return '左 · Base';
    if (profile.id === 'lprec') return '左 · Sym';
    return '右 · Sym';
  };

  const profileSubtitle = (profile: ProfileDef) => {
    if (!isJapanese) return profile.subtitle;
    return profile.id === 'lprec' ? '精密スクロール' : 'スクロール';
  };

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
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
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
    setMessage(isJapanese ? '慣性設定を読み込み中…' : 'Reading inertia settings…');
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
        ? (isJapanese ? 'スクロール慣性の設定を読み込みました。' : 'Scroll inertia controls ready.')
        : (isJapanese
          ? `ファームウェアから慣性設定 ${found}/${INERTIA_KEY_SET.size} 件を取得しました（全設定 ${status.affectedCount} 件）。`
          : `Firmware returned ${found}/${INERTIA_KEY_SET.size} inertia setting(s) (${status.affectedCount} total settings).`));
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
    if (loading) return;
    if (availableProfiles.length > 0 && !availableProfiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(availableProfiles[0].id);
    }
  }, [availableProfiles, selectedProfileId, loading]);

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
      setMessage(isJapanese ? `${profileLabel(profile)} の慣性設定を保存しました。` : `${profile.label} inertia saved.`);
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
    return <div className="trackball-inertia panel"><strong>{isJapanese ? 'スクロール慣性' : 'Scroll Inertia'}</strong><small> {isJapanese ? '設定を読み込み中…' : 'Reading settings…'}</small></div>;
  }

  if (availableProfiles.length === 0) {
    return (
      <div className="trackball-inertia panel">
        <div className="trackball-inertia-heading">
          <div>
            <strong>{isJapanese ? 'スクロール慣性' : 'Scroll Inertia'}</strong>
            <small>{isJapanese ? '完全な慣性プロファイルを取得できませんでした。' : 'No complete inertia profile was returned.'}</small>
          </div>
          <button className="button secondary" onClick={() => void load()} disabled={busy}>{isJapanese ? '再読込' : 'Refresh'}</button>
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
          <strong>{isJapanese ? 'スクロール慣性' : 'Scroll Inertia'}</strong>
          <small>{isJapanese
            ? 'スクロールモードを選び、慣性が始まる条件と止まり方を調整します。'
            : 'Choose a scroll mode, then tune how easily momentum starts and how long it continues.'}</small>
        </div>
        <button className="button secondary" onClick={() => void load()} disabled={busy}>{isJapanese ? '再読込' : 'Reload'}</button>
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
            <strong>{profileLabel(profile)}</strong>
            <small>{profileSubtitle(profile)}</small>
          </button>
        ))}
      </div>

      <section className="trackball-inertia-editor">
        <div className="trackball-inertia-editor-heading">
          <div>
            <div className="eyebrow">{profileSubtitle(selectedProfile)}</div>
            <h3>{profileLabel(selectedProfile)}</h3>
          </div>
          <label className="trackball-inertia-toggle">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(event) => updateDraft(selectedProfile.id, { enabled: event.target.checked })}
            />
            <span>{draft.enabled
              ? (isJapanese ? '慣性 ON' : 'Inertia On')
              : (isJapanese ? '慣性 OFF' : 'Inertia Off')}</span>
          </label>
        </div>

        <div className="trackball-inertia-help">
          <strong>{isJapanese ? '各値の意味' : 'What each value means'}</strong>
          <div className="trackball-inertia-help-grid">
            <div><b>Start / Trigger</b><span>{isJapanese
              ? '慣性を開始するために必要なフリックの強さ。小さいほど軽いフリックでも慣性が発動し、大きいほど強く弾く必要があります。'
              : 'Flick-strength threshold for starting inertia. Lower values trigger more easily; higher values require a stronger flick.'}</span></div>
            <div><b>Move / Gesture</b><span>{isJapanese
              ? '慣性を有効にするまでに必要な移動量。小さいほど短い操作でも発動し、大きいほど長く回したときだけ発動します。'
              : 'Movement required before inertia can arm. Lower values work with shorter gestures; higher values require more travel.'}</span></div>
            <div><b>Stop / Tail</b><span>{isJapanese
              ? '慣性を停止する速度のしきい値。小さいほど低速まで慣性が残って長く続き、大きいほど早めに止まります。'
              : 'Velocity threshold where inertia stops. Lower values keep the tail running longer; higher values stop it sooner.'}</span></div>
          </div>
        </div>

        <div className={`trackball-inertia-controls ${draft.enabled ? '' : 'disabled-look'}`}>
          <label className="trackball-inertia-control">
            <span className="trackball-inertia-control-title">
              <span><strong>{isJapanese ? 'Trigger（Start）' : 'Trigger (Start)'}</strong><small>{isJapanese ? '慣性が始まるフリックの強さ' : 'How strong the flick must be'}</small></span>
              <input type="number" min={1} max={200} value={draft.start} disabled={busy || !draft.enabled}
                onChange={(event) => updateDraft(selectedProfile.id, { start: Number(event.target.value) })} />
            </span>
            <div className="trackball-inertia-slider-labels"><span>{isJapanese ? '発動しやすい' : 'Easier'}</span><span>{isJapanese ? '強く弾く' : 'Harder'}</span></div>
            <input className="trackball-inertia-slider" type="range" min={1} max={80} step={1}
              value={Math.min(80, draft.start)} disabled={busy || !draft.enabled}
              onChange={(event) => updateDraft(selectedProfile.id, { start: Number(event.target.value) })} />
          </label>

          <label className="trackball-inertia-control">
            <span className="trackball-inertia-control-title">
              <span><strong>{isJapanese ? 'Gesture（Move）' : 'Gesture (Move)'}</strong><small>{isJapanese ? '慣性を準備するまでの移動量' : 'Movement needed before momentum can arm'}</small></span>
              <input type="number" min={1} max={500} value={draft.move} disabled={busy || !draft.enabled}
                onChange={(event) => updateDraft(selectedProfile.id, { move: Number(event.target.value) })} />
            </span>
            <div className="trackball-inertia-slider-labels"><span>{isJapanese ? '短い操作' : 'Shorter'}</span><span>{isJapanese ? '長い操作' : 'Longer'}</span></div>
            <input className="trackball-inertia-slider" type="range" min={1} max={120} step={1}
              value={Math.min(120, draft.move)} disabled={busy || !draft.enabled}
              onChange={(event) => updateDraft(selectedProfile.id, { move: Number(event.target.value) })} />
          </label>

          <label className="trackball-inertia-control">
            <span className="trackball-inertia-control-title">
              <span><strong>{isJapanese ? 'Tail（Stop）' : 'Tail (Stop)'}</strong><small>{isJapanese ? '慣性が最後に止まるしきい値' : 'Threshold where momentum finally stops'}</small></span>
              <input type="number" min={0} max={50} value={draft.stop} disabled={busy || !draft.enabled}
                onChange={(event) => updateDraft(selectedProfile.id, { stop: Number(event.target.value) })} />
            </span>
            <div className="trackball-inertia-slider-labels"><span>{isJapanese ? '長く続く' : 'Longer'}</span><span>{isJapanese ? '早く止まる' : 'Stops sooner'}</span></div>
            <input className="trackball-inertia-slider" type="range" min={0} max={20} step={1}
              value={Math.min(20, draft.stop)} disabled={busy || !draft.enabled}
              onChange={(event) => updateDraft(selectedProfile.id, { stop: Number(event.target.value) })} />
          </label>
        </div>

        <div className="trackball-inertia-footer">
          <div className="trackball-inertia-saved">
            <span>{isJapanese ? '保存済み' : 'Saved'}</span>
            <strong>{saved.enabled ? (isJapanese ? 'ON' : 'On') : (isJapanese ? 'OFF' : 'Off')} · {saved.start} / {saved.move} / {saved.stop}</strong>
            {dirty && <em>{isJapanese ? '未保存の変更あり' : 'Unsaved changes'}</em>}
          </div>
          <div className="trackball-actions">
            <button className="button secondary" disabled={busy || !dirty}
              onClick={() => updateDraft(selectedProfile.id, saved)}>{isJapanese ? '元に戻す' : 'Reset'}</button>
            <button className="button" onClick={() => void applyAndSave(selectedProfile)} disabled={busy || !dirty}>
              {busy ? (isJapanese ? '保存中…' : 'Saving…') : (isJapanese ? '適用して保存' : 'Apply & Save')}
            </button>
          </div>
        </div>
      </section>

      {message && <div className="status-strip"><span>{message}</span></div>}
      {error && <div className="notice">{error}</div>}
    </div>
  );
}
