import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import KeyTester from './KeyTester';
import { useLanguage } from './i18n';
import './keyTesterPortal.css';

const TOOL_EVENT = 'mykeebstudio-active-tool';

function nativeToolTitle() {
  const active = document.querySelector<HTMLElement>('.tool-nav .nav-item.active');
  const text = (active?.textContent ?? '').trim();
  if (/Layer Viewer|Keymap|レイヤービューア|キーマップ/i.test(text)) return 'Keymap';
  return text || 'Runtime Combo';
}

export default function KeyTesterPortal() {
  const { isJapanese, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace');
    if (!workspace) return undefined;

    const syncHosts = () => {
      setMenuHost(document.querySelector<HTMLElement>('.tool-nav'));
      setContentHost(document.querySelector<HTMLElement>('.content'));
    };

    syncHosts();
    const observer = new MutationObserver(syncHosts);
    observer.observe(workspace, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!contentHost) return;
    contentHost.classList.toggle('external-tool-active', open);
    return () => contentHost.classList.remove('external-tool-active');
  }, [contentHost, open]);

  useEffect(() => {
    const onToolEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id && detail.id !== 'key-tester') setOpen(false);
    };
    const onDocumentClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('.tool-nav .nav-item');
      if (!button || button.classList.contains('key-tester-menu-item')) return;
      setOpen(false);
    };
    window.addEventListener(TOOL_EVENT, onToolEvent);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      window.removeEventListener(TOOL_EVENT, onToolEvent);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, []);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      window.dispatchEvent(new CustomEvent(TOOL_EVENT, {
        detail: next
          ? { id: 'key-tester', title: t('keyTester') }
          : { id: 'native', title: nativeToolTitle() },
      }));
      return next;
    });
  }

  return (
    <>
      {menuHost && createPortal(
        <button
          type="button"
          className={`nav-item key-tester-menu-item ${open ? 'active' : ''}`}
          onClick={toggle}
          title={isJapanese ? 'キーテスター' : 'Key Tester'}
        >
          <span aria-hidden="true">⌨</span>
          <span>{t('keyTester')}</span>
        </button>,
        menuHost,
      )}

      {open && contentHost && createPortal(
        <div className="embedded-tool-page key-tester-main-page">
          <KeyTester />
        </div>,
        contentHost,
      )}
    </>
  );
}
