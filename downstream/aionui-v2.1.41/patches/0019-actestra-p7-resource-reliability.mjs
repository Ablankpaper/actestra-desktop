import fs from "node:fs";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] ?? "");
if (path.basename(outputRoot) !== "aionui-v2.1.41") {
  throw new Error(`Expected a materialized aionui-v2.1.41 tree, received ${outputRoot}`);
}

function absolutePath(relativePath) {
  return path.join(outputRoot, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(absolutePath(relativePath), "utf8");
}

function write(relativePath, contents) {
  fs.writeFileSync(absolutePath(relativePath), contents, "utf8");
}

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one downstream patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

const bridgePath = "packages/desktop/src/process/services/actestraShadowBridge.ts";

replaceOnce(
  bridgePath,
  `import {
  resolveP7SecuritySmokeIsolation,
  runP7PackagedSecuritySmoke,
} from '@/actestra/main/security/p7SecuritySmoke';`,
  `import {
  resolveP7SecuritySmokeIsolation,
  runP7PackagedSecuritySmoke,
} from '@/actestra/main/security/p7SecuritySmoke';
import {
  resolveP7ResourceReliabilitySmokeIsolation,
  runP7PackagedResourceReliabilitySmoke,
} from '@/actestra/main/security/p7ResourceReliabilitySmoke';`,
);

replaceOnce(
  bridgePath,
  `let generalWorkSmokeStarted = false;
let p7SecuritySmokeStarted = false;
const generalWorkSmokeConfig = resolveActestraGeneralWorkSmokeConfig(
  process.env,
);
const p7SecuritySmokeIsolation = resolveP7SecuritySmokeIsolation(process.env);`,
  `let generalWorkSmokeStarted = false;
let p7SecuritySmokeStarted = false;
let p7ResourceReliabilitySmokeStarted = false;
const generalWorkSmokeConfig = resolveActestraGeneralWorkSmokeConfig(
  process.env,
);
const p7SecuritySmokeIsolation = resolveP7SecuritySmokeIsolation(process.env);
const p7ResourceReliabilitySmokeIsolation =
  resolveP7ResourceReliabilitySmokeIsolation(process.env);`,
);

replaceOnce(
  bridgePath,
  `}

export async function initializeActestraPersistenceUtility(
  userDataPath: string,
): Promise<void> {`,
  `}

async function startP7ResourceReliabilitySmoke(): Promise<void> {
  if (
    p7ResourceReliabilitySmokeStarted ||
    p7ResourceReliabilitySmokeIsolation === null ||
    !app.isPackaged
  ) {
    return;
  }
  p7ResourceReliabilitySmokeStarted = true;
  try {
    const results = await runP7PackagedResourceReliabilitySmoke(
      p7ResourceReliabilitySmokeIsolation,
    );
    for (const result of results) {
      console.info(
        'ACTESTRA_P7_RESOURCE_RELIABILITY_RESULT ' + JSON.stringify(result),
      );
    }
    fs.writeFileSync(
      p7ResourceReliabilitySmokeIsolation.evidence,
      JSON.stringify({
        schemaVersion: 1,
        ids: results.map((result) => result.id),
        incidentCodes: results.map((result) => result.incidentCode),
        cleanup: results.map((result) => result.cleanup),
        redacted: true,
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
    app.quit();
  } catch {
    console.error(
      'ACTESTRA_P7_RESOURCE_RELIABILITY_FAILED ' +
        JSON.stringify({ code: 'probe-failed' }),
    );
    app.quit();
  }
}

export async function initializeActestraPersistenceUtility(
  userDataPath: string,
): Promise<void> {`,
);

replaceOnce(
  bridgePath,
  `  currentWindow?.webContents.once('did-finish-load', () => {
    void startP7SecuritySmoke();
  });`,
  `  currentWindow?.webContents.once('did-finish-load', () => {
    void startP7SecuritySmoke();
    void startP7ResourceReliabilitySmoke();
  });`,
);

replaceOnce(
  bridgePath,
  `  generalWorkSmokeStarted = false;
  p7SecuritySmokeStarted = false;
  disposeScheduleBridge?.();`,
  `  generalWorkSmokeStarted = false;
  p7SecuritySmokeStarted = false;
  p7ResourceReliabilitySmokeStarted = false;
  disposeScheduleBridge?.();`,
);
