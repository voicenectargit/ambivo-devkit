// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
/** A letter on the space scale (`--am-space-*`). Kept working; numbers are the target. */
export type SpaceToken = '3xs' | '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/**
 * A spacing multiple of the 4px unit — Figma's `space/1…12`. `2` is 8px,
 * `4` is 16px. The atom computes `calc(N * var(--am-unit))`, so a root
 * setting scales it.
 */
export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 8 | 12;

/**
 * A spacing value: a multiple (`2`, or `"2"` as a static attribute gives it),
 * or a letter. Letters keep following `.dense-N`, which steps `--am-space-*`
 * down; numbers do not.
 */
export type SpaceValue = SpaceStep | `${SpaceStep}` | SpaceToken;

/** A spacing value, or `none` for zero. */
export type SpaceOrNone = SpaceValue | 'none';

export const SPACE_STEPS: readonly SpaceStep[] = [1, 2, 3, 4, 5, 6, 8, 12];

export const SPACE_TOKENS: readonly SpaceToken[] = ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'];

/** The CSS length for a spacing value, as `_am-layout.scss` writes it for attributes. */
export function spaceCss(value: SpaceOrNone): string {
  if (value === 'none') return '0px';
  if (typeof value === 'number' || /^\d+$/.test(value)) return `calc(${value} * var(--am-unit))`;
  return `var(--am-space-${value})`;
}
