// SPDX-License-Identifier: Apache-2.0

/** The human name for a chapter.
 *
 *  Chapters are declared by putting `data-chapter="<slug>"` on a section and
 *  nothing else, so the rail has to get its labels from the same place the
 *  conductor gets its anchors — otherwise adding a chapter means editing two
 *  files and the second one gets forgotten. The slug title-cases into a good
 *  label on its own; `data-chapter-label` overrides it when it does not. */
export function chapterLabel(slug: string, override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

/** Where a chapter sits along the rail, 0 at the top and 1 at the bottom.
 *  Chapters are evenly spaced in tau by construction — chapter i is tau
 *  i/(n-1) — so the rail is a true readout of the run, not an approximation
 *  of it. */
export function railPosition(index: number, count: number): number {
  if (count <= 1) return 0;
  return index / (count - 1);
}
