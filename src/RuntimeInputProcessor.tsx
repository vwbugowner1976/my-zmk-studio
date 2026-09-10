import { useEffect, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import RuntimeInputProcessorBase from './RuntimeInputProcessorBase';
import TrackballInertiaSettings from './TrackballInertiaSettings';
import './trackballInertia.css';

const CUSTOM_SETTINGS_SUBSYSTEM_ID = 'cormoran_custom_settings';

export default function RuntimeInputProcessor({
  connection,
  subsystemIndex,
  layerNames,
  onDebug,
}: {
  connection: RpcConnection;
  subsystemIndex: number;
  layerNames: string[];
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [customSettingsSubsystemIndex, setCustomSettingsSubsystemIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCustomSettingsSubsystemIndex(null);

    void call_rpc(connection, { custom: { listCustomSubsystems: {} } })
      .then((response) => {
        if (cancelled) return;
        const found = response.custom?.listCustomSubsystems?.subsystems?.find(
          (item) => item.identifier === CUSTOM_SETTINGS_SUBSYSTEM_ID,
        );
        setCustomSettingsSubsystemIndex(found?.index ?? null);
        onDebug('Trackball Custom Settings subsystem', found
          ? { identifier: found.identifier, index: found.index }
          : 'not found');
      })
      .catch((cause) => {
        if (!cancelled) {
          onDebug('Trackball Custom Settings subsystem lookup failed',
            cause instanceof Error ? cause.message : String(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connection, onDebug]);

  return (
    <>
      <RuntimeInputProcessorBase
        connection={connection}
        subsystemIndex={subsystemIndex}
        layerNames={layerNames}
        onDebug={onDebug}
      />

      {customSettingsSubsystemIndex !== null && (
        <TrackballInertiaSettings
          connection={connection}
          customSettingsSubsystemIndex={customSettingsSubsystemIndex}
          runtimeInputSubsystemIndex={subsystemIndex}
          onDebug={onDebug}
        />
      )}
    </>
  );
}
