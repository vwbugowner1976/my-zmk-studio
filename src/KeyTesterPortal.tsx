import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import KeyTester from './KeyTester';
import { useLanguage } from './i18n';
import './keyTesterPortal.css';

export default function KeyTesterPortal() {
  const { isJapanese, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const findMenu = () => {
      setMenuHost(document.querySelector<HTMLElement>('.tool-nav'));
    };

    findMenu();
    const observer = new MutationObserver(findMenu);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return (
    <>
      {menuHost && createPortal(
        <button
          type="button"
          className={`nav-item key-tester-menu-item ${open ? 'active' : ''}`}
          onClick={() => setOpen((value) => !value)}
          title={open
            ? (isJapanese ? 'キーテスターを閉じる' : 'Close Key Tester')
            : (isJapanese ? 'キーテスターを開く' : 'Open Key Tester')}
        >
          <span aria-hidden="true">⌨</span>
          <span>{t('keyTester')}</span>
        </button>,
        menuHost,
      )}

      {open && (
        <div className="key-tester-overlay" role="dialog" aria-modal="true" aria-label={t('keyTester')}>
          <div className="key-tester-window">
            <div className="key-tester-window-head">
              <div>
                <div className="eyebrow">{isJapanese ? 'キーボード診断' : 'Keyboard diagnostics'}</div>
                <h2>{t('keyTester')}</h2>
                <p>{isJapanese
                  ? '実際のHID入力と、ZMK Studioから取得した実機レイアウトを確認します。'
                  : "Test actual HID input, or use the keyboard's real physical layout from ZMK Studio."}</p>
              </div>
              <button className="button secondary" type="button" onClick={() => setOpen(false)}>{isJapanese ? '閉じる' : 'Close'}</button>
            </div>
            <KeyTester />
          </div>
        </div>
      )}
    </>
  );
}
