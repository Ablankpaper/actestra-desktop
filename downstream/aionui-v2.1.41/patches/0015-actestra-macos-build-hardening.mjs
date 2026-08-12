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

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one downstream patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

const buildScript = "scripts/build-with-builder.js";

replaceOnce(
  buildScript,
  `const DMG_RETRY_DELAY_SEC = 30;`,
  `const DMG_RETRY_DELAY_SEC = 30;

// Actestra: the DMG retry below must only ever mask a transient disk-image
// failure. Signing, compilation and resource-generation failures also leave a
// .app on disk with no .dmg, so artifact presence alone cannot tell them apart
// and would let a real failure reach exit 0 through --prepackaged. Classify on
// the captured failure output instead, and fail closed when it is unrecognised.
const ACTESTRA_DMG_RETRYABLE_PATTERNS = [
  /hdiutil/i,
  /create-dmg/i,
  /Device not configured/i,
  /Resource busy/i,
  /detach failed/i,
];
const ACTESTRA_BUILD_FATAL_PATTERNS = [
  /codesign/i,
  /resource fork, Finder information, or similar detritus not allowed/i,
  /is not signed at all/i,
  /code object is not signed/i,
  /electron-vite/i,
  /Cannot find module/i,
];

function actestraClassifyMacBuildFailure(output) {
  const text = typeof output === 'string' ? output : '';
  const fatal = ACTESTRA_BUILD_FATAL_PATTERNS.find((pattern) => pattern.test(text));
  if (fatal) {
    return { retryable: false, reason: \`fatal build failure matching \${fatal}\` };
  }
  const retryable = ACTESTRA_DMG_RETRYABLE_PATTERNS.find((pattern) => pattern.test(text));
  if (retryable) {
    return { retryable: true, reason: \`disk-image failure matching \${retryable}\` };
  }
  return { retryable: false, reason: 'unrecognised failure output' };
}

// Structural completeness of the .app handed to --prepackaged. Development
// builds are ad-hoc linker-signed with no sealed resources, so
// \`codesign --verify\` can never pass here; check the bundle layout instead of
// the signature so this gate holds in both signed and unsigned builds.
function actestraAssertPackagedAppComplete(appDir) {
  const appName = fs.readdirSync(appDir).find((f) => f.endsWith('.app'));
  if (!appName) throw new Error(\`No .app found in \${appDir}\`);
  const appPath = path.join(appDir, appName);
  const required = [
    'Contents/Info.plist',
    \`Contents/MacOS/\${path.basename(appName, '.app')}\`,
    'Contents/Resources/app.asar',
  ];
  for (const relativePath of required) {
    if (!fs.statSync(path.join(appPath, relativePath), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(
        \`Refusing --prepackaged retry: incomplete .app, missing \${relativePath}\`
      );
    }
  }
  return appPath;
}`,
);

replaceOnce(
  buildScript,
  `function createMacArtifactsWithPrepackaged(appDir, targetArch) {
  const appName = fs.readdirSync(appDir).find((f) => f.endsWith('.app'));
  if (!appName) throw new Error(\`No .app found in \${appDir}\`);
  const appPath = path.join(appDir, appName);
`,
  `function createMacArtifactsWithPrepackaged(appDir, targetArch) {
  const appPath = actestraAssertPackagedAppComplete(appDir);
`,
);

replaceOnce(
  buildScript,
  `  try {
    execSync(cmd, { stdio: 'inherit', shell: process.platform === 'win32' });
    return;
  } catch (error) {
    // On non-macOS or if .app doesn't exist, just throw
    const appDir = isMac ? findAppDir(outDir) : null;
    if (!appDir || dmgExists(outDir)) throw error;

    // .app exists but no .dmg → DMG creation failed
    console.log('\\n🔄 Build failed during DMG creation (.app exists, .dmg missing)');
    console.log('   Retrying macOS distributable creation with --prepackaged...');`,
  `  try {
    // stderr is piped so the failure can be classified; it is echoed verbatim
    // below so no original build error is ever swallowed.
    execSync(cmd, {
      stdio: ['inherit', 'inherit', 'pipe'],
      shell: process.platform === 'win32',
    });
    return;
  } catch (error) {
    const failureOutput = \`\${error.stderr?.toString() ?? ''}\\n\${error.message ?? ''}\`;
    if (failureOutput.trim()) {
      process.stderr.write(failureOutput.endsWith('\\n') ? failureOutput : \`\${failureOutput}\\n\`);
    }

    // On non-macOS or if .app doesn't exist, just throw
    const appDir = isMac ? findAppDir(outDir) : null;
    if (!appDir || dmgExists(outDir)) throw error;

    const classification = actestraClassifyMacBuildFailure(failureOutput);
    if (!classification.retryable) {
      console.error(\`\\n❌ Build failed before disk-image creation: \${classification.reason}\`);
      console.error('   Not retrying with --prepackaged; the original failure stands.');
      throw error;
    }

    // .app exists, no .dmg, and the failure names the disk-image stage
    console.log(\`\\n🔄 Build failed during DMG creation (\${classification.reason})\`);
    console.log('   Retrying macOS distributable creation with --prepackaged...');`,
);

