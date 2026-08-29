import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'my-zmk-studio-debug-log';
const POSITION_KEY = 'my-zmk-studio-debug-position';
const PREFIX = '[MyZMKStudio] ';
const MAX_LINES = 400;

type Position = { x: number; y: number };

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

function loadStoredPosition(): Position | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Position>;
    return typeof parsed.x === 'number' && typeof parsed.y === 'number'
      ? { x: parsed.x, y: parsed.y }
      : null;
  } catch {
    return null;
  }
}

function clampPosition(position: Position, element: HTMLElement | null): Position {
  if (!element) return position;
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - element.offsetWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - element.offsetHeight - margin);
  return {
    x: Math.min(Math.max(margin, position.x), maxX),
    y: Math.min(Math.max(margin, position.y), maxY),
  };
}

export default function DebugConsole() {
  const [lines, setLines] = useState<string[]>(loadStoredLines);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState<Position | null>(loadStoredPosition);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

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

  useEffect(() => {
    if (!position) return;
    const handleResize = () => {
      setPosition((current) => current ? clampPosition(current, panelRef.current) : current);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const clamped = clampPosition(position, panelRef.current);
    if (clamped.x !== position.x || clamped.y !== position.y) {
      setPosition(clamped);
      return;
    }
    try {
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
      // Ignore storage failures.
    }
  }, [position, collapsed]);

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

  function resetPosition() {
    setPosition(null);
    try {
      window.localStorage.removeItem(POSITION_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const current = position ?? { x: rect.left, y: rect.top };
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - current.x,
      offsetY: event.clientY - current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!position) setPosition(current);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(clampPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    }, panelRef.current));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
  }

  const positionedStyle = position
    ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' }
    : undefined;

  return (
    <section
      ref={panelRef}
      className={`global-debug-console ${collapsed ? 'collapsed' : ''} ${position ? 'moved' : ''}`}
      style={positionedStyle}
    >
      <div
        className="global-debug-header draggable"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div>
          <strong>Debug Console</strong>
          <span>{lines.length} lines · drag this header to move</span>
        </div>
        <div className="global-debug-actions">
          <button type="button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? 'Show' : 'Hide'}
          </button>
          <button type="button" onClick={resetPosition} disabled={!position}>Reset Position</button>
          <button type="button" onClick={copyLog} disabled={!lines.length}>Copy</button>
          <button type="button" onClick={clearLog} disabled={!lines.length}>Clear Log</button>
        </div>
      </div>
      {!collapsed && <pre>{lines.join('\n') || 'No debug events yet.'}</pre>}
    </section>
  );
}
