/** One source for reader motion; Reader.module.css mirrors these as --cv-* variables. */
export const MOTION = {
  ease: 'cubic-bezier(.2,.8,.2,1)',
  fast: 100,
  swap: 200,
  size: 260,
  swapDistance: 4,
  swapBlur: 1,
  swapGap: 50,
} as const;
