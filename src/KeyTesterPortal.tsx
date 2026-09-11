import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import KeyTester from './KeyTester';
import './keyTesterPortal.css';

export default function KeyTesterPortal() {
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
          title={open ? 'Close Key Tester' : 'Open Key Tester'}
        >
          <span aria-hidden="true">⌨</span>
          <span>Key Tester</span>
        </button>,
        menuHost,
      )}

      {open && (
        <div className="key-tester-overlay" role="dialog" aria-modal="true" aria-label="Key Tester">
          <div className="key-tester-window">
            <div className="key-tester-window-head">
              <div>
                <div className="eyebrow">Keyboard diagnostics</div>
                <h2>Key Tester</h2>
                <p>Test actual HID input, or load the keyboard's real physical layout from ZMK Studio.</p>
              </div>
              <button className="button secondary" type="button" onClick={() => setOpen(false)}>Close</button>
            </div>
            <KeyTester />
          </div>
        </div>
      )}
    </>
  );
}
