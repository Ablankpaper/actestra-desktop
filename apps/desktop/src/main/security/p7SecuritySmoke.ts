import { spawn } from "node:child_process";
import type { WebContents } from "electron";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  isAllowedActestraWebviewRequest,
  isAllowedActestraWebviewSource,
} from "../../shared/webviewPolicy";
import { createGooseRunnerEnvironment } from "../workers/gooseRunnerProcess";
import { admitGooseRunnerArtifact } from "../workers/gooseRunnerArtifact";
import { createGooseRunnerSandboxLaunch } from "../workers/gooseRunnerSandbox";

type WebviewSession = Readonly<{
  setPermissionRequestHandler: (
    handler: (
      _webContents: unknown,
      _permission: string,
      callback: (allowed: boolean) => void,
    ) => void,
  ) => void;
  webRequest: {
    onBeforeRequest: (
      filter: unknown,
      listener: (
        details: Readonly<{ url: string }>,
        callback: (result: { cancel: boolean }) => void,
      ) => void,
    ) => void;
  };
}>;
type WebviewOwner = Pick<WebContents, "on">;

function isAllowedWebviewPartition(partition: string | undefined): boolean {
  return (
    partition !== undefined &&
    /^persist:(?:actestra-preview|ext-settings-[a-z0-9._-]+)$/iu.test(partition)
  );
}

export function installWebviewGuestSecurity(
  owner: WebviewOwner,
  resolveSession: (partition: string | undefined) => WebviewSession,
  options: Readonly<{ backendPort?: () => number }> = {},
): void {
  const configuredSessions = new WeakSet<object>();
  owner.on("will-attach-webview", (event, webPreferences, params) => {
    const localPreview = /^file:|^data:/iu.test(params.src);
    const allowedPartition =
      params.partition === undefined ? localPreview : isAllowedWebviewPartition(params.partition);
    const backendPort = options.backendPort?.();
    if (
      !isAllowedActestraWebviewSource(params.src, {
        backendPort,
        partition: params.partition,
      }) ||
      !allowedPartition
    ) {
      event.preventDefault();
      return;
    }
    const mutablePreferences = webPreferences as Record<string, unknown>;
    delete mutablePreferences.preload;
    delete mutablePreferences.preloadURL;
    delete mutablePreferences.preloadPath;
    Object.assign(webPreferences, {
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      nativeWindowOpen: false,
    });
    if (params.partition !== undefined) {
      const guestSession = resolveSession(params.partition);
      if (configuredSessions.has(guestSession)) return;
      configuredSessions.add(guestSession);
      guestSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
      });
      guestSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
        (details, callback) => {
          callback({
            cancel: !isAllowedActestraWebviewRequest(details.url, {
              backendPort: options.backendPort?.(),
            }),
          });
        },
      );
    }
  });
}

export const P7_PACKAGED_SECURITY_CASES = Object.freeze([
  "P7-A-RENDERER-002",
  "P7-A-CREDENTIAL-001",
  "P7-A-CREDENTIAL-003",
  "P7-A-WORKER-001",
  "P7-A-NETWORK-001",
  "P7-A-PROCESS-002",
  "P7-A-ARTIFACT-001",
] as const);
export const P7_EXPECTED_RENDERER_BRIDGE_KEYS = Object.freeze([
  "actestraProviderGet",
  "actestraProviderList",
  "actestraProviderMutate",
  "captureFeedbackScreenshot",
  "collectFeedbackLogs",
  "emit",
  "getPathForFile",
  "logFeedbackEvent",
  "on",
  "recoverCorruptedDatabase",
] as const);

export type P7SecuritySmokeIsolation = Readonly<{
  root: string;
  userData: string;
  home: string;
  temp: string;
  sentinel: string;
  workspace: string;
  evidence: string;
  hostReadProbe: string;
  target: string;
  runnerArtifactDirectory: string;
  runnerManifestSha256: string;
}>;

function isStrictlyInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function resolveP7SecuritySmokeIsolation(
  environment: Readonly<Record<string, string | undefined>>,
): P7SecuritySmokeIsolation | null {
  if (environment.ACTESTRA_P7_SECURITY_SMOKE !== "1" || environment.ACTESTRA_E2E_TEST !== "1") {
    return null;
  }
  const root = environment.ACTESTRA_E2E_ISOLATION_ROOT?.trim();
  const userData = environment.ACTESTRA_USER_DATA_DIR?.trim();
  const home = environment.ACTESTRA_E2E_HOME_DIR?.trim();
  const temp = environment.ACTESTRA_E2E_TEMP_DIR?.trim();
  const sentinel = environment.ACTESTRA_P7_SECURITY_SMOKE_SENTINEL?.trim();
  const workspace = environment.ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE?.trim();
  const evidence = environment.ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE?.trim();
  const hostReadProbe = environment.ACTESTRA_P7_SECURITY_SMOKE_HOST_READ_PROBE?.trim();
  const target = environment.ACTESTRA_P7_SECURITY_SMOKE_TARGET?.trim();
  const runnerArtifactDirectory =
    environment.ACTESTRA_P7_SECURITY_SMOKE_RUNNER_ARTIFACT_DIRECTORY?.trim();
  const runnerManifestSha256 =
    environment.ACTESTRA_P7_SECURITY_SMOKE_RUNNER_MANIFEST_SHA256?.trim();
  if (
    root === undefined ||
    userData === undefined ||
    home === undefined ||
    temp === undefined ||
    sentinel === undefined ||
    workspace === undefined ||
    evidence === undefined ||
    hostReadProbe === undefined ||
    target === undefined ||
    runnerArtifactDirectory === undefined ||
    runnerManifestSha256 === undefined ||
    !path.isAbsolute(root) ||
    !path.isAbsolute(userData) ||
    !path.isAbsolute(home) ||
    !path.isAbsolute(temp) ||
    !isStrictlyInside(root, userData) ||
    !isStrictlyInside(root, home) ||
    !isStrictlyInside(root, temp) ||
    !isStrictlyInside(root, sentinel) ||
    !isStrictlyInside(root, workspace) ||
    !isStrictlyInside(root, evidence) ||
    !path.isAbsolute(hostReadProbe) ||
    hostReadProbe === root ||
    isStrictlyInside(root, hostReadProbe) ||
    !path.isAbsolute(runnerArtifactDirectory) ||
    !/^[a-f0-9]{64}$/u.test(runnerManifestSha256)
  ) {
    return null;
  }
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(target);
  } catch {
    return null;
  }
  if (
    parsedTarget.protocol !== "http:" ||
    parsedTarget.hostname === "127.0.0.1" ||
    parsedTarget.hostname === "localhost" ||
    !/^\d{1,5}$/u.test(parsedTarget.port) ||
    Number(parsedTarget.port) < 1 ||
    Number(parsedTarget.port) > 65_535 ||
    parsedTarget.pathname === "/" ||
    !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(parsedTarget.hostname)
  ) {
    return null;
  }
  return Object.freeze({
    root,
    userData,
    home,
    temp,
    sentinel,
    workspace,
    evidence,
    hostReadProbe,
    target,
    runnerArtifactDirectory,
    runnerManifestSha256,
  });
}

export type P7SecuritySmokeResult = Readonly<{
  id: (typeof P7_PACKAGED_SECURITY_CASES)[number];
  outcome: "denied-safe";
  redacted: true;
  sideEffectCount: 0;
  evidenceVersion: 1;
}>;

export function p7SecuritySmokeResult(
  id: (typeof P7_PACKAGED_SECURITY_CASES)[number],
): P7SecuritySmokeResult {
  return Object.freeze({
    id,
    outcome: "denied-safe",
    redacted: true,
    sideEffectCount: 0,
    evidenceVersion: 1,
  });
}

type ExecuteJavaScriptPort = Readonly<{
  executeJavaScript(source: string, userGesture?: boolean): Promise<unknown>;
}>;

