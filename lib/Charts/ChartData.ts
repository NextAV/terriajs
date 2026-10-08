export interface ChartPoint {
  readonly x: number | Date;
  readonly y: number;
  /**
   * The period this point stands for, `[periodStartMs, periodEndMs)`, when the
   * data DECLARES it (`chartPeriodEndColumn`). Absent on every chart that does
   * not opt in, which keeps the inferred-span behaviour of a bar click.
   */
  readonly periodStartMs?: number;
  readonly periodEndMs?: number;
  /** Tooltip heading for this point (`chartTooltipTitleColumn`), e.g. "1–15 Jul 2026". */
  readonly tooltipTitle?: string;
  /** Extra tooltip rows for this point's ROW (`chartTooltipColumns`), shown once. */
  readonly tooltipRows?: readonly ChartTooltipRow[];
}

export interface ChartTooltipRow {
  readonly name: string;
  readonly value: string;
  readonly units?: string;
}
