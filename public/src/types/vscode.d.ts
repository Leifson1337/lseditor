declare module 'vscode' {
  export interface Position {
    line: number;
    character: number;
  }

  export interface Range {
    start: Position;
    end: Position;
  }

  export interface Selection extends Range {
    anchor: Position;
    active: Position;
    isEmpty: boolean;
    isSingleLine: boolean;
  }

  export interface TextDocument {
    uri: { fsPath: string };
    fileName: string;
    getText(): string;
    getText(range: Range): string;
    positionAt(offset: number): Position;
    offsetAt(position: Position): number;
  }

  export interface TextEditor {
    document: TextDocument;
    selection: Selection;
    viewColumn?: number;
    selections: Selection[];
  }

  export interface WorkspaceEdit {
    replace(uri: { fsPath: string }, range: Range, newText: string): void;
  }

  export interface OutputChannel {
    appendLine(value: string): void;
    clear(): void;
    dispose(): void;
  }

  export interface ExtensionContext {
    subscriptions: { dispose(): any }[];
    extensionPath: string;
    globalStoragePath: string;
  }

  export namespace window {
    export function showInformationMessage(message: string): Promise<string>;
    export function showErrorMessage(message: string): Promise<string>;
    export function showWarningMessage(message: string): Promise<string>;
    export const activeTextEditor: TextEditor | undefined;
  }

  export namespace workspace {
    export function openTextDocument(uri: { fsPath: string }): Promise<TextDocument>;
    export function applyEdit(edit: WorkspaceEdit): Promise<boolean>;
  }

  export class DiagnosticCollection {
    constructor(name: string);
    set(uri: { fsPath: string }, diagnostics: Diagnostic[]): void;
    clear(): void;
    delete(uri: { fsPath: string }): void;
    dispose(): void;
  }

  export interface Diagnostic {
    range: Range;
    message: string;
    severity: DiagnosticSeverity;
    source?: string;
  }

  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3
  }
} 