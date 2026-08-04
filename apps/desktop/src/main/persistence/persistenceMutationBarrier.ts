import type { ActestraPersistencePort } from "../../core";

const mutationBarriers = new WeakMap<ActestraPersistencePort, Promise<void>>();
const ignorePriorFailure = (): void => undefined;

export async function withPersistenceMutationBarrier<Result>(
  persistence: ActestraPersistencePort,
  operation: () => Promise<Result>,
): Promise<Result> {
  const prior = mutationBarriers.get(persistence) ?? Promise.resolve();
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prior.catch(ignorePriorFailure).then(() => slot);
  mutationBarriers.set(persistence, tail);
  await prior.catch(ignorePriorFailure);
  try {
    return await operation();
  } finally {
    release();
    if (mutationBarriers.get(persistence) === tail) {
      mutationBarriers.delete(persistence);
    }
  }
}
