import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BehaviorBinding } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import type { BehaviorOption } from './useStudioCore';

export type SensorBindingRecord = {
  sensorIndex: number;
  binding: BehaviorBinding;
};

export type SensorBindingsCapability = {
  supported: boolean;
  source?: string;
  bindings?: SensorBindingRecord[];
};

function behaviorName(binding: BehaviorBinding, behaviorOptions: BehaviorOption[] | null) {
  const option = behaviorOptions?.find((item) => item.id === binding.behaviorId);
  return option?.displayName || `Behavior #${binding.behaviorId}`;
}

export function SensorBindingsPanel({
  layerIndex,
  behaviorOptions,
  capability = { supported: false },
}: {
  layerIndex: number;
  behaviorOptions: BehaviorOption[] | null;
  capability?: SensorBindingsCapability;
}) {
  const bindings = capability.bindings ?? [];

  return (
    <section className="panel sensor-bindings-panel">
      <div className="sensor-bindings-heading">
        <div>
          <span className="sensor-bindings-kicker">Layer {layerIndex}</span>
          <h3>Encoder / Sensor Bindings</h3>
          <p>Configure rotary encoders and other keymap sensors per layer.</p>
        </div>
        <span className={`sensor-bindings-status ${capability.supported ? 'supported' : ''}`}>
          {capability.supported ? 'Firmware supported' : 'Firmware extension required'}
        </span>
      </div>

      {!capability.supported ? (
        <div className="sensor-bindings-unavailable">
          <div className="sensor-bindings-icon" aria-hidden="true">↻</div>
          <div>
            <strong>My ZMK Studio is ready for sensor bindings.</strong>
            <p>
              This firmware does not expose layer sensor bindings through Studio RPC yet.
              Normal key editing is unaffected. Once the sensor-binding extension is added to
              firmware, this panel will become the encoder editor without changing the keymap UI.
            </p>
          </div>
        </div>
      ) : bindings.length === 0 ? (
        <div className="sensor-bindings-empty">
          <strong>No sensors reported for this layer.</strong>
          <span>{capability.source ? `Source: ${capability.source}` : 'The firmware reported sensor-binding support but returned no bindings.'}</span>
        </div>
      ) : (
        <div className="sensor-bindings-list">
          {bindings.map(({ sensorIndex, binding }) => (
            <article className="sensor-binding-card" key={sensorIndex}>
              <div>
                <span>Sensor {sensorIndex + 1}</span>
                <strong>{behaviorName(binding, behaviorOptions)}</strong>
              </div>
              <code>{binding.param1} · {binding.param2}</code>
              <button className="button secondary" type="button" disabled title="Editing is enabled when the sensor-binding write RPC is connected.">
                Edit
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="sensor-bindings-footnote">
        Planned editor: existing Binding Picker / behavior metadata, staged changes, and the same Save / Discard flow as normal keys.
      </div>
    </section>
  );
}

export default function SensorBindingsPortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [layerIndex, setLayerIndex] = useState(0);

  useEffect(() => {
    function sync() {
      const viewer = document.querySelector<HTMLElement>('.layer-viewer');
      setHost(viewer);
      const active = viewer?.querySelector<HTMLElement>('.layer-tab.active strong');
      const parsed = Number(active?.textContent ?? '0');
      setLayerIndex(Number.isFinite(parsed) ? parsed : 0);
    }

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (!host) return null;
  return createPortal(
    <SensorBindingsPanel layerIndex={layerIndex} behaviorOptions={null} />,
    host,
  );
}
