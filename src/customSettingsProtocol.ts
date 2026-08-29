export type CustomSettingScalar =
  | { type: 'int32'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'bytes'; value: Uint8Array };

export type CustomSettingValue =
  | CustomSettingScalar
  | { type: 'array'; index: number; size: number; value: CustomSettingScalar };

export type CustomSettingConstraint =
  | { type: 'range'; min: CustomSettingScalar | null; max: CustomSettingScalar | null }
  | { type: 'options'; values: CustomSettingScalar[]; labels: string[] }
  | { type: 'hid'; usagePage: number; usageMin: number; usageMax: number }
  | { type: 'layer' }
  | { type: 'behavior' };

export type CustomSettingMeta = {
  confidentiality: number;
  readPermission: number;
  writePermission: number;
  constraints: CustomSettingConstraint[];
};

export type CustomSettingRecord = {
  customSubsystemIndex: number;
  key: string;
  meta: CustomSettingMeta | null;
  hasUnsavedValue: boolean;
  value: CustomSettingValue | null;
  source: number;
};

export type CustomSettingsStatus = {
  affectedCount: number;
  message: string;
};

export type CustomSettingNotification = {
  kind: number;
  setting: CustomSettingRecord;
};

function encodeVarintNumber(value: number): number[] {
  if (value < 0) {
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
  let v = value >>> 0;
  const out: number[] = [];
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return out;
}

function bytesField(field: number, value: Uint8Array | number[]) {
  const bytes = Array.from(value);
  return [...encodeVarintNumber((field << 3) | 2), ...encodeVarintNumber(bytes.length), ...bytes];
}

function varintField(field: number, value: number, includeZero = false) {
  if (!includeZero && value === 0) return [];
  return [...encodeVarintNumber(field << 3), ...encodeVarintNumber(value)];
}

function stringField(field: number, value: string) {
  return bytesField(field, new TextEncoder().encode(value));
}

function encodeSettingRef(customSubsystemIndex: number, key: string) {
  return [
    ...varintField(1, customSubsystemIndex, true),
    ...stringField(2, key),
  ];
}

function encodeScalarValue(value: CustomSettingScalar) {
  if (value.type === 'bytes') return bytesField(1, value.value);
  if (value.type === 'int32') return varintField(2, value.value, true);
  if (value.type === 'bool') return varintField(3, value.value ? 1 : 0, true);
  return stringField(4, value.value);
}

function encodeSettingValue(value: CustomSettingValue) {
  if (value.type === 'array') {
    const array = [
      ...varintField(1, value.index, true),
      ...varintField(2, value.size, true),
      ...bytesField(3, encodeScalarValue(value.value)),
    ];
    return bytesField(5, array);
  }
  return encodeScalarValue(value);
}

export function encodeListSettingsRequest(requireMeta = true) {
  const inner = [
    ...bytesField(1, []),
    ...varintField(2, requireMeta ? 1 : 0, true),
  ];
  return new Uint8Array(bytesField(1, inner));
}

export function encodeWriteSettingRequest(setting: CustomSettingRecord, value: CustomSettingValue) {
  const inner = [
    ...bytesField(1, encodeSettingRef(setting.customSubsystemIndex, setting.key)),
    ...bytesField(2, encodeSettingValue(value)),
    ...varintField(3, 0, true),
  ];
  return new Uint8Array(bytesField(3, inner));
}

function encodeScope() {
  return bytesField(1, []);
}

export function encodeSaveSettingsRequest() {
  return new Uint8Array(bytesField(4, encodeScope()));
}

export function encodeDiscardSettingsRequest() {
  return new Uint8Array(bytesField(5, encodeScope()));
}

export function encodeResetSettingsRequest() {
  return new Uint8Array(bytesField(6, encodeScope()));
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

function decodeScalar(bytes: Uint8Array): CustomSettingScalar | null {
  const reader = new Reader(bytes);
  let result: CustomSettingScalar | null = null;
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) result = { type: 'bytes', value: reader.bytes() };
    else if (field === 2 && wire === 0) result = { type: 'int32', value: reader.int32() };
    else if (field === 3 && wire === 0) result = { type: 'bool', value: reader.uint32() !== 0 };
    else if (field === 4 && wire === 2) result = { type: 'string', value: reader.string() };
    else reader.skip(wire);
  }
  return result;
}

