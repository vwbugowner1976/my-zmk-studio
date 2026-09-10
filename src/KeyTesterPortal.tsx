import { useState } from 'react';
import KeyTester from './KeyTester';
import './keyTesterPortal.css';

export default function KeyTesterPortal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`key-tester-launcher ${open ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={open ? 'Close Key Tester' : 'Open Key Tester'}
      >
        ⌨
        <span>Key Tester</span>
      </button>

      {open && (
        <div className="key-tester-overlay" role="dialog" aria-modal="true" aria-label="Key Tester">
          <div className="key-tester-window">
            <div className="key-tester-window-head">
              <div>
                <div className="eyebrow">Keyboard diagnostics</div>
                <h2>Key Tester</h2>
                <p>Checks the actual key events received by Windows / the browser.</p>
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
