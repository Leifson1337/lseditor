import { EventEmitter } from 'events';
import * as v8 from 'v8';
import * as inspector from 'inspector';
import * as fs from 'fs';
import * as path from 'path';

interface Breakpoint {
  id: string;
  filePath: string;
  line: number;
  column?: number;
  condition?: string;
  hitCount?: number;
  enabled: boolean;
}

interface Variable {
  name: string;
  value: any;
  type: string;
  scope: 'local' | 'closure' | 'global';
}

interface CallFrame {
  id: number;
  functionName: string;
  filePath: string;
  line: number;
  column: number;
  scopeChain: Variable[];
  this: any;
}

interface WatchExpression {
  id: string;
  expression: string;
  value?: any;
  error?: string;
}

interface Profile {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  samples: ProfileSample[];
}

interface ProfileSample {
  timestamp: number;
  stack: string[];
  memoryUsage: NodeJS.MemoryUsage;
}

interface InspectorPausedEvent {
  callFrames: Array<{
    callFrameId: string;
    functionName: string;
    location: {
      scriptId: string;
      lineNumber: number;
      columnNumber: number;
    };
    scopeChain: Array<{
      type: string;
      object: {
        type: string;
        value?: any;
      };
    }>;
    this: {
      type: string;
      value?: any;
    };
  }>;
  reason: string;
  data?: any;
}

interface InspectorScriptParsedEvent {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  executionContextId: number;
  hash: string;
  executionContextAuxData?: any;
  sourceMapURL?: string;
  hasSourceURL?: boolean;
  isModule?: boolean;
  length?: number;
  stackTrace?: any;
}

interface InspectorResponse<T> {
  id: number;
  result: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

type InspectorCallback<T> = (err: Error | null, response?: InspectorResponse<T>) => void;

type InspectorParams = {
  [key: string]: any;
};

interface DebuggerSetBreakpointResponse {
  breakpointId: string;
  actualLocation: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  };
}

interface DebuggerGetScopeChainResponse {
  scopeChain: Array<{
    type: string;
    object: {
      type: string;
      objectId: string;
    };
  }>;
}

interface RuntimeGetPropertiesResponse {
  result: Array<{
    name: string;
    value: {
      type: string;
      value?: any;
    };
  }>;
}

interface RuntimeEvaluateResponse {
  result: {
    type: string;
    value?: any;
  };
}

interface ProfilerStopResponse {
  profile: {
    nodes: Array<{
      callFrame: {
        functionName: string;
        timestamp: number;
      };
    }>;
  };
}

interface HeapProfilerTakeHeapSnapshotResponse {
  profile: string;
}

export class DebugService extends EventEmitter {
  private session: inspector.Session;
  private breakpoints: Map<string, Breakpoint> = new Map();
  private watchExpressions: Map<string, WatchExpression> = new Map();
  private callStack: CallFrame[] = [];
  private currentFrame: CallFrame | null = null;
  private isDebugging: boolean = false;
  private profiles: Map<string, Profile> = new Map();
  private currentProfile: Profile | null = null;
  private scriptMap: Map<string, string> = new Map();

  constructor() {
    super();
    this.session = new inspector.Session();
    this.initializeDebugSession();
  }

  private initializeDebugSession(): void {
    try {
      this.session.connect();
      this.setupEventHandlers();
    } catch (error) {
      console.error('Failed to initialize debug session:', error);
      this.emit('error', error);
    }
  }

  private setupEventHandlers(): void {
    this.session.on('Debugger.paused', (params: InspectorPausedEvent) => {
      this.handlePausedEvent(params);
    });

    this.session.on('Debugger.resumed', () => {
      this.handleResumedEvent();
    });

    this.session.on('Debugger.scriptParsed', (params: InspectorScriptParsedEvent) => {
      this.handleScriptParsedEvent(params);
    });

    this.session.on('Runtime.exceptionThrown', (params) => {
      this.emit('exception', params);
    });

    this.session.on('Runtime.consoleAPICalled', (params) => {
      this.emit('console', params);
    });
  }

