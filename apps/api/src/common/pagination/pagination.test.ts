import { describe, expect, it } from 'vitest';
import { pageArgs, toPage } from './pagination.js';

describe('pagination', () => {
  it('asks for one extra row and skips the cursor row', () => {
    expect(pageArgs({ limit: 25 })).toEqual({ take: 26, orderBy: { id: 'desc' } });
    expect(pageArgs({ limit: 2, cursor: 'c' })).toEqual({
      take: 3,
      cursor: { id: 'c' },
      skip: 1,
      orderBy: { id: 'desc' },
    });
  });

  it('returns nextCursor only when more rows exist', () => {
    const rows = [{ id: '3' }, { id: '2' }, { id: '1' }];
    expect(toPage(rows, 2, (r) => r.id)).toEqual({ data: ['3', '2'], nextCursor: '2' });
    expect(toPage(rows, 3, (r) => r.id)).toEqual({ data: ['3', '2', '1'], nextCursor: null });
    expect(toPage([], 3, (r: { id: string }) => r.id)).toEqual({ data: [], nextCursor: null });
  });
});
