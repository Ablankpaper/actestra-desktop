import type { ActestraBridge } from "../shared/contracts";

declare global {
  interface Window {
    readonly actestra: ActestraBridge;
  }
}

export {};
