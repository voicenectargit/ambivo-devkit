// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { Directive, input } from '@angular/core';
import type { ContainerEdge } from '../types/responsive';

/**
 * amShowFrom / amHideFrom — show one variant of a piece of UI from a container
 * breakpoint up, and another below it. A native `@container` query decides;
 * there is no observer and no breakpoint signal in code.
 *
 * ```html
 * <app-card-wide amShowFrom="xl" />
 * <app-card-compact amHideFrom="xl" />
 * ```
 *
 * Both variants are rendered, so keep them light; a variant that is heavy to
 * build is a sign the two should be one layout with responsive atom values
 * (`[amClusterGap]="{ xs: 2, md: 4 }"`) instead.
 *
 * The container is the nearest element with `container-type` (a fill surface,
 * amContainer, a pane region, the top app bar, the shell root), the same one
 * every other responsive atom value follows. With no container above (a CDK
 * dialog, outside the shell), no query matches: neither rule applies and both
 * variants show, so give such a region an amContainer of a fixed size.
 */
@Directive({
  selector: '[amShowFrom], [amHideFrom]',
  standalone: true,
  host: {
    '[attr.data-am-show-from]': 'amShowFrom() || null',
    '[attr.data-am-hide-from]': 'amHideFrom() || null',
  },
})
export class ShowDirective {
  readonly amShowFrom = input<ContainerEdge | ''>('');
  readonly amHideFrom = input<ContainerEdge | ''>('');
}
