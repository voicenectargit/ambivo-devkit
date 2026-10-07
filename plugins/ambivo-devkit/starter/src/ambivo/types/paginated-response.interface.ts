// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
export interface PaginatedResponse<T = any> {
  count: number;
  data: T[];
}
