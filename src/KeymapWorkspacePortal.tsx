import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import KeymapBackup from './KeymapBackup';
import {
  getSharedStudioConnectionSnapshot,
  subscribeSharedStudioConnection,
} from './studioConnectionRegistry';

function isKeymapActive() {
  const active = document.querySelector<HTMLElement>('.tool-nav .nav-item.active');
  return /Layer Viewer|Keymap|キーマップ|レイヤービューア/i.test(active?.textContent ?? '');
}

export default function KeymapWorkspacePortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const { connection } = useSyncExternalStore(
    subscribeSharedStudioConnection,
    getSharedStudioConnectionSnapshot,
    getSharedStudioConnectionSnapshot,
  );

  useEffect(() => {
    const content = document.querySelector<HTMLElement>('.content');
    if (!content) return undefined;

    const sync = () => {
      const next = isKeymapActive()
        ? content.querySelector<HTMLElement>('.layer-viewer')
        : null;
      setHost((current) => current === next ? current : next);
      if (!next) setBackupOpen(false);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(content, { childList: true });
    document.addEventListener('click', sync, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', sync, true);
    };
  }, []);

  useEffect(() => {
    if (!host) return;
    host.classList.toggle('keymap-backup-active', backupOpen);
    return () => host.classList.remove('keymap-backup-active');
  }, [host, backupOpen]);

  if (!host) return null;

  return createPortal(
    <div className="keymap-workspace-portal">
      <div className="keymap-workspace-tabs" role="tablist" aria-label="Keymap tools">
        <button
          type="button"
          role="tab"
          aria-selected={!backupOpen}
          className={!backupOpen ? 'active' : ''}
          onClick={() => setBackupOpen(false)}
        >
          Editor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={backupOpen}
          className={backupOpen ? 'active' : ''}
          onClick={() => setBackupOpen(true)}
          disabled={!connection}
        >
          Backup / Restore
        </button>
      </div>
      {backupOpen && connection && (
        <div className="keymap-backup-embedded">
          <KeymapBackup
            connection={connection}
            onDebug={(event, detail) => {
              const suffix = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
              console.info(`[MyKeebStudio] ${new Date().toISOString().slice(11, 23)} ${event}${suffix}`);
            }}
          />
        </div>
      )}
    </div>,
    host,
  );
}