export async function runP7RendererNetworkSmoke(
  webContents: ExecuteJavaScriptPort,
  deniedDestination = "http://127.0.0.1:9/actestra-p7-denied",
): Promise<P7SecuritySmokeResult> {
  const guestProbeSource = `(() => Promise.allSettled([fetch(${JSON.stringify(deniedDestination)})]).then(([fetchResult]) => ({
    hasNodeAuthority:
      typeof window.require !== 'undefined' ||
      typeof window.process !== 'undefined' ||
      typeof window.ipcRenderer !== 'undefined',
    fetchRejected: fetchResult.status === 'rejected',
  })))()`;
  const result = await webContents.executeJavaScript(
    `(() => {
      const exactBridgeKeys = Object.keys(window.electronAPI ?? {}).sort();
      const hasNodeAuthority =
        typeof window.require !== 'undefined' ||
        typeof window.process !== 'undefined' ||
        typeof window.ipcRenderer !== 'undefined';
      const destination = ${JSON.stringify(deniedDestination)};
      const guestProbeSource = ${JSON.stringify(guestProbeSource)};
      const runGuestProbe = async () => {
        const guest = document.createElement('webview');
        guest.style.display = 'none';
        guest.setAttribute('partition', 'persist:actestra-preview');
        guest.src = 'data:text/html,<meta charset="utf-8"><title>P7 guest probe</title>';
        document.body.appendChild(guest);
        try {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              resolve(true);
            };
            guest.addEventListener('did-stop-loading', finish, { once: true });
            guest.addEventListener('did-fail-load', finish, { once: true });
            setTimeout(finish, 2000);
          });
          const guestResult = await guest.executeJavaScript(guestProbeSource, true);
          return guestResult;
        } finally {
          guest.remove();
        }
      };
      return Promise.allSettled([
        fetch(destination),
        new Promise((resolve, reject) => {
          const socket = new WebSocket(destination.replace('http:', 'ws:'));
          socket.onopen = () => reject(new Error('websocket unexpectedly opened'));
          socket.onerror = () => resolve(true);
          setTimeout(() => reject(new Error('websocket denial was not observed')), 2000);
        }),
        new Promise((resolve, reject) => {
          const source = new EventSource(destination);
          source.onopen = () => {
            source.close();
            reject(new Error('eventsource unexpectedly opened'));
          };
          source.onerror = () => {
            source.close();
            resolve(true);
          };
          setTimeout(() => {
            source.close();
            reject(new Error('eventsource denial was not observed'));
          }, 2000);
        }),
        new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open('GET', destination, true);
          request.timeout = 2000;
          request.onload = () => reject(new Error('xmlhttprequest unexpectedly opened'));
          request.onerror = () => resolve(true);
          request.onabort = () => resolve(true);
          request.ontimeout = () => resolve(true);
          request.send();
        }),
        runGuestProbe(),
      ]).then(([fetchResult, socketResult, eventSourceResult, xhrResult, guestResult]) => ({
        exactBridgeKeys,
        hasNodeAuthority,
        fetchRejected: fetchResult.status === 'rejected',
        socketRejected: socketResult.status === 'fulfilled',
        eventSourceRejected: eventSourceResult.status === 'fulfilled',
        xhrRejected: xhrResult.status === 'fulfilled',
        guest:
          guestResult.status === 'fulfilled' &&
          typeof guestResult.value === 'object' &&
          guestResult.value !== null &&
          !Array.isArray(guestResult.value)
            ? guestResult.value
            : null,
      }));
    })()`,
    true,
  );
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    (result as { hasNodeAuthority?: unknown }).hasNodeAuthority !== false ||
    (result as { fetchRejected?: unknown }).fetchRejected !== true ||
    (result as { socketRejected?: unknown }).socketRejected !== true ||
    (result as { eventSourceRejected?: unknown }).eventSourceRejected !== true ||
    (result as { xhrRejected?: unknown }).xhrRejected !== true ||
    typeof (result as { guest?: unknown }).guest !== "object" ||
    (result as { guest: { hasNodeAuthority?: unknown } }).guest.hasNodeAuthority !== false ||
    (result as { guest: { fetchRejected?: unknown } }).guest.fetchRejected !== true ||
    !Array.isArray((result as { exactBridgeKeys?: unknown }).exactBridgeKeys) ||
    JSON.stringify((result as { exactBridgeKeys: unknown }).exactBridgeKeys) !==
      JSON.stringify([...P7_EXPECTED_RENDERER_BRIDGE_KEYS])
  ) {
    throw new Error("P7 Renderer network boundary was not physically denied");
  }
  return p7SecuritySmokeResult("P7-A-RENDERER-002");
}

type ProviderCredentialProbe = Readonly<{
  providerIpcAvailable: boolean;
  redacted: boolean;
  directFetchRejected: boolean;
  noDirectProviderResource: boolean;
  providerResourceKinds: readonly unknown[];
  leakageCount: number;
}>;

export type P7ProviderResourceSummary = Readonly<{
  valid: boolean;
  providerResourceCount: number;
  unexpectedProviderResourceCount: number;
}>;

/**
 * The packaged probe deliberately attempts one blocked Provider request. Some
 * Chromium versions retain that cancelled request in Resource Timing, so the
 * probe reports only bounded classifications instead of raw URLs. A timing
 * labelled `probe` is expected; every other Provider timing is unexpected.
 */
export function summarizeP7ProviderResourceKinds(
  values: readonly unknown[],
): P7ProviderResourceSummary {
  const valid = values.every((value) => value === "probe" || value === "unexpected");
  const unexpectedProviderResourceCount = values.filter((value) => value !== "probe").length;
  return Object.freeze({
    valid,
    providerResourceCount: values.length,
    unexpectedProviderResourceCount,
  });
}

type ProviderCredentialProbePort = Readonly<{
  executeJavaScript(source: string, userGesture?: boolean): Promise<unknown>;
}>;

export async function runP7ProviderCredentialSmoke(
  webContents: ProviderCredentialProbePort,
): Promise<readonly P7SecuritySmokeResult[]> {
  const result = await webContents.executeJavaScript(
    `(() => (async () => {
      const api = window.electronAPI ?? {};
      const listProviders = api.actestraProviderList;
      if (typeof listProviders !== 'function') {
        return { providerIpcAvailable: false, redacted: false, directFetchRejected: false, noDirectProviderResource: false, leakageCount: 1 };
      }
      let providers;
      try {
        providers = await listProviders();
      } catch {
        return { providerIpcAvailable: true, redacted: false, directFetchRejected: false, noDirectProviderResource: false, leakageCount: 1 };
      }
      let leakageCount = 0;
      const isCredentialKey = (key) => /^(?:api[_-]?key|access[_-]?key[_-]?id|secret[_-]?access[_-]?key|token|password)$/iu.test(key);
      const isAllowedRedactedCredential = (value) => value === undefined || value === '' || value === '[REDACTED]';
      const visit = (value) => {
        if (Array.isArray(value)) {
          for (const item of value) visit(item);
          return;
        }
        if (typeof value !== 'object' || value === null) return;
        for (const [key, child] of Object.entries(value)) {
          if (isCredentialKey(key) && !isAllowedRedactedCredential(child)) leakageCount += 1;
          if (!isCredentialKey(key)) visit(child);
        }
      };
      visit(providers);
      let directFetchRejected = false;
      const port = window.__backendPort;
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('backend port unavailable');
      const providerProbeUrl = 'http://127.0.0.1:' + String(port) + '/api/providers';
      try {
        await fetch(providerProbeUrl);
      } catch {
        directFetchRejected = true;
      }
      const providerResourceKinds = performance
        .getEntriesByType('resource')
        .map((entry) => {
          const name = String(entry.name);
          if (!name.includes('/api/providers')) return null;
          return name === providerProbeUrl ? 'probe' : 'unexpected';
        })
        .filter((kind) => kind !== null);
      const noDirectProviderResource = providerResourceKinds.every((kind) => kind === 'probe');
      return {
        providerIpcAvailable: true,
        redacted: Array.isArray(providers) && leakageCount === 0,
        directFetchRejected,
        noDirectProviderResource,
        providerResourceKinds,
        leakageCount,
      };
    })())()`,
    true,
  );
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    (result as ProviderCredentialProbe).providerIpcAvailable !== true ||
    (result as ProviderCredentialProbe).redacted !== true ||
    (result as ProviderCredentialProbe).directFetchRejected !== true ||
    !Array.isArray((result as ProviderCredentialProbe).providerResourceKinds) ||
    !summarizeP7ProviderResourceKinds((result as ProviderCredentialProbe).providerResourceKinds)
      .valid ||
    summarizeP7ProviderResourceKinds((result as ProviderCredentialProbe).providerResourceKinds)
      .unexpectedProviderResourceCount !== 0 ||
    (result as ProviderCredentialProbe).leakageCount !== 0
  ) {
    throw new Error("P7 Provider credential boundary was not physically denied");
  }
  return Object.freeze([
    p7SecuritySmokeResult("P7-A-CREDENTIAL-001"),
    p7SecuritySmokeResult("P7-A-CREDENTIAL-003"),
  ]);
}

function processGroupIsAlive(
  processId: number,
  leaderHasExited: () => boolean = () => false,
): boolean {
  try {
    process.kill(-processId, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return !leaderHasExited();
    throw error;
  }
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function waitForP7ProcessGone(processId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processIsAlive(processId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (processIsAlive(processId)) {
    throw new Error("P7 process cleanup left a descendant alive");
  }
}

function killProcessGroup(processId: number): void {
  try {
    process.kill(-processId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("P7 sandbox probe timed out")), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal !== null) {
        reject(new Error("P7 sandbox probe exited unexpectedly"));
      } else {
        resolve();
      }
    });
  });
}

export function isP7HostReadDeniedCode(code: unknown): boolean {
  return code === "EPERM" || code === "EACCES";
}

const P7_SANDBOX_PROBE_EXECUTABLE = "/usr/bin/perl";
const P7_SANDBOX_PROBE_PRIVATE_PARENT = "/private/var/tmp";

function createP7SandboxProbePrivateRoot(prefix: string): string {
  const canonicalParent = realpathSync(P7_SANDBOX_PROBE_PRIVATE_PARENT);
  if (
    canonicalParent !== P7_SANDBOX_PROBE_PRIVATE_PARENT ||
    !statSync(canonicalParent).isDirectory()
  ) {
    throw new Error("P7 sandbox probe private parent is unavailable");
  }
  const privateRoot = mkdtempSync(path.join(canonicalParent, prefix));
  chmodSync(privateRoot, 0o700);
  return privateRoot;
}

export async function runP7SandboxBoundaryProbe(
  isolation: Readonly<{ hostReadProbe: string; target: string }>,
): Promise<Readonly<{ networkDenied: boolean; hostReadDenied: boolean }>> {
  if (process.platform !== "darwin") throw new Error("P7 sandbox probe is unavailable");
  const hostReadProbePath = isolation.hostReadProbe;
  readFileSync(hostReadProbePath);
  const target = new URL(isolation.target);
  const targetPort = Number(target.port);
  if (
    target.protocol !== "http:" ||
    !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(target.hostname) ||
    !Number.isSafeInteger(targetPort) ||
    targetPort < 1 ||
    targetPort > 65_535
  ) {
    throw new Error("P7 sandbox probe target is invalid");
  }
  const privateRoot = createP7SandboxProbePrivateRoot("actestra-p7-worker-sandbox-");
  const resultPath = path.join(privateRoot, "probe-result.json");
  const launch = createGooseRunnerSandboxLaunch({
    executablePath: P7_SANDBOX_PROBE_EXECUTABLE,
    privateRoot,
    networkPorts: [],
  });
  const script = `use IO::Socket::INET;
my ($result_path, $host, $port, $host_read_path) = @ARGV;
my $socket = IO::Socket::INET->new(PeerAddr => $host, PeerPort => $port, Proto => "tcp", Timeout => 1.5);
my $network_denied = defined($socket) ? "false" : "true";
close($socket) if defined($socket);
my $host_read_denied = "false";
if (!open(my $host_file, "<", $host_read_path)) {
  $host_read_denied = ($!{EPERM} || $!{EACCES}) ? "true" : "false";
}
open(my $result_file, ">", $result_path) or exit 2;
print $result_file '{"networkDenied":' . $network_denied . ',"hostReadDenied":' . $host_read_denied . '}';
close($result_file) or exit 2;`;
  const child = spawn(
    launch.executable,
    [
      ...launch.args,
      "-e",
      script,
      resultPath,
      target.hostname,
      String(targetPort),
      hostReadProbePath,
    ],
    {
      detached: true,
      env: { PATH: process.env.PATH ?? "" },
      stdio: "ignore",
    },
  );
  let leaderExited = false;
  child.once("exit", () => {
    leaderExited = true;
  });
  try {
    await waitForExit(child, 5_000);
    const value = JSON.parse(readFileSync(resultPath, "utf8")) as {
      readonly networkDenied?: unknown;
      readonly hostReadDenied?: unknown;
    };
    if (value.networkDenied !== true || value.hostReadDenied !== true) {
      throw new Error(
        `P7 Worker sandbox boundary was not physically denied (${String(value.networkDenied)}/${String(value.hostReadDenied)})`,
      );
    }
    return { networkDenied: true, hostReadDenied: true };
  } finally {
    try {
      if (child.pid !== undefined && processGroupIsAlive(child.pid, () => leaderExited)) {
        killProcessGroup(child.pid);
      }
    } finally {
      rmSync(privateRoot, { recursive: true, force: true });
    }
  }
}

async function runP7WorkerAdmissionSmoke(
  isolation: P7SecuritySmokeIsolation,
): Promise<P7SecuritySmokeResult> {
  const artifact = await admitGooseRunnerArtifact(isolation.runnerArtifactDirectory, {
    trustedManifestSha256: isolation.runnerManifestSha256,
    expectedTargetTriple: process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin",
  });
  const privateRoot = path.join(isolation.temp, "p7-worker-environment");
  const environment = createGooseRunnerEnvironment(privateRoot);
  const serialized = JSON.stringify(environment);
  if (
    artifact.targetTriple.length === 0 ||
    environment.GOOSE_PATH_ROOT !== privateRoot ||
    /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)/iu.test(serialized) ||
    Object.hasOwn(environment, "OPENAI_API_KEY")
  ) {
    throw new Error("P7 Worker admission widened the environment");
  }
  return p7SecuritySmokeResult("P7-A-WORKER-001");
}

async function runP7ArtifactTrustSmoke(
  isolation: P7SecuritySmokeIsolation,
  packagedAppAsar: string,
): Promise<P7SecuritySmokeResult> {
  if (!existsSync(packagedAppAsar)) throw new Error("P7 packaged app archive is missing");
  const tamperedDirectory = path.join(isolation.temp, "p7-tampered-runner");
  cpSync(isolation.runnerArtifactDirectory, tamperedDirectory, { recursive: true });
  const manifestPath = path.join(tamperedDirectory, "actestra-goose-runner.manifest.json");
  const manifest = readFileSync(manifestPath);
  writeFileSync(manifestPath, Buffer.concat([manifest, Buffer.from("\n")]), { mode: 0o600 });
  try {
    await admitGooseRunnerArtifact(tamperedDirectory, {
      trustedManifestSha256: isolation.runnerManifestSha256,
      expectedTargetTriple:
        process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin",
    });
  } catch {
    return p7SecuritySmokeResult("P7-A-ARTIFACT-001");
  } finally {
    rmSync(tamperedDirectory, { recursive: true, force: true });
  }
  throw new Error("P7 artifact admission accepted a tampered manifest");
}

