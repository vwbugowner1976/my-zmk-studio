import type { RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';

type Listener = () => void;

type Snapshot = {
  connection: RpcConnection | null;
};

let snapshot: Snapshot = { connection: null };
const listeners = new Set<Listener>();

export function setSharedStudioConnection(connection: RpcConnection | null) {
  if (snapshot.connection === connection) return;
  snapshot = { connection };
  for (const listener of listeners) listener();
}

export function getSharedStudioConnectionSnapshot() {
  return snapshot;
}

export function subscribeSharedStudioConnection(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
