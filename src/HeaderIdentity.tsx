import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEVICE_IDENTITY_EVENT,
  getConnectedDeviceId,
  getConnectedDeviceName,
} from './deviceIdentity';

export default function HeaderIdentity() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [deviceId, setDeviceId] = useState(getConnectedDeviceId);
  const [deviceName, setDeviceName] = useState(getConnectedDeviceName);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.topbar-brand > div'));
  }, []);

  useEffect(() => {
    const refresh = () => {
      setDeviceId(getConnectedDeviceId());
      setDeviceName(getConnectedDeviceName());
    };
    window.addEventListener(DEVICE_IDENTITY_EVENT, refresh);
    return () => window.removeEventListener(DEVICE_IDENTITY_EVENT, refresh);
  }, []);

  if (!host) return null;

  return createPortal(
    <div className="header-identity-row">
      <h1 className="header-identity-title">
        MyKeebStudio <small className="version-badge">v0.6</small>
      </h1>
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
