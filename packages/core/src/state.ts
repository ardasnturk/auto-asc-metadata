import { VitrinState, type StageName } from '@vitrin/schemas';
import { existsSync } from 'node:fs';
import { readJson, writeJson } from './fsx.js';

/**
 * `.vitrin/state.json` — which stages completed and with what input hash.
 * A stage whose input hash is unchanged is skipped unless `--force` is passed.
 */
export class StateStore {
  private state: VitrinState = { version: 1, stages: {} };

  private constructor(private readonly file: string) {}

  static async load(file: string): Promise<StateStore> {
    const store = new StateStore(file);
    if (existsSync(file)) store.state = await readJson(file, VitrinState);
    return store;
  }

  get(stage: StageName) {
    return this.state.stages[stage];
  }

  isFresh(stage: StageName, inputHash: string): boolean {
    const rec = this.state.stages[stage];
    return Boolean(rec && rec.inputHash === inputHash && rec.status === 'ok');
  }

  async mark(
    stage: StageName,
    inputHash: string,
    outputs: string[] = [],
    status: 'ok' | 'warning' | 'blocked' = 'ok',
    note?: string,
  ): Promise<void> {
    this.state.stages[stage] = { completedAt: new Date().toISOString(), inputHash, outputs, status, note };
    await writeJson(this.file, this.state);
  }

  async invalidate(stage: StageName): Promise<void> {
    delete this.state.stages[stage];
    await writeJson(this.file, this.state);
  }

  snapshot(): VitrinState {
    return structuredClone(this.state);
  }
}
