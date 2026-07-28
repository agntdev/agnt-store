let clock: () => Date = () => new Date();
export function now(): Date { return clock(); }
/** Test-only clock seam. */
export function _setNow(next: () => Date): void { clock = next; }
