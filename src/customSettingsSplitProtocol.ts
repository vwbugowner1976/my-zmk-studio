import type { CustomSettingRecord, CustomSettingValue, CustomSettingScalar } from './customSettingsProtocol';

// Custom Settings split RPC semantics:
// omitted source = local side only, UINT32_MAX = all split sides.
export const CUSTOM_SETTING_SOURCE_ALL = 0xffffffff;

function encodeVarintNumber(value: number): number[] {
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

function encodeScalarValue(value: CustomSettingScalar) {
  if (value.type === 'bytes') return bytesField(1, value.value);
  if (value.type === 'int32') return varintField(2, value.value, true);
  if (value.type === 'bool') return varintField(3, value.value ? 1 : 0, true);
  return stringField(4, value.value);
}

function encodeSettingValue(value: CustomSettingValue) {
  if (value.type === 'array') {
    return bytesField(5, [
      ...varintField(1, value.index, true),
      ...varintField(2, value.size, true),
      ...bytesField(3, encodeScalarValue(value.value)),
    ]);
  }
  return encodeScalarValue(value);
}

function encodeSettingRef(setting: CustomSettingRecord) {
  const fields = [
    ...varintField(1, setting.customSubsystemIndex, true),
    ...stringField(2, setting.key),
    ...varintField(3, setting.source, true),
  ];
  if (setting.value?.type === 'array') fields.push(...varintField(4, setting.value.index, true));
  return fields;
}

function encodeAllScope() {
  // SettingScope.source = field 4. UINT32_MAX asks the central to relay to all peripherals.
  return bytesField(1, varintField(4, CUSTOM_SETTING_SOURCE_ALL, true));
}

export function encodeListSettingsAllRequest(requireMeta = true) {
  const inner = [
    ...encodeAllScope(),
    ...varintField(2, requireMeta ? 1 : 0, true),
  ];
  return new Uint8Array(bytesField(1, inner));
}

export function encodeWriteSettingSplitRequest(setting: CustomSettingRecord, value: CustomSettingValue) {
  const inner = [
    ...bytesField(1, encodeSettingRef(setting)),
    ...bytesField(2, encodeSettingValue(value)),
    ...varintField(3, 0, true),
  ];
  return new Uint8Array(bytesField(3, inner));
}

export function encodeSaveSettingsAllRequest() {
  return new Uint8Array(bytesField(4, encodeAllScope()));
}

export function encodeDiscardSettingsAllRequest() {
  return new Uint8Array(bytesField(5, encodeAllScope()));
}

export function encodeResetSettingsAllRequest() {
  return new Uint8Array(bytesField(6, encodeAllScope()));
}
