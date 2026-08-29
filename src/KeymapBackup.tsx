import { useEffect, useMemo, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import type { BehaviorBinding, Keymap } from '@zmkfirmware/zmk-studio-ts-client/keymap';

type BackupFile = {
  format: 'my-zmk-studio-keymap';
  version: 1;
  exportedAt: string;
  keymap: Keymap;
};

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sameBinding(a: BehaviorBinding, b: BehaviorBinding) {
  return a.behaviorId === b.behaviorId && a.param1 === b.param1 && a.param2 === b.param2;
}

function bindingText(binding: BehaviorBinding) {
  const params = [binding.param1, binding.param2].filter((value) => value !== 0);
  return `Behavior #${binding.behaviorId}${params.length ? ` · ${params.join(' · ')}` : ''}`;
}

function validateBackup(value: unknown): BackupFile {
  if (!value || typeof value !== 'object') throw new Error('Invalid backup file.');
  const candidate = value as Partial<BackupFile>;
  if (candidate.format !== 'my-zmk-studio-keymap' || candidate.version !== 1 || !candidate.keymap) {
    throw new Error('This is not a My ZMK Studio keymap backup.');
  }
  if (!Array.isArray(candidate.keymap.layers)) throw new Error('Backup contains no layers.');
  return candidate as BackupFile;
}

export default function KeymapBackup({
  connection,
  onDebug,
}: {
  connection: RpcConnection;
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [current, setCurrent] = useState<Keymap | null>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [previewLayer, setPreviewLayer] = useState(0);
  const [changedOnly, setChangedOnly] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function readKeymap() {
    onDebug('RPC -> keymap.getKeymap (backup)');
    const response = await call_rpc(connection, { keymap: { getKeymap: true } });
    const keymap = response.keymap?.getKeymap;
    if (!keymap) throw new Error('Firmware returned no keymap.');
    setCurrent(keymap);
    onDebug('Backup keymap loaded', {
      layers: keymap.layers.length,
      bindings: keymap.layers.map((layer) => layer.bindings.length),
    });
    return keymap;
  }

  useEffect(() => {
    void readKeymap().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [connection]);

  async function exportBackup() {
    setBusy(true);
    try {
      const keymap = current ?? await readKeymap();
      const backup: BackupFile = {
        format: 'my-zmk-studio-keymap',
        version: 1,
        exportedAt: new Date().toISOString(),
        keymap,
      };
      downloadJson(backup, `my-zmk-studio-keymap-${new Date().toISOString().slice(0, 10)}.json`);
      setMessage(`Exported ${keymap.layers.length} layer(s).`);
      onDebug('Keymap JSON exported', { layers: keymap.layers.length });
    } finally {
      setBusy(false);
    }
  }

  async function chooseImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = validateBackup(JSON.parse(await file.text()));
      const live = current ?? await readKeymap();
      if (parsed.keymap.layers.length !== live.layers.length) {
        throw new Error(`Layer count mismatch: backup ${parsed.keymap.layers.length}, firmware ${live.layers.length}.`);
      }
      parsed.keymap.layers.forEach((layer, index) => {
        const liveLayer = live.layers[index];
        if (!liveLayer || layer.bindings.length !== liveLayer.bindings.length) {
          throw new Error(`Layer ${index} key count mismatch.`);
        }
      });
      setPending(parsed);
      setPreviewLayer(0);
      setMessage('Backup loaded. Review imported contents and differences before applying.');
      onDebug('Keymap backup selected', { exportedAt: parsed.exportedAt, layers: parsed.keymap.layers.length });
    } catch (error) {
      setPending(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const diff = useMemo(() => {
    if (!current || !pending) return { bindings: 0, names: 0, byLayer: [] as number[] };
    let bindings = 0;
    let names = 0;
    const byLayer = pending.keymap.layers.map((layer, layerIndex) => {
      const live = current.layers[layerIndex];
      if (layer.name !== live.name) names += 1;
      let layerChanges = 0;
      layer.bindings.forEach((binding, position) => {
        if (!sameBinding(binding, live.bindings[position])) {
          bindings += 1;
          layerChanges += 1;
        }
      });
      return layerChanges;
    });
    return { bindings, names, byLayer };
  }, [current, pending]);

  const previewRows = useMemo(() => {
    if (!current || !pending) return [];
    const liveLayer = current.layers[previewLayer];
    const importLayer = pending.keymap.layers[previewLayer];
    if (!liveLayer || !importLayer) return [];
    return importLayer.bindings.map((binding, position) => ({
      position,
      current: liveLayer.bindings[position],
      imported: binding,
      changed: !sameBinding(binding, liveLayer.bindings[position]),
    })).filter((row) => !changedOnly || row.changed);
  }, [current, pending, previewLayer, changedOnly]);

  async function applyImport() {
    if (!pending) return;
    setBusy(true);
    setMessage('Applying backup…');
    try {
      const live = await readKeymap();
      if (pending.keymap.layers.length !== live.layers.length) throw new Error('Firmware layout changed since preview.');
      let bindingWrites = 0;
      let nameWrites = 0;

      for (let layerIndex = 0; layerIndex < pending.keymap.layers.length; layerIndex += 1) {
        const sourceLayer = pending.keymap.layers[layerIndex];
        const liveLayer = live.layers[layerIndex];
        if (sourceLayer.bindings.length !== liveLayer.bindings.length) throw new Error(`Layer ${layerIndex} key count changed.`);

        if (sourceLayer.name !== liveLayer.name) {
          onDebug('RPC -> keymap.setLayerProps', { layerId: liveLayer.id, name: sourceLayer.name });
          const response = await call_rpc(connection, {
            keymap: { setLayerProps: { layerId: liveLayer.id, name: sourceLayer.name } },
          });
          if (response.keymap?.setLayerProps !== 0) throw new Error(`Failed to set layer ${layerIndex} name.`);
          nameWrites += 1;
        }

        for (let position = 0; position < sourceLayer.bindings.length; position += 1) {
          const desired = sourceLayer.bindings[position];
          if (sameBinding(desired, liveLayer.bindings[position])) continue;
          onDebug('RPC -> keymap.setLayerBinding', { layerIndex, position, behaviorId: desired.behaviorId });
          const response = await call_rpc(connection, {
            keymap: {
              setLayerBinding: {
                layerId: liveLayer.id,
                keyPosition: position,
                binding: desired,
              },
            },
          });
          if (response.keymap?.setLayerBinding !== 0) {
            throw new Error(`Layer ${layerIndex}, position ${position}: setLayerBinding failed (${response.keymap?.setLayerBinding}).`);
          }
          bindingWrites += 1;
        }
      }

      onDebug('RPC -> keymap.saveChanges');
      const save = await call_rpc(connection, { keymap: { saveChanges: true } });
      if (!save.keymap?.saveChanges?.ok) {
        throw new Error(`saveChanges failed (${save.keymap?.saveChanges?.err ?? 'unknown'}).`);
      }

      const refreshed = await readKeymap();
      setPending(null);
      setMessage(`Restore complete: ${bindingWrites} binding(s), ${nameWrites} layer name(s). Re-read ${refreshed.layers.length} layer(s).`);
      onDebug('Keymap restore complete', { bindingWrites, nameWrites });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text);
      onDebug('Keymap restore failed', text);
    } finally {
      setBusy(false);
    }
  }

  const liveLayer = current?.layers[previewLayer];
  const importLayer = pending?.keymap.layers[previewLayer];

  return (
    <div className="keymap-backup">
      <section className="panel backup-toolbar">
        <div>
          <h3>Keymap Backup</h3>
          <p>Export the live firmware keymap to JSON, or compare and restore a matching backup.</p>
        </div>
        <div className="backup-actions">
          <button className="button secondary" onClick={() => void readKeymap()} disabled={busy}>Refresh</button>
          <button className="button" onClick={exportBackup} disabled={busy || !current}>Export JSON</button>
          <button className="button secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>Import JSON</button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={chooseImport} />
        </div>
      </section>

      {current && (
        <section className="panel backup-summary">
          <strong>Live firmware</strong>
          <span>{current.layers.length} layers</span>
          <span>{current.layers.reduce((sum, layer) => sum + layer.bindings.length, 0)} bindings</span>
        </section>
      )}

      {pending && current && (
        <>
          <section className="panel import-preview">
            <div>
              <h3>Import preview</h3>
              <p>Exported {pending.exportedAt}</p>
              <p>{pending.keymap.layers.length} layers · {diff.bindings} binding change(s) · {diff.names} layer name change(s)</p>
            </div>
            <div className="backup-actions">
              <button className="button secondary" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
              <button className="button danger" onClick={applyImport} disabled={busy || (diff.bindings === 0 && diff.names === 0)}>
                Apply to firmware
              </button>
            </div>
          </section>

          <div className="backup-layer-tabs">
            {pending.keymap.layers.map((layer, index) => (
              <button
                key={layer.id}
                className={`layer-tab ${previewLayer === index ? 'active' : ''}`}
                onClick={() => setPreviewLayer(index)}
              >
                <strong>{index}</strong>
                <span>{layer.name || `Layer ${index}`}</span>
                {diff.byLayer[index] > 0 && <em>{diff.byLayer[index]}</em>}
              </button>
            ))}
          </div>

          <section className="panel backup-diff-panel">
            <div className="backup-diff-header">
              <div>
                <h3>Layer {previewLayer} comparison</h3>
                <p>
                  Current: <strong>{liveLayer?.name || `Layer ${previewLayer}`}</strong>
                  {' → '}
                  Import: <strong>{importLayer?.name || `Layer ${previewLayer}`}</strong>
                </p>
              </div>
              <label className="backup-filter">
                <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />
                Changed only
              </label>
            </div>

            {liveLayer && importLayer && liveLayer.name !== importLayer.name && (
              <div className="layer-name-diff">
                <span>Layer name</span>
                <code>{liveLayer.name || '(empty)'}</code>
                <span>→</span>
                <code>{importLayer.name || '(empty)'}</code>
              </div>
            )}

            <div className="backup-diff-table-wrap">
              <table className="backup-diff-table">
                <thead>
                  <tr><th>Position</th><th>Current firmware</th><th>Imported backup</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.position} className={row.changed ? 'changed' : ''}>
                      <td>#{row.position}</td>
                      <td><code>{bindingText(row.current)}</code></td>
                      <td><code>{bindingText(row.imported)}</code></td>
                      <td>{row.changed ? 'Changed' : 'Same'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewRows.length === 0 && (
                <div className="backup-no-diff">No binding changes in this layer.</div>
              )}
            </div>
          </section>
        </>
      )}

      {message && <div className="notice backup-message">{message}</div>}
    </div>
  );
}
