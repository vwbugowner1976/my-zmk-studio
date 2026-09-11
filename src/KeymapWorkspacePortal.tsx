import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type KeymapMode = 'edit' | 'backup' | 'other';

function keymapEditButton() {
  return document.querySelector<HTMLButtonElement>('.tool-nav > .nav-item:nth-child(2)');
}

function keymapBackupButton() {
  return document.querySelector<HTMLButtonElement>('.tool-nav > .nav-item:nth-child(3)');
}

function currentMode(): KeymapMode {
  if (keymapEditButton()?.classList.contains('active')) return 'edit';
  if (keymapBackupButton()?.classList.contains('active')) return 'backup';
  return 'other';
}

export default function KeymapWorkspacePortal() {
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<KeymapMode>('other');

  useEffect(() => {
    const sync = () => {
      const nextMode = currentMode();
      setMode((current) => current === nextMode ? current : nextMode);

      const nextMenu = document.querySelector<HTMLElement>('.tool-nav');
      setMenuHost((current) => current === nextMenu ? current : nextMenu);

      const nextToolbar = nextMode === 'edit'
        ? document.querySelector<HTMLElement>('.layer-viewer .layer-export-actions')
        : null;
      setToolbarHost((current) => current === nextToolbar ? current : nextToolbar);
    };

    sync();

    const content = document.querySelector<HTMLElement>('.content');
    const menu = document.querySelector<HTMLElement>('.tool-nav');
    const contentObserver = content ? new MutationObserver(sync) : null;
    const menuObserver = menu ? new MutationObserver(sync) : null;

    contentObserver?.observe(content!, { childList: true, subtree: true });
    menuObserver?.observe(menu!, { attributes: true, subtree: true, attributeFilter: ['class'] });
    document.addEventListener('click', sync, true);

    return () => {
      contentObserver?.disconnect();
      menuObserver?.disconnect();
      document.removeEventListener('click', sync, true);
    };
  }, []);

  function openEdit() {
    keymapEditButton()?.click();
  }

  function openBackup() {
    keymapBackupButton()?.click();
  }

  const sidebar = menuHost ? createPortal(
    <div className="keymap-nav-submenu" aria-label="Keymap tools">
      <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={openEdit}>
        Edit
      </button>
      <button type="button" className={mode === 'backup' ? 'active' : ''} onClick={openBackup}>
        Backup / Restore
      </button>
    </div>,
    menuHost,
  ) : null;

  const toolbarAction = toolbarHost && mode === 'edit' ? createPortal(
    <button
      type="button"
      className="button secondary keymap-toolbar-backup-button"
      onClick={openBackup}
    >
      Backup / Restore
    </button>,
    toolbarHost,
  ) : null;

  return <>{sidebar}{toolbarAction}</>;
}
