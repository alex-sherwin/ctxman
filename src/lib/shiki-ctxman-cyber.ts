// PURE Shiki (TextMate) theme `ctxman-cyber`: the same palette and token mapping as the Monaco theme
// (src/ui/kit/monaco-theme.ts), so rendered markdown code blocks and editors look alike (UI_SPEC §J.0).
// Used via src/lib/markdown-config.ts by astro.config.ts and src/lib/markdown.ts. Single dark theme: no
// dual-theme CSS variable switching. Structural types only (shiki is not a direct dependency).
import { CYBER } from './cyber-palette.ts';

export interface ShikiTokenColor {
  scope: string[];
  settings: { foreground?: string; fontStyle?: string };
}

export interface ShikiThemeRegistration {
  name: string;
  type: 'dark';
  colors: Record<string, string>;
  tokenColors: ShikiTokenColor[];
}

export const ctxmanCyberShiki: ShikiThemeRegistration = {
  name: 'ctxman-cyber',
  type: 'dark',
  colors: { 'editor.background': CYBER.void700, 'editor.foreground': CYBER.chrome100 },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: CYBER.chrome400, fontStyle: 'italic' },
    },
    {
      scope: ['keyword', 'storage', 'storage.type', 'constant.language'],
      settings: { foreground: CYBER.magentaText },
    },
    { scope: ['string', 'string.quoted'], settings: { foreground: CYBER.green500 } },
    {
      scope: ['constant.numeric', 'constant.character.escape'],
      settings: { foreground: CYBER.yellow500 },
    },
    {
      scope: ['entity.name.function', 'support.function'],
      settings: { foreground: CYBER.cyan500 },
    },
    {
      scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
      settings: { foreground: CYBER.cyan400 },
    },
    {
      scope: ['support.type.property-name', 'meta.object-literal.key', 'entity.name.tag.yaml'],
      settings: { foreground: CYBER.cyan400 },
    },
    { scope: ['entity.name.tag'], settings: { foreground: CYBER.violetText } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: CYBER.orange } },
    { scope: ['variable', 'variable.other'], settings: { foreground: CYBER.chrome100 } },
    { scope: ['variable.parameter'], settings: { foreground: CYBER.orange } },
    {
      scope: ['punctuation', 'meta.brace', 'keyword.operator'],
      settings: { foreground: CYBER.chrome300 },
    },
    {
      scope: ['markup.heading', 'entity.name.section'],
      settings: { foreground: CYBER.cyan500, fontStyle: 'bold' },
    },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.inline.raw', 'markup.raw'], settings: { foreground: CYBER.orange } },
    {
      scope: ['markup.underline.link', 'string.other.link'],
      settings: { foreground: CYBER.blueText },
    },
    {
      scope: ['markup.list punctuation', 'punctuation.definition.list'],
      settings: { foreground: CYBER.magentaText },
    },
    {
      scope: ['markup.quote'],
      settings: { foreground: CYBER.chrome400, fontStyle: 'italic' },
    },
    { scope: ['markup.inserted'], settings: { foreground: CYBER.green500 } },
    { scope: ['markup.deleted', 'invalid'], settings: { foreground: CYBER.magenta500 } },
  ],
};
