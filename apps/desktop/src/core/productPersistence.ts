import type { CorePersistencePort } from "./persistence";
import type { PlatformEvidencePersistencePort } from "./platform";
import type { WorkloadPersistencePort } from "./workloadContent";

export interface ActestraPersistencePort
  extends CorePersistencePort, PlatformEvidencePersistencePort, WorkloadPersistencePort {}
