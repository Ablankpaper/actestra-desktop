import type {
  AionUiApprovalAuthorityPersistencePort,
  AionUiGeneralWorkJourneyPersistencePort,
  AionUiScheduledGeneralWorkPersistencePort,
  AionUiShadowPersistencePort,
} from "../compatibility/aionui";
import type { CorePersistencePort } from "./persistence";
import type { PlatformEvidencePersistencePort } from "./platform";
import type { GeneralWorkRecoveryPersistencePort } from "./generalWorkRecovery";
import type { WorkloadPersistencePort } from "./workloadContent";

export interface ActestraPersistencePort
  extends
    CorePersistencePort,
    PlatformEvidencePersistencePort,
    AionUiShadowPersistencePort,
    AionUiApprovalAuthorityPersistencePort,
    AionUiGeneralWorkJourneyPersistencePort,
    AionUiScheduledGeneralWorkPersistencePort,
    GeneralWorkRecoveryPersistencePort,
    WorkloadPersistencePort {}
