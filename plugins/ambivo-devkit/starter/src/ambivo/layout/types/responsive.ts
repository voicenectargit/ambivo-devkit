// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
/**
 * Container breakpoints — min-widths of the NEAREST query container, not the
 * viewport. A dialog or a pane is narrow on a wide screen, and a card has to
 * follow the room it actually has.
 *
 * Mobile first, each key "from here up": `xs` is the base (0), `md` holds from
 * 900px until a wider key that is set. `md` matches Figma's Supplier row Wide;
 * Compact is under 600. `_am-container.scss` holds the same numbers in
 * `$am-container-bps`, because `@container` cannot read `var()`;
 * `responsive.spec.ts` keeps the two in sync.
 *
 * Deliberately not `UiBreakpoints`: those are viewport ranges for the shell.
 */
export const CONTAINER_BREAKPOINTS = {
  xs: 0,
  sm: 600,
  md: 900,
  lg: 1280,
  xl: 1920,
} as const;

export type ContainerBp = keyof typeof CONTAINER_BREAKPOINTS;

/** A key above the base: the edges a query is written for. */
export type ContainerEdge = Exclude<ContainerBp, 'xs'>;

export const CONTAINER_BPS = Object.keys(CONTAINER_BREAKPOINTS) as ContainerBp[];

const EDGES = CONTAINER_BPS.filter((bp): bp is ContainerEdge => bp !== 'xs');

/**
 * A value, or a value per container breakpoint: `2` or `{ xs: 2, md: 4 }`.
 * Mobile first: `xs` is required, and each key holds from its width up until a
 * wider key that is set. With no container above (a CDK dialog), `xs` applies.
 *
 * Typed values only. There is no string shorthand (`"2 md:4"`): it could not
 * be type-checked, and a value nothing checks is how `class="fx-1"` ended up
 * doing nothing.
 */
export type Responsive<T> = T | ({ xs: T } & Partial<Record<ContainerEdge, T>>);

/** A responsive value in object form. */
export type ResponsiveMap<T> = { xs: T } & Partial<Record<ContainerEdge, T>>;

export function isResponsiveMap<T>(value: Responsive<T>): value is ResponsiveMap<T> {
  return typeof value === 'object' && value !== null && 'xs' in value;
}

/** The value in force at a breakpoint: the nearest one set at or below it. */
export function valueAt<T>(value: Responsive<T>, bp: ContainerBp): T {
  if (!isResponsiveMap(value)) return value;
  let result = value.xs;
  for (const b of EDGES) {
    if (CONTAINER_BREAKPOINTS[b] > CONTAINER_BREAKPOINTS[bp]) break;
    if (value[b] !== undefined) result = value[b] as T;
  }
  return result;
}

/** The keys a responsive value sets, `xs` first. A plain value sets `xs` only. */
export function keysSet<T>(value: Responsive<T>): ContainerBp[] {
  if (!isResponsiveMap(value)) return ['xs'];
  return CONTAINER_BPS.filter((bp) => value[bp] !== undefined);
}

/** Custom properties set through the atom's `[style]` binding. */
export type AtomVars = Record<string, string>;

/**
 * The per-key custom properties for a responsive value: `--am-<name>` for
 * `xs`, `--am-<name>-<key>` for each wider key that is set. `_am-layout.scss`
 * reads them, each key falling back to the next narrower one.
 */
export function responsiveVars<T>(
  name: string,
  value: ResponsiveMap<T>,
  toCss: (v: T) => string,
): AtomVars {
  const vars: AtomVars = {};
  for (const bp of keysSet(value)) {
    const v = value[bp];
    if (v !== undefined) vars[bp === 'xs' ? `--am-${name}` : `--am-${name}-${bp}`] = toCss(v);
  }
  return vars;
}

/**
 * How one atom input reaches the stylesheet. A plain value goes on an
 * attribute (`data-am-gap="3"`), whose rule sets the base variable, so it adds
 * no inline style. A responsive value marks the attribute empty and writes its
 * variables through the atom's `[style]` binding.
 */
export interface AtomValue {
  attr: string | null;
  vars: AtomVars | null;
}

export function atomValue<T extends string | number>(
  name: string,
  value: Responsive<T>,
  toCss: (v: T) => string,
): AtomValue {
  if (isResponsiveMap(value)) return { attr: '', vars: responsiveVars(name, value, toCss) };
  return { attr: String(value), vars: null };
}

/** Merge the variables of an atom's inputs into one `[style]` value. */
export function mergeVars(...values: (AtomVars | null)[]): AtomVars | null {
  const set = values.filter((v): v is AtomVars => v !== null);
  return set.length ? Object.assign({}, ...set) : null;
}
