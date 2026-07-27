import fs from "node:fs";
import path from "node:path";

export const CURRENT_DATA_LAYOUT_VERSION = 1;
export const DATA_LAYOUT_MANIFEST = "data-layout.json";

export interface DataLayoutManifest {
  readonly product: "Actestra";
  readonly layoutVersion: number;
}

export type DataLayoutState = "created" | "current";

function parseManifest(content: string): DataLayoutManifest {
  const manifest: unknown = JSON.parse(content);

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("product" in manifest) ||
    manifest.product !== "Actestra" ||
    !("layoutVersion" in manifest) ||
    typeof manifest.layoutVersion !== "number" ||
    !Number.isInteger(manifest.layoutVersion)
  ) {
    throw new Error("Actestra data layout manifest is invalid");
  }

  if (manifest.layoutVersion > CURRENT_DATA_LAYOUT_VERSION) {
    throw new Error(
      `Actestra data layout ${manifest.layoutVersion} is newer than supported version ${CURRENT_DATA_LAYOUT_VERSION}`,
    );
  }

  if (manifest.layoutVersion < CURRENT_DATA_LAYOUT_VERSION) {
    throw new Error(
      `No migration is registered from Actestra data layout ${manifest.layoutVersion}`,
    );
  }

  return {
    product: "Actestra",
    layoutVersion: manifest.layoutVersion,
  };
}

export function ensureDataLayout(userDataPath: string): DataLayoutState {
  fs.mkdirSync(userDataPath, {
    recursive: true,
    mode: 0o700,
  });

  const manifestPath = path.join(userDataPath, DATA_LAYOUT_MANIFEST);

  try {
    parseManifest(fs.readFileSync(manifestPath, "utf8"));
    return "current";
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const manifest: DataLayoutManifest = {
    product: "Actestra",
    layoutVersion: CURRENT_DATA_LAYOUT_VERSION,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  return "created";
}
