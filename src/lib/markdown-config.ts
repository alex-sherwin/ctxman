// Shiki config of src/lib/markdown.ts (runtime rendering of every markdown body).
// One custom dark Shiki theme (`ctxman-cyber`, the Monaco palette): no dual-theme CSS variables,
// so src/styles/prose.css needs no theme switching (UI_SPEC §J.0).
import { ctxmanCyberShiki } from './shiki-ctxman-cyber.ts';

export const SHIKI_CONFIG = {
  theme: ctxmanCyberShiki,
  wrap: false,
} as const;