const buildTest = "tests/unit/bootstrap/buildWithBuilder.test.ts";

replaceOnce(
  buildTest,
  `describe('build-with-builder', () => {`,
  `function loadBuildScriptSource(): string {
  return readFileSync(resolve(repoRoot, 'scripts/build-with-builder.js'), 'utf8');
}

describe('build-with-builder macOS failure classification', () => {
  it('fails without a --prepackaged retry when codesign fails and the .app exists', () => {
    const source = loadBuildScriptSource();
    const retryBody = source.match(/function buildWithDmgRetry\\(([\\s\\S]*?)\\n}/)?.[1];

    expect(retryBody).toBeTruthy();
    expect(retryBody).toContain('actestraClassifyMacBuildFailure');
    expect(retryBody).toMatch(/if \\(!classification\\.retryable\\)[\\s\\S]*?throw error;/);
    expect(
      retryBody!.indexOf('!classification.retryable')
    ).toBeLessThan(retryBody!.indexOf('createMacArtifactsWithPrepackaged'));

    const classify = new Function(
      \`\${source.match(/const ACTESTRA_DMG_RETRYABLE_PATTERNS[\\s\\S]*?\\n}/)![0]}
       return actestraClassifyMacBuildFailure;\`
    )() as (output: string) => { retryable: boolean; reason: string };

    const codesignFailure = classify(
      'codesign failed: resource fork, Finder information, or similar detritus not allowed'
    );
    expect(codesignFailure.retryable).toBe(false);
    expect(classify('').retryable).toBe(false);
    expect(classify('some unfamiliar builder crash').retryable).toBe(false);
  });

  it('allows a --prepackaged retry only for disk-image failures on a complete .app', () => {
    const source = loadBuildScriptSource();
    const classify = new Function(
      \`\${source.match(/const ACTESTRA_DMG_RETRYABLE_PATTERNS[\\s\\S]*?\\n}/)![0]}
       return actestraClassifyMacBuildFailure;\`
    )() as (output: string) => { retryable: boolean; reason: string };

    expect(classify('hdiutil: create failed - Device not configured').retryable).toBe(true);
    expect(classify('Error: Resource busy while detaching disk image').retryable).toBe(true);

    expect(source).toContain('function actestraAssertPackagedAppComplete');
    expect(source).toContain('Refusing --prepackaged retry: incomplete .app');
    expect(source).toMatch(
      /function createMacArtifactsWithPrepackaged[\\s\\S]*?actestraAssertPackagedAppComplete\\(appDir\\)/
    );
    // Development builds are ad-hoc linker-signed, so the completeness gate must
    // not depend on a codesign verification that can never pass locally.
    const completenessGate = source.match(
      /function actestraAssertPackagedAppComplete[\\s\\S]*?\\n}/
    )?.[0];
    expect(completenessGate).toBeTruthy();
    expect(completenessGate).not.toContain('codesign');
  });

  it('echoes the original failure output before deciding whether to retry', () => {
    const source = loadBuildScriptSource();
    const retryBody = source.match(/function buildWithDmgRetry\\(([\\s\\S]*?)\\n}/)?.[1];

    expect(retryBody).toContain('process.stderr.write');
    expect(retryBody!.indexOf('process.stderr.write')).toBeLessThan(
      retryBody!.indexOf('const classification')
    );
  });
});

describe('build-with-builder', () => {`,
);
