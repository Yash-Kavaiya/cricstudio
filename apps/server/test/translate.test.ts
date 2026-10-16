import { describe, expect, it } from 'vitest';
import { targetCode, translateLine } from '../src/commentary/translate';

describe('commentary translation', () => {
  it('translates into every non-English commentary language, never English variants', () => {
    expect(targetCode('hi-IN')).toBe('hi');
    expect(targetCode('pa-IN')).toBe('pa');
    expect(targetCode('ta-IN')).toBe('ta');
    for (const l of ['en-IN', 'en-GB', 'en-US', 'en-AU', undefined]) expect(targetCode(l)).toBeNull();
  });

  it('leaves English lines alone without a network call', async () => {
    expect(await translateLine('What a shot!', 'en-IN')).toBeNull();
  });
});