  public async startDebugging(): Promise<void> {
    if (this.isDebugging) return;

    try {
      await this.session.post('Debugger.enable');
      await this.session.post('Runtime.enable');
      this.isDebugging = true;
      this.emit('debuggingStarted');
    } catch (error) {
      console.error('Failed to start debugging:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async stopDebugging(): Promise<void> {
    if (!this.isDebugging) return;

    try {
      await this.session.post('Debugger.disable');
      await this.session.post('Runtime.disable');
      this.isDebugging = false;
      this.breakpoints.clear();
      this.watchExpressions.clear();
      this.callStack = [];
      this.currentFrame = null;
      this.emit('debuggingStopped');
    } catch (error) {
      console.error('Failed to stop debugging:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private async post<T>(method: string, params?: InspectorParams): Promise<T> {
    return new Promise((resolve, reject) => {
      const callback: InspectorCallback<T> = (err, response) => {
        if (err) {
          reject(err);
        } else if (response?.error) {
          reject(new Error(response.error.message));
        } else if (response?.result) {
          resolve(response.result);
        } else {
          reject(new Error('Invalid response from inspector'));
        }
      };

      this.session.post(method, params, callback as (err: Error | null, params?: object) => void);
    });
  }

  public async setBreakpoint(
    filePath: string,
    line: number,
    column?: number,
    condition?: string
  ): Promise<Breakpoint> {
    if (!this.isDebugging) {
      throw new Error('Debugging not started');
    }

    try {
      const scriptId = await this.getScriptId(filePath);
      const response = await this.post<DebuggerSetBreakpointResponse>('Debugger.setBreakpoint', {
        location: {
          scriptId,
          lineNumber: line - 1,
          columnNumber: column ? column - 1 : undefined
        },
        condition
      });

      const breakpoint: Breakpoint = {
        id: response.breakpointId,
        filePath,
        line,
        column,
        condition,
        hitCount: 0,
        enabled: true
      };

      this.breakpoints.set(breakpoint.id, breakpoint);
      this.emit('breakpointSet', breakpoint);
      return breakpoint;
    } catch (error) {
      console.error('Failed to set breakpoint:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async removeBreakpoint(breakpointId: string): Promise<void> {
    if (!this.isDebugging) return;

    try {
      await this.session.post('Debugger.removeBreakpoint', {
        breakpointId
      });

      this.breakpoints.delete(breakpointId);
      this.emit('breakpointRemoved', breakpointId);
    } catch (error) {
      console.error('Failed to remove breakpoint:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async continue(): Promise<void> {
    if (!this.isDebugging) return;

    try {
      await this.session.post('Debugger.resume');
      this.emit('continued');
    } catch (error) {
      console.error('Failed to continue:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async stepOver(): Promise<void> {
    if (!this.isDebugging) return;

    try {
      await this.session.post('Debugger.stepOver');
      this.emit('steppedOver');
    } catch (error) {
      console.error('Failed to step over:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async stepInto(): Promise<void> {
    if (!this.isDebugging) return;

    try {
      await this.session.post('Debugger.stepInto');
      this.emit('steppedInto');
    } catch (error) {
      console.error('Failed to step into:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async stepOut(): Promise<void> {
    if (!this.isDebugging) return;

    try {
      await this.session.post('Debugger.stepOut');
      this.emit('steppedOut');
    } catch (error) {
      console.error('Failed to step out:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async evaluate(expression: string): Promise<any> {
    if (!this.isDebugging) {
      throw new Error('Debugging not started');
    }

    try {
      const response = await this.post<RuntimeEvaluateResponse>('Runtime.evaluate', {
        expression,
        returnByValue: true
      });

      return response.result.value;
    } catch (error) {
      console.error('Failed to evaluate expression:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async getVariables(scopeNumber: number = 0): Promise<Variable[]> {
    if (!this.isDebugging || !this.currentFrame) {
      throw new Error('Not in debugging state');
    }

    try {
      const response = await this.post<DebuggerGetScopeChainResponse>('Debugger.getScopeChain', {
        callFrameId: this.currentFrame.id
      });

      const scope = response.scopeChain[scopeNumber];
      if (!scope) {
        return [];
      }

      const properties = await this.post<RuntimeGetPropertiesResponse>('Runtime.getProperties', {
        objectId: scope.object.objectId
      });

      return properties.result.map((prop) => ({
        name: prop.name,
        value: prop.value.value,
        type: prop.value.type,
        scope: scope.type as 'local' | 'closure' | 'global'
      }));
    } catch (error) {
      console.error('Failed to get variables:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async addWatchExpression(expression: string): Promise<WatchExpression> {
    const id = Math.random().toString(36).substr(2, 9);
    const watchExpression: WatchExpression = {
      id,
      expression
    };

    this.watchExpressions.set(id, watchExpression);
    await this.updateWatchExpressions();
    return watchExpression;
  }

  public async removeWatchExpression(id: string): Promise<void> {
    this.watchExpressions.delete(id);
  }

  public async updateWatchExpressions(): Promise<void> {
    if (!this.isDebugging) return;

    for (const [id, watch] of this.watchExpressions) {
      try {
        const value = await this.evaluate(watch.expression);
        watch.value = value;
        watch.error = undefined;
      } catch (error) {
        watch.value = undefined;
        watch.error = error instanceof Error ? error.message : String(error);
      }
    }
    this.emit('watchExpressionsUpdated');
  }

  public async startProfiling(name: string): Promise<void> {
    if (this.currentProfile) {
      throw new Error('Profiling already in progress');
    }

    try {
      await this.session.post('Profiler.enable');
      await this.session.post('Profiler.start');
      
      this.currentProfile = {
        id: Math.random().toString(36).substr(2, 9),
        name,
        startTime: Date.now(),
        endTime: 0,
        samples: []
      };

      this.emit('profilingStarted', this.currentProfile);
    } catch (error) {
      console.error('Failed to start profiling:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async stopProfiling(): Promise<Profile> {
    if (!this.currentProfile) {
      throw new Error('No profiling in progress');
    }

    try {
      const response = await this.post<ProfilerStopResponse>('Profiler.stop');
      await this.post<void>('Profiler.disable');

      this.currentProfile.endTime = Date.now();
      this.currentProfile.samples = response.profile.nodes.map((node) => ({
        timestamp: node.callFrame.timestamp,
        stack: node.callFrame.functionName ? [node.callFrame.functionName] : [],
        memoryUsage: process.memoryUsage()
      }));

      this.profiles.set(this.currentProfile.id, this.currentProfile);
      const profile = this.currentProfile;
      this.currentProfile = null;

      this.emit('profilingStopped', profile);
      return profile;
    } catch (error) {
      console.error('Failed to stop profiling:', error);
      this.emit('error', error);
      throw error;
    }
  }

  public async takeHeapSnapshot(): Promise<Buffer> {
    try {
      const response = await this.post<HeapProfilerTakeHeapSnapshotResponse>('HeapProfiler.takeHeapSnapshot');
      return Buffer.from(response.profile);
    } catch (error) {
      console.error('Failed to take heap snapshot:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private async getScriptId(filePath: string): Promise<string> {
    const scriptId = this.scriptMap.get(filePath);
    if (scriptId) {
      return scriptId;
    }
    throw new Error(`Script not found: ${filePath}`);
  }

  private handlePausedEvent(params: InspectorPausedEvent): void {
    this.callStack = params.callFrames.map(frame => ({
      id: parseInt(frame.callFrameId),
      functionName: frame.functionName,
      filePath: frame.location.scriptId,
      line: frame.location.lineNumber + 1,
      column: frame.location.columnNumber + 1,
      scopeChain: [],
      this: frame.this
    }));

    this.currentFrame = this.callStack[0];
    this.emit('paused', {
      reason: params.reason,
      callStack: this.callStack,
      currentFrame: this.currentFrame
    });
  }

  private handleResumedEvent(): void {
    this.callStack = [];
    this.currentFrame = null;
    this.emit('resumed');
  }

  private handleScriptParsedEvent(params: InspectorScriptParsedEvent): void {
    this.scriptMap.set(params.url, params.scriptId);
    this.emit('scriptParsed', {
      scriptId: params.scriptId,
      url: params.url
    });
  }

  public getBreakpoints(): Breakpoint[] {
    return Array.from(this.breakpoints.values());
  }

  public getWatchExpressions(): WatchExpression[] {
    return Array.from(this.watchExpressions.values());
  }

  public getCallStack(): CallFrame[] {
    return [...this.callStack];
  }

  public getCurrentFrame(): CallFrame | null {
    return this.currentFrame;
  }

  public getProfiles(): Profile[] {
    return Array.from(this.profiles.values());
  }

  public dispose(): void {
    if (this.isDebugging) {
      this.stopDebugging().catch(console.error);
    }
    this.session.disconnect();
    this.removeAllListeners();
  }
} 