function decodeSettingValue(bytes: Uint8Array): CustomSettingValue | null {
  const reader = new Reader(bytes);
  let result: CustomSettingValue | null = null;
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field >= 1 && field <= 4) {
      if (field === 1 && wire === 2) result = { type: 'bytes', value: reader.bytes() };
      else if (field === 2 && wire === 0) result = { type: 'int32', value: reader.int32() };
      else if (field === 3 && wire === 0) result = { type: 'bool', value: reader.uint32() !== 0 };
      else if (field === 4 && wire === 2) result = { type: 'string', value: reader.string() };
      else reader.skip(wire);
    } else if (field === 5 && wire === 2) {
      const arrayReader = new Reader(reader.bytes());
      let index = 0;
      let size = 0;
      let value: CustomSettingScalar | null = null;
      while (!arrayReader.done) {
        const arrayTag = arrayReader.uint32();
        const arrayField = arrayTag >>> 3;
        const arrayWire = arrayTag & 7;
        if (arrayField === 1 && arrayWire === 0) index = arrayReader.uint32();
        else if (arrayField === 2 && arrayWire === 0) size = arrayReader.uint32();
        else if (arrayField === 3 && arrayWire === 2) value = decodeScalar(arrayReader.bytes());
        else arrayReader.skip(arrayWire);
      }
      if (value) result = { type: 'array', index, size, value };
    } else reader.skip(wire);
  }
  return result;
}

function decodeRange(bytes: Uint8Array): CustomSettingConstraint {
  const reader = new Reader(bytes);
  let min: CustomSettingScalar | null = null;
  let max: CustomSettingScalar | null = null;
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) min = decodeScalar(reader.bytes());
    else if (field === 2 && wire === 2) max = decodeScalar(reader.bytes());
    else reader.skip(wire);
  }
  return { type: 'range', min, max };
}

function decodeOptions(bytes: Uint8Array): CustomSettingConstraint {
  const reader = new Reader(bytes);
  const values: CustomSettingScalar[] = [];
  const labels: string[] = [];
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const value = decodeScalar(reader.bytes());
      if (value) values.push(value);
    } else if (field === 2 && wire === 2) labels.push(reader.string());
    else reader.skip(wire);
  }
  return { type: 'options', values, labels };
}

function decodeHid(bytes: Uint8Array): CustomSettingConstraint {
  const reader = new Reader(bytes);
  let usagePage = 0;
  let usageMin = 0;
  let usageMax = 0;
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire !== 0) { reader.skip(wire); continue; }
    if (field === 1) usagePage = reader.uint32();
    else if (field === 2) usageMin = reader.uint32();
    else if (field === 3) usageMax = reader.uint32();
    else reader.skip(wire);
  }
  return { type: 'hid', usagePage, usageMin, usageMax };
}

function decodeConstraint(bytes: Uint8Array): CustomSettingConstraint | null {
  const reader = new Reader(bytes);
  let result: CustomSettingConstraint | null = null;
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) result = decodeRange(reader.bytes());
    else if (field === 2 && wire === 2) result = decodeOptions(reader.bytes());
    else if (field === 3 && wire === 2) result = decodeHid(reader.bytes());
    else if (field === 4 && wire === 2) { reader.bytes(); result = { type: 'layer' }; }
    else if (field === 5 && wire === 2) { reader.bytes(); result = { type: 'behavior' }; }
    else reader.skip(wire);
  }
  return result;
}

