# Custom Settings firmware integration guide

This document describes how a ZMK firmware/module can expose settings to **My ZMK Studio → Custom Settings**.

It is based on the Custom Settings implementation currently used by the LoTom ZMK 0.3 firmware (`zmk-feature-custom-settings-v03`).

## What My ZMK Studio expects

My ZMK Studio does not need device-specific UI code for ordinary Custom Settings values. The firmware publishes:

- a custom subsystem identifier
- a stable setting key
- a value type
- the current value
- optional constraints/metadata
- read/write permissions

The Studio reads that metadata and renders a suitable editor automatically.

Supported scalar value types include:

- `INT32` → number field / range-aware editor
- `BOOL` → toggle
- `STRING` → text field
- `BYTES` → currently treated as an opaque value unless the Studio has a dedicated editor

Useful constraints include:

- integer range
- option list with labels
- HID usage
- layer ID
- behavior ID

## 1. Add and enable Custom Settings

Add the Custom Settings module to `config/west.yml` and enable it in the firmware.

For the LoTom-compatible ZMK 0.3 setup this is already pinned in `west.yml`.

Typical central-side configuration:

```conf
CONFIG_ZMK_CUSTOM_SETTINGS=y
CONFIG_ZMK_CUSTOM_SETTINGS_STUDIO_RPC=y
CONFIG_ZMK_STUDIO_RPC_RX_BUF_SIZE=128
CONFIG_ZMK_STUDIO_RPC_CUSTOM_SUBSYSTEM_REQUEST_PAYLOAD_MAX_BYTES=96
CONFIG_ZMK_LOW_PRIORITY_THREAD_STACK_SIZE=2048
```

## 2. Register a Studio custom subsystem namespace

A Custom Setting belongs to a `custom_subsystem_id`. For Studio discovery, that ID should match a custom ZMK Studio subsystem registered by the owning module.

Example:

```c
#include <zmk/studio/custom.h>

static bool my_module_rpc_handle_request(const zmk_custom_CallRequest *request,
                                         pb_callback_t *encode_response) {
    ARG_UNUSED(request);
    ARG_UNUSED(encode_response);
    return false;
}

static struct zmk_rpc_custom_subsystem_meta my_module_meta = {
    .security = ZMK_STUDIO_RPC_HANDLER_UNSECURED,
};

ZMK_RPC_CUSTOM_SUBSYSTEM(my_module, &my_module_meta, my_module_rpc_handle_request);
```

Use the exact same identifier string/symbol namespace for the settings owned by that module.

A module that already has its own Studio RPC subsystem can reuse that existing subsystem ID. Runtime Combo is an example: its settings use the Runtime Combo subsystem ID and therefore appear grouped under Runtime Combo in My ZMK Studio.

## 3. Register a setting

Include:

```c
#include <cormoran/zmk/custom_settings.h>
```

Example integer setting:

```c
ZMK_CUSTOM_SETTING_DEFINE(
    my_speed_setting,
    "my_module",
    "speed",
    ZMK_CUSTOM_SETTING_VALUE_TYPE_INT32,
    ZMK_CUSTOM_SETTING_VALUE_INT32(10),
    ZMK_CUSTOM_SETTING_CONFIDENTIALITY_RPC_PUBLIC,
    ZMK_CUSTOM_SETTING_PERMISSION_UNSECURE,
    ZMK_CUSTOM_SETTING_PERMISSION_UNSECURE,
    ZMK_CUSTOM_SETTING_RANGE_INT32(0, 100));
```

The important parts are:

- `"my_module"` — stable subsystem identifier
- `"speed"` — stable key
- value type
- default value
- confidentiality
- read permission
- write permission
- constraint metadata

Do not casually rename shipped subsystem IDs or setting keys. They are persistent identifiers used by firmware storage and Studio clients.

## 4. Common setting patterns

### Boolean

```c
ZMK_CUSTOM_SETTING_DEFINE(
    invert_x_setting,
    "my_module",
    "invert_x",
    ZMK_CUSTOM_SETTING_VALUE_TYPE_BOOL,
    ZMK_CUSTOM_SETTING_VALUE_BOOL(false),
    ZMK_CUSTOM_SETTING_CONFIDENTIALITY_RPC_PUBLIC,
    ZMK_CUSTOM_SETTING_PERMISSION_UNSECURE,
    ZMK_CUSTOM_SETTING_PERMISSION_UNSECURE,
    ZMK_CUSTOM_SETTING_NO_CONSTRAINT);
```

### Integer with range

```c
ZMK_CUSTOM_SETTING_DEFINE(
    cpi_setting,
    "my_module",
    "cpi",
    ZMK_CUSTOM_SETTING_VALUE_TYPE_INT32,
    ZMK_CUSTOM_SETTING_VALUE_INT32(600),
    ZMK_CUSTOM_SETTING_CONFIDENTIALITY_RPC_PUBLIC,
    ZMK_CUSTOM_SETTING_PERMISSION_UNSECURE,
    ZMK_CUSTOM_SETTING_PERMISSION_UNSECURE,
    ZMK_CUSTOM_SETTING_RANGE_INT32(200, 3200));
```

My ZMK Studio can use the range metadata automatically.

### Option list

Use `ZMK_CUSTOM_SETTING_CONSTRAINT_OPTIONS` when the firmware has a finite set of meaningful values. Supplying labels lets Studio show human-readable choices instead of raw numbers.

### Arrays

Use `ZMK_CUSTOM_SETTING_ARRAY_ELEMENT_DEFINE(...)` for indexed settings. Runtime Combo uses this pattern for combo records/names.

