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
  const target = absolutePath(relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one downstream patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

const webviewHostPath = "packages/desktop/src/renderer/components/media/WebviewHost.tsx";

replaceOnce(
  "packages/desktop/src/index.ts",
  `  installWebviewGuestSecurity(mainWindow.webContents, (partition) =>
    partition === undefined ? session.defaultSession : session.fromPartition(partition),
  );`,
  `  installWebviewGuestSecurity(
    mainWindow.webContents,
    (partition) =>
      partition === undefined ? session.defaultSession : session.fromPartition(partition),
    { backendPort: () => backendManager.port },
  );`,
);

replaceOnce(
  webviewHostPath,
  `import { Left, Right, Refresh, Loading } from '@icon-park/react';`,
  `import { Left, Right, Refresh, Loading } from '@icon-park/react';
import {
  ACTESTRA_DEFAULT_WEBVIEW_PARTITION,
  isAllowedActestraWebviewSource,
} from '@/actestra/shared/webviewPolicy';`,
);

replaceOnce(
  webviewHostPath,
  `const MAX_ZOOM_FACTOR = 1.5;`,
  `const MAX_ZOOM_FACTOR = 1.5;
const ACTESTRA_WEBVIEW_UNAVAILABLE =
  'This preview is unavailable. Actestra only opens approved local preview services.';`,
);

replaceOnce(
  webviewHostPath,
  `  const [webviewReady, setWebviewReady] = useState(false);

  // Self-managed history stacks`,
  `  const [webviewReady, setWebviewReady] = useState(false);
  const effectivePartition = partition ?? ACTESTRA_DEFAULT_WEBVIEW_PARTITION;
  const [loadError, setLoadError] = useState<string | null>(() =>
    isAllowedActestraWebviewSource(url, {
      backendPort: window.__backendPort,
      partition: effectivePartition,
    })
      ? null
      : ACTESTRA_WEBVIEW_UNAVAILABLE
  );
  const isAllowedUrl = useCallback(
    (targetUrl: string) =>
      isAllowedActestraWebviewSource(targetUrl, {
        backendPort: window.__backendPort,
        partition: effectivePartition,
      }),
    [effectivePartition]
  );

  // Self-managed history stacks`,
);

replaceOnce(
  webviewHostPath,
  `    setWebviewReady(false);
    autoFitPendingRef.current = isStarOfficeUrl(url);
  }, [url]);`,
  `    setWebviewReady(false);
    setLoadError(isAllowedUrl(url) ? null : ACTESTRA_WEBVIEW_UNAVAILABLE);
    autoFitPendingRef.current = isStarOfficeUrl(url);
  }, [isAllowedUrl, isStarOfficeUrl, url]);`,
);

replaceOnce(
  webviewHostPath,
  `    (targetUrl: string) => {
      const webviewEl = webviewRef.current;
      if (!webviewEl || !targetUrl) return;
      if (targetUrl === currentUrl) return;`,
  `    (targetUrl: string) => {
      if (!targetUrl) return;
      if (!isAllowedUrl(targetUrl)) {
        setInputUrl(targetUrl);
        setIsLoading(false);
        setLoadError(ACTESTRA_WEBVIEW_UNAVAILABLE);
        return;
      }
      const webviewEl = webviewRef.current;
      if (!webviewEl) return;
      setLoadError(null);
      if (targetUrl === currentUrl) return;`,
);

replaceOnce(
  webviewHostPath,
  `    [currentUrl]
  );

  // Webview event listeners`,
  `    [currentUrl, isAllowedUrl]
  );

  // Webview event listeners`,
);

replaceOnce(
  webviewHostPath,
  `    const handleStartLoading = () => setIsLoading(true);`,
  `    const handleStartLoading = () => {
      setLoadError(null);
      setIsLoading(true);
    };`,
);

replaceOnce(
  webviewHostPath,
  `    const handleDidFinishLoad = () => {
      setIsLoading(false);
      onDidFinishLoad?.();
    };

    const handleDidFailLoad = (event: any) => {
      setIsLoading(false);
      onDidFailLoad?.(event.errorCode, event.errorDescription);
    };`,
  `    const handleDidFinishLoad = () => {
      setLoadError(null);
      setIsLoading(false);
      onDidFinishLoad?.();
    };

    const handleDidFailLoad = (event: any) => {
      setLoadError(ACTESTRA_WEBVIEW_UNAVAILABLE);
      setIsLoading(false);
      onDidFailLoad?.(event.errorCode, event.errorDescription);
    };`,
);

replaceOnce(
  webviewHostPath,
  `  webviewAttrs.partition = partition ?? 'persist:actestra-preview';`,
  `  webviewAttrs.partition = effectivePartition;`,
);

replaceOnce(
  webviewHostPath,
  `      {!showNavBar && isLoading && (`,
  `      {!showNavBar && isLoading && loadError === null && (`,
);

replaceOnce(
  webviewHostPath,
  `        <webview
          ref={webviewRef as any}
          src={currentUrl}
          className='border-0 absolute left-0 top-0'
          style={{
            opacity: !showNavBar && isLoading ? 0 : 1,
            transition: 'opacity 150ms ease-in',
          }}
          {...webviewAttrs}
        />`,
  `        {loadError === null ? (
          <webview
            ref={webviewRef as any}
            src={currentUrl}
            className='border-0 absolute left-0 top-0'
            style={{
              opacity: !showNavBar && isLoading ? 0 : 1,
              transition: 'opacity 150ms ease-in',
            }}
            {...webviewAttrs}
          />
        ) : (
          <div
            role='alert'
            className='absolute inset-0 flex items-center justify-center bg-bg-1 px-24px text-center'
          >
            <div className='max-w-440px'>
              <div className='text-14px text-t-primary font-medium'>Preview unavailable</div>
              <div className='mt-8px text-12px text-t-secondary'>{loadError}</div>
            </div>
          </div>
        )}`,
);

write(
  "tests/unit/actestra/p7WebviewAvailability.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTESTRA_DEFAULT_WEBVIEW_PARTITION,
  isAllowedActestraWebviewSource,
} from '@/actestra/shared/webviewPolicy';

describe('P7 WebView availability guidance', () => {
  it('classifies external and undeclared local previews as unavailable', () => {
    const options = {
      backendPort: 13400,
      partition: ACTESTRA_DEFAULT_WEBVIEW_PARTITION,
    } as const;
    expect(isAllowedActestraWebviewSource('https://preview.example.invalid/page', options)).toBe(false);
    expect(isAllowedActestraWebviewSource('http://127.0.0.1:59999/page', options)).toBe(false);
  });

  it('materializes an explanatory alert instead of a silent blank surface', () => {
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../packages/desktop/src/renderer/components/media/WebviewHost.tsx',
      ),
      'utf8',
    );
    expect(source).toContain("role='alert'");
    expect(source).toContain('Preview unavailable');
    expect(source).toContain('approved local preview services');
    expect(source).toContain('isAllowedActestraWebviewSource');
  });
});
`,
);
