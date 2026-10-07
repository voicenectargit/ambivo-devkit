// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import {
  AfterViewInit,
  Directive,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
} from '@angular/core';

@Directive({
  selector: '[amMeasureWidth]',
})
export class MeasureWidthDirective implements AfterViewInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;

  amMeasureWidth = input.required<string>(); // item id
  amWidthChange = output<{ id: string; width: number }>();

  ngAfterViewInit() {
    this.ro = new ResizeObserver(() => {
      const width = this.el.nativeElement.getBoundingClientRect().width;
      this.amWidthChange.emit({ id: this.amMeasureWidth(), width });
    });
    this.ro.observe(this.el.nativeElement, { box: 'border-box' });
  }

  ngOnDestroy() {
    this.ro?.disconnect();
  }
}
