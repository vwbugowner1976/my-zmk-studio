export type BleManagementStatus = {
  activeProfile: number;
  profileCount: number;
  bondedMask: number;
  connectedMask: number;
  openMask: number;
};

export type BleManagementCommandResult = {
  status: number;
  state: BleManagementStatus;
};

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v) byte |= 0x80;
    bytes.push(byte);
  } while (v);
  return bytes;
}

function fieldVarint(field: number, value: number, includeZero = false): number[] {
  if (!includeZero && value === 0) return [];
  return [...encodeVarint(field << 3), ...encodeVarint(value)];
}

function fieldBytes(field: number, bytes: number[] | Uint8Array): number[] {
  const value = Array.from(bytes);
  return [...encodeVarint((field << 3) | 2), ...encodeVarint(value.length), ...value];
}

function messageWithIndex(field: number, index: number) {
  return new Uint8Array(fieldBytes(field, fieldVarint(1, index, true)));
}

export const encodeBleGetStatusRequest = () => new Uint8Array([0x0a, 0x00]);
export const encodeBleSelectProfileRequest = (index: number) => messageWithIndex(2, index);
export const encodeBleClearProfileRequest = (index: number) => messageWithIndex(3, index);
export const encodeBleDisconnectProfileRequest = (index: number) => messageWithIndex(4, index);
export const encodeBleClearAllRequest = () => new Uint8Array([0x2a, 0x00]);

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

  sint32(): number {
    const value = this.uint32();
    return (value >>> 1) ^ -(value & 1);
  }

  bytesValue(): Uint8Array {
    const length = this.uint32();
    const end = this.pos + length;
    if (end > this.bytes.length) throw new Error('Invalid protobuf length');
    const value = this.bytes.subarray(this.pos, end);
    this.pos = end;
    return value;
  }

  skip(wireType: number) {
    if (wireType === 0) { this.uint32(); return; }
    if (wireType === 2) { this.bytesValue(); return; }
    if (wireType === 5) { this.pos += 4; return; }
    if (wireType === 1) { this.pos += 8; return; }
    throw new Error(`Unsupported protobuf wire type ${wireType}`);
  }
}

function decodeStatusMessage(bytes: Uint8Array): BleManagementStatus {
  const reader = new Reader(bytes);
  const status: BleManagementStatus = {
    activeProfile: 0,
    profileCount: 0,
    bondedMask: 0,
    connectedMask: 0,
    openMask: 0,
  };

  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire !== 0) {
      reader.skip(wire);
      continue;
    }
    switch (field) {
      case 1: status.activeProfile = reader.uint32(); break;
      case 2: status.profileCount = reader.uint32(); break;
      case 3: status.bondedMask = reader.uint32(); break;
      case 4: status.connectedMask = reader.uint32(); break;
      case 5: status.openMask = reader.uint32(); break;
      default: reader.skip(wire); break;
    }
  }

  return status;
}

function decodeCommandMessage(bytes: Uint8Array): BleManagementCommandResult {
  const reader = new Reader(bytes);
  let statusCode = 0;
  let state: BleManagementStatus = {
    activeProfile: 0,
    profileCount: 0,
    bondedMask: 0,
    connectedMask: 0,
    openMask: 0,
  };

  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) statusCode = reader.sint32();
    else if (field === 2 && wire === 2) state = decodeStatusMessage(reader.bytesValue());
    else reader.skip(wire);
  }

  return { status: statusCode, state };
}

function decodeErrorMessage(bytes: Uint8Array): number {
  const reader = new Reader(bytes);
  let status = -1;
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) status = reader.sint32();
    else reader.skip(wire);
  }
  return status;
}

export function decodeBleStatusResponse(bytes: Uint8Array): BleManagementStatus {
  const reader = new Reader(bytes);
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) return decodeStatusMessage(reader.bytesValue());
    if (field === 3 && wire === 2) {
      const status = decodeErrorMessage(reader.bytesValue());
      throw new Error(`BLE management RPC error ${status}`);
    }
    reader.skip(wire);
  }
  throw new Error('BLE management returned no status');
}

export function decodeBleCommandResponse(bytes: Uint8Array): BleManagementCommandResult {
  const reader = new Reader(bytes);
  while (!reader.done) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 2 && wire === 2) return decodeCommandMessage(reader.bytesValue());
    if (field === 3 && wire === 2) {
      const status = decodeErrorMessage(reader.bytesValue());
      throw new Error(`BLE management RPC error ${status}`);
    }
    reader.skip(wire);
  }
  throw new Error('BLE management returned no command result');
}

export function maskHas(mask: number, index: number) {
  return (mask & (1 << index)) !== 0;
}
