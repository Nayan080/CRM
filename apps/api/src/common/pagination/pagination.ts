import type { ListQuery, Paginated } from '@crm/contracts';

/**
 * Cursor pagination for list endpoints. Ids are UUID v7 (time-ordered), so `id desc` = newest first.
 * One extra row is fetched to know whether another page exists.
 */
export function pageArgs(query: ListQuery) {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy: { id: 'desc' as const },
  };
}

export function toPage<T extends { id: string }, R>(
  rows: T[],
  limit: number,
  map: (row: T) => R,
): Paginated<R> {
  const page = rows.slice(0, limit);
  return {
    data: page.map(map),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Case-insensitive "contains" filter for search boxes. */
export function contains(q: string) {
  return { contains: q, mode: 'insensitive' as const };
}
