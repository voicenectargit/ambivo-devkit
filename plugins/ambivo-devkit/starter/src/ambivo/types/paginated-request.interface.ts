// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
export interface PaginatedRequest {
  pageSize: number;
  pageIndex: number;
  getCount?: boolean;
}
