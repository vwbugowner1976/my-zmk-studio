export type RuntimeCombo = {
  id: number;
  name: string;
  positions: number[];
  behavior: string;
  timeoutMs: number;
  enabled: boolean;
};

export interface RuntimeComboClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listCombos(): Promise<RuntimeCombo[]>;
  setCombo(combo: RuntimeCombo): Promise<void>;
  deleteCombo(id: number): Promise<void>;
  save(): Promise<void>;
}

/**
 * UI development client.
 * Replace with the DYA/ZMK Studio RPC-backed implementation next.
 */
export class DemoRuntimeComboClient implements RuntimeComboClient {
  private combos: RuntimeCombo[] = [
    { id: 0, name: 'Escape', positions: [12, 13], behavior: '&kp ESC', timeoutMs: 40, enabled: true },
    { id: 1, name: 'Tab', positions: [20, 21], behavior: '&kp TAB', timeoutMs: 45, enabled: true },
  ];

  async connect() {}
  async disconnect() {}

  async listCombos() {
    return structuredClone(this.combos);
  }

  async setCombo(combo: RuntimeCombo) {
    const index = this.combos.findIndex((item) => item.id === combo.id);
    if (index >= 0) this.combos[index] = structuredClone(combo);
    else this.combos.push(structuredClone(combo));
  }

  async deleteCombo(id: number) {
    this.combos = this.combos.filter((combo) => combo.id !== id);
  }

  async save() {
    // No-op in demo mode.
  }
}
