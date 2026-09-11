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
const TOOL_EVENT = 'mykeebstudio-active-tool';

type Subsystem = { index: number; identifier: string };

function nativeToolTitle() {
  const active = document.querySelector<HTMLElement>('.tool-nav .nav-item.active');
  const text = (active?.textContent ?? '').trim();
  if (/Layer Viewer|Keymap|レイヤービューア|キーマップ/i.test(text)) return 'Keymap';
  return text || 'Runtime Combo';
}

export default function BLEManagementPortal() {
  const { isJapanese, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);
  const [subsystem, setSubsystem] = useState<Subsystem | null>(null);
  const [detecting, setDetecting] = useState(false);
  const { connection } = useSyncExternalStore(
    subscribeSharedStudioConnection,
    getSharedStudioConnectionSnapshot,
    getSharedStudioConnectionSnapshot,
  );

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace');
    if (!workspace) return undefined;
    const syncHosts = () => {
      setMenuHost(document.querySelector<HTMLElement>('.tool-nav'));
      setContentHost(document.querySelector<HTMLElement>('.content'));
    };
    syncHosts();
    const observer = new MutationObserver(syncHosts);
    observer.observe(workspace, { childList: true, subtree: true });
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

  useEffect(() => {
    if (!contentHost) return;
    contentHost.classList.toggle('external-tool-active', open);
    return () => contentHost.classList.remove('external-tool-active');
  }, [contentHost, open]);

  useEffect(() => {
    const onToolEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id && detail.id !== 'ble-management') setOpen(false);
    };
    const onDocumentClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('.tool-nav .nav-item');
      if (!button || button.classList.contains('ble-management-menu-item')) return;
      setOpen(false);
    };
    window.addEventListener(TOOL_EVENT, onToolEvent);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      window.removeEventListener(TOOL_EVENT, onToolEvent);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, []);

  const available = !!connection && !!subsystem;

  function toggle() {
    if (!available) return;
    setOpen((current) => {
      const next = !current;
      window.dispatchEvent(new CustomEvent(TOOL_EVENT, {
        detail: next
          ? { id: 'ble-management', title: t('bleManagement') }
          : { id: 'native', title: nativeToolTitle() },
      }));
      return next;
    });
  }

  return (
    <>
      {menuHost && createPortal(
        <button
          type="button"
          className={`nav-item ble-management-menu-item ${open ? 'active' : ''}`}
          onClick={toggle}
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

      {open && contentHost && connection && subsystem && createPortal(
        <div className="embedded-tool-page ble-management-main-page">
          <BLEManagement
            connection={connection}
            subsystemIndex={subsystem.index}
            onDebug={(event, detail) => {
              const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
              console.info(`[MyKeebStudio] ${new Date().toISOString().slice(11, 23)} ${event}${suffix}`);
            }}
          />
        </div>,
        contentHost,
      )}
    </>
  );
}
