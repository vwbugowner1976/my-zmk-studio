export type RuntimeInputProcessorRecord = {
  id: number;
  name: string;
  scaleMultiplier: number;
  scaleDivisor: number;
  rotationDegrees: number;
  xyToScrollEnabled: boolean;
  xySwapEnabled: boolean;
  xInvert: boolean;
  yInvert: boolean;
};

function encodeVarint(value: number): number[] {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return out;
}

function varintField(field: number, value: number, includeZero = true) {
  if (!includeZero && value === 0) return [];
  return [...encodeVarint(field << 3), ...encodeVarint(value)];
}

function bytesField(field: number, value: number[]) {
  return [...encodeVarint((field << 3) | 2), ...encodeVarint(value.length), ...value];
}

export function encodeListInputProcessorsRequest() {
  return Uint8Array.from(bytesField(1, []));
}

export function encodeSetScaleMultiplierRequest(id: number, value: number) {
  return Uint8Array.from(bytesField(3, [
    ...varintField(1, id),
    ...varintField(2, value),
  ]));
}

export function encodeSetScaleDivisorRequest(id: number, value: number) {
  return Uint8Array.from(bytesField(4, [
    ...varintField(1, id),
    ...varintField(2, value),
  ]));
}

class Reader {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}
  get done() { return this.pos >= this.data.length; }

  varintBig(): bigint {
    let value = 0n;
    let shift = 0n;
    while (this.pos < this.data.length) {
      const byte = this.data[this.pos++];
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
      if (shift > 70n) throw new Error('Invalid protobuf varint');
    }
    throw new Error('Unexpected end of protobuf varint');
  }

  uint32() { return Number(this.varintBig() & 0xffffffffn) >>> 0; }
  int32() { return Number(BigInt.asIntN(32, this.varintBig())); }

  bytes() {
    const length = this.uint32();
    const end = this.pos + length;
    if (end > this.data.length) throw new Error('Invalid protobuf length');
    const value = this.data.subarray(this.pos, end);
    this.pos = end;
    return value;
  }

  string() { return new TextDecoder().decode(this.bytes()); }

  skip(wire: number) {
    if (wire === 0) { this.varintBig(); return; }
    if (wire === 2) { this.bytes(); return; }
    throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
}

function decodeProcessor(bytes: Uint8Array): RuntimeInputProcessorRecord {
  const reader = new Reader(bytes);
  const result: RuntimeInputProcessorRecord = {
    id: 0,
    name: '',
    scaleMultiplier: 1,
    scaleDivisor: 1,
    rotationDegrees: 0,
    xyToScrollEnabled: false,
    xySwapEnabled: false,
    xInvert: false,
    yInvert: false,
  };

  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) result.id = reader.uint32();
    else if (field === 2 && wire === 2) result.name = reader.string();
    else if (field === 3 && wire === 0) result.scaleMultiplier = reader.uint32();
    else if (field === 4 && wire === 0) result.scaleDivisor = reader.uint32();
    else if (field === 5 && wire === 0) result.rotationDegrees = reader.int32();
    else if (field === 14 && wire === 0) result.xyToScrollEnabled = reader.uint32() !== 0;
    else if (field === 15 && wire === 0) result.xySwapEnabled = reader.uint32() !== 0;
    else if (field === 16 && wire === 0) result.xInvert = reader.uint32() !== 0;
    else if (field === 17 && wire === 0) result.yInvert = reader.uint32() !== 0;
    else reader.skip(wire);
  }
  return result;
}

export function decodeRuntimeInputNotification(payload: Uint8Array): RuntimeInputProcessorRecord | null {
  const reader = new Reader(payload);
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const changed = new Reader(reader.bytes());
      while (!changed.done) {
        const changedTag = changed.uint32();
        const changedField = changedTag >>> 3;
        const changedWire = changedTag & 7;
        if (changedField === 1 && changedWire === 2) return decodeProcessor(changed.bytes());
        changed.skip(changedWire);
      }
      return null;
    }
    reader.skip(wire);
  }
  return null;
}

export function assertRuntimeInputResponse(payload: Uint8Array) {
  const reader = new Reader(payload);
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const errorReader = new Reader(reader.bytes());
      let message = 'Runtime Input Processor RPC error';
      while (!errorReader.done) {
        const errorTag = errorReader.uint32();
        const errorField = errorTag >>> 3;
        const errorWire = errorTag & 7;
        if (errorField === 1 && errorWire === 2) message = errorReader.string();
        else errorReader.skip(errorWire);
      }
      throw new Error(message);
    }
    reader.skip(wire);
  }
}
