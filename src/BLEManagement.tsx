import { useEffect, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import {
  decodeBleCommandResponse,
  decodeBleStatusResponse,
  encodeBleClearAllRequest,
  encodeBleClearProfileRequest,
  encodeBleDisconnectProfileRequest,
  encodeBleGetStatusRequest,
  encodeBleSelectProfileRequest,
  maskHas,
  type BleManagementStatus,
} from './bleManagementProtocol';
import { useLanguage } from './i18n';
import './bleManagement.css';

type Props = {
  connection: RpcConnection;
  subsystemIndex: number;
  onDebug?: (event: string, detail?: unknown) => void;
};

type Command = 'select' | 'disconnect' | 'clear' | 'clear-all';

export default function BLEManagement({ connection, subsystemIndex, onDebug }: Props) {
  const { isJapanese } = useLanguage();
  const [status, setStatus] = useState<BleManagementStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  async function call(payload: Uint8Array, label: string) {
    onDebug?.(`BLE RPC -> ${label}`, { subsystemIndex, bytes: Array.from(payload) });
    const response = await call_rpc(connection, { custom: { call: { subsystemIndex, payload } } });
    const bytes = response.custom?.call?.payload;
    if (!bytes) throw new Error('BLE management returned no payload');
    onDebug?.(`BLE RPC <- ${label}`, { bytes: Array.from(bytes) });
    return bytes;
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const bytes = await call(encodeBleGetStatusRequest(), 'get_status');
      setStatus(decodeBleStatusResponse(bytes));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, subsystemIndex]);

  async function runCommand(command: Command, index?: number) {
    setBusy(true);
    setError(null);
    try {
      let payload: Uint8Array;
      let label: string;
      switch (command) {
        case 'select':
          payload = encodeBleSelectProfileRequest(index ?? 0);
          label = `select_profile(${index})`;
          break;
        case 'disconnect':
          payload = encodeBleDisconnectProfileRequest(index ?? 0);
          label = `disconnect_profile(${index})`;
          break;
        case 'clear':
          payload = encodeBleClearProfileRequest(index ?? 0);
          label = `clear_profile(${index})`;
          break;
        case 'clear-all':
          payload = encodeBleClearAllRequest();
          label = 'clear_all';
          break;
      }

      const bytes = await call(payload, label);
      const result = decodeBleCommandResponse(bytes);
      setStatus(result.state);
      if (result.status !== 0) throw new Error(`${label} failed: ${result.status}`);
      if (command === 'clear-all') setConfirmClearAll(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  const count = status?.profileCount ?? 0;
  const profiles = Array.from({ length: count }, (_, index) => {
    const active = status?.activeProfile === index;
    const bonded = status ? maskHas(status.bondedMask, index) : false;
    const connected = status ? maskHas(status.connectedMask, index) : false;
    const open = status ? maskHas(status.openMask, index) : true;
    return { index, active, bonded, connected, open };
  });

  return (
    <div className="ble-management">
      <section className="panel ble-overview">
        <div>
          <div className="eyebrow">Bluetooth profiles</div>
          <h3>{isJapanese ? 'BLEプロファイル管理' : 'BLE Profile Management'}</h3>
          <p>
            {isJapanese
              ? 'ZMKのBLEプロファイルを確認・選択・切断・消去します。変更操作にはStudio Unlockが必要です。'
              : 'Inspect, select, disconnect and clear ZMK BLE profiles. Write operations require Studio Unlock.'}
          </p>
        </div>
        <button className="button secondary" type="button" onClick={() => void refresh()} disabled={busy}>
          {busy ? (isJapanese ? '更新中…' : 'Refreshing…') : (isJapanese ? '更新' : 'Refresh')}
        </button>
      </section>

      {error && <div className="notice">{error}</div>}

      {!status ? (
        <section className="panel empty"><div>{busy ? (isJapanese ? 'BLE状態を取得中…' : 'Reading BLE state…') : (isJapanese ? 'BLE状態を取得できませんでした。' : 'BLE state unavailable.')}</div></section>
      ) : (
        <section className="ble-profile-grid">
          {profiles.map((profile) => (
            <article className={`panel ble-profile-card ${profile.active ? 'active' : ''}`} key={profile.index}>
              <div className="ble-profile-head">
                <div>
                  <span className="tester-label">PROFILE</span>
                  <strong>#{profile.index}</strong>
                </div>
                <div className="ble-badges">
                  {profile.active && <span className="ble-badge active">{isJapanese ? '選択中' : 'Active'}</span>}
                  <span className={`ble-badge ${profile.bonded ? 'bonded' : 'empty'}`}>
                    {profile.bonded ? (isJapanese ? '登録済み' : 'Bonded') : (isJapanese ? '空き' : 'Empty')}
                  </span>
                  <span className={`ble-badge ${profile.connected ? 'connected' : 'disconnected'}`}>
                    {profile.connected ? (isJapanese ? '接続中' : 'Connected') : (isJapanese ? '未接続' : 'Disconnected')}
                  </span>
                </div>
              </div>

              <p className="ble-profile-state">
                {profile.open
                  ? (isJapanese ? '新しいホストとのペアリング待機に使用できます。' : 'Available for pairing with a new host.')
                  : (isJapanese ? 'このスロットにはボンド情報があります。' : 'This slot contains bond information.')}
              </p>

              <div className="ble-profile-actions">
                <button className="button" type="button" disabled={busy || profile.active} onClick={() => void runCommand('select', profile.index)}>
                  {isJapanese ? '選択' : 'Select'}
                </button>
                <button className="button secondary" type="button" disabled={busy || !profile.connected} onClick={() => void runCommand('disconnect', profile.index)}>
                  {isJapanese ? '切断' : 'Disconnect'}
                </button>
                <button
                  className="button danger"
                  type="button"
                  disabled={busy || !profile.bonded}
                  onClick={() => {
                    const ok = window.confirm(isJapanese
                      ? `BLEプロファイル #${profile.index} のボンド情報を消去しますか？\nこのプロファイルが選択され、再ペアリングが必要になります。`
                      : `Clear bond information for BLE profile #${profile.index}?\nThis profile becomes selected and will need to be paired again.`);
                    if (ok) void runCommand('clear', profile.index);
                  }}
                >
                  {isJapanese ? '消去' : 'Clear'}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="panel ble-danger-zone">
        <div>
          <h3>{isJapanese ? 'すべてのボンドを消去' : 'Clear all bonds'}</h3>
          <p>{isJapanese ? '全BLEプロファイルのペアリング情報を消去します。' : 'Remove pairing information from every BLE profile.'}</p>
        </div>
        {!confirmClearAll ? (
          <button className="button danger" type="button" disabled={busy || !status} onClick={() => setConfirmClearAll(true)}>
            {isJapanese ? 'すべて消去…' : 'Clear all…'}
          </button>
        ) : (
          <div className="ble-clear-confirm">
            <span>{isJapanese ? '本当に消去しますか？' : 'Are you sure?'}</span>
            <button className="button secondary" type="button" onClick={() => setConfirmClearAll(false)} disabled={busy}>{isJapanese ? 'キャンセル' : 'Cancel'}</button>
            <button className="button danger" type="button" onClick={() => void runCommand('clear-all')} disabled={busy}>{isJapanese ? '全消去' : 'Clear all bonds'}</button>
          </div>
        )}
      </section>
    </div>
  );
}
