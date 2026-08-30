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

function encodeScope(customSubsystemIndex: number | null, source: number) {
  const fields: number[] = [];
  if (customSubsystemIndex !== null) fields.push(...varintField(1, customSubsystemIndex, true));
  fields.push(...varintField(4, source, true));
  return bytesField(1, fields);
}

export function encodeListSettingsAllRequest(requireMeta = true) {
  const inner = [
    ...encodeScope(null, CUSTOM_SETTING_SOURCE_ALL),
    ...varintField(2, requireMeta ? 1 : 0, true),
  ];
  return new Uint8Array(bytesField(1, inner));
}

export function encodeListSettingsForSubsystemAllRequest(customSubsystemIndex: number, requireMeta = true) {
  const inner = [
    ...encodeScope(customSubsystemIndex, CUSTOM_SETTING_SOURCE_ALL),
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

function encodeScopedMutation(requestField: number, customSubsystemIndex: number, source: number) {
  return new Uint8Array(bytesField(requestField, encodeScope(customSubsystemIndex, source)));
}

export function encodeSaveSettingsForSourceRequest(customSubsystemIndex: number, source: number) {
  return encodeScopedMutation(4, customSubsystemIndex, source);
}

export function encodeDiscardSettingsForSourceRequest(customSubsystemIndex: number, source: number) {
  return encodeScopedMutation(5, customSubsystemIndex, source);
}

export function encodeResetSettingsForSourceRequest(customSubsystemIndex: number, source: number) {
  return encodeScopedMutation(6, customSubsystemIndex, source);
}

export function encodeSaveSettingsAllRequest() {
  return new Uint8Array(bytesField(4, encodeScope(null, CUSTOM_SETTING_SOURCE_ALL)));
}

export function encodeDiscardSettingsAllRequest() {
  return new Uint8Array(bytesField(5, encodeScope(null, CUSTOM_SETTING_SOURCE_ALL)));
}

export function encodeResetSettingsAllRequest() {
  return new Uint8Array(bytesField(6, encodeScope(null, CUSTOM_SETTING_SOURCE_ALL)));
}
