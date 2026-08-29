import { useEffect, useState } from 'react';
import {
  DEVICE_IDENTITY_EVENT,
  getConnectedDeviceId,
  getConnectedDeviceName,
  setConnectedDeviceName,
} from './deviceIdentity';

export default function DeviceNameBadge() {
  const [deviceId, setDeviceId] = useState(getConnectedDeviceId);
  const [name, setName] = useState(getConnectedDeviceName);

  useEffect(() => {
    const refresh = () => {
      setDeviceId(getConnectedDeviceId());
      setName(getConnectedDeviceName());
    };
    window.addEventListener(DEVICE_IDENTITY_EVENT, refresh);
    return () => window.removeEventListener(DEVICE_IDENTITY_EVENT, refresh);
  }, []);

  if (!deviceId) return null;

  return (
    <div className="device-name-badge" title={`USB ${deviceId}`}>
      <span>Keyboard</span>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          setConnectedDeviceName(name);
          setName(getConnectedDeviceName());
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        aria-label="Connected keyboard name"
      />
      <small>{deviceId}</small>
    </div>
  );
}
