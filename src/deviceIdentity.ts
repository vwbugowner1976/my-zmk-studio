const CURRENT_DEVICE_KEY = 'my-zmk-studio-current-device';
const DEVICE_NAMES_KEY = 'my-zmk-studio-device-names';
export const DEVICE_IDENTITY_EVENT = 'my-zmk-studio-device-identity';

type DeviceNames = Record<string, string>;

function readNames(): DeviceNames {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_NAMES_KEY) || '{}') as DeviceNames;
  } catch {
    return {};
  }
}

function writeNames(names: DeviceNames) {
  try {
    localStorage.setItem(DEVICE_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Keep the current session usable when storage is unavailable.
  }
}

function emit() {
  window.dispatchEvent(new CustomEvent(DEVICE_IDENTITY_EVENT));
}

export function setConnectedDevice(deviceId: string) {
  try {
    localStorage.setItem(CURRENT_DEVICE_KEY, deviceId);
  } catch {
    // Ignore storage failures.
  }
  emit();
}

export function clearConnectedDevice() {
  try {
    localStorage.removeItem(CURRENT_DEVICE_KEY);
  } catch {
    // Ignore storage failures.
  }
  emit();
}

export function getConnectedDeviceId() {
  try {
    return localStorage.getItem(CURRENT_DEVICE_KEY) || '';
  } catch {
    return '';
  }
}

export function defaultDeviceName(deviceId: string) {
  if (!deviceId) return 'ZMK Keyboard';
  return `ZMK Keyboard ${deviceId.replace(/:/g, '-')}`;
}

export function getConnectedDeviceName() {
  const deviceId = getConnectedDeviceId();
  if (!deviceId) return '';
  return readNames()[deviceId] || defaultDeviceName(deviceId);
}

export function setConnectedDeviceName(name: string) {
  const deviceId = getConnectedDeviceId();
  if (!deviceId) return;
  const names = readNames();
  const trimmed = name.trim();
  if (trimmed) names[deviceId] = trimmed;
  else delete names[deviceId];
  writeNames(names);
  emit();
}

export function safeDeviceFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'zmk-keyboard';
}

export function installDeviceExportNaming() {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement) || !target.download) return;
    const deviceName = getConnectedDeviceName();
    if (!deviceName) return;
    const prefix = safeDeviceFilename(deviceName);
    if (target.download.startsWith(`${prefix}-`)) return;
    target.download = `${prefix}-${target.download}`;
  }, true);
}
