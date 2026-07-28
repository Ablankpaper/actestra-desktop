import path from "node:path";

export const PRODUCT_NAME = "Actestra";
export const APP_ID = "com.bignormal.actestra";
export const PROTOCOL_SCHEME = "actestra";
export const USER_DATA_DIRECTORY = "Actestra";

export function resolveUserDataPath(appDataRoot: string, override?: string): string {
  const explicitPath = override?.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  return path.join(appDataRoot, USER_DATA_DIRECTORY);
}

export function isActestraDeepLink(value: string): boolean {
  try {
    return new URL(value).protocol === `${PROTOCOL_SCHEME}:`;
  } catch {
    return false;
  }
}
