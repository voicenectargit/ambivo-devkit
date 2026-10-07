// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
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

// atoms (directives)
export {
  SurfaceDirective,
  type SurfaceLevel,
  type RadiusToken,
} from './directives/surface.directive';
export { ScrollDirective, ScrollRef, type ScrollAxis } from './directives/scroll.directive';
export { InsetDirective, type SpaceToken } from './directives/inset.directive';
export { ContainerDirective, type ContainerSize } from './directives/container.directive';
export { MeasureDirective, type MeasureToken } from './directives/measure.directive';
export { StackDirective } from './directives/stack.directive';
export {
  ClusterDirective,
  type ClusterAlign,
  type ClusterCollapse,
  type ClusterJustify,
} from './directives/cluster.directive';
export { PanesDirective, type PanesPreset } from './directives/panes.directive';
export { StickyTopDirective } from './directives/sticky-top.directive';

// molecules (components)
export { HeaderComponent, type HeadingTag } from './components/header.component';
export { ToolbarComponent } from './components/toolbar.component';
export { SelectionBarComponent } from './components/selection-bar.component';
export {
  BlockStatusComponent,
  type BlockStatusIntent,
  type BlockStatusSize,
} from './components/block-status.component';

// services
export { ScrollRestorationService } from './services/scroll-restoration.service';
