declare module '@xterm/addon-fit' {
  import { Terminal } from 'xterm';

  export class FitAddon {
    activate(terminal: Terminal): void;
    dispose(): void;
    fit(): void;
    proposeDimensions(): { cols: number; rows: number } | undefined;
  }
}

declare module '@xterm/addon-web-links' {
  import { Terminal } from 'xterm';

  export class WebLinksAddon {
    constructor(handler?: (event: MouseEvent, uri: string) => void, options?: { hover?: boolean });
    activate(terminal: Terminal): void;
    dispose(): void;
  }
}

declare module '@xterm/addon-search' {
  import { Terminal } from 'xterm';

  export class SearchAddon {
    activate(terminal: Terminal): void;
    dispose(): void;
    findNext(term: string, searchOptions?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }): boolean;
    findPrevious(term: string, searchOptions?: { regex?: boolean; wholeWord?: boolean; caseSensitive?: boolean }): boolean;
  }
}

declare module '@xterm/addon-unicode11' {
  import { Terminal } from 'xterm';

  export class Unicode11Addon {
    activate(terminal: Terminal): void;
    dispose(): void;
  }
}

declare module '@xterm/addon-webgl' {
  import { Terminal } from 'xterm';

  export class WebglAddon {
    constructor(preserveDrawingBuffer?: boolean);
    activate(terminal: Terminal): void;
    dispose(): void;
  }
} 