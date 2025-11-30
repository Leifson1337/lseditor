declare module 'node-pty' {
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    encoding?: string;
  }

  export interface IPty {
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(): void;
    onData(listener: (data: string) => void): void;
    onExit(listener: (event: { exitCode: number; signal: number }) => void): void;
  }

  export function spawn(file: string, args: string[], options: IPtyForkOptions): IPty;
}

declare module 'node-pty-prebuilt-multiarch' {
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    encoding?: string;
  }

  export interface IPty {
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(): void;
    onData(listener: (data: string) => void): void;
    onExit(listener: (event: { exitCode: number; signal: number }) => void): void;
  }

  export function spawn(file: string, args: string[], options: IPtyForkOptions): IPty;
}
