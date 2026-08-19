import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('admin layout isolation', () => {
  it('keeps the root layout chrome-free', () => {
    const rootLayout = read('app/layout.tsx');

    expect(rootLayout).not.toMatch(/import\s+MarketTicker\s+from/);
    expect(rootLayout).not.toMatch(/import\s+\{\s*Footer\s*\}\s+from/);
    expect(rootLayout).not.toContain('<header');
  });

  it('owns public chrome only in the marketing route group', () => {
    const marketingLayout = read('app/(marketing)/layout.tsx');

    expect(marketingLayout).toContain('MarketTicker');
    expect(marketingLayout).toContain('<Footer');
    expect(marketingLayout).toContain('<header');
  });

  it('keeps the CMS shell inside the admin dashboard route group', () => {
    const adminLayout = read('app/admin/(dashboard)/layout.tsx');

    expect(adminLayout).toContain('AdminHeader');
    expect(adminLayout).not.toContain('MarketTicker');
    expect(adminLayout).not.toContain('<Footer');
  });
});