import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function TopbarToolTitle() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [title, setTitle] = useState('');

  useEffect(() => {
    function sync() {
      const topbar = document.querySelector<HTMLElement>('.topbar');
      const contentHeader = document.querySelector<HTMLElement>('.content-header');
      const overlayTitle = document.querySelector<HTMLElement>('.key-tester-overlay h2, .ble-management-overlay h2');
      const contentTitle = contentHeader?.querySelector<HTMLElement>('h2');
      const nextTitle = (overlayTitle?.textContent || contentTitle?.textContent || '').trim();

      setHost(topbar);
      setTitle(nextTitle);
      if (contentHeader && contentTitle) contentHeader.classList.add('title-moved-to-topbar');
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (!host || !title) return null;
  return createPortal(
    <div className="topbar-tool-title" aria-live="polite">
      <span>／</span>
      <strong>{title}</strong>
    </div>,
    host,
  );
}
