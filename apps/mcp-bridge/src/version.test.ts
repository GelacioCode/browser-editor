import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LATEST_BRIDGE_VERSION } from '@viditor/contracts';

describe('bridge version', () => {
  it('matches what the editor expects (LATEST_BRIDGE_VERSION)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toBe(LATEST_BRIDGE_VERSION);
  });
});
