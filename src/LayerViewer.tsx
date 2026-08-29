import { useEffect, useMemo, useRef, useState } from 'react';
import { call_rpc, type RpcConnection } from '@zmkfirmware/zmk-studio-ts-client';
import type { BehaviorParameterValueDescription } from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import type {
  BehaviorBinding,
  KeyPhysicalAttrs,
  Keymap,
  Layer,
} from '@zmkfirmware/zmk-studio-ts-client/keymap';
import { jsPDF } from 'jspdf';
import type { BehaviorOption } from './useStudioCore';

const UNIT_PX = 58;
const PADDING = 28;
const HEADER = 58;

const KEYBOARD_USAGE: Record<number, string> = {
  40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space',
  45: '-', 46: '=', 47: '[', 48: ']', 49: '\\', 50: '#', 51: ';', 52: "'",
  53: '`', 54: ',', 55: '.', 56: '/', 57: 'Caps Lock',
  70: 'Print Screen', 71: 'Scroll Lock', 72: 'Pause', 73: 'Insert', 74: 'Home',
  75: 'Page Up', 76: 'Delete', 77: 'End', 78: 'Page Down', 79: 'Right', 80: 'Left',
  81: 'Down', 82: 'Up', 83: 'Num Lock', 84: 'KP /', 85: 'KP *', 86: 'KP -',
  87: 'KP +', 88: 'KP Enter', 89: 'KP 1', 90: 'KP 2', 91: 'KP 3', 92: 'KP 4',
  93: 'KP 5', 94: 'KP 6', 95: 'KP 7', 96: 'KP 8', 97: 'KP 9', 98: 'KP 0', 99: 'KP .',
};

const CONSUMER_USAGE: Record<number, string> = {
  0xB5: 'Next', 0xB6: 'Previous', 0xB7: 'Stop', 0xCD: 'Play/Pause',
  0xE2: 'Mute', 0xE9: 'Volume +', 0xEA: 'Volume -',
};

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'layer';
}

function keyboardUsageName(usage: number) {
  if (usage >= 4 && usage <= 29) return String.fromCharCode(65 + usage - 4);
  if (usage >= 30 && usage <= 38) return String(usage - 29);
  if (usage === 39) return '0';
  if (usage >= 58 && usage <= 69) return `F${usage - 57}`;
  return KEYBOARD_USAGE[usage] ?? `Key 0x${usage.toString(16).toUpperCase()}`;
}

function decodeHidUsage(value: number) {
  const modifiers = (value >>> 24) & 0xff;
  const page = (value >>> 16) & 0xff;
  const usage = value & 0xffff;
  const modifierNames = ['Ctrl', 'Shift', 'Alt', 'GUI', 'RCtrl', 'RShift', 'RAlt', 'RGUI'];
  const prefix = modifierNames.filter((_, bit) => modifiers & (1 << bit));

  let key: string;
  if (page === 0x07) key = keyboardUsageName(usage);
  else if (page === 0x0c) key = CONSUMER_USAGE[usage] ?? `Consumer 0x${usage.toString(16).toUpperCase()}`;
  else key = `HID ${page.toString(16).toUpperCase()}:${usage.toString(16).toUpperCase()}`;

  return [...prefix, key].join('+');
}

type ParamLabel = { text: string; kind: 'hid' | 'layer' | 'named' | 'raw' | 'none' };

function describeFromMetadata(value: number, descriptions: BehaviorParameterValueDescription[]): ParamLabel | null {
  for (const description of descriptions) {
    if (description.constant !== undefined && description.constant === value) {
      return { text: description.name || String(value), kind: 'named' };
    }
  }
  for (const description of descriptions) {
    if (description.hidUsage) return { text: decodeHidUsage(value), kind: 'hid' };
  }
  for (const description of descriptions) {
    if (description.range && value >= description.range.min && value <= description.range.max) {
      const label = description.name ? `${description.name}: ${value}` : String(value);
      return { text: label, kind: 'named' };
    }
  }
  for (const description of descriptions) {
    if (description.layerId) return { text: `Layer ${value}`, kind: 'layer' };
  }
  for (const description of descriptions) {
    if (description.nil && value === 0) return { text: '', kind: 'none' };
  }
  return null;
}

function describeParam(option: BehaviorOption | undefined, param: 1 | 2, value: number): ParamLabel {
  if (!option) return value ? { text: String(value), kind: 'raw' } : { text: '', kind: 'none' };
  for (const set of option.metadata) {
    const descriptions = param === 1 ? set.param1 : set.param2;
    const described = describeFromMetadata(value, descriptions);
    if (described) return described;
  }
  return value ? { text: String(value), kind: 'raw' } : { text: '', kind: 'none' };
}

