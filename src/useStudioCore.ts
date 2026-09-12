import { useEffect, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import type { BehaviorBindingParametersSet } from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import { setSharedStudioConnection } from './studioConnectionRegistry';

export type BehaviorOption = {
  id: number;
  displayName: string;
  metadata: BehaviorBindingParametersSet[];
};

export function useBehaviorOptions(connection: RpcConnection | null | undefined) {
  const [options, setOptions] = useState<BehaviorOption[] | null>(null);

  useEffect(() => {
    setSharedStudioConnection(connection ?? null);
    return () => {
      setSharedStudioConnection(null);
    };
  }, [connection]);

  useEffect(() => {
    if (!connection) {
      setOptions(null);
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      const listResp = await call_rpc(connection, {
        behaviors: { listAllBehaviors: true },
      });
      const ids = listResp?.behaviors?.listAllBehaviors?.behaviors ?? [];
      const details = [];
      for (const id of ids) {
        if (cancelled) return;
        details.push(
          await call_rpc(connection, {
            behaviors: { getBehaviorDetails: { behaviorId: id } },
          }),
        );
      }
      if (cancelled) return;

      setOptions(
        details
          .map((resp, index) => {
            const detail = resp?.behaviors?.getBehaviorDetails;
            return {
              id: ids[index],
              displayName: detail?.displayName ?? '',
              metadata: detail?.metadata ?? [],
            };
          })
          .filter((option) => option.displayName)
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      );
    })().catch(() => {
      if (!cancelled) setOptions([]);
    });

    return () => {
      cancelled = true;
    };
  }, [connection]);

  return connection ? options : null;
}
