/** The number of days in a month; `month` is 1 for January through 12 for December. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