function behaviorLabel(binding: BehaviorBinding | undefined, options: BehaviorOption[] | null) {
  if (!binding) return { title: '—', subtitle: '' };
  const option = options?.find((item) => item.id === binding.behaviorId);
  const name = option?.displayName || `Behavior #${binding.behaviorId}`;
  const p1 = describeParam(option, 1, binding.param1);
  const p2 = describeParam(option, 2, binding.param2);

  if (/transparent/i.test(name)) return { title: '▽', subtitle: 'Transparent' };
  if (/none|disabled/i.test(name)) return { title: '—', subtitle: name };

  if (p1.kind === 'hid' && !p2.text && /key press|keypress/i.test(name)) {
    return { title: p1.text, subtitle: name };
  }

  const args = [p1.text, p2.text].filter(Boolean).join(' · ');
  return { title: name, subtitle: args };
}

function geometry(keys: KeyPhysicalAttrs[]) {
  const u = (value: number) => value / 100;
  const maxX = Math.max(...keys.map((key) => u(key.x) + u(key.width)));
  const maxY = Math.max(...keys.map((key) => u(key.y) + u(key.height)));
  return {
    width: Math.ceil(maxX * UNIT_PX + PADDING * 2),
    height: Math.ceil(maxY * UNIT_PX + PADDING * 2 + HEADER),
    u,
  };
}

