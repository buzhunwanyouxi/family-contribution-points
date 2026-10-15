/**
 * A minimal instance table for the evidence-upload path.
 *
 * ⚠️ **This is a placeholder, and it is labelled as one on purpose.**
 *
 * The task module (#11 templates, #12 claim, #13 score, #14 settle) does not exist yet: nothing in
 * this repository reads or writes `TaskInstance`. Evidence upload, however, is meaningless without
 * something to attach evidence *to* -- `POST .../instances/:iid/proof` has to answer "does this
 * instance exist, in whose family, and is it already settled".
 *
 * Rather than pretend the dependency is satisfied, this file provides the smallest honest stand-in:
 *
 *   - it implements `InstanceReader`, which is the **only** thing the media module is allowed to ask;
 *   - it is writable (`add`) so the upload path can be exercised end-to-end today;
 *   - when the task module lands, **delete this file** and pass the task module's own reader into
 *     `createMediaService`. The media module will not need to change, because it only knows the port.
 *
 * What it deliberately does not do: enforce any task rules (who may claim, when scoring closes,
 * what the deadline is). Those are #12-#14's job, and duplicating them here would create a second
 * source of truth for the same rules -- the exact failure this project keeps designing against.
 */
import type { InstanceFacts, InstanceReader } from './upload.js';

export interface InstanceStore extends InstanceReader {
  /** Test/dev helper: register an instance so evidence can be attached to it. */
  add(facts: InstanceFacts): void;
  /** Test/dev helper: move an instance through its lifecycle. */
  setStatus(instanceId: string, status: string): void;
  count(): number;
}

export function createInMemoryInstanceStore(): InstanceStore {
  const rows = new Map<string, InstanceFacts>();

  return {
    async findInstance(instanceId) {
      const row = rows.get(instanceId);
      return row === undefined ? null : { ...row };
    },
    add(facts) {
      rows.set(facts.id, { ...facts });
    },
    setStatus(instanceId, status) {
      const row = rows.get(instanceId);
      if (row === undefined) throw new Error(`未知的任务实例:${instanceId}`);
      rows.set(instanceId, { ...row, status });
    },
    count() {
      return rows.size;
    },
  };
}
