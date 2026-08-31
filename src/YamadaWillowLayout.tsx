export type MatrixPosition = {
  row: number;
  col: number;
};

type SourceKey = {
  id: string;
  matrix: MatrixPosition;
};

type EncoderBinding = {
  id: string;
  ccw: MatrixPosition;
  cw: MatrixPosition;
};

export const YAMADA_WILLOW_PROFILE = {
  name: 'Yamada Willow',
  vendorId: 0xfeed,
  productId: 0x1519,
  matrix: { rows: 10, cols: 10 },
  expectedLayers: 4,
} as const;

const KEY_MATRIX: Record<string, MatrixPosition> = {
  k01: { row: 1, col: 0 },
  k02: { row: 2, col: 0 },
  k03: { row: 3, col: 0 },
  k04: { row: 4, col: 0 },
  k05: { row: 5, col: 0 },
  k06: { row: 6, col: 0 },
  k07: { row: 7, col: 0 },
  k08: { row: 8, col: 0 },
  k09: { row: 9, col: 0 },
  k10: { row: 0, col: 1 },
  k11: { row: 2, col: 1 },
  k12: { row: 3, col: 1 },
  k13: { row: 4, col: 1 },
  k14: { row: 5, col: 1 },
  k15: { row: 6, col: 1 },
  k16: { row: 7, col: 1 },
  k17: { row: 8, col: 1 },
  k18: { row: 9, col: 1 },
  k19: { row: 0, col: 2 },
  k20: { row: 1, col: 2 },
  k21: { row: 3, col: 2 },
  k22: { row: 4, col: 2 },
  k23: { row: 5, col: 2 },
  k24: { row: 6, col: 2 },
  k25: { row: 7, col: 2 },
  k26: { row: 8, col: 2 },
  k27: { row: 9, col: 2 },
  k28: { row: 0, col: 3 },
  k29: { row: 1, col: 3 },
  k30: { row: 2, col: 3 },
  k31: { row: 4, col: 3 },
  k32: { row: 5, col: 3 },
  k33: { row: 6, col: 3 },
  k34: { row: 7, col: 3 },
  k35: { row: 8, col: 3 },
  k36: { row: 9, col: 3 },
  k37: { row: 0, col: 4 },
  k38: { row: 1, col: 4 },
  k39: { row: 2, col: 4 },
  k40: { row: 3, col: 4 },
  k41: { row: 5, col: 4 },
  k42: { row: 6, col: 4 },
  k43: { row: 7, col: 4 },
  k44: { row: 8, col: 4 },
  k45: { row: 9, col: 4 },
  k46: { row: 0, col: 5 },
  k47: { row: 1, col: 5 },
  k48: { row: 2, col: 5 },
  k49: { row: 3, col: 5 },
  k50: { row: 4, col: 5 },
  k51: { row: 6, col: 5 },
  k52: { row: 7, col: 5 },
  k53: { row: 8, col: 5 },
  k54: { row: 9, col: 5 },
  k55: { row: 0, col: 6 },
  k56: { row: 1, col: 6 },
  k57: { row: 2, col: 6 },
  k58: { row: 3, col: 6 },
  k59: { row: 4, col: 6 },
  k60: { row: 5, col: 6 },
  k61: { row: 7, col: 6 },
  k62: { row: 8, col: 6 },
  k63: { row: 9, col: 6 },
  k64: { row: 0, col: 7 },
  k65: { row: 1, col: 7 },
  k66: { row: 2, col: 7 },
  k67: { row: 3, col: 7 },
  k68: { row: 4, col: 7 },
  k69: { row: 5, col: 7 },
  k70: { row: 6, col: 7 },
  k71: { row: 8, col: 7 },
  k72: { row: 0, col: 8 },
  k73: { row: 1, col: 8 },
  k74: { row: 0, col: 9 },
};

const sourceKey = (id: string): SourceKey => ({ id, matrix: KEY_MATRIX[id] });
const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => sourceKey(`k${String(start + index).padStart(2, '0')}`));

