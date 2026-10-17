// PURE hex mirror of the cybercore-css 0.3.0 palette plus ctxman's extra neons (UI_SPEC §B.23).
// Monaco themes and the Shiki theme need literal hex values (they cannot read CSS variables).
// tests/unit/cyber-palette.test.ts asserts the cybercore entries equal node_modules/cybercore-css/dist/cybercore.css,
// and that the "ours" entries equal the --cx-neon-* values in src/styles/tokens.css, so a drift fails loudly.
export const CYBER = {
  cyan300: '#87eaf2',
  cyan400: '#54d1db',
  cyan500: '#00f0ff',
  cyan600: '#00c4cc',
  cyan700: '#0097a7',
  cyan900: '#005d6a',
  magenta500: '#ff2a6d',
  magenta700: '#b31248',
  yellow500: '#fcee0a',
  yellow700: '#aca406',
  green400: '#43ff83',
  green500: '#05ffa1',
  green700: '#03a969',
  green900: '#015331',
  void100: '#2a2d3a',
  void200: '#1f2230',
  void300: '#181a25',
  void400: '#12141d',
  void500: '#0d0e14',
  void700: '#07080c',
  void800: '#040508',
  chrome100: '#f0f1f5',
  chrome200: '#d1d4de',
  chrome300: '#b2b7c7',
  chrome400: '#939ab0',
  chrome500: '#747d99',
  chrome600: '#5c647a',
  // ours (UI_SPEC §A.1 --cx-neon-*): cybercore 0.3.0 ships only cyan/magenta/yellow/green
  orange: '#ff8a3d',
  blueText: '#7db1ff',
  violet: '#b26bff',
  violetText: '#c493ff',
  lime: '#b8ff3d',
  pink: '#ff6ad5',
  magentaText: '#ff6b96',
} as const;

export type CyberColorName = keyof typeof CYBER;
