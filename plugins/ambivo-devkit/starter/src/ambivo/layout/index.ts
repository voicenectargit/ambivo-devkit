// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
// Layout primitives — public API. Imported individually by features (like the
// rest of @am/crm/ui), e.g. `import { SurfaceDirective, HeaderComponent } …`.
//
// Also reachable as `@am/crm/ui/layout` (tsconfig.base.json). The main barrel
// re-exports the whole CRM UI — record forms, charts, data-bound tables — and
// pulls crm2/core and the data libs behind it, so an app that wants nothing but
// amStack/amInset cannot use it. The anonymous share viewer is the case in
// point: it has no auth providers at all. Everything below imports only
// @angular/core, @angular/cdk and MatIcon, which is what makes the narrow entry
// point honest — keep it that way.
//
// tokens & global styles ship as the `m3.am-layout()` SCSS mixin (see
// primitives/styles/_am-layout.scss); include it once in the app's global SCSS.

// responsive values (container breakpoints)
export {
  CONTAINER_BREAKPOINTS,
  CONTAINER_BPS,
  valueAt,
  type ContainerBp,
  type ContainerEdge,
  type Responsive,
  type ResponsiveMap,
} from './types/responsive';
export {
  SPACE_STEPS,
  type SpaceOrNone,
  type SpaceStep,
  type SpaceToken,
  type SpaceValue,
} from './types/space';

// atoms (directives)
export {
  SurfaceDirective,
  type SurfaceLevel,
  type RadiusToken,
} from './directives/surface.directive';
export {
  ScrollDirective,
  ScrollRef,
  type ScrollAxis,
  type ScrollGutter,
} from './directives/scroll.directive';
export {
  InsetDirective,
  type AxisInset,
  type InsetSide,
} from './directives/inset.directive';
export { ContainerDirective, type ContainerSize } from './directives/container.directive';
export { MeasureDirective, type MeasureToken } from './directives/measure.directive';
export { StackDirective, type StackAlign } from './directives/stack.directive';
export {
  ClusterDirective,
  type ClusterAlign,
  type ClusterCollapse,
  type ClusterJustify,
  type ClusterWrap,
} from './directives/cluster.directive';
/** @deprecated Use `GridDirective` (`amGrid="<preset>"`). */
export { PanesDirective, type PanesPreset } from './directives/panes.directive';
export { GridDirective, type GridPreset, type TileToken } from './directives/grid.directive';
export { FillDirective } from './directives/fill.directive';
export { ToneDirective, type ToneToken } from './directives/tone.directive';
export { ShowDirective } from './directives/show.directive';
export { TextDirective, type TextRole } from './directives/text.directive';
export { StickyTopDirective } from './directives/sticky-top.directive';
export { StickyLeftDirective } from './directives/sticky-left.directive';

// molecules (components)
export { HeaderComponent } from './components/header.component';
export { ToolbarComponent } from './components/toolbar.component';
export { SelectionBarComponent } from './components/selection-bar.component';
export {
  BlockStatusComponent,
  type BlockStatusIntent,
  type BlockStatusSize,
} from './components/block-status.component';

// services
export { ScrollRestorationService } from './services/scroll-restoration.service';