function decodeMeta(bytes: Uint8Array): CustomSettingMeta {
  const reader = new Reader(bytes);
  const result: CustomSettingMeta = { confidentiality: 0, readPermission: 0, writePermission: 0, constraints: [] };
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) result.confidentiality = reader.uint32();
    else if (field === 2 && wire === 0) result.readPermission = reader.uint32();
    else if (field === 3 && wire === 0) result.writePermission = reader.uint32();
    else if (field === 4 && wire === 2) {
      const constraint = decodeConstraint(reader.bytes());
      if (constraint) result.constraints.push(constraint);
    } else reader.skip(wire);
  }
  return result;
}

function decodeSetting(bytes: Uint8Array): CustomSettingRecord {
  const reader = new Reader(bytes);
  const result: CustomSettingRecord = {
    customSubsystemIndex: 0,
    key: '',
    meta: null,
    hasUnsavedValue: false,
    value: null,
    source: 0,
  };
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) result.customSubsystemIndex = reader.uint32();
    else if (field === 2 && wire === 2) result.key = reader.string();
    else if (field === 3 && wire === 2) result.meta = decodeMeta(reader.bytes());
    else if (field === 8 && wire === 0) result.hasUnsavedValue = reader.uint32() !== 0;
    else if (field === 9 && wire === 2) result.value = decodeSettingValue(reader.bytes());
    else if (field === 10 && wire === 0) result.source = reader.uint32();
    else reader.skip(wire);
  }
  return result;
}

export function decodeCustomSettingsNotification(payload: Uint8Array): CustomSettingNotification | null {
  const reader = new Reader(payload);
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const settingReader = new Reader(reader.bytes());
      let kind = 0;
      let setting: CustomSettingRecord | null = null;
      while (!settingReader.done) {
        const settingTag = settingReader.uint32();
        const settingField = settingTag >>> 3;
        const settingWire = settingTag & 7;
        if (settingField === 1 && settingWire === 0) kind = settingReader.uint32();
        else if (settingField === 2 && settingWire === 2) setting = decodeSetting(settingReader.bytes());
        else settingReader.skip(settingWire);
      }
      return setting ? { kind, setting } : null;
    }
    reader.skip(wire);
  }
  return null;
}

export function decodeCustomSettingsResponse(payload: Uint8Array): CustomSettingsStatus {
  const reader = new Reader(payload);
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const errorReader = new Reader(reader.bytes());
      let message = 'Custom Settings error';
      while (!errorReader.done) {
        const errorTag = errorReader.uint32();
        if ((errorTag >>> 3) === 1 && (errorTag & 7) === 2) message = errorReader.string();
        else errorReader.skip(errorTag & 7);
      }
      throw new Error(message);
    }
    if (field === 2 && wire === 2) {
      const statusReader = new Reader(reader.bytes());
      let affectedCount = 0;
      let message = '';
      while (!statusReader.done) {
        const statusTag = statusReader.uint32();
        const statusField = statusTag >>> 3;
        const statusWire = statusTag & 7;
        if (statusField === 1 && statusWire === 0) affectedCount = statusReader.uint32();
        else if (statusField === 2 && statusWire === 2) message = statusReader.string();
        else statusReader.skip(statusWire);
      }
      return { affectedCount, message };
    }
    reader.skip(wire);
  }
  return { affectedCount: 0, message: '' };
}

export function cloneCustomSettingValue(value: CustomSettingValue | null): CustomSettingValue | null {
  if (!value) return null;
  if (value.type === 'bytes') return { type: 'bytes', value: new Uint8Array(value.value) };
  if (value.type === 'array') return {
    type: 'array',
    index: value.index,
    size: value.size,
    value: value.value.type === 'bytes'
      ? { type: 'bytes', value: new Uint8Array(value.value.value) }
      : { ...value.value },
  };
  return { ...value };
}

export function settingValueText(value: CustomSettingValue | null): string {
  if (!value) return 'Hidden / unavailable';
  if (value.type === 'bytes') return `${value.value.length} bytes`;
  if (value.type === 'array') return `[${value.index + 1}/${value.size}] ${settingValueText(value.value)}`;
  if (value.type === 'bool') return value.value ? 'On' : 'Off';
  return String(value.value);
}
