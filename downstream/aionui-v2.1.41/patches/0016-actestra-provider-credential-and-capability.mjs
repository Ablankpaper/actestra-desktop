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
  const filePath = absolutePath(relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function writeNew(relativePath, contents) {
  if (fs.existsSync(absolutePath(relativePath))) {
    throw new Error(`Downstream overlay expected a new file: ${relativePath}`);
  }
  write(relativePath, contents);
}

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one downstream patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

// ---------------------------------------------------------------------------
// Provider credentials never reach the Renderer or Chromium's disk cache.
//
// The native IProvider contract carries `api_key` as a plain field, so every
// /api/providers read used to hand the Renderer a full plaintext secret, and
// the cacheable response let Chromium persist copies to disk. Main keeps the
// plaintext record it already owns; the Renderer receives a redacted view.
// ---------------------------------------------------------------------------

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `import { routeActestraApprovalRequest } from './actestraApprovalAuthorityClient';`,
  `import { routeActestraApprovalRequest } from './actestraApprovalAuthorityClient';
import {
  redactActestraProviderRecord,
  withoutRedactedActestraCredentials,
} from '@/actestra/shared/providerCredential';`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  const json = await response.json();
  // Backend wraps in { success, data, ... } — unwrap when present.
  const data =
    json && typeof json === 'object' && 'data' in json ? json.data : json;
  publishActestraHttpObservation({`,
  `  const json = await response.json();
  // Backend wraps in { success, data, ... } — unwrap when present.
  const data = redactActestraProviderSecrets(
    method,
    path,
    json && typeof json === 'object' && 'data' in json ? json.data : json
  );
  publishActestraHttpObservation({`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `// ---------------------------------------------------------------------------
// Provider factories (same shape as bridge.buildProvider)
// ---------------------------------------------------------------------------`,
  `/**
 * Main must keep reading plaintext keys: resolveAionCoreMainModelBinding pulls
 * \`api_key\` off /api/providers and hands it to the real LLM client. This bridge
 * is shared by both processes, so redaction is scoped to the Renderer — the
 * only side that must never hold the secret. Same discriminator getBackendPort
 * already uses.
 */
function isActestraRendererContext(): boolean {
  return typeof window !== 'undefined';
}

type ActestraProviderRecordRoute =
  | Readonly<{ handled: false }>
  | Readonly<{ handled: true; value: unknown }>;

function parseActestraProviderRecordPath(
  path: string
): Readonly<{ kind: 'collection' }> | Readonly<{ kind: 'record'; providerId: string }> | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(path, 'http://actestra.invalid').pathname);
  } catch {
    return null;
  }
  if (pathname === '/api/providers') return { kind: 'collection' };
  if (
    pathname === '/api/providers/fetch-models' ||
    pathname === '/api/providers/detect-protocol'
  ) {
    return null;
  }
  const match = /^\\/api\\/providers\\/([^/]+)$/.exec(pathname);
  return match?.[1] ? { kind: 'record', providerId: match[1] } : null;
}

async function routeActestraProviderRecordRequest(request: Readonly<{
  method: string;
  path: string;
  body: unknown;
}>): Promise<ActestraProviderRecordRoute> {
  if (!isActestraRendererContext() || isWebUiBrowserMode()) return { handled: false };
  const route = parseActestraProviderRecordPath(request.path);
  if (route === null) return { handled: false };

  const proxy = window.electronAPI;
  if (
    !proxy?.actestraProviderList ||
    !proxy.actestraProviderGet ||
    !proxy.actestraProviderMutate
  ) {
    throw new BackendHttpError({
      method: request.method,
      path: request.path,
      status: 503,
      body: {
        success: false,
        error: 'Actestra Provider authority is unavailable.',
        code: 'provider-unavailable',
      },
    });
  }

  if (request.method === 'GET') {
    return {
      handled: true,
      value:
        route.kind === 'collection'
          ? await proxy.actestraProviderList()
          : await proxy.actestraProviderGet(route.providerId),
    };
  }
  if (request.method === 'POST' && route.kind === 'collection') {
    return {
      handled: true,
      value: await proxy.actestraProviderMutate({ operation: 'create', body: request.body }),
    };
  }
  if (request.method === 'PUT' && route.kind === 'record') {
    return {
      handled: true,
      value: await proxy.actestraProviderMutate({
        operation: 'update',
        providerId: route.providerId,
        body: request.body,
      }),
    };
  }
  if (request.method === 'DELETE' && route.kind === 'record') {
    return {
      handled: true,
      value: await proxy.actestraProviderMutate({
        operation: 'delete',
        providerId: route.providerId,
      }),
    };
  }

  throw new BackendHttpError({
    method: request.method,
    path: request.path,
    status: 405,
    body: {
      success: false,
      error: 'Actestra Provider operation is not allowed.',
      code: 'provider-operation-not-allowed',
    },
  });
}

/**
 * Strips provider secrets from any response body that carries provider records.
 * Applied to every method so a create/update echo cannot reintroduce the leak.
 */
export function redactActestraProviderSecrets(
  _method: string,
  path: string,
  data: unknown
): unknown {
  if (!isActestraRendererContext() || !path.startsWith('/api/providers')) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(redactActestraProviderRecord);
  }
  return redactActestraProviderRecord(data);
}

// ---------------------------------------------------------------------------
// Provider factories (same shape as bridge.buildProvider)
// ---------------------------------------------------------------------------`,
);
// Redaction removes the secret from the parsed body, but Chromium decides on its
// own whether to persist the raw HTTP response to the disk cache. `no-store`
// keeps provider responses out of that cache in both directions.
replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }`,
  `  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // Provider records carry credentials: never let this response be cached.
  const isCredentialBearingPath = path.startsWith('/api/providers');
  if (isCredentialBearingPath) {
    headers['Cache-Control'] = 'no-store';
  }`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });`,
  `  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...(isCredentialBearingPath ? { cache: 'no-store' as const } : {}),
  });`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `    if (options?.silentStatuses?.includes(response.status)) {
      console.debug(\`[httpBridge] \${method} \${path} → \${response.status} (silenced)\`, errorBody);
    } else {
      console.error(\`[httpBridge] \${method} \${path} → \${response.status}\`, errorBody);
    }
    throw new BackendHttpError({ method, path, status: response.status, body: errorBody });`,
  `    // Provider responses are credential-bearing even on failure. Never retain
    // or log a raw error body from that route: gateways may echo authorization
    // hints or embedded provider URLs.
    const safeErrorBody = isCredentialBearingPath
      ? {
          success: false,
          error: 'Provider request failed',
          code: 'provider-request-failed',
        }
      : errorBody;
    if (options?.silentStatuses?.includes(response.status)) {
      console.debug(\`[httpBridge] \${method} \${path} → \${response.status} (silenced)\`, safeErrorBody);
    } else {
      console.error(\`[httpBridge] \${method} \${path} → \${response.status}\`, safeErrorBody);
    }
    throw new BackendHttpError({ method, path, status: response.status, body: safeErrorBody });`,
);
// ---------------------------------------------------------------------------
// The process boundary: Renderer provider reads never touch the raw bytes.
//
// Redaction after `response.json()` still parses the plaintext secret inside
// the Renderer, so the exposed backend port alone is enough to read a live key.
// Main owns the fetch instead and redacts before the value crosses IPC, so the
// Renderer only ever receives sentinels. Main-side callers keep using
// httpRequest directly, which is how resolveAionCoreMainModelBinding still
// reads the real key.
// ---------------------------------------------------------------------------

replaceOnce(
  "packages/desktop/src/index.ts",
  `ipcMain.handle('backend:recover-corrupted-database', async () => {`,
  `registerActestraProviderRendererIpc({
  ipcMain,
  request: async (method, requestPath, body) => {
    const { httpRequest } = await import('./common/adapter/httpBridge');
    return httpRequest<unknown>(method, requestPath, body);
  },
  trustedWebContents: () => mainWindow?.webContents ?? null,
});

ipcMain.handle('backend:recover-corrupted-database', async () => {`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `  recoverCorruptedDatabase: () => ipcRenderer.invoke('backend:recover-corrupted-database'),`,
  `  recoverCorruptedDatabase: () => ipcRenderer.invoke('backend:recover-corrupted-database'),
  // Main-owned provider proxy: the Renderer receives pre-redacted records only.
  actestraProviderList: () => ipcRenderer.invoke('actestra:provider-list'),
  actestraProviderGet: (providerId: string) => ipcRenderer.invoke('actestra:provider-get', providerId),
  actestraProviderMutate: (request: unknown) => ipcRenderer.invoke('actestra:provider-mutate', request),`,
);

replaceOnce(
  "packages/desktop/src/common/types/platform/electron.ts",
  `  recoverCorruptedDatabase?: () => Promise<void>;`,
  `  recoverCorruptedDatabase?: () => Promise<void>;
  actestraProviderList?: () => Promise<unknown>;
  actestraProviderGet?: (providerId: string) => Promise<unknown>;
  actestraProviderMutate?: (request: unknown) => Promise<unknown>;`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `import { runGeneralWorkerProbe } from './actestra/main/workers/generalWorkerProbe';`,
  `import { runGeneralWorkerProbe } from './actestra/main/workers/generalWorkerProbe';
import {
  installActestraProviderRendererBoundary,
  registerActestraProviderRendererIpc,
} from './actestra/main/compatibility/providerRendererBoundary';`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  console.log('[Actestra] Main window created (id=' + mainWindow.id + ')');`,
  `  console.log('[Actestra] Main window created (id=' + mainWindow.id + ')');
  installActestraProviderRendererBoundary({
    backendPort: () => backendManager.port,
    webRequest: mainWindow.webContents.session.webRequest,
  });`,
);

// Renderer Provider record CRUD is re-routed onto the Main proxy before the
// fetch is ever issued, so no plaintext response body is parsed in this process.
replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  const approvalRoute = await routeActestraApprovalRequest({ method, path, body });`,
  `  const providerRoute = await routeActestraProviderRecordRequest({
    method,
    path,
    body: requestBody,
  });
  if (providerRoute.handled) {
    publishActestraHttpObservation({ method, path, response: providerRoute.value });
    return providerRoute.value as T;
  }

  const approvalRoute = await routeActestraApprovalRequest({ method, path, body });`,
);

// ---------------------------------------------------------------------------
// The sentinel contract.
//
// Redaction is only safe because every consumer can tell "a key is configured"
// from "here is the key". This module is the single definition of that
// distinction, so the Renderer never has to compare against a bare string.
// ---------------------------------------------------------------------------

writeNew(
  "packages/desktop/src/actestra/shared/providerCredential.ts",
  `/**
 * The placeholder the Renderer receives in place of a provider secret.
 *
 * Main keeps the plaintext record it already owns; every value that crosses
 * into the Renderer carries this sentinel instead. It is deliberately not a
 * plausible key: any request that reaches a real gateway with this value is a
 * bug in the caller, not a credential that might partially work.
 */
export const ACTESTRA_REDACTED_CREDENTIAL = '[REDACTED]';

/**
 * True when \`value\` is the redaction sentinel rather than a usable secret.
 */
export function isActestraRedactedCredential(value: unknown): boolean {
  return value === ACTESTRA_REDACTED_CREDENTIAL;
}

/**
 * True when a provider field holds a credential the caller may actually send
 * to a gateway. A redacted sentinel is configured-but-unusable, so it answers
 * "is a key set?" with yes and "can I authenticate with it?" with no.
 */
export function isUsableActestraCredential(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && !isActestraRedactedCredential(value);
}

/**
 * Drops redacted fields from a provider update so a save cannot overwrite the
 * stored secret with the sentinel.
 *
 * \`UpdateProviderRequest\` is fully partial: an omitted field keeps whatever
 * Main already has. That makes omission — not substitution — the correct way
 * for a Renderer that never learned the secret to leave it untouched.
 */
export function withoutRedactedActestraCredentials<T>(update: T): T {
  if (typeof update !== 'object' || update === null) {
    return update;
  }
  const source = update as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (isActestraRedactedCredential(value)) {
      continue;
    }
    if (key === 'bedrock_config' && typeof value === 'object' && value !== null) {
      const nested: Record<string, unknown> = {};
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (!isActestraRedactedCredential(nestedValue)) {
          nested[nestedKey] = nestedValue;
        }
      }
      result[key] = nested;
      continue;
    }
    result[key] = value;
  }
  return result as T;
}

/**
 * Returns a provider record with every secret replaced by the sentinel.
 *
 * This lives in the shared module rather than in httpBridge because Main is the
 * process that performs the redaction: it runs before the record crosses IPC,
 * so the Renderer never receives the plaintext response bytes at all.
 */
export function redactActestraProviderRecord(provider: unknown): unknown {
  if (typeof provider !== 'object' || provider === null) {
    return provider;
  }
  const { api_key, bedrock_config, base_url, ...rest } = provider as Record<string, unknown>;
  const redacted: Record<string, unknown> = { ...rest };
  if (typeof base_url === 'string') {
    try {
      const parsed = new URL(base_url);
      if (parsed.username || parsed.password || [...parsed.searchParams.keys()].some((key) => /(?:key|token|secret|auth|password)/iu.test(key))) {
        redacted.base_url = parsed.protocol + '//' + parsed.host + parsed.pathname;
      } else {
        redacted.base_url = base_url;
      }
    } catch {
      redacted.base_url = '[REDACTED]';
    }
  } else if (base_url !== undefined) {
    redacted.base_url = '[REDACTED]';
  }
  if (api_key !== undefined) {
    // Preserve "a key is configured" without disclosing the secret itself.
    redacted.api_key =
      typeof api_key === 'string' && api_key.length === 0 ? '' : ACTESTRA_REDACTED_CREDENTIAL;
  }
  if (bedrock_config !== undefined) {
    if (typeof bedrock_config === 'object' && bedrock_config !== null) {
      const { access_key_id, secret_access_key, ...restBedrock } = bedrock_config as Record<
        string,
        unknown
      >;
      redacted.bedrock_config = {
        ...restBedrock,
        ...(access_key_id !== undefined
          ? { access_key_id: ACTESTRA_REDACTED_CREDENTIAL }
          : {}),
        ...(secret_access_key !== undefined
          ? { secret_access_key: ACTESTRA_REDACTED_CREDENTIAL }
          : {}),
      };
    } else {
      redacted.bedrock_config = bedrock_config;
    }
  }
  return redacted;
}
`,
);
// ---------------------------------------------------------------------------
// The write path: a redacted key must never be persisted.
//
// EditModeModal / AddModelModal both save `{...data, ...values}`, so a redacted
// `data.api_key` would otherwise be written straight back over the real secret.
// Guarding the single updateProvider seam covers every such caller at once,
// rather than asking each modal to remember the rule.
// ---------------------------------------------------------------------------

// ipcBridge.ts is a declared R0 invariant, so the guard lives on the httpBridge
// request path instead. That is the stricter placement anyway: it covers every
// provider write, not just the one `mode.updateProvider` helper.
replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,`,
  `  const response = await fetch(url, {
    method,
    headers,
    body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  // Provider records carry credentials: never let this response be cached.
  const isCredentialBearingPath = path.startsWith('/api/providers');
  if (isCredentialBearingPath) {
    headers['Cache-Control'] = 'no-store';
  }`,
  `  // Provider records carry credentials: never let this response be cached.
  const isCredentialBearingPath = path.startsWith('/api/providers');
  if (isCredentialBearingPath) {
    headers['Cache-Control'] = 'no-store';
  }

  // The Renderer only ever saw a sentinel for secrets it did not change, so
  // writing one back would clobber the stored plaintext. Dropping those fields
  // preserves the stored value, because every provider write field is optional.
  const requestBody = isCredentialBearingPath
    ? withoutRedactedActestraCredentials(body)
    : body;`,
);
// ---------------------------------------------------------------------------
// The read path: never authenticate with a sentinel.
//
// useModeModeList gated on `!!api_key` and forwarded the value verbatim to the
// anonymous /api/providers/fetch-models route. A redacted key is truthy, so
// without this the hook would ask a real gateway to authenticate with
// "[REDACTED]" and surface an auth error instead of an empty list.
// ---------------------------------------------------------------------------

replaceOnce(
  "packages/desktop/src/renderer/hooks/agent/useModeModeList.ts",
  `import { ipcBridge } from '@/common';
import useSWR from 'swr';`,
  `import { ipcBridge } from '@/common';
import {
  isActestraRedactedCredential,
  isUsableActestraCredential,
} from '@/actestra/shared/providerCredential';
import useSWR from 'swr';`,
);

// A saved provider's key reaches the Renderer as a sentinel, so the anonymous
// route can no longer authenticate for it. Threading the provider id lets the
// hook fall back to the id-scoped route, where Main supplies the stored secret.
replaceOnce(
  "packages/desktop/src/renderer/hooks/agent/useModeModeList.ts",
  `  bedrock_config?: {
    auth_method: 'accessKey' | 'profile';
    region: string;
    access_key_id?: string;
    secret_access_key?: string;
    profile?: string;
  }
) => {
  return useSWR(
    [platform + '/models', { platform, base_url, api_key, try_fix, bedrock_config }],
    async ([_url, { platform, base_url, api_key, try_fix, bedrock_config }]): Promise<{`,
  `  bedrock_config?: {
    auth_method: 'accessKey' | 'profile';
    region: string;
    access_key_id?: string;
    secret_access_key?: string;
    profile?: string;
  },
  provider_id?: string
) => {
  return useSWR(
    [
      platform + '/models',
      { platform, base_url, api_key, try_fix, bedrock_config, provider_id },
    ],
    async ([
      _url,
      { platform, base_url, api_key, try_fix, bedrock_config, provider_id },
    ]): Promise<{`,
);

replaceOnce(
  "packages/desktop/src/renderer/hooks/agent/useModeModeList.ts",
  `      const hasUsableCredentials = platform === 'bedrock' ? !!bedrock_config : !!api_key;
      if (hasUsableCredentials) {
        const res = await ipcBridge.mode.fetchModelList.invoke({
          base_url,
          api_key: api_key ?? '',
          try_fix,
          platform,
          bedrock_config,
        });`,
  `      // A saved provider's key arrives redacted, so the anonymous route cannot
      // authenticate for it. The id-scoped route can: Main still holds the
      // plaintext and resolves it server-side.
      const useStoredCredential = isActestraRedactedCredential(api_key) && !!provider_id;
      const hasUsableCredentials =
        platform === 'bedrock' ? !!bedrock_config : isUsableActestraCredential(api_key);
      if (hasUsableCredentials || useStoredCredential) {
        const res = useStoredCredential
          ? await ipcBridge.mode.fetchProviderModels.invoke({
              id: provider_id as string,
              try_fix,
            })
          : await ipcBridge.mode.fetchModelList.invoke({
              base_url,
              api_key: api_key ?? '',
              try_fix,
              platform,
              bedrock_config,
            });`,
);

// Both existing-provider call sites pass the id so the hook can reach the
// id-scoped route when the form still holds the sentinel.
replaceOnce(
  "packages/desktop/src/renderer/pages/settings/components/EditModeModal.tsx",
  `    const modelListState = useModeModeList(
      data?.platform || 'gemini',
      isFullUrl ? '' : effectiveBaseUrl,
      isFullUrl ? '' : effectiveApiKey,
      true,
      undefined
    );`,
  `    const modelListState = useModeModeList(
      data?.platform || 'gemini',
      isFullUrl ? '' : effectiveBaseUrl,
      isFullUrl ? '' : effectiveApiKey,
      true,
      undefined,
      data?.id
    );`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/components/AddModelModal.tsx",
  `    const { data: modelList, isLoading } = useModeModeList(data?.platform, data?.base_url, data?.api_key);`,
  `    const { data: modelList, isLoading } = useModeModeList(
      data?.platform,
      data?.base_url,
      data?.api_key,
      undefined,
      undefined,
      data?.id
    );`,
);

// EditModeModal's Base URL blur runs its own fetch outside the hook, so it needs
// the same guard or a Base URL edit on a saved provider would authenticate with
// the sentinel.
replaceOnce(
  "packages/desktop/src/renderer/pages/settings/components/EditModeModal.tsx",
  `import { getProviderLogo } from '@/renderer/utils/model/modelPlatforms';`,
  `import { getProviderLogo } from '@/renderer/utils/model/modelPlatforms';
import { isUsableActestraCredential } from '@/actestra/shared/providerCredential';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/components/EditModeModal.tsx",
  `      // Backend requires an api_key for non-bedrock platforms; without one a
      // fetch would just return empty — skip and clear any stale hint.
      if (!apiKey) {`,
  `      // Backend requires an api_key for non-bedrock platforms; without one a
      // fetch would just return empty — skip and clear any stale hint. A
      // redacted key is unusable for the same purpose.
      if (!isUsableActestraCredential(apiKey)) {`,
);
// ---------------------------------------------------------------------------
// Provider capability declaration.
//
// Team creation admits a provider only when it declares `text` and
// `function_calling`, but this modal never submitted `capabilities` at all — so
// a fresh profile could not produce a Team-eligible custom provider through the
// UI. `capabilities` already exists on IProvider and on both request contracts,
// so this is purely a missing control, not a wire change.
// ---------------------------------------------------------------------------

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/components/AddPlatformModal.tsx",
  `import type { IProvider } from '@/common/config/storage';`,
  `import type { IProvider, ModelType } from '@/common/config/storage';
import {
  ACTESTRA_TEAM_REQUIRED_CAPABILITIES,
  actestraCapabilityOptions,
  toActestraModelCapabilities,
} from '@/actestra/shared/providerCapability';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/components/AddPlatformModal.tsx",
  `          models: Array.isArray(values.model) ? values.model : [values.model],
          is_full_url: isFullUrl,
        };`,
  `          models: Array.isArray(values.model) ? values.model : [values.model],
          is_full_url: isFullUrl,
          // Declared by the user, so a custom provider can satisfy the Team
          // admission contract without hand-editing stored config.
          capabilities: toActestraModelCapabilities(values.capabilities as ModelType[] | undefined),
        };`,
);
writeNew(
  "packages/desktop/src/actestra/shared/providerCapability.ts",
  `import type { ModelCapability, ModelType } from '@/common/config/storage';

/**
 * The capabilities a provider must declare before a Team will admit it.
 *
 * A Team worker needs to produce text and to call tools; a provider missing
 * either cannot run one, so these are pre-selected rather than merely offered.
 */
export const ACTESTRA_TEAM_REQUIRED_CAPABILITIES: readonly ModelType[] = Object.freeze([
  'text',
  'function_calling',
]);

/**
 * Capability choices offered when configuring a provider, in declaration order.
 */
export const ACTESTRA_DECLARABLE_CAPABILITIES: readonly ModelType[] = Object.freeze([
  'text',
  'function_calling',
  'vision',
  'reasoning',
  'web_search',
  'image_generation',
]);

/**
 * Select options for the capability control. Labels come from the caller so the
 * shared module stays free of i18n wiring.
 */
export function actestraCapabilityOptions(
  label: (type: ModelType) => string
): { label: string; value: ModelType }[] {
  return ACTESTRA_DECLARABLE_CAPABILITIES.map((type) => ({ label: label(type), value: type }));
}

/**
 * Normalizes a capability selection into the stored \`ModelCapability\` shape.
 *
 * Marked \`isUserSelected\` because these come from an explicit choice rather
 * than from name-pattern inference, so later inference must not silently
 * override them. Falls back to the Team-required set when the caller passes
 * nothing, which keeps the common case working without a decision.
 */
export function toActestraModelCapabilities(selection: ModelType[] | undefined): ModelCapability[] {
  const selected = selection === undefined || selection.length === 0
    ? ACTESTRA_TEAM_REQUIRED_CAPABILITIES
    : selection;
  const seen = new Set<ModelType>();
  const capabilities: ModelCapability[] = [];
  for (const type of selected) {
    if (seen.has(type)) continue;
    seen.add(type);
    capabilities.push({ type, isUserSelected: true });
  }
  return capabilities;
}
`,
);
// The Team-eligibility hint tracks the live selection, so the capability field
// needs a watcher alongside the ones the modal already keeps.
replaceOnce(
  "packages/desktop/src/renderer/pages/settings/components/AddPlatformModal.tsx",
  `  const bedrockAuthMethod = Form.useWatch('bedrockAuthMethod', form);`,
  `  const declaredCapabilities = Form.useWatch('capabilities', form) as ModelType[] | undefined;
  const missingTeamCapabilities = useMemo(() => {
    const declared = new Set(declaredCapabilities ?? []);
    return ACTESTRA_TEAM_REQUIRED_CAPABILITIES.filter((type) => !declared.has(type));
  }, [declaredCapabilities]);
  const bedrockAuthMethod = Form.useWatch('bedrockAuthMethod', form);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/components/AddPlatformModal.tsx",
  `          {/* AWS Bedrock Authentication Method */}`,
  `          {/* Declared capabilities — gates Team eligibility */}
          <Form.Item
            label={t('settings.capabilities', '模型能力')}
            field={'capabilities'}
            initialValue={[...ACTESTRA_TEAM_REQUIRED_CAPABILITIES]}
            required
            rules={[
              {
                // A declaration must say something, but which capabilities are
                // right belongs to the provider: an image-only endpoint is a
                // legitimate configuration. Team eligibility is surfaced as a
                // hint below rather than enforced here.
                validator: (value: ModelType[] | undefined, callback: (error?: string) => void) => {
                  if ((value ?? []).length === 0) {
                    callback(
                      t('settings.capabilitiesRequiredHint', '请至少声明一项模型能力')
                    );
                    return;
                  }
                  callback();
                },
              },
            ]}
            extra={
              <div className='text-11px text-t-secondary mt-2 leading-4'>
                {missingTeamCapabilities.length > 0
                  ? t(
                      'settings.capabilitiesTeamHint',
                      '团队协作需要 text 与 function_calling，缺少时该模型无法加入团队'
                    )
                  : t('settings.capabilitiesTeamReadyHint', '该模型可用于团队协作')}
              </div>
            }
          >
            <Select mode='multiple' placeholder={t('settings.capabilities', '模型能力')}>
              {actestraCapabilityOptions((type) => t(\`settings.capability.\${type}\`, type)).map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          {/* AWS Bedrock Authentication Method */}`,
);

// ---------------------------------------------------------------------------
// The upstream Select mock labels every multi-select `model-select`.
//
// Declaring capabilities adds a second `mode='multiple'` control to the
// platform modal, so that mock now labels two controls the same and
// `findByTestId('model-select')` fails as ambiguous. The capability control is
// the only multi-select offering 'function_calling', which keeps the model
// picker's identity untouched — the mock stays as upstream wrote it for every
// control it already knew about.
// ---------------------------------------------------------------------------
replaceOnce(
  "tests/unit/common-config/modelCapabilities.dom.test.tsx",
  `    const testId =
      mode === 'multiple'
        ? 'model-select'`,
  `    const testId =
      mode === 'multiple'
        ? optionValues.has('function_calling')
          ? 'actestra-capabilities-select'
          : 'model-select'`,
);

replaceOnce(
  "tests/unit/common-adapter/httpBridge.test.ts",
  `  describe('httpGet', () => {`,
  `  describe('Actestra provider record boundary', () => {
    it('routes Provider record CRUD through the fixed Main proxy without fetch', async () => {
      const fetchSpy = vi.fn();
      const actestraProviderList = vi.fn().mockResolvedValue([{ id: 'provider-1', api_key: '[REDACTED]' }]);
      const actestraProviderGet = vi.fn().mockResolvedValue({ id: 'provider-1', api_key: '[REDACTED]' });
      const actestraProviderMutate = vi.fn()
        .mockResolvedValueOnce({ id: 'provider-1', api_key: '[REDACTED]' })
        .mockResolvedValueOnce({ id: 'provider-1', api_key: '[REDACTED]' })
        .mockResolvedValueOnce(undefined);
      vi.stubGlobal('fetch', fetchSpy);
      vi.stubGlobal('window', {
        __backendPort: 13400,
        electronAPI: { actestraProviderList, actestraProviderGet, actestraProviderMutate },
      });
      vi.spyOn(console, 'debug').mockImplementation(() => {});

      await expect(httpRequest('GET', '/api/providers')).resolves.toEqual([
        { id: 'provider-1', api_key: '[REDACTED]' },
      ]);
      await expect(httpRequest('GET', '/api/providers/provider-1')).resolves.toMatchObject({ id: 'provider-1' });
      await expect(
        httpRequest('POST', '/api/providers', { name: 'Provider', api_key: 'new-key' })
      ).resolves.toMatchObject({ id: 'provider-1' });
      await expect(
        httpRequest('PUT', '/api/providers/provider-1', {
          name: 'Provider',
          api_key: '[REDACTED]',
        })
      ).resolves.toMatchObject({ id: 'provider-1' });
      await expect(httpRequest('DELETE', '/api/providers/provider-1')).resolves.toBeUndefined();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(actestraProviderList).toHaveBeenCalledTimes(1);
      expect(actestraProviderGet).toHaveBeenCalledWith('provider-1');
      expect(actestraProviderMutate).toHaveBeenNthCalledWith(1, {
        operation: 'create',
        body: { name: 'Provider', api_key: 'new-key' },
      });
      expect(actestraProviderMutate).toHaveBeenNthCalledWith(2, {
        operation: 'update',
        providerId: 'provider-1',
        body: { name: 'Provider' },
      });
      expect(actestraProviderMutate).toHaveBeenNthCalledWith(3, {
        operation: 'delete',
        providerId: 'provider-1',
      });
    });

    it('keeps non-record Provider model discovery on the retained HTTP route', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { models: ['model-1'] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchSpy);
      vi.stubGlobal('window', {
        __backendPort: 13400,
        electronAPI: {
          actestraProviderList: vi.fn(),
          actestraProviderGet: vi.fn(),
          actestraProviderMutate: vi.fn(),
        },
      });
      vi.spyOn(console, 'debug').mockImplementation(() => {});

      await expect(
        httpRequest('POST', '/api/providers/fetch-models', { api_key: 'preview-key' })
      ).resolves.toEqual({ models: ['model-1'] });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('httpGet', () => {`,
);

// ---------------------------------------------------------------------------
// Provider record network boundary regression.
//
// The Electron Renderer still needs the local AionCore port for retained
// AionUI features, so deleting that bridge would break the product. The
// security boundary instead blocks only provider record endpoints in the
// Renderer session while leaving non-secret provider operations reachable.
// ---------------------------------------------------------------------------

writeNew(
  "packages/desktop/src/actestra/main/compatibility/providerRendererBoundary.ts",
  `import {
  redactActestraProviderRecord,
  withoutRedactedActestraCredentials,
} from '@/actestra/shared/providerCredential';

export const ACTESTRA_PROVIDER_LIST_CHANNEL = 'actestra:provider-list';
export const ACTESTRA_PROVIDER_GET_CHANNEL = 'actestra:provider-get';
export const ACTESTRA_PROVIDER_MUTATE_CHANNEL = 'actestra:provider-mutate';

/**
 * Renderer code retains the AionCore port for preserved AionUI routes, but it
 * must never read or mutate a credential-bearing Provider record directly.
 * Main owns those records through a small, explicit IPC boundary instead.
 */

export interface ActestraProviderRecordRequest {
  readonly backendPort: number;
  readonly method: string;
  readonly url: string;
}

export interface ActestraProviderRendererWebRequest {
  onBeforeRequest(
    filter: Readonly<{ urls: readonly string[] }>,
    listener: (
      details: Readonly<{ method: string; url: string }>,
      callback: (result: Readonly<{ cancel: boolean }>) => void,
    ) => void,
  ): void;
}

export interface ActestraProviderRendererBoundaryOptions {
  readonly backendPort: () => number;
  readonly webRequest: ActestraProviderRendererWebRequest;
}

export interface ActestraProviderRendererIpcMain {
  handle(
    channel: string,
    listener: (event: Readonly<{ sender: unknown; senderFrame: unknown }>, ...args: unknown[]) => unknown,
  ): void;
}

export interface ActestraProviderRendererWebContents {
  readonly mainFrame: unknown;
  isDestroyed(): boolean;
}

export interface ActestraProviderRendererIpcOptions {
  readonly ipcMain: ActestraProviderRendererIpcMain;
  readonly request: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<unknown>;
  readonly trustedWebContents: () => ActestraProviderRendererWebContents | null;
}

type ProviderMutationOperation = 'create' | 'update' | 'delete';

function providerUnavailable(): Error {
  return new Error('Actestra provider request is unavailable');
}

function providerInvalid(): Error {
  return new Error('Actestra provider request is invalid');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function assertProviderId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    hasControlCharacter(value)
  ) {
    throw providerInvalid();
  }
}

function isTrustedEvent(
  event: Readonly<{ sender: unknown; senderFrame: unknown }>,
  options: ActestraProviderRendererIpcOptions,
): boolean {
  try {
    const webContents = options.trustedWebContents();
    return (
      webContents !== null &&
      webContents.isDestroyed() === false &&
      event.sender === webContents &&
      event.senderFrame === webContents.mainFrame
    );
  } catch {
    return false;
  }
}

function redactedProviderResponse(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(redactActestraProviderRecord)
    : redactActestraProviderRecord(value);
}

function parseProviderMutation(value: unknown):
  | Readonly<{ operation: 'create'; body: Record<string, unknown> }>
  | Readonly<{ operation: 'update'; providerId: string; body: Record<string, unknown> }>
  | Readonly<{ operation: 'delete'; providerId: string }> {
  const request = asRecord(value);
  if (request === null || typeof request.operation !== 'string') throw providerInvalid();

  const operation = request.operation as ProviderMutationOperation;
  if (operation === 'create') {
    if (!hasOnlyKeys(request, ['operation', 'body'])) throw providerInvalid();
    const body = asRecord(request.body);
    if (body === null) throw providerInvalid();
    return Object.freeze({ operation, body });
  }
  if (operation === 'update') {
    if (!hasOnlyKeys(request, ['operation', 'providerId', 'body'])) throw providerInvalid();
    assertProviderId(request.providerId);
    const body = asRecord(request.body);
    if (body === null) throw providerInvalid();
    return Object.freeze({ operation, providerId: request.providerId, body });
  }
  if (operation === 'delete') {
    if (!hasOnlyKeys(request, ['operation', 'providerId'])) throw providerInvalid();
    assertProviderId(request.providerId);
    return Object.freeze({ operation, providerId: request.providerId });
  }
  throw providerInvalid();
}

/**
 * Registers the only Renderer-facing Provider record operations. It is not a
 * generic HTTP proxy: method and route are derived from a fixed request union.
 */
export function registerActestraProviderRendererIpc(
  options: ActestraProviderRendererIpcOptions,
): void {
  const requireTrusted = (event: Readonly<{ sender: unknown; senderFrame: unknown }>, args: readonly unknown[]) => {
    if (args.length !== 0 || !isTrustedEvent(event, options)) throw providerUnavailable();
  };

  options.ipcMain.handle(ACTESTRA_PROVIDER_LIST_CHANNEL, async (event, ...args) => {
    requireTrusted(event, args);
    return redactedProviderResponse(await options.request('GET', '/api/providers'));
  });

  options.ipcMain.handle(ACTESTRA_PROVIDER_GET_CHANNEL, async (event, ...args) => {
    if (!isTrustedEvent(event, options)) throw providerUnavailable();
    if (args.length !== 1) throw providerInvalid();
    assertProviderId(args[0]);
    return redactedProviderResponse(
      await options.request('GET', '/api/providers/' + encodeURIComponent(args[0])),
    );
  });

  options.ipcMain.handle(ACTESTRA_PROVIDER_MUTATE_CHANNEL, async (event, ...args) => {
    if (!isTrustedEvent(event, options)) throw providerUnavailable();
    if (args.length !== 1) throw providerInvalid();
    const mutation = parseProviderMutation(args[0]);
    if (mutation.operation === 'create') {
      return redactedProviderResponse(
        await options.request('POST', '/api/providers', withoutRedactedActestraCredentials(mutation.body)),
      );
    }
    if (mutation.operation === 'update') {
      return redactedProviderResponse(
        await options.request(
          'PUT',
          '/api/providers/' + encodeURIComponent(mutation.providerId),
          withoutRedactedActestraCredentials(mutation.body),
        ),
      );
    }
    return options.request('DELETE', '/api/providers/' + encodeURIComponent(mutation.providerId), undefined);
  });
}

function isBackendPort(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}

function canonicalPathname(url: URL): string | null {
  try {
    const decoded = decodeURIComponent(url.pathname);
    return decoded.length > 1 ? decoded.replace(/\\/+$/, '') : decoded;
  } catch {
    return null;
  }
}

/**
 * Classifies only the collection and one-record Provider routes. The hostname
 * deliberately does not participate: any HTTP origin pointed at the active
 * backend port is equivalent from the Renderer security boundary.
 */
export function isActestraProviderRecordRequest(request: ActestraProviderRecordRequest): boolean {
  if (!isBackendPort(request.backendPort)) return false;

  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' || parsed.port !== String(request.backendPort)) return false;

  const pathname = canonicalPathname(parsed);
  if (pathname === null) return false;
  if (pathname === '/api/providers') return true;

  if (
    pathname === '/api/providers/fetch-models' ||
    pathname === '/api/providers/detect-protocol'
  ) {
    return false;
  }

  const match = /^\\/api\\/providers\\/([^/]+)$/.exec(pathname);
  return match !== null && match[1].length > 0;
}

/**
 * Cancels bypass-style Renderer fetches before Chromium sends them to AionCore.
 * The listener resolves the port at request time because the window is created
 * before backend startup completes.
 */
export function installActestraProviderRendererBoundary(
  options: ActestraProviderRendererBoundaryOptions,
): void {
  options.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, callback) => {
    callback({
      cancel: isActestraProviderRecordRequest({
        backendPort: options.backendPort(),
        method: details.method,
        url: details.url,
      }),
    });
  });
}
`,
);

writeNew(
  "tests/unit/actestra/providerRendererBoundary.test.ts",
  `import { describe, expect, it, vi } from 'vitest';
import {
  ACTESTRA_PROVIDER_GET_CHANNEL,
  ACTESTRA_PROVIDER_LIST_CHANNEL,
  ACTESTRA_PROVIDER_MUTATE_CHANNEL,
  installActestraProviderRendererBoundary,
  isActestraProviderRecordRequest,
  registerActestraProviderRendererIpc,
} from '@/actestra/main/compatibility/providerRendererBoundary';

type ProviderIpcHandler = (
  event: Readonly<{ sender: unknown; senderFrame: unknown }>,
  ...args: unknown[]
) => Promise<unknown> | unknown;

function createProviderIpcHarness() {
  const handlers = new Map<string, ProviderIpcHandler>();
  const mainFrame = {};
  const webContents = {
    mainFrame,
    isDestroyed: () => false,
  };
  const request = vi.fn(async (method: string, path: string, body?: unknown) => {
    if (method === 'DELETE') return undefined;
    return { id: 'provider-1', api_key: 'opaque-test-credential', method, path, body };
  });

  registerActestraProviderRendererIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as ProviderIpcHandler),
    },
    request,
    trustedWebContents: () => webContents,
  });

  return {
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error('missing provider IPC handler');
      return handler({ sender: webContents, senderFrame: mainFrame }, ...args);
    },
    invokeUntrusted: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error('missing provider IPC handler');
      return handler({ sender: {}, senderFrame: {} }, ...args);
    },
    request,
  };
}

describe('Actestra Provider Renderer boundary', () => {
  it.each([
    ['GET', 'http://127.0.0.1:49152/api/providers'],
    ['POST', 'http://localhost:49152/api/providers?source=renderer'],
    ['GET', 'http://127.0.0.1:49152/api/providers/provider-1'],
    ['PUT', 'http://loopback.invalid:49152/api/providers/provider%2D1?save=1'],
    ['DELETE', 'http://[::1]:49152/api/providers/provider-1/'],
  ])('classifies direct %s provider record access through any host alias', (method, url) => {
    expect(isActestraProviderRecordRequest({ backendPort: 49152, method, url })).toBe(true);
  });

  it.each([
    ['GET', 'http://127.0.0.1:49153/api/providers'],
    ['GET', 'https://127.0.0.1:49152/api/providers'],
    ['POST', 'http://127.0.0.1:49152/api/providers/fetch-models'],
    ['POST', 'http://127.0.0.1:49152/api/providers/detect-protocol'],
    ['POST', 'http://127.0.0.1:49152/api/providers/provider-1/models'],
    ['GET', 'http://127.0.0.1:49152/api/teams'],
  ])('preserves non-record request %s %s', (method, url) => {
    expect(isActestraProviderRecordRequest({ backendPort: 49152, method, url })).toBe(false);
  });

  it('cancels record requests and preserves every other request in the same session', () => {
    let listener:
      | ((details: Readonly<{ method: string; url: string }>, callback: (result: Readonly<{ cancel: boolean }>) => void) => void)
      | null = null;
    const onBeforeRequest = vi.fn((_filter, nextListener) => {
      listener = nextListener;
    });

    installActestraProviderRendererBoundary({
      backendPort: () => 49152,
      webRequest: { onBeforeRequest },
    });

    expect(onBeforeRequest).toHaveBeenCalledWith(
      { urls: ['http://*/*'] },
      expect.any(Function),
    );
    expect(listener).not.toBeNull();

    const blocked = vi.fn();
    listener!({ method: 'GET', url: 'http://127.0.0.1:49152/api/providers' }, blocked);
    expect(blocked).toHaveBeenCalledWith({ cancel: true });

    const allowed = vi.fn();
    listener!(
      { method: 'POST', url: 'http://127.0.0.1:49152/api/providers/provider-1/models' },
      allowed,
    );
    expect(allowed).toHaveBeenCalledWith({ cancel: false });
  });

  it('routes trusted provider mutations through Main, strips sentinels, and redacts the response', async () => {
    const harness = createProviderIpcHarness();

    const result = await harness.invoke(ACTESTRA_PROVIDER_MUTATE_CHANNEL, {
      operation: 'update',
      providerId: 'provider-1',
      body: { api_key: '[REDACTED]', name: 'Updated provider' },
    });

    expect(harness.request).toHaveBeenCalledWith('PUT', '/api/providers/provider-1', {
      name: 'Updated provider',
    });
    expect(result).toMatchObject({ id: 'provider-1', api_key: '[REDACTED]' });
    expect(JSON.stringify(result)).not.toContain('opaque-test-credential');
  });

  it('redacts trusted provider reads and leaves a delete response empty', async () => {
    const harness = createProviderIpcHarness();

    const list = await harness.invoke(ACTESTRA_PROVIDER_LIST_CHANNEL);
    const single = await harness.invoke(ACTESTRA_PROVIDER_GET_CHANNEL, 'provider-1');
    const deleted = await harness.invoke(ACTESTRA_PROVIDER_MUTATE_CHANNEL, {
      operation: 'delete',
      providerId: 'provider-1',
    });

    expect(list).toMatchObject({ api_key: '[REDACTED]' });
    expect(single).toMatchObject({ api_key: '[REDACTED]' });
    expect(deleted).toBeUndefined();
    expect(harness.request).toHaveBeenLastCalledWith('DELETE', '/api/providers/provider-1', undefined);
  });

  it('rejects untrusted senders and malformed provider mutations before calling AionCore', async () => {
    const harness = createProviderIpcHarness();

    await expect(
      harness.invokeUntrusted(ACTESTRA_PROVIDER_MUTATE_CHANNEL, {
        operation: 'delete',
        providerId: 'provider-1',
      })
    ).rejects.toThrow('Actestra provider request is unavailable');
    await expect(
      harness.invoke(ACTESTRA_PROVIDER_MUTATE_CHANNEL, {
        operation: 'delete',
        providerId: 'provider-1',
        body: {},
      })
    ).rejects.toThrow('Actestra provider request is invalid');
    expect(harness.request).not.toHaveBeenCalled();
  });
});
`,
);

// The packaged P4 smoke used to prove that Renderer code could fetch raw
// Provider records directly. The credential boundary reverses that contract:
// direct Chromium access must fail, while the narrow Main IPC projection stays
// available and contains only empty values or the redaction sentinel.
replaceOnce(
  "packages/desktop/src/index.ts",
  `        const providerProbe = [
          '(async () => {',
          '  const port = window.__backendPort;',
          "  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('backend port unavailable');",
          "  const response = await fetch('http://127.0.0.1:' + String(port) + '/api/providers');",
          "  if (!response.ok) throw new Error('provider request failed with ' + String(response.status));",
          '  await response.text();',
          '  return true;',
          '})()',
        ].join('\\n');`,
  `        const providerProbe = [
          '(async () => {',
          '  const port = window.__backendPort;',
          "  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('backend port unavailable');",
          "  const assertCredential = (value) => { if (value !== undefined && value !== '' && value !== '[REDACTED]') throw new Error('provider projection contains an unredacted credential'); };",
          "  const assertRedactedProviderProjection = (value) => {",
          "    if (!Array.isArray(value)) throw new Error('provider projection is invalid');",
          "    for (const provider of value) {",
          "      if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) throw new Error('provider projection is invalid');",
          "      assertCredential(provider.api_key);",
          "      if (provider.bedrock_config !== undefined) {",
          "        if (typeof provider.bedrock_config !== 'object' || provider.bedrock_config === null || Array.isArray(provider.bedrock_config)) throw new Error('provider projection is invalid');",
          "        assertCredential(provider.bedrock_config.access_key_id);",
          "        assertCredential(provider.bedrock_config.secret_access_key);",
          "      }",
          "    }",
          "  };",
          '  let directFetchRejected = false;',
          "  try { await fetch('http://127.0.0.1:' + String(port) + '/api/providers'); } catch { directFetchRejected = true; }",
          "  if (!directFetchRejected) throw new Error('direct Provider fetch unexpectedly succeeded');",
          '  const listProviders = window.electronAPI?.actestraProviderList;',
          "  if (typeof listProviders !== 'function') throw new Error('provider IPC unavailable');",
          '  assertRedactedProviderProjection(await listProviders());',
          '  return true;',
          '})()',
        ].join('\\n');`,
);