const MAIN_ROWS: SourceKey[][] = [
  range(1, 12),
  range(13, 24),
  range(25, 36),
  range(37, 50),
  range(51, 58),
];

const AMBI_ROWS: SourceKey[][] = [
  ['k59', 'k62', 'k66'].map(sourceKey),
  ['k60', 'k63', 'k67', 'k70'].map(sourceKey),
  ['k61', 'k64', 'k68', 'k71'].map(sourceKey),
  ['k65', 'k69'].map(sourceKey),
];

const ENCODERS: EncoderBinding[] = [
  { id: 'Encoder 1', ccw: { row: 1, col: 9 }, cw: { row: 2, col: 9 } },
  { id: 'Encoder 2', ccw: { row: 3, col: 9 }, cw: { row: 4, col: 9 } },
  { id: 'Encoder 3', ccw: { row: 5, col: 9 }, cw: { row: 6, col: 9 } },
];

export function isYamadaWillowDevice(vendorId: number, productId: number) {
  return vendorId === YAMADA_WILLOW_PROFILE.vendorId && productId === YAMADA_WILLOW_PROFILE.productId;
}

type Props = {
  keymap: number[];
  keycodeLabel: (value: number) => string;
  hex4: (value: number) => string;
};

export default function YamadaWillowLayout({ keymap, keycodeLabel, hex4 }: Props) {
  const cols = YAMADA_WILLOW_PROFILE.matrix.cols;
  const valueAt = ({ row, col }: MatrixPosition) => keymap[row * cols + col] ?? 0;

  const renderKey = (key: SourceKey) => {
    const value = valueAt(key.matrix);
    return (
      <div className={`qmk-source-key ${value === 0 ? 'empty' : ''}`} key={key.id}>
        <small>{key.id} · r{key.matrix.row}c{key.matrix.col}</small>
        <strong>{keycodeLabel(value)}</strong>
        <code>{hex4(value)}</code>
      </div>
    );
  };

  return (
    <div className="qmk-source-layout">
      <div className="qmk-source-note">
        Source-order view reconstructed from the keyboard's QMK <code>LAYOUT</code> macro. The matrix mapping is exact; the center-cluster spacing is schematic because the supplied source does not contain full key geometry.
      </div>

      <div className="qmk-source-section">
        <h5>Willow key rows</h5>
        <div className="qmk-source-scroll">
          {MAIN_ROWS.map((row, index) => (
            <div className="qmk-source-row" key={`main-${index}`}>{row.map(renderKey)}</div>
          ))}
        </div>
      </div>

      <div className="qmk-source-lower">
        <div className="qmk-source-section">
          <h5>Ambi cluster · source order</h5>
          <div className="qmk-ambi-cluster">
            {AMBI_ROWS.map((row, index) => (
              <div className="qmk-source-row compact" key={`ambi-${index}`}>{row.map(renderKey)}</div>
            ))}
          </div>
        </div>

        <div className="qmk-source-section">
          <h5>Bottom keys & encoder bindings</h5>
          <div className="qmk-encoder-row">
            {renderKey(sourceKey('k72'))}
            {ENCODERS.map((encoder, index) => {
              const ccw = valueAt(encoder.ccw);
              const cw = valueAt(encoder.cw);
              const trailingKey = index === 0 ? 'k73' : index === 1 ? 'k74' : null;
              return (
                <div className="qmk-encoder-group" key={encoder.id}>
                  <div className="qmk-encoder-card">
                    <strong>{encoder.id}</strong>
                    <span><small>CCW r{encoder.ccw.row}c{encoder.ccw.col}</small><b>{keycodeLabel(ccw)}</b><code>{hex4(ccw)}</code></span>
                    <span><small>CW r{encoder.cw.row}c{encoder.cw.col}</small><b>{keycodeLabel(cw)}</b><code>{hex4(cw)}</code></span>
                  </div>
                  {trailingKey && renderKey(sourceKey(trailingKey))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
