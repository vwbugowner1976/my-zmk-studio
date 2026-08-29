import { useEffect, useState } from 'react';

const STORAGE_KEY = 'my-zmk-studio-debug-log';
const PREFIX = '[MyZMKStudio] ';
const MAX_LINES = 400;

function loadStoredLines(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((line) => typeof line === 'string') : [];
  } catch {
    return [];
  }
}

export default function DebugConsole() {
  const [lines, setLines] = useState<string[]>(loadStoredLines);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const originalInfo = console.info;

    console.info = (...args: unknown[]) => {
      originalInfo(...args);
      const first = args[0];
      if (typeof first !== 'string' || !first.startsWith(PREFIX)) return;

      const line = first.slice(PREFIX.length);
      setLines((current) => {
        const next = [...current, line].slice(-MAX_LINES);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore storage failures; the in-memory log still works.
        }
        return next;
      });
    };

    return () => {
      console.info = originalInfo;
    };
  }, []);

  async function copyLog() {
    await navigator.clipboard.writeText(lines.join('\n'));
  }

  function clearLog() {
    setLines([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  return (
    <section className={`global-debug-console ${collapsed ? 'collapsed' : ''}`}>
      <div className="global-debug-header">
        <div>
          <strong>Debug Console</strong>
          <span>{lines.length} lines · persists across disconnects</span>
        </div>
        <div className="global-debug-actions">
          <button type="button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? 'Show' : 'Hide'}
          </button>
          <button type="button" onClick={copyLog} disabled={!lines.length}>Copy</button>
          <button type="button" onClick={clearLog} disabled={!lines.length}>Clear Log</button>
        </div>
      </div>
      {!collapsed && <pre>{lines.join('\n') || 'No debug events yet.'}</pre>}
    </section>
  );
}
