import { XzReadableStream } from 'xz-decompress';

export type VialHidInputReportEvent = {
  data: DataView;
};

export type VialHidInputReportListener = (event: VialHidInputReportEvent) => void;

export type VialHidDevice = {
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: 'inputreport', listener: VialHidInputReportListener): void;
  removeEventListener(type: 'inputreport', listener: VialHidInputReportListener): void;
};

export type VialDefinition = {
  name?: string;
  vendorId?: string | number;
  productId?: string | number;
  matrix?: {
    rows?: number;
    cols?: number;
  };
  layouts?: unknown;
  [key: string]: unknown;
};

export type VialProbeResult = {
  protocolVersion: number;
  keyboardUid: string;
  definitionSize: number;
  definition: VialDefinition | null;
  definitionError: string | null;
};

const REPORT_ID = 0;
const REPORT_SIZE = 32;
const VIAL_PREFIX = 0xfe;
const VIAL_GET_KEYBOARD_ID = 0x00;
const VIAL_GET_SIZE = 0x01;
const VIAL_GET_DEFINITION = 0x02;
const MAX_REASONABLE_PROTOCOL = 64;
const MAX_DEFINITION_SIZE = 512 * 1024;

function littleEndianU32(data: Uint8Array, offset = 0) {
  return (
    data[offset]
    | (data[offset + 1] << 8)
    | (data[offset + 2] << 16)
    | (data[offset + 3] << 24)
  ) >>> 0;
}

function uidString(data: Uint8Array) {
  return Array.from(data.slice(4, 12))
    .map((value) => value.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
}

function vialCommand(
  device: VialHidDevice,
  command: number,
  bytes: number[] = [],
  timeoutMs = 1200,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const payload = new Uint8Array(REPORT_SIZE);
    payload[0] = VIAL_PREFIX;
    payload[1] = command;
    bytes.slice(0, REPORT_SIZE - 2).forEach((value, index) => {
      payload[index + 2] = value & 0xff;
    });

    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      device.removeEventListener('inputreport', onInputReport);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onInputReport: VialHidInputReportListener = (event) => {
      const data = new Uint8Array(
        event.data.buffer,
        event.data.byteOffset,
        event.data.byteLength,
      );
      if (data.byteLength !== REPORT_SIZE) return;
      finish(() => resolve(new Uint8Array(data)));
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for Vial command 0x${command.toString(16).toUpperCase()} response.`)));
    }, timeoutMs);

    device.addEventListener('inputreport', onInputReport);
    void device.sendReport(REPORT_ID, payload).catch((error) => {
      finish(() => reject(error));
    });
  });
}

async function readEmbeddedDefinition(device: VialHidDevice, size: number) {
  const payload = new Uint8Array(size);
  let written = 0;
  let page = 0;

  while (written < size) {
    const response = await vialCommand(device, VIAL_GET_DEFINITION, [
      page & 0xff,
      (page >> 8) & 0xff,
    ]);
    const count = Math.min(REPORT_SIZE, size - written);
    payload.set(response.slice(0, count), written);
    written += count;
    page += 1;
  }

  const source = new Blob([payload]).stream();
  const text = await new Response(new XzReadableStream(source)).text();
  const parsed = JSON.parse(text) as VialDefinition;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Embedded Vial definition did not decode to a JSON object.');
  }
  return parsed;
}

export async function probeVialDevice(device: VialHidDevice): Promise<VialProbeResult | null> {
  let idResponse: Uint8Array;
  try {
    idResponse = await vialCommand(device, VIAL_GET_KEYBOARD_ID);
  } catch {
    return null;
  }

  const protocolVersion = littleEndianU32(idResponse);
  if (protocolVersion > MAX_REASONABLE_PROTOCOL) return null;

  let sizeResponse: Uint8Array;
  try {
    sizeResponse = await vialCommand(device, VIAL_GET_SIZE);
  } catch {
    return null;
  }

  const definitionSize = littleEndianU32(sizeResponse);
  if (definitionSize <= 0 || definitionSize > MAX_DEFINITION_SIZE) return null;

  let definition: VialDefinition | null = null;
  let definitionError: string | null = null;
  try {
    definition = await readEmbeddedDefinition(device, definitionSize);
  } catch (error) {
    definitionError = error instanceof Error ? error.message : String(error);
  }

  return {
    protocolVersion,
    keyboardUid: uidString(idResponse),
    definitionSize,
    definition,
    definitionError,
  };
}
