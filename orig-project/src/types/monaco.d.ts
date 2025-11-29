declare module 'monaco-editor' {
  export interface IEditorOptions {
    // ... existing options ...
    folding?: boolean;
    foldingStrategy?: 'auto' | 'indentation';
    foldingHighlight?: boolean;
    foldingRanges?: FoldingRange[];
    showFoldingControls?: 'always' | 'mouseover';
    unfoldOnClickAfterEndOfLine?: boolean;
  }

  export interface FoldingRange {
    start: number;
    end: number;
    kind?: FoldingRangeKind;
  }

  export enum FoldingRangeKind {
    Comment = 1,
    Imports = 2,
    Region = 3
  }

  export interface IModel {
    // ... existing methods ...
    getFoldingRanges(): FoldingRange[];
    setFoldingRanges(ranges: FoldingRange[]): void;
    onDidChangeFoldingRanges(listener: (e: FoldingRangesChangeEvent) => void): IDisposable;
  }

  export interface FoldingRangesChangeEvent {
    model: IModel;
    ranges: FoldingRange[];
  }

  export interface ICodeEditor {
    // ... existing methods ...
    getFoldingRanges(): FoldingRange[];
    setFoldingRanges(ranges: FoldingRange[]): void;
    unfold(range: FoldingRange): void;
    fold(range: FoldingRange): void;
    toggleFold(range: FoldingRange): void;
  }

  export namespace editor {
    // ... existing namespace ...
    export function setFoldingRanges(model: IModel, ranges: FoldingRange[]): void;
    export function getFoldingRanges(model: IModel): FoldingRange[];
  }
}

declare module 'monaco-editor/esm/vs/editor/contrib/folding/folding' {
  export interface IFoldingRangeProvider {
    provideFoldingRanges(model: monaco.editor.ITextModel, context: monaco.languages.FoldingContext): Promise<monaco.languages.FoldingRange[]>;
  }
}

declare module 'monaco-editor/esm/vs/editor/contrib/folding/foldingModel' {
  export class FoldingModel {
    constructor(model: monaco.editor.ITextModel);
    update(ranges: monaco.languages.FoldingRange[]): void;
    getFoldingRanges(): monaco.languages.FoldingRange[];
    getFoldAtLine(lineNumber: number): monaco.languages.FoldingRange | null;
    isLineFolded(lineNumber: number): boolean;
    toggleFold(range: monaco.languages.FoldingRange): void;
    unfold(range: monaco.languages.FoldingRange): void;
    fold(range: monaco.languages.FoldingRange): void;
  }
} 