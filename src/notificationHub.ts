import type { Notification, RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';

type Listener = (notification: Notification) => void;

type HubState = {
  listeners: Set<Listener>;
  started: boolean;
};

const hubs = new WeakMap<RpcConnection, HubState>();

function stateFor(connection: RpcConnection) {
  let state = hubs.get(connection);
  if (!state) {
    state = { listeners: new Set(), started: false };
    hubs.set(connection, state);
  }
  return state;
}

function start(connection: RpcConnection, state: HubState) {
  if (state.started) return;
  state.started = true;
  void (async () => {
    const reader = connection.notification_readable.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        for (const listener of [...state.listeners]) {
          try { listener(value); } catch (error) { console.warn('[MyZMKStudio] notification listener failed', error); }
        }
      }
    } catch (error) {
      console.debug('[MyZMKStudio] notification hub closed', error);
    } finally {
      try { reader.releaseLock(); } catch { /* connection teardown */ }
      state.started = false;
    }
  })();
}

export function subscribeNotifications(connection: RpcConnection, listener: Listener) {
  const state = stateFor(connection);
  state.listeners.add(listener);
  start(connection, state);
  return () => {
    state.listeners.delete(listener);
  };
}
