// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
export interface PaginatedResponse<T = any> {
  count: number;
  data: T[];
}
