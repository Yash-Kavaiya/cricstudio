import { describe, expect, it } from 'vitest';
import { decodeEntities, stripHtml } from '../src/normalize';

describe('ESPN text cleanup', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('R Powell c &dagger;Samson b Arshdeep')).toBe('R Powell c †Samson b Arshdeep');
    expect(decodeEntities('c &amp; b Starc &#8211; 4 &#x2013; 1')).toBe('c & b Starc – 4 – 1');
    expect(decodeEntities('&unknownthing; stays')).toBe('&unknownthing; stays');
  });

  it('strips tags and collapses whitespace', () => {
    expect(stripHtml('<b>FOUR</b><br/>  through &quot;cover&quot;')).toBe('FOUR through "cover"');
  });
});
