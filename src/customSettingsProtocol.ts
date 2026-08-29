export type CustomSettingValue =
  | { type: 'bool'; value: boolean }
  | { type: 'int32'; value: number }
  | { type: 'uint32'; value: number }
  | { type: 'float'; value: number }
  | { type: 'string'; value: string }
  | { type: 'bytes'; value: Uint8Array }
  | {
      type: 'array';
      index: number;
      size: number;
      value: Exclude<CustomSettingValue, { type: 'array' }>;
    };

export type CustomSettingDescriptor = {
  id: number;
  name: string;
  description: string;
  value: CustomSettingValue | null;
};

export type CustomSettingsStatus = {
  affectedCount: number;
  message: string;
};

export function decodeCustomSettingsStatus(_payload: Uint8Array): CustomSettingsStatus {
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
