import {describe, it, expect} from 'vitest';
import {readFileSync, readdirSync, statSync, existsSync} from 'fs';
import {join, resolve} from 'path';

const MODULES_DIR = resolve(__dirname, '../../');

/**
 * Singleton packages that must be declared as peerDependencies.
 * These are core runtimes where duplicate copies cause version conflicts.
 * Pattern follows how @deck.gl itself declares its dependencies.
 */
const SINGLETON_PATTERNS = [
  /^@deck\.gl\//,
  /^@deck\.gl-community\//,
  /^@luma\.gl\/core$/,
  /^@luma\.gl\/engine$/,
  /^@loaders\.gl\/core$/
];

/**
 * Singleton packages should use tilde (~) ranges, not caret (^),
 * because @deck.gl minor versions are often breaking.
 */
const TILDE_REQUIRED_PATTERNS = [/^@deck\.gl\//, /^@deck\.gl-community\//, /^@luma\.gl\//];

function isSingleton(pkg: string): boolean {
  return SINGLETON_PATTERNS.some(p => p.test(pkg));
}

function requiresTilde(pkg: string): boolean {
  return TILDE_REQUIRED_PATTERNS.some(p => p.test(pkg));
}

interface PackageJson {
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function getModulePackageJsons(): {name: string; path: string; pkg: PackageJson}[] {
  return readdirSync(MODULES_DIR)
    .filter(dir => {
      const pkgPath = join(MODULES_DIR, dir, 'package.json');
      return existsSync(pkgPath) && statSync(join(MODULES_DIR, dir)).isDirectory();
    })
    .map(dir => {
      const pkgPath = join(MODULES_DIR, dir, 'package.json');
      return {
        name: dir,
        path: pkgPath,
        pkg: JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson
      };
    })
    .filter(({pkg}) => !pkg.private);
}

describe('peer dependency structure', () => {
  const modules = getModulePackageJsons();

  it.each(
    modules.map(({name, pkg}) => [name, pkg.dependencies ?? {}])
  )('%s should not have singleton vis.gl packages in dependencies', (name, deps) => {
    const violations = Object.keys(deps).filter(isSingleton);
    expect(
      violations,
      `${name} has singleton packages in dependencies instead of peerDependencies`
    ).toEqual([]);
  });
});

describe('peer dependency version ranges', () => {
  const modules = getModulePackageJsons();

  it.each(
    modules.map(({name, pkg}) => [name, pkg.peerDependencies ?? {}])
  )('%s should use tilde (~) ranges for @deck.gl and @luma.gl peer deps', (name, peers) => {
    const violations = Object.entries(peers)
      .filter(([dep]) => requiresTilde(dep))
      .filter(([, range]) => range.startsWith('^'));
    expect(
      violations.map(([dep, range]) => `${dep}: ${range}`),
      `${name} uses caret (^) where tilde (~) is required`
    ).toEqual([]);
  });
});

describe('peer dependency version consistency', () => {
  const modules = getModulePackageJsons();
  const versionMap = new Map<string, {version: string; module: string}[]>();

  for (const {name, pkg} of modules) {
    const peers = pkg.peerDependencies ?? {};
    for (const [dep, range] of Object.entries(peers)) {
      if (!versionMap.has(dep)) {
        versionMap.set(dep, []);
      }
      versionMap.get(dep)?.push({version: range, module: name});
    }
  }

  const multiVersionDeps = [...versionMap.entries()].filter(([, entries]) => entries.length >= 2);

  it.each(
    multiVersionDeps
  )('%s should have consistent version range across modules', (dep, entries) => {
    const versions = [...new Set(entries.map(e => e.version))];
    if (versions.length > 1) {
      const detail = entries.map(e => `  ${e.module}: ${e.version}`).join('\n');
      expect.fail(`${dep} has inconsistent ranges:\n${detail}`);
    }
  });
});
