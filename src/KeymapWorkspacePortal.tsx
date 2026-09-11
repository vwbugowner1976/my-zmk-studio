import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import KeymapBackup from './KeymapBackup';
import {
  getSharedStudioConnectionSnapshot,
  subscribeSharedStudioConnection,
} from './studioConnectionRegistry';

type KeymapMode = 'edit' | 'backup';

function keymapMenuButton() {
  return document.querySelector<HTMLButtonElement>('.tool-nav > .nav-item:nth-child(2)');
}

function isKeymapActive() {
  const button = keymapMenuButton();
  return !!button?.classList.contains('active');
}

export default function KeymapWorkspacePortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const requestedModeRef = useRef<KeymapMode | null>(null);
  const { connection } = useSyncExternalStore(
    subscribeSharedStudioConnection,
    getSharedStudioConnectionSnapshot,
    getSharedStudioConnectionSnapshot,
  );

  useEffect(() => {
    const findMenu = () => {
      setMenuHost(document.querySelector<HTMLElement>('.tool-nav'));
    };
    findMenu();
    const observer = new MutationObserver(findMenu);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const content = document.querySelector<HTMLElement>('.content');
    if (!content) return undefined;

    const sync = () => {
      const next = isKeymapActive()
        ? content.querySelector<HTMLElement>('.layer-viewer')
        : null;

      if (next) {
        const requested = requestedModeRef.current;
        if (requested) {
          setBackupOpen(requested === 'backup');
          requestedModeRef.current = null;
        } else if (next !== host) {
          setBackupOpen(false);
        }
      } else if (!requestedModeRef.current) {
        setBackupOpen(false);
      }

      setHost((current) => current === next ? current : next);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(content, { childList: true });
    document.addEventListener('click', sync, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', sync, true);
    };
  }, [host]);

  useEffect(() => {
    if (!host) return;
    host.classList.toggle('keymap-backup-active', backupOpen);
    return () => host.classList.remove('keymap-backup-active');
  }, [host, backupOpen]);

  function openFromMenu(mode: KeymapMode) {
    requestedModeRef.current = mode;
    const button = keymapMenuButton();
    if (!button) return;

    if (!button.classList.contains('active')) {
      button.click();
      return;
    }

    setBackupOpen(mode === 'backup');
    requestedModeRef.current = null;
  }

  const sidebar = menuHost ? createPortal(
    <div className="keymap-nav-submenu" aria-label="Keymap tools">
      <button
        type="button"
        className={!backupOpen && isKeymapActive() ? 'active' : ''}
        onClick={() => openFromMenu('edit')}
      >
        Edit
      </button>
      <button
        type="button"
        className={backupOpen && isKeymapActive() ? 'active' : ''}
        onClick={() => openFromMenu('backup')}
        disabled={!connection}
      >
        Backup / Restore
      </button>
    </div>,
    menuHost,
  ) : null;

  const workspace = host ? createPortal(
    <div className="keymap-workspace-portal">
      {!backupOpen ? (
        <div className="keymap-workspace-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => setBackupOpen(true)}
            disabled={!connection}
          >
            Backup / Restore
          </button>
        </div>
      ) : (
        <>
          <div className="keymap-workspace-actions backup-open">
            <button
              type="button"
              className="button secondary"
              onClick={() => setBackupOpen(false)}
            >
              ← Back to Keymap
            </button>
          </div>
          {connection && (
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
        </>
      )}
    </div>,
    host,
  ) : null;

  return <>{sidebar}{workspace}</>;
}
