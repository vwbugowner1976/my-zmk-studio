import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { call_rpc } from '@zmkfirmware/zmk-studio-ts-client';
import BLEManagement from './BLEManagement';
import {
  getSharedStudioConnectionSnapshot,
  subscribeSharedStudioConnection,
} from './studioConnectionRegistry';
import { useLanguage } from './i18n';
import './bleManagementPortal.css';

const BLE_MANAGEMENT_SUBSYSTEM_ID = 'mykeeb__ble_management';

type Subsystem = { index: number; identifier: string };

export default function BLEManagementPortal() {
  const { isJapanese, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const [subsystem, setSubsystem] = useState<Subsystem | null>(null);
  const [detecting, setDetecting] = useState(false);
  const { connection } = useSyncExternalStore(
    subscribeSharedStudioConnection,
    getSharedStudioConnectionSnapshot,
    getSharedStudioConnectionSnapshot,
  );

  useEffect(() => {
    const findMenu = () => setMenuHost(document.querySelector<HTMLElement>('.tool-nav'));
    findMenu();
    const observer = new MutationObserver(findMenu);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!connection) {
      setSubsystem(null);
      setOpen(false);
      return;
    }

    let cancelled = false;
    setDetecting(true);
    void call_rpc(connection, { custom: { listCustomSubsystems: {} } })
      .then((response) => {
        if (cancelled) return;
        const found = (response.custom?.listCustomSubsystems?.subsystems ?? [])
          .find((item) => item.identifier === BLE_MANAGEMENT_SUBSYSTEM_ID);
        setSubsystem(found ? { index: found.index, identifier: found.identifier } : null);
      })
      .catch(() => {
        if (!cancelled) setSubsystem(null);
      })
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });

    return () => { cancelled = true; };
  }, [connection]);

  const available = !!connection && !!subsystem;

  return (
    <>
      {menuHost && createPortal(
        <button
          type="button"
          className={`nav-item ble-management-menu-item ${open ? 'active' : ''}`}
          onClick={() => available && setOpen((value) => !value)}
          disabled={!available}
          title={available
            ? (isJapanese ? 'BLEプロファイルを管理' : 'Manage BLE profiles')
            : detecting
              ? (isJapanese ? 'BLE管理機能を確認中…' : 'Detecting BLE management…')
              : (isJapanese ? '対応firmwareが必要です' : 'Requires compatible firmware')}
        >
          <span aria-hidden="true">◉</span>
          <span>{t('bleManagement')}</span>
        </button>,
        menuHost,
      )}

      {open && connection && subsystem && (
        <div className="ble-management-overlay" role="dialog" aria-modal="true" aria-label={t('bleManagement')}>
          <div className="ble-management-window">
            <div className="ble-management-window-head">
              <div>
                <div className="eyebrow">Bluetooth</div>
                <h2>{t('bleManagement')}</h2>
                <p>{isJapanese ? '接続中キーボードのBLEプロファイルを管理します。' : 'Manage BLE profiles on the connected keyboard.'}</p>
              </div>
              <button className="button secondary" type="button" onClick={() => setOpen(false)}>{isJapanese ? '閉じる' : 'Close'}</button>
            </div>
            <BLEManagement
              connection={connection}
              subsystemIndex={subsystem.index}
              onDebug={(event, detail) => {
                const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
                console.info(`[MyZMKStudio] ${new Date().toISOString().slice(11, 23)} ${event}${suffix}`);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
