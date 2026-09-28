/**
 * The colour tokens from index.css, for drawing in a chosen theme whatever the
 * browser's (exported images, #44). A unit test keeps them in step with the
 * stylesheet. `--canvas` is the plain surface colour, so an image's plan area
 * and margins match.
 */
export type Theme = 'light' | 'dark'

export const PALETTES: Record<Theme, Record<string, string>> = {
  light: {
    '--text': '#1d1b22',
    '--muted': '#5e5a66',
    '--surface': '#ffffff',
    '--border': '#e3e1e6',
    '--accent': '#3b528b',
    '--canvas': '#ffffff',
    '--wall-casing': '#1d1b22',
    '--ap': '#ffffff',
    '--ap-ring': '#1d1b22',
  },
  dark: {
    '--text': '#ecebef',
    '--muted': '#a6a2ad',
    '--surface': '#1f1e24',
    '--border': '#2e2c34',
    '--accent': '#8fb4ff',
    '--canvas': '#1f1e24',
    '--wall-casing': '#000000',
    '--ap': '#1f1e24',
    '--ap-ring': '#ecebef',
  },
}