function shorten(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function LayerSvg({
  layer,
  layerIndex,
  keys,
  behaviorOptions,
  svgRef,
}: {
  layer: Layer;
  layerIndex: number;
  keys: KeyPhysicalAttrs[];
  behaviorOptions: BehaviorOption[] | null;
  svgRef?: React.Ref<SVGSVGElement>;
}) {
  const g = geometry(keys);
  return (
    <svg
      ref={svgRef}
      className="layer-svg"
      viewBox={`0 0 ${g.width} ${g.height}`}
      width={g.width}
      height={g.height}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="100%" height="100%" fill="#0b1220" />
      <text x={PADDING} y={31} fill="#f8fafc" fontSize="20" fontWeight="700">
        Layer {layerIndex}: {layer.name || `Layer ${layerIndex}`}
      </text>
      <text x={PADDING} y={49} fill="#94a3b8" fontSize="11">
        My ZMK Studio · read from firmware
      </text>
      {keys.map((key, position) => {
        const x = PADDING + g.u(key.x) * UNIT_PX;
        const y = PADDING + HEADER + g.u(key.y) * UNIT_PX;
        const width = Math.max(32, g.u(key.width) * UNIT_PX - 4);
        const height = Math.max(32, g.u(key.height) * UNIT_PX - 4);
        const rx = PADDING + g.u(key.rx) * UNIT_PX;
        const ry = PADDING + HEADER + g.u(key.ry) * UNIT_PX;
        const label = behaviorLabel(layer.bindings[position], behaviorOptions);
        const title = shorten(label.title, width < 50 ? 8 : 13);
        const subtitle = shorten(label.subtitle, width < 50 ? 10 : 18);
        const transform = key.r ? `rotate(${key.r} ${rx} ${ry})` : undefined;
        return (
          <g key={position} transform={transform}>
            <rect x={x} y={y} width={width} height={height} rx="7" fill="#1e293b" stroke="#475569" strokeWidth="1" />
            <text x={x + width / 2} y={y + height / 2 - (subtitle ? 4 : -3)} textAnchor="middle" fill="#f8fafc" fontSize="11" fontWeight="700">
              {title}
            </text>
            {subtitle && (
              <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle" fill="#93c5fd" fontSize="7.5">
                {subtitle}
              </text>
            )}
            <text x={x + 5} y={y + 11} fill="#64748b" fontSize="7">{position}</text>
          </g>
        );
      })}
    </svg>
  );
}

async function svgToPng(svg: SVGSVGElement, scale = 2) {
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to render layer SVG.'));
    });
    image.src = url;
    await loaded;
    const width = Number(svg.getAttribute('width')) || svg.viewBox.baseVal.width;
    const height = Number(svg.getAttribute('height')) || svg.viewBox.baseVal.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function LayerViewer({
  connection,
  physicalKeys,
  behaviorOptions,
  onDebug,
}: {
  connection: RpcConnection;
  physicalKeys: KeyPhysicalAttrs[] | null;
  behaviorOptions: BehaviorOption[] | null;
  onDebug: (event: string, detail?: unknown) => void;
}) {
  const [keymap, setKeymap] = useState<Keymap | null>(null);
  const [activeLayer, setActiveLayer] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentSvgRef = useRef<SVGSVGElement | null>(null);

  const layer = keymap?.layers[activeLayer] ?? null;
  const behaviorMapReady = useMemo(() => behaviorOptions !== null, [behaviorOptions]);

  async function loadKeymap() {
    setLoading(true);
    setError(null);
    onDebug('RPC -> keymap.getKeymap');
    try {
      const response = await call_rpc(connection, { keymap: { getKeymap: true } });
      const next = response.keymap?.getKeymap;
      if (!next) throw new Error('Firmware returned no keymap.');
      setKeymap(next);
      setActiveLayer((current) => Math.min(current, Math.max(0, next.layers.length - 1)));
      onDebug('Keymap loaded', {
        layers: next.layers.length,
        availableLayers: next.availableLayers,
        bindings: next.layers.map((item) => item.bindings.length),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      onDebug('Keymap load failed', message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKeymap();
  }, [connection]);

  async function exportCurrentPng() {
    if (!layer || !currentSvgRef.current) return;
    setExporting(true);
    try {
      const png = await svgToPng(currentSvgRef.current, 2.5);
      downloadDataUrl(png, `layer-${activeLayer}-${safeName(layer.name)}.png`);
      onDebug('Layer PNG exported', { layer: activeLayer, name: layer.name });
    } finally {
      setExporting(false);
    }
  }

  async function renderLayerPng(targetLayer: Layer, index: number) {
    if (!physicalKeys?.length) throw new Error('Physical layout is unavailable.');
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    document.body.appendChild(host);
    try {
      const { createRoot } = await import('react-dom/client');
      const root = createRoot(host);
      await new Promise<void>((resolve) => {
        root.render(
          <LayerSvg
            layer={targetLayer}
            layerIndex={index}
            keys={physicalKeys}
            behaviorOptions={behaviorOptions}
          />,
        );
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const svg = host.querySelector('svg');
      if (!svg) throw new Error('Layer render failed.');
      const png = await svgToPng(svg, 2.2);
      root.unmount();
      return png;
    } finally {
      host.remove();
    }
  }

  async function exportAllPng() {
    if (!keymap) return;
    setExporting(true);
    onDebug('All layer PNG export started', { count: keymap.layers.length });
    try {
      for (let index = 0; index < keymap.layers.length; index += 1) {
        const item = keymap.layers[index];
        const png = await renderLayerPng(item, index);
        downloadDataUrl(png, `layer-${index}-${safeName(item.name)}.png`);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      onDebug('All layer PNG export complete', { count: keymap.layers.length });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      onDebug('All layer PNG export failed', message);
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    if (!keymap) return;
    setExporting(true);
    onDebug('Layer PDF export started', { count: keymap.layers.length });
    try {
      let pdf: jsPDF | null = null;
      for (let index = 0; index < keymap.layers.length; index += 1) {
        const item = keymap.layers[index];
        const png = await renderLayerPng(item, index);
        const image = new Image();
        const loaded = new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('PDF image render failed.'));
        });
        image.src = png;
        await loaded;
        const landscape = image.width >= image.height;
        if (!pdf) {
          pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
        } else {
          pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
        }
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margin = 28;
        const ratio = Math.min((pageW - margin * 2) / image.width, (pageH - margin * 2) / image.height);
        const w = image.width * ratio;
        const h = image.height * ratio;
        pdf.addImage(png, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h, undefined, 'FAST');
      }
      pdf?.save('my-zmk-studio-keymap.pdf');
      onDebug('Layer PDF export complete', { count: keymap.layers.length });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      onDebug('Layer PDF export failed', message);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="panel empty"><div><h3>Reading keymap…</h3><p>Loading layers and bindings from firmware.</p></div></div>;
  }

  if (error && !keymap) {
    return <div className="panel empty"><div><h3>Layer Viewer unavailable</h3><p>{error}</p><button className="button" onClick={loadKeymap}>Retry</button></div></div>;
  }

  if (!keymap || !physicalKeys?.length || !layer) {
    return <div className="panel empty"><div><h3>No layer data</h3><p>Keymap or physical layout was not returned by this firmware.</p></div></div>;
  }

  return (
    <div className="layer-viewer">
      <section className="panel layer-toolbar">
        <div>
          <h3>Layer Viewer</h3>
          <p>{keymap.layers.length} layer(s) · {physicalKeys.length} physical key(s) · read only</p>
        </div>
        <div className="layer-export-actions">
          <button className="button secondary" onClick={loadKeymap} disabled={loading || exporting}>Refresh</button>
          <button className="button secondary" onClick={exportCurrentPng} disabled={exporting}>PNG</button>
          <button className="button secondary" onClick={exportAllPng} disabled={exporting}>All PNG</button>
          <button className="button" onClick={exportPdf} disabled={exporting}>PDF</button>
        </div>
      </section>

      {error && <div className="notice">{error}</div>}
      {!behaviorMapReady && <div className="notice">Behavior metadata is still loading; raw values will be used temporarily.</div>}

      <div className="layer-tabs" role="tablist">
        {keymap.layers.map((item, index) => (
          <button
            key={item.id}
            className={`layer-tab ${activeLayer === index ? 'active' : ''}`}
            onClick={() => setActiveLayer(index)}
          >
            <strong>{index}</strong>
            <span>{item.name || `Layer ${index}`}</span>
          </button>
        ))}
      </div>

      <section className="panel layer-canvas-panel">
        <div className="layer-canvas-scroll">
          <LayerSvg
            layer={layer}
            layerIndex={activeLayer}
            keys={physicalKeys}
            behaviorOptions={behaviorOptions}
            svgRef={currentSvgRef}
          />
        </div>
      </section>
    </div>
  );
}
