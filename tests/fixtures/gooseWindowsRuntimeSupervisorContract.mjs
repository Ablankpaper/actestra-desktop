/**
 * Shared timeout budget for the Windows authenticated-runtime parent-death
 * fixture. Every outer watchdog must be longer than the bounded phase it
 * observes; otherwise host load is misreported as a fixture failure.
 */
export const WINDOWS_RUNTIME_HANDSHAKE_TIMEOUT_MS = 30_000;
export const WINDOWS_RUNTIME_SESSION_PHASE_TIMEOUT_MS = 60_000;
export const WINDOWS_RUNTIME_PROMPT_TIMEOUT_MS = 30_000;
export const WINDOWS_PARENT_DEATH_PROCESS_DISCOVERY_TIMEOUT_MS = 10_000;
export const WINDOWS_PARENT_DEATH_PROCESS_EXIT_TIMEOUT_MS = 10_000;
export const WINDOWS_PARENT_DEATH_STATE_TIMEOUT_MS = 180_000;
export const WINDOWS_RUNTIME_INTEGRATION_TIMEOUT_MS = 480_000;
export const WINDOWS_RUNTIME_CHILD_TIMEOUT_MS = 510_000;
