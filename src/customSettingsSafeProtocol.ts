import {
  cloneCustomSettingValue,
  decodeCustomSettingsNotification,
  decodeCustomSettingsResponse,
  settingValueText,
  type CustomSettingRecord,
  type CustomSettingScalar,
  type CustomSettingValue,
  type CustomSettingConstraint,
  type CustomSettingMeta,
  type CustomSettingsStatus,
  type CustomSettingNotification,
} from './customSettingsProtocol';

export {
  cloneCustomSettingValue,
  decodeCustomSettingsNotification,
  decodeCustomSettingsResponse,
  settingValueText,
};

export type {
  CustomSettingRecord,
  CustomSettingScalar,
  CustomSettingValue,
  CustomSettingConstraint,
  CustomSettingMeta,
  CustomSettingsStatus,
  CustomSettingNotification,
};

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
