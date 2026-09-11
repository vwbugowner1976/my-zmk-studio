import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

function keymapEditButton() {
  return document.querySelector<HTMLButtonElement>('.tool-nav > .nav-item:nth-child(2)');
}

function keymapBackupButton() {
  return document.querySelector<HTMLButtonElement>('.tool-nav > .nav-item:nth-child(3)');
}

function isEditActive() {
  return !!keymapEditButton()?.classList.contains('active');
}

function isBackupActive() {
  return !!keymapBackupButton()?.classList.contains('active');
}

export default function KeymapWorkspacePortal() {
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const sync = () => {
      setMenuHost(document.querySelector<HTMLElement>('.tool-nav'));
      const toolbar = isEditActive()
        ? document.querySelector<HTMLElement>('.layer-viewer .layer-export-actions')
        : null;
      setToolbarHost((current) => current === toolbar ? current : toolbar);
      forceRender((value) => value + 1);
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
      <button type="button" className={isEditActive() ? 'active' : ''} onClick={openEdit}>
        Edit
      </button>
      <button type="button" className={isBackupActive() ? 'active' : ''} onClick={openBackup}>
        Backup / Restore
      </button>
    </div>,
    menuHost,
  ) : null;

  const toolbarAction = toolbarHost ? createPortal(
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