My ZMK Studio can list array elements, but complex array/bytes editing is better handled by a dedicated feature editor when the data has domain-specific structure.

## 5. Apply a changed setting to live hardware

Registering a value only creates persistent configuration. If a live device such as a sensor must change immediately, listen for the Custom Settings change event:

```c
#include <zmk/event_manager.h>
#include <cormoran/zmk/custom_settings.h>

static int custom_setting_changed_listener(const zmk_event_t *eh) {
    const struct zmk_custom_setting_changed *ev = as_zmk_custom_setting_changed(eh);
    if (!ev || !ev->setting) {
        return ZMK_EV_EVENT_BUBBLE;
    }

    if (strcmp(ev->setting->custom_subsystem_id, "my_module") != 0) {
        return ZMK_EV_EVENT_BUBBLE;
    }

    if (strcmp(zmk_custom_setting_public_key(ev->setting), "speed") == 0) {
        int32_t speed;
        if (zmk_custom_setting_get_int32(ev->setting, &speed) == 0) {
            /* Apply speed to the live device here. */
        }
    }

    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(my_module_custom_settings, custom_setting_changed_listener);
ZMK_SUBSCRIPTION(my_module_custom_settings, zmk_custom_setting_changed);
```

The change event distinguishes updated/saved/discarded/reset operations. Usually the safest device integration is to read the **effective value** after any relevant event and re-apply it to the hardware.

That means:

- Stage change → hardware updates immediately
- Discard → persistent/default value is restored and hardware follows it
- Reset → default value is restored and hardware follows it
- Save → current RAM value becomes persistent

## 6. Apply persisted/default values during boot

A hardware module should also read its Custom Setting during initialization and apply the effective value to the device.

Example:

```c
const struct zmk_custom_setting *setting =
    zmk_custom_setting_find("my_module", "speed");

int32_t speed;
if (setting && zmk_custom_setting_get_int32(setting, &speed) == 0) {
    /* Apply speed to hardware. */
}
```

Initialization ordering matters. Apply the value only after:

1. Custom Settings has initialized/loaded its effective value, and
2. the target device is ready.

If ordering is uncertain, use an appropriate Zephyr work item/init hook rather than assuming the device or settings subsystem is already ready.

## 7. Split keyboards

This is required when the setting belongs to a peripheral half but Studio runs on the central half.

Enable relay support on both halves:

```conf
CONFIG_ZMK_SPLIT_RELAY_EVENT=y
CONFIG_ZMK_CUSTOM_SETTINGS_SPLIT_RPC_RELAY=y
```

Only the central half needs:

```conf
CONFIG_ZMK_CUSTOM_SETTINGS_STUDIO_RPC=y
```

The peripheral can keep ZMK Studio itself disabled.

For larger metadata/value payloads, the split relay data length and BLE MTU may need to be increased. Start with scalar settings because they are small and robust.

## 8. PMW3610 example for LoTom

LoTom currently defines the PMW3610 as `&trackball` on the right/peripheral half with a DTS default of 600 CPI.

The badjeff ZMK 0.3 PMW3610 driver exposes `PMW3610_ATTR_CPI` through Zephyr's sensor attribute API and defines a valid CPI range of 200–3200.

A bridge can therefore register:

```c
ZMK_CUSTOM_SETTING_DEFINE(
    lotom_pmw3610_cpi,
    "lotom__pmw3610",
    "cpi",
    ZMK_CUSTOM_SETTING_VALUE_TYPE_INT32,
    ZMK_CUSTOM_SETTING_VALUE_INT32(600),
    ZMK_CUSTOM_SETTING_CONFIDENTIALITY_RPC_PUBLIC,
    ZMK_CUSTOM_SETTING_PERMISSION_UNSECURE,
    ZMK_CUSTOM_SETTING_PERMISSION_UNSECURE,
    ZMK_CUSTOM_SETTING_RANGE_INT32(200, 3200));
```

and apply it with the sensor API:

```c
const struct device *trackball = DEVICE_DT_GET(DT_NODELABEL(trackball));
struct sensor_value value = { .val1 = cpi, .val2 = 0 };

sensor_attr_set(trackball, SENSOR_CHAN_ALL,
                (enum sensor_attribute)PMW3610_ATTR_CPI,
                &value);
```

The exact channel accepted by the pinned PMW3610 driver must be kept consistent with its `attr_set` implementation; verify against the pinned driver before merging firmware changes.

## 9. Recommended My ZMK Studio integration rules

For a good generic UI:

- Prefer scalar settings over opaque records when practical.
- Add range metadata for numeric values.
- Add labels for finite option sets.
- Use `RPC_PUBLIC` only for settings that are safe to expose/export.
- Keep secret/personal values appropriately restricted.
- Use stable, short keys such as `cpi`, `invert_x`, `scroll_divisor`.
- Let Custom Settings provide generic editing first; add a dedicated Studio page only when a feature needs richer visualization or multi-setting coordination.

## 10. Validation checklist

After adding a firmware setting:

1. Build both split halves.
2. Flash both halves if relay/config changed.
3. Connect the central half to My ZMK Studio.
4. Confirm the new subsystem appears in the Custom Subsystems list.
5. Open Custom Settings.
6. Confirm `list_settings` reports the new setting.
7. Stage a change and verify the live device changes.
8. Discard and verify hardware returns to the old value.
9. Stage again and Save to firmware.
10. Reboot and verify the saved value is restored.

This sequence validates discovery, metadata, runtime application, discard semantics, persistence, split relay, and boot restoration.