import path from "node:path";

const WEBVIEW_DEVELOPMENT_HOSTS = new Set(["127.0.0.1", "localhost"]);

type WebviewAttachEvent = Readonly<{ preventDefault: () => void }>;
type WebviewPreferences = Record<string, unknown>;
type WebviewParams = Readonly<{ src: string; partition?: string }>;
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
type WebviewOwner = Readonly<{
  on: (
    event: "will-attach-webview",
    listener: (
      event: WebviewAttachEvent,
      webPreferences: WebviewPreferences,
      params: WebviewParams,
    ) => void,
  ) => unknown;
}>;

function isAllowedWebviewSource(rawSource: string): boolean {
  try {
    const url = new URL(rawSource);
    if (url.protocol === "https:" || url.protocol === "file:" || url.protocol === "data:") {
      return true;
    }
    return url.protocol === "http:" && WEBVIEW_DEVELOPMENT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedWebviewPartition(partition: string | undefined): boolean {
  return (
    partition !== undefined &&
    /^persist:(?:actestra-preview|ext-settings-[a-z0-9._-]+)$/iu.test(partition)
  );
}

export function installWebviewGuestSecurity(
  owner: WebviewOwner,
  resolveSession: (partition: string | undefined) => WebviewSession,
): void {
  const configuredSessions = new WeakSet<object>();
  owner.on("will-attach-webview", (event, webPreferences, params) => {
    const localPreview = /^file:|^data:/iu.test(params.src);
    const allowedPartition =
      params.partition === undefined ? localPreview : isAllowedWebviewPartition(params.partition);
    if (!isAllowedWebviewSource(params.src) || !allowedPartition) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    delete webPreferences.preloadPath;
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
          try {
            const url = new URL(details.url);
            callback({
              cancel: !(
                url.protocol === "https:" ||
                (url.protocol === "http:" && WEBVIEW_DEVELOPMENT_HOSTS.has(url.hostname))
              ),
            });
          } catch {
            callback({ cancel: true });
          }
        },
      );
    }
  });
}

export const P7_PACKAGED_SECURITY_CASES = Object.freeze(["P7-A-RENDERER-002"] as const);
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
  target: string;
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
  const target = environment.ACTESTRA_P7_SECURITY_SMOKE_TARGET?.trim();
  if (
    root === undefined ||
    userData === undefined ||
    home === undefined ||
    temp === undefined ||
    sentinel === undefined ||
    workspace === undefined ||
    evidence === undefined ||
    target === undefined ||
    !path.isAbsolute(root) ||
    !path.isAbsolute(userData) ||
    !path.isAbsolute(home) ||
    !path.isAbsolute(temp) ||
    !isStrictlyInside(root, userData) ||
    !isStrictlyInside(root, home) ||
    !isStrictlyInside(root, temp) ||
    !isStrictlyInside(root, sentinel) ||
    !isStrictlyInside(root, workspace) ||
    !isStrictlyInside(root, evidence)
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
    target,
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
