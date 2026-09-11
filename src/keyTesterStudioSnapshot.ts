import type { KeyPhysicalAttrs, Layer } from '@zmkfirmware/zmk-studio-ts-client/keymap';

export type KeyTesterStudioSnapshot = {
  deviceName: string;
  physicalKeys: KeyPhysicalAttrs[];
  baseLayer: Layer | null;
};

type Listener = () => void;

let current: KeyTesterStudioSnapshot | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function setKeyTesterStudioSnapshot(snapshot: KeyTesterStudioSnapshot) {
  current = snapshot;
  emit();
}

export function clearKeyTesterStudioSnapshot() {
  current = null;
  emit();
}

export function getKeyTesterStudioSnapshot() {
  return current;
}

export function subscribeKeyTesterStudioSnapshot(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
