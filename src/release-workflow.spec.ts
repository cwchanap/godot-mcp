import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ciWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const releaseWorkflowPath = resolve(repoRoot, '.github/workflows/release.yml');

function readReleaseWorkflow(): string {
  return existsSync(releaseWorkflowPath)
    ? readFileSync(releaseWorkflowPath, 'utf8')
    : '';
}

describe('npm release workflow', () => {
  it('publishes only from stable published GitHub releases', () => {
    const releaseWorkflow = readReleaseWorkflow();

    expect(existsSync(releaseWorkflowPath)).toBe(true);
    expect(ciWorkflow).not.toContain('release:');
    expect(ciWorkflow).not.toContain('npm publish');
    expect(releaseWorkflow).toContain('release:');
    expect(releaseWorkflow).toContain('types: [published]');
    expect(releaseWorkflow).toContain('if: ${{ !github.event.release.prerelease }}');
    expect(releaseWorkflow).not.toContain('workflow_dispatch:');
    expect(releaseWorkflow).not.toContain('push:');
  });

  it('checks out and validates the release tag against package.json before publishing', () => {
    const releaseWorkflow = readReleaseWorkflow();

    expect(releaseWorkflow).toContain('ref: ${{ github.event.release.tag_name }}');
    expect(releaseWorkflow).toContain('RELEASE_TAG: ${{ github.event.release.tag_name }}');
    expect(releaseWorkflow).toContain('PACKAGE_VERSION=');
    expect(releaseWorkflow).toContain('"v$PACKAGE_VERSION"');
    expect(releaseWorkflow.indexOf('Validate release version')).toBeGreaterThan(-1);
    expect(releaseWorkflow.indexOf('Publish package')).toBeGreaterThan(
      releaseWorkflow.indexOf('Validate release version')
    );
  });

  it('runs the full package verification and preserves npm token publishing', () => {
    const releaseWorkflow = readReleaseWorkflow();

    expect(releaseWorkflow).toContain("NODE_VERSION: '24'");
    expect(releaseWorkflow).toContain('contents: read');
    expect(releaseWorkflow).toContain('id-token: write');
    expect(releaseWorkflow).toContain('run: npm ci');
    expect(releaseWorkflow).toContain('run: npm run typecheck');
    expect(releaseWorkflow).toContain('run: npm run test');
    expect(releaseWorkflow).toContain('run: npm run build');
    expect(releaseWorkflow).toContain('run: npm run smoke:packed');
    expect(releaseWorkflow).toContain('run: npm publish --access public');
    expect(releaseWorkflow).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');

    const publishIndex = releaseWorkflow.indexOf('Publish package');
    expect(publishIndex).toBeGreaterThan(-1);
    for (const command of [
      'run: npm ci',
      'run: npm run typecheck',
      'run: npm run test',
      'run: npm run build',
      'run: npm run smoke:packed',
    ]) {
      expect(releaseWorkflow.indexOf(command)).toBeLessThan(publishIndex);
    }
  });
});