export async function runP7ProcessCleanupBoundaryProbe(): Promise<P7SecuritySmokeResult> {
  if (process.platform !== "darwin") throw new Error("P7 process-group probe is unavailable");
  const privateRoot = createP7SandboxProbePrivateRoot("actestra-p7-process-cleanup-");
  const descendantPidPath = path.join(privateRoot, "descendant.pid");
  const launch = createGooseRunnerSandboxLaunch({
    executablePath: P7_SANDBOX_PROBE_EXECUTABLE,
    privateRoot,
    networkPorts: [],
  });
  const childScript = `my ($pid_path) = @ARGV;
my $descendant = fork();
exit 2 if !defined($descendant);
if ($descendant == 0) {
  while (1) { sleep 1; }
}
open(my $pid_file, ">", $pid_path) or exit 3;
print $pid_file $descendant;
close($pid_file) or exit 3;
while (1) { sleep 1; }`;
  const child = spawn(launch.executable, [...launch.args, "-e", childScript, descendantPidPath], {
    detached: true,
    env: { PATH: process.env.PATH ?? "" },
    stdio: "ignore",
  });
  let leaderExited = false;
  child.once("exit", () => {
    leaderExited = true;
  });
  try {
    if (child.pid === undefined) throw new Error("P7 process probe has no leader");
    const deadline = Date.now() + 2_000;
    while (!existsSync(descendantPidPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!existsSync(descendantPidPath)) {
      throw new Error("P7 process probe did not create a descendant");
    }
    const descendantPid = Number(readFileSync(descendantPidPath, "utf8").trim());
    if (!Number.isSafeInteger(descendantPid) || descendantPid <= 0) {
      throw new Error("P7 process probe produced an invalid descendant");
    }
    const childExit = new Promise<void>((resolve) => {
      if (leaderExited) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
    killProcessGroup(child.pid);
    await childExit;
    await waitForP7ProcessGone(descendantPid, 2_000);
    // A second cleanup request is deliberately idempotent after the leader exits;
    // signaling a stale/reused PGID would risk affecting an unrelated process.
    if (!leaderExited) killProcessGroup(child.pid);
    if (processGroupIsAlive(child.pid, () => leaderExited)) {
      throw new Error("P7 process group survived cleanup");
    }
    if (!existsSync(descendantPidPath)) {
      throw new Error("P7 process probe lost its cleanup evidence");
    }
    rmSync(privateRoot, { recursive: true, force: true });
    if (existsSync(privateRoot)) throw new Error("P7 process private root survived cleanup");
    return p7SecuritySmokeResult("P7-A-PROCESS-002");
  } finally {
    try {
      if (child.pid !== undefined && processGroupIsAlive(child.pid, () => leaderExited)) {
        killProcessGroup(child.pid);
      }
    } finally {
      rmSync(privateRoot, { recursive: true, force: true });
    }
  }
}

export async function runP7PackagedSecuritySmoke(
  options: Readonly<{
    webContents: ProviderCredentialProbePort;
    isolation: P7SecuritySmokeIsolation;
    packagedAppAsar: string;
  }>,
): Promise<readonly P7SecuritySmokeResult[]> {
  const renderer = await runP7RendererNetworkSmoke(options.webContents, options.isolation.target);
  const credential = await runP7ProviderCredentialSmoke(options.webContents);
  const sandbox = await runP7SandboxBoundaryProbe(options.isolation);
  const worker = await runP7WorkerAdmissionSmoke(options.isolation);
  const network =
    sandbox.networkDenied && sandbox.hostReadDenied
      ? p7SecuritySmokeResult("P7-A-NETWORK-001")
      : (() => {
          throw new Error("P7 Worker network boundary was not physically denied");
        })();
  const processCleanup = await runP7ProcessCleanupBoundaryProbe();
  const artifact = await runP7ArtifactTrustSmoke(options.isolation, options.packagedAppAsar);
  return Object.freeze([renderer, ...credential, worker, network, processCleanup, artifact]);
}
