/**
 * Actestra-owned WebView service policy.
 *
 * The renderer may use this helper only to explain an unavailable preview. The
 * Main-process guest-session hook remains the authority that cancels requests.
 */

export const ACTESTRA_DEFAULT_WEBVIEW_PARTITION = "persist:actestra-preview" as const;

/** Fixed local ports owned by the retained OfficeCLI preview integration. */
export const ACTESTRA_OFFICE_PREVIEW_PORTS = Object.freeze([18791, 18888, 19000] as const);

type WebviewPolicyOptions = Readonly<{
  backendPort?: number;
  partition?: string;
}>;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function hasExplicitPort(url: URL): boolean {
  return /^\d{1,5}$/u.test(url.port) && Number(url.port) >= 1 && Number(url.port) <= 65_535;
}

function isAllowedServicePort(port: number, options: WebviewPolicyOptions): boolean {
  if (Number.isSafeInteger(options.backendPort) && port === options.backendPort) return true;
  return ACTESTRA_OFFICE_PREVIEW_PORTS.includes(
    port as (typeof ACTESTRA_OFFICE_PREVIEW_PORTS)[number],
  );
}

function isAllowedPartition(partition: string | undefined): boolean {
  return (
    partition === ACTESTRA_DEFAULT_WEBVIEW_PARTITION ||
    /^persist:ext-settings-[a-z0-9._-]+$/iu.test(partition ?? "")
  );
}

function parseNetworkUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (!isLoopbackHost(url.hostname) || !hasExplicitPort(url)) return null;
    return url;
  } catch {
    return null;
  }
}

/** Whether a WebView's initial source is one of the declared local services. */
export function isAllowedActestraWebviewSource(
  rawUrl: string,
  options: WebviewPolicyOptions = {},
): boolean {
  if (rawUrl.startsWith("file:") || rawUrl.startsWith("data:")) return true;
  const url = parseNetworkUrl(rawUrl);
  if (url === null || !["http:", "https:"].includes(url.protocol)) return false;
  return isAllowedPartition(options.partition) && isAllowedServicePort(Number(url.port), options);
}

/** Whether a network request made by an admitted WebView guest is allowed. */
export function isAllowedActestraWebviewRequest(
  rawUrl: string,
  options: WebviewPolicyOptions = {},
): boolean {
  const url = parseNetworkUrl(rawUrl);
  if (url === null || !["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
  return isAllowedServicePort(Number(url.port), options);
}
