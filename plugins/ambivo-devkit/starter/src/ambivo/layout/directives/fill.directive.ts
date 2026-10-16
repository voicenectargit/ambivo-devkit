// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { Directive } from '@angular/core';

/**
 * amFill — marks the main part of an amCluster or amStack: it takes the space
 * the others leave.
 *
 * - In a cluster (row): grows across the row and may shrink below its content,
 *   so its text truncates, down to the `sm` tile width; below that the other
 *   children wrap under it. Works for any child — first, last or in the middle
 *   (icon · name · actions).
 * - In a stack (column): takes the remaining height and may shrink to nothing,
 *   so a scrolling body under a header gets a bounded box (`amFill amScroll`).
 *
 * A marker, not a flex utility: there is no grow factor, basis or ratio to set.
 * Equal columns are amGrid; ratios are amPanes tracks.
 */
@Directive({
  selector: '[amFill]',
  standalone: true,
  host: { 'data-am-fill': '' },
})
export class FillDirective {}
