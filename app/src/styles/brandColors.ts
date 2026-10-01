/**
 * The few places that need a color as a literal because CSS variables do not work there:
 * the Web App Manifest and <meta name="theme-color">. This is the only TypeScript file
 * allowed to contain a color. tests/design/tokens.test.ts keeps it equal to
 * --color-background in tokens.css, which comes from the Brand & Color System document.
 */
export const THEME_COLOR = "#faf9f6";
