import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEVICE_IDENTITY_EVENT,
  getConnectedDeviceId,
  getConnectedDeviceName,
} from './deviceIdentity';

const TOOL_EVENT = 'mykeebstudio-active-tool';

function normalizeToolTitle(value: string) {
  const text = value.trim();
  if (/Layer Viewer|Keymap|レイヤービューア|キーマップ/i.test(text)) return 'Keymap';
  if (/Keymap Backup/i.test(text)) return 'Keymap';
  if (/Key Tester|キーテスター/i.test(text)) return 'Key Tester';
  if (/BLE Management|BLE管理/i.test(text)) return 'BLE Management';
  if (/Trackball|トラックボール/i.test(text)) return 'Trackball';
  if (/Custom Settings|カスタム設定/i.test(text)) return 'Custom Settings';
  if (/Runtime Combo|ランタイムコンボ/i.test(text)) return 'Runtime Combo';
  return text.replace(/^[^A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]+/, '') || 'Runtime Combo';
}

function currentNativeToolTitle() {
  const active = document.querySelector<HTMLElement>('.tool-nav .nav-item.active');
  return normalizeToolTitle(active?.textContent ?? 'Runtime Combo');
}

export default function HeaderIdentity() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [deviceId, setDeviceId] = useState(getConnectedDeviceId);
  const [deviceName, setDeviceName] = useState(getConnectedDeviceName);
  const [toolTitle, setToolTitle] = useState('Runtime Combo');

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.topbar-brand > div'));
    setToolTitle(currentNativeToolTitle());
  }, []);

  useEffect(() => {
    const refresh = () => {
      const nextId = getConnectedDeviceId();
      setDeviceId(nextId);
      setDeviceName(getConnectedDeviceName());
      document.body.classList.toggle('mykeeb-connected', !!nextId);
    };
    refresh();
    window.addEventListener(DEVICE_IDENTITY_EVENT, refresh);
    return () => {
      window.removeEventListener(DEVICE_IDENTITY_EVENT, refresh);
      document.body.classList.remove('mykeeb-connected');
    };
  }, []);

  useEffect(() => {
    const onToolEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string }>).detail;
      if (detail?.title) setToolTitle(normalizeToolTitle(detail.title));
    };
    const onDocumentClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('.tool-nav .nav-item');
      if (!button) return;
      window.setTimeout(() => setToolTitle(normalizeToolTitle(button.textContent ?? currentNativeToolTitle())), 0);
    };
    window.addEventListener(TOOL_EVENT, onToolEvent);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      window.removeEventListener(TOOL_EVENT, onToolEvent);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, []);

  if (!host) return null;

  return createPortal(
    <div className="header-identity-row">
      <h1 className="header-identity-title">
        MyKeebStudio <small className="version-badge">v0.6</small>
      </h1>
      <span className="header-tool-title" aria-label="Current tool">/ {toolTitle}</span>
      {deviceId && (
        <span className="header-device-name" title={`USB ${deviceId}`}>
          <span className="status online" aria-hidden="true" />
          <strong>{deviceName || 'ZMK Keyboard'}</strong>
        </span>
      )}
    </div>,
    host,
  );
}
