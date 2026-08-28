export type RuntimeComboRecord = {
  index: number;
  name: string;
  keyPositions: number[];
  behaviorId: number;
  param1: number;
  param2: number;
  layerMask: number;
  enabled: boolean;
  timeoutMs: number;
  requirePriorIdleMs: number;
  slowReleaseOverride: number;
  source: number;
};

export const encodeListCombosRequest = () => new Uint8Array([0x0a, 0x00]);

class Reader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get done() { return this.pos >= this.bytes.length; }
  uint32(): number {
    let value = 0;
    let shift = 0;
    while (this.pos < this.bytes.length) {
      const byte = this.bytes[this.pos++];
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value >>> 0;
      shift += 7;
      if (shift > 35) throw new Error('Invalid protobuf varint');
    }
    throw new Error('Unexpected end of protobuf varint');
  }
  bytesValue(): Uint8Array {
    const length = this.uint32();
    const end = this.pos + length;
    if (end > this.bytes.length) throw new Error('Invalid protobuf length');
    const value = this.bytes.subarray(this.pos, end);
    this.pos = end;
    return value;
  }
  string(): string { return new TextDecoder().decode(this.bytesValue()); }
  skip(wireType: number) {
    if (wireType === 0) { this.uint32(); return; }
    if (wireType === 2) { this.bytesValue(); return; }
    if (wireType === 5) { this.pos += 4; return; }
    if (wireType === 1) { this.pos += 8; return; }
    throw new Error(`Unsupported protobuf wire type ${wireType}`);
  }
}

function decodeBehavior(bytes: Uint8Array) {
  const reader = new Reader(bytes);
  const result = { behaviorId: 0, param1: 0, param2: 0 };
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1) result.behaviorId = reader.uint32();
    else if (field === 2) result.param1 = reader.uint32();
    else if (field === 3) result.param2 = reader.uint32();
    else reader.skip(wire);
  }
  return result;
}

function decodePackedUint32(bytes: Uint8Array): number[] {
  const reader = new Reader(bytes);
  const values: number[] = [];
  while (!reader.done) values.push(reader.uint32());
  return values;
}

function decodeCombo(bytes: Uint8Array): RuntimeComboRecord {
  const reader = new Reader(bytes);
  const combo: RuntimeComboRecord = {
    index: 0,
    name: '',
    keyPositions: [],
    behaviorId: 0,
    param1: 0,
    param2: 0,
    layerMask: 0,
    enabled: false,
    timeoutMs: 0,
    requirePriorIdleMs: 0,
    slowReleaseOverride: 0,
    source: 0,
  };

  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: combo.index = reader.uint32(); break;
      case 2: combo.name = reader.string(); break;
      case 3:
        if (wire === 2) combo.keyPositions.push(...decodePackedUint32(reader.bytesValue()));
        else combo.keyPositions.push(reader.uint32());
        break;
      case 4: {
        const behavior = decodeBehavior(reader.bytesValue());
        combo.behaviorId = behavior.behaviorId;
        combo.param1 = behavior.param1;
        combo.param2 = behavior.param2;
        break;
      }
      case 6: combo.layerMask = reader.uint32(); break;
      case 8: combo.enabled = reader.uint32() !== 0; break;
      case 9: combo.timeoutMs = reader.uint32(); break;
      case 10: combo.requirePriorIdleMs = reader.uint32(); break;
      case 11: combo.slowReleaseOverride = reader.uint32(); break;
      case 12: combo.source = reader.uint32(); break;
      default: reader.skip(wire); break;
    }
  }
  return combo;
}

function decodeListCombosResponse(bytes: Uint8Array): RuntimeComboRecord[] {
  const reader = new Reader(bytes);
  const combos: RuntimeComboRecord[] = [];
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) combos.push(decodeCombo(reader.bytesValue()));
    else reader.skip(wire);
  }
  return combos;
}

export function decodeRuntimeComboResponse(bytes: Uint8Array): RuntimeComboRecord[] {
  const reader = new Reader(bytes);
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const errorReader = new Reader(reader.bytesValue());
      let message = 'Runtime Combo RPC error';
      while (!errorReader.done) {
        const errorTag = errorReader.uint32();
        const errorField = errorTag >>> 3;
        const errorWire = errorTag & 7;
        if (errorField === 1 && errorWire === 2) message = errorReader.string();
        else errorReader.skip(errorWire);
      }
      throw new Error(message);
    }
    if (field === 2 && wire === 2) return decodeListCombosResponse(reader.bytesValue());
    reader.skip(wire);
  }
  return [];
}
