import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type DependencyLayout = 'hoisted' | 'nested';

interface FixtureOptions {
  layout?: DependencyLayout;
  includeTr46?: boolean;
  includeCssstyle?: boolean;
}

interface PatchFixture {
  scriptPath: string;
  tr46File?: string;
  cssstyleFiles: string[];
}

const fixtureRoots: string[] = [];
const sourceScript = join(process.cwd(), 'scripts', 'patch-jiti-compat.mjs');

function writeFixtureFile(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function createFixture({
  layout = 'hoisted',
  includeTr46 = true,
  includeCssstyle = true
}: FixtureOptions = {}): PatchFixture {
  const root = mkdtempSync(join(tmpdir(), 'pi web agent issue 34 '));
  fixtureRoots.push(root);

  const sharedNodeModules = join(root, 'node_modules');
  const packageRoot = join(sharedNodeModules, '@demigodmode', 'pi-web-agent');
  const scriptPath = join(packageRoot, 'scripts', 'patch-jiti-compat.mjs');
  const dependencyRoot =
    layout === 'nested' ? join(packageRoot, 'node_modules') : sharedNodeModules;

  mkdirSync(dirname(scriptPath), { recursive: true });
  copyFileSync(sourceScript, scriptPath);

  let tr46File: string | undefined;
  if (includeTr46) {
    const tr46Root = join(dependencyRoot, 'tr46');
    tr46File = join(tr46Root, 'index.js');
    writeFixtureFile(
      join(tr46Root, 'package.json'),
      JSON.stringify({ name: 'tr46', version: '5.1.1', main: 'index.js' })
    );
    writeFixtureFile(tr46File, 'const punycode = require("punycode/");\n');
  }

  const cssstyleFiles: string[] = [];
  if (includeCssstyle) {
    const cssstyleRoot = join(dependencyRoot, 'cssstyle');
    writeFixtureFile(
      join(cssstyleRoot, 'package.json'),
      JSON.stringify({
        name: 'cssstyle',
        version: '4.6.0',
        main: 'lib/CSSStyleDeclaration.js'
      })
    );
    writeFixtureFile(join(cssstyleRoot, 'lib', 'CSSStyleDeclaration.js'), 'module.exports = {};\n');

    for (const relativePath of [
      join('lib', 'allExtraProperties.js'),
      join('lib', 'generated', 'allProperties.js'),
      join('lib', 'generated', 'implementedProperties.js')
    ]) {
      const file = join(cssstyleRoot, relativePath);
      writeFixtureFile(file, 'module.exports = new Set(["display"]);\n');
      cssstyleFiles.push(file);
    }
  }

  return { scriptPath, tr46File, cssstyleFiles };
}

function runPatch(scriptPath: string) {
  return spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
}

function expectPatched(fixture: PatchFixture): void {
  expect(fixture.tr46File).toBeDefined();
  expect(readFileSync(fixture.tr46File!, 'utf8')).toContain(
    'require("punycode/punycode.js")'
  );
  for (const file of fixture.cssstyleFiles) {
    expect(readFileSync(file, 'utf8')).toContain('pi/jiti workaround');
  }
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('patch-jiti-compat postinstall script', () => {
  it('patches dependencies hoisted outside the scoped package from a path containing spaces', () => {
    const fixture = createFixture({ layout: 'hoisted' });

    const result = runPatch(fixture.scriptPath);

    expect(result.status).toBe(0);
    expectPatched(fixture);
  });

  it('patches dependencies nested inside the package', () => {
    const fixture = createFixture({ layout: 'nested' });

    const result = runPatch(fixture.scriptPath);

    expect(result.status).toBe(0);
    expectPatched(fixture);
  });

  it('does not duplicate the cssstyle shim when run twice', () => {
    const fixture = createFixture({ layout: 'nested' });

    expect(runPatch(fixture.scriptPath).status).toBe(0);
    expect(runPatch(fixture.scriptPath).status).toBe(0);

    for (const file of fixture.cssstyleFiles) {
      const markers = readFileSync(file, 'utf8').match(/pi\/jiti workaround/g) ?? [];
      expect(markers).toHaveLength(1);
    }
  });

  it('continues patching cssstyle when tr46 is unavailable', () => {
    const fixture = createFixture({ layout: 'hoisted', includeTr46: false });

    const result = runPatch(fixture.scriptPath);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('tr46');
    for (const file of fixture.cssstyleFiles) {
      expect(readFileSync(file, 'utf8')).toContain('pi/jiti workaround');
    }
  });

  it('continues patching tr46 when cssstyle is unavailable', () => {
    const fixture = createFixture({ layout: 'hoisted', includeCssstyle: false });

    const result = runPatch(fixture.scriptPath);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('cssstyle');
    expectPatched(fixture);
  });
});
