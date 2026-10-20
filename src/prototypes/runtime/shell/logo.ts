/*
 * The J.P. Morgan logo for the Prototypes page shell, inlined: a prototype's
 * frame may load images only from data: URLs and the runtime, so it can't
 * fetch public/brand/. The markup is public/brand/jpmorgan-logo.svg and
 * jpmorgan-logo-dark.svg, which test/prototypes/shell.test.ts keeps in step.
 */

export const LOGO_SVG = {
  light: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 28" role="img" aria-label="J.P. Morgan"><title>J.P. Morgan</title><text x="0" y="21" font-family="Georgia, \'Times New Roman\', Times, serif" font-size="21" letter-spacing="0.2" fill="#1b1b1d">J.P.Morgan</text></svg>',
  dark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 28" role="img" aria-label="J.P. Morgan"><title>J.P. Morgan</title><text x="0" y="21" font-family="Georgia, \'Times New Roman\', Times, serif" font-size="21" letter-spacing="0.2" fill="#f4f4f5">J.P.Morgan</text></svg>',
} as const;

export const LOGO_SRC = {
  light: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(LOGO_SVG.light)}`,
  dark: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(LOGO_SVG.dark)}`,
} as const;
