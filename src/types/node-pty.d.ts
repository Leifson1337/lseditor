declare module 'node-pty' {
  interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    encoding?: string;
  }

  interface IPty {
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(): void;
    onData(listener: (data: string) => void): void;
  }

  function spawn(file: string, args: string[], options: IPtyForkOptions): IPty;
} 