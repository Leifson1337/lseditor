import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'; // For potential future use with Monaco's AST or tokenization

export interface CodeElement {
  name: string;
  type: 'function' | 'class' | 'method' | 'arrow-function';
  startLine: number;
  // endLine?: number; // Deferred due to regex limitations
}

/**
 * Identifies functions, classes, and common method/arrow-function patterns in code using regex.
 * 
 * @param code The code content as a string.
 * @param language The programming language (e.g., 'javascript', 'typescript', 'python').
 * @returns An array of identified code elements.
 */
export function identifyFunctionsAndClasses(code: string, language: string): CodeElement[] {
  const elements: CodeElement[] = [];
  const lines = code.split('\\n');

  // Helper to get line number from character index more efficiently
  const getLineNumberFromIndex = (index: number, lineStartIndices: number[]): number => {
    // Find the line index by checking which start index is less than or equal to the character index
    let lineIndex = lineStartIndices.findIndex(startIndex => startIndex > index);
    if (lineIndex === -1) { // Index is on or after the last line's start
      lineIndex = lineStartIndices.length;
    }
    return lineIndex; // This is 1-based line number
  };

  // Pre-calculate start indices of each line for efficient line number lookup
  const lineStartIndices: number[] = [0]; // First line starts at index 0
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\\n') {
      lineStartIndices.push(i + 1);
    }
  }
  
  // Helper to avoid adding duplicate elements (e.g. if a method is also caught by a general function regex)
  const addElement = (element: CodeElement) => {
    if (!elements.some(el => el.name === element.name && el.startLine === element.startLine && el.type === element.type)) {
      elements.push(element);
    }
  };


  if (language === 'javascript' || language === 'typescript') {
    // 1. Standard functions: function functionName(...) {
    const funcRegex = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*{/g;
    let match;
    while ((match = funcRegex.exec(code)) !== null) {
      addElement({
        name: match[1],
        type: 'function',
        startLine: getLineNumberFromIndex(match.index, lineStartIndices),
      });
    }

    // 2. Arrow functions assigned to const/let/var: const funcName = (...) => { OR const funcName = param => {
    // Improved regex to better capture parameters and avoid matching non-function assignments
    const arrowFuncRegex = /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:\((?:[^)]|\n)*?\)|[a-zA-Z0-9_]+)\s*=>/g;
    while ((match = arrowFuncRegex.exec(code)) !== null) {
      addElement({
        name: match[1],
        type: 'arrow-function',
        startLine: getLineNumberFromIndex(match.index, lineStartIndices),
      });
    }
    
    // 3. Classes: class ClassName {
    const classRegex = /class\s+([a-zA-Z0-9_]+)(?:\s+extends\s+[\w.]+)?\s*{/g;
    while ((match = classRegex.exec(code)) !== null) {
      addElement({
        name: match[1],
        type: 'class',
        startLine: getLineNumberFromIndex(match.index, lineStartIndices),
      });
    }

    // 4. Class methods and object methods (simplified)
    // Looks for patterns like: methodName(...) {, async methodName(...) {, static methodName(...) {, get prop() {, set prop(...) {
    // Does not require 'function' keyword. Must be careful not to overlap too much with arrow functions if they are not explicitly typed.
    // This regex attempts to find methods within class or object literal contexts.
    // It's hard to perfectly scope with regex alone.
    // `m` flag for multiline, `^` for start of line to ensure it's a declaration.
    // It will find function-like declarations that are not top-level `function` or `const/let/var = fn =>`
    const methodRegex = /^\s*(?:static\s+|async\s+)?(get\s+|set\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:{|=>)/gm;
    // We iterate line by line for methods to associate them with the correct line number from `lines` array
    lines.forEach((lineContent, lineIdx) => {
        // Reset lastIndex for global regex on each line
        methodRegex.lastIndex = 0; 
        let methodMatch;
        // We are using lineContent for regex exec here to correctly map startLine
        while((methodMatch = methodRegex.exec(lineContent)) !== null) {
            const name = methodMatch[2]; // Group 2 is the name (after optional get/set)
            
            // Basic check to avoid re-classifying arrow functions that might be part of an object property
            // if they were already captured by the more specific arrowFuncRegex.
            // This is a heuristic. Proper AST parsing is needed for accuracy.
            const alreadyCapturedAsArrow = elements.some(el => 
                el.name === name && 
                el.startLine === (lineIdx + 1) && 
                el.type === 'arrow-function'
            );

            if (!alreadyCapturedAsArrow) {
                 addElement({
                    name: name,
                    type: 'method', // Could be a class method or an object method
                    startLine: lineIdx + 1,
                });
            }
        }
    });

  } else if (language === 'python') {
    // Python functions: def function_name(...):
    const pyFuncRegex = /^\s*def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*:/gm; // `m` for multiline, `^` for start
    let match;
    while ((match = pyFuncRegex.exec(code)) !== null) {
      const funcName = match[1];
      // In Python, methods are also defined with 'def' but are inside a class.
      // A simple regex approach can't easily distinguish this context.
      // We list all 'def' as 'function' for now. UI or further processing might differentiate.
      addElement({
        name: funcName,
        type: 'function', // Could be a method; type 'method' can be used if context is known
        startLine: getLineNumberFromIndex(match.index, lineStartIndices),
      });
    }

    // Python classes: class ClassName(...):
    const pyClassRegex = /^\s*class\s+([a-zA-Z0-9_]+)\s*(?:\(([^)]*)\))?\s*:/gm; // `m` for multiline, `^` for start
    while ((match = pyClassRegex.exec(code)) !== null) {
      addElement({
        name: match[1],
        type: 'class',
        startLine: getLineNumberFromIndex(match.index, lineStartIndices),
      });
    }
  }

  // Sort elements by start line number
  elements.sort((a, b) => a.startLine - b.startLine);

  return elements;
}
