import { useEffect, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';

export type BehaviorOption = {
  id: number;
  displayName: string;
};

export function useBehaviorOptions(connection: RpcConnection | null | undefined) {
  const [options, setOptions] = useState<BehaviorOption[] | null>(null);

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
      const details = await Promise.all(
        ids.map((id) =>
          call_rpc(connection, {
            behaviors: { getBehaviorDetails: { behaviorId: id } },
          }),
        ),
      );
      if (cancelled) return;

      setOptions(
        details
          .map((resp, index) => ({
            id: ids[index],
            displayName: resp?.behaviors?.getBehaviorDetails?.displayName ?? '',
          }))
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
