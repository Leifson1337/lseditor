// Maps the app's themes (ThemeContext) onto Monaco editor themes so the code
// editor re-themes together with the rest of the UI. Built-in Monaco themes
// (vs / vs-dark / hc-black) cover dark/light/high-contrast; the richer palettes
// are registered as custom Monaco themes that inherit token colors from a base.
import type { ThemeId } from '../contexts/ThemeContext';

interface CustomThemeDef {
  name: string;
  base: 'vs' | 'vs-dark' | 'hc-black';
  background: string;
  foreground: string;
  lineHighlight?: string;
  selection?: string;
  lineNumber?: string;       // gutter line-number color
  lineNumberActive?: string; // active line number color
}

const CUSTOM_THEMES: CustomThemeDef[] = [
  { name: 'lse-midnight', base: 'vs-dark', background: '#0b1021', foreground: '#e6ebff', lineHighlight: '#141b30', selection: '#20366b', lineNumber: '#5a6388', lineNumberActive: '#cdd6ff' },
  { name: 'lse-dracula', base: 'vs-dark', background: '#282a36', foreground: '#f8f8f2', lineHighlight: '#343746', selection: '#44475a', lineNumber: '#6272a4', lineNumberActive: '#f8f8f2' },
  { name: 'lse-solarized-dark', base: 'vs-dark', background: '#002b36', foreground: '#93a1a1', lineHighlight: '#073642', selection: '#073642', lineNumber: '#586e75', lineNumberActive: '#93a1a1' },
  { name: 'lse-nord', base: 'vs-dark', background: '#2e3440', foreground: '#eceff4', lineHighlight: '#3b4252', selection: '#434c5e', lineNumber: '#7b8394', lineNumberActive: '#eceff4' },
  { name: 'lse-crimson', base: 'vs-dark', background: '#0d0d0f', foreground: '#f4e9ea', lineHighlight: '#1b1b1f', selection: '#5a1f25', lineNumber: '#6e5557', lineNumberActive: '#ff4d4d' }
];

let defined = false;

// Register the custom Monaco themes (idempotent). Call from the editor's
// beforeMount so the themes exist before any setTheme call.
export function defineMonacoThemes(monaco: any): void {
  if (defined || !monaco?.editor?.defineTheme) return;
  try {
    for (const theme of CUSTOM_THEMES) {
      monaco.editor.defineTheme(theme.name, {
        base: theme.base,
        inherit: true,
        rules: [],
        colors: {
          'editor.background': theme.background,
          'editor.foreground': theme.foreground,
          'editorGutter.background': theme.background,
          'minimap.background': theme.background,
          ...(theme.lineHighlight ? { 'editor.lineHighlightBackground': theme.lineHighlight } : {}),
          ...(theme.selection ? { 'editor.selectionBackground': theme.selection } : {}),
          ...(theme.lineNumber ? { 'editorLineNumber.foreground': theme.lineNumber } : {}),
          ...(theme.lineNumberActive ? { 'editorLineNumber.activeForeground': theme.lineNumberActive } : {})
        }
      });
    }
    defined = true;
  } catch {
    /* monaco may not be fully ready — will retry on next mount */
  }
}

export function appThemeToMonaco(themeId: ThemeId): string {
  switch (themeId) {
    case 'light': return 'vs';
    case 'high-contrast': return 'hc-black';
    case 'midnight': return 'lse-midnight';
    case 'dracula': return 'lse-dracula';
    case 'solarized-dark': return 'lse-solarized-dark';
    case 'nord': return 'lse-nord';
    case 'crimson': return 'lse-crimson';
    case 'dark':
    default: return 'vs-dark';
  }
}
