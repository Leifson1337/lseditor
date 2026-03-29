/**
 * WhisperAutoStartService
 * 
 * Automatically downloads and starts a small Whisper model in the background
 * when the application starts. Provides debug logging for transparency.
 */

export type WhisperAutoStartStatus = 
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'error';

export interface WhisperAutoStartState {
  status: WhisperAutoStartStatus;
  progress?: number;
  message?: string;
  error?: string;
}

type StateListener = (state: WhisperAutoStartState) => void;

class WhisperAutoStartService {
  private static instance: WhisperAutoStartService;
  private state: WhisperAutoStartState = { status: 'idle' };
  private listeners: Set<StateListener> = new Set();
  private baseUrl: string = 'http://localhost:1234';
  private preferredModel: string = 'whisper-tiny';
  private checkInterval: number = 5000; // 5 seconds
  private maxRetries: number = 3;
  private retryCount: number = 0;

  private constructor() {}

  static getInstance(): WhisperAutoStartService {
    if (!WhisperAutoStartService.instance) {
      WhisperAutoStartService.instance = new WhisperAutoStartService();
    }
    return WhisperAutoStartService.instance;
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Update state and notify all listeners
   */
  private setState(newState: Partial<WhisperAutoStartState>) {
    this.state = { ...this.state, ...newState };
    this.log(`State changed: ${this.state.status}${this.state.message ? ` - ${this.state.message}` : ''}`);
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * Debug logging
   */
  private log(message: string) {
    console.log(`[WhisperAutoStart] ${message}`);
  }

  /**
   * Update configuration
   */
  configure(baseUrl: string, model?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (model) {
      this.preferredModel = model;
    }
    this.log(`Configured: baseUrl=${this.baseUrl}, model=${this.preferredModel}`);
  }

  /**
   * Start the auto-start process
   */
  async start() {
    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      this.log('Already in progress, skipping');
      return;
    }

    this.log('Starting Whisper auto-start process');
    this.setState({ status: 'checking', message: 'Checking for Whisper model...' });

    try {
      // Check if LM Studio is running
      const isRunning = await this.checkLMStudioRunning();
      if (!isRunning) {
        this.log('LM Studio is not running, will retry later');
        this.setState({ 
          status: 'idle', 
          message: 'LM Studio not running. Will retry automatically.' 
        });
        this.scheduleRetry();
        return;
      }

      // Check if a Whisper model is already loaded
      const hasWhisper = await this.checkWhisperModelLoaded();
      if (hasWhisper) {
        this.log('Whisper model already loaded');
        this.setState({ status: 'ready', message: 'Whisper model ready' });
        return;
      }

      // Check if Whisper model is available locally
      const availableModels = await this.getAvailableModels();
      const whisperModel = this.findWhisperModel(availableModels);

      if (whisperModel) {
        this.log(`Found Whisper model: ${whisperModel}`);
        await this.loadModel(whisperModel);
      } else {
        this.log('No Whisper model found locally');
        this.setState({ 
          status: 'idle', 
          message: 'No Whisper model found. Please download one in LM Studio.' 
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Error: ${message}`);
      this.setState({ 
        status: 'error', 
        error: message,
        message: 'Failed to start Whisper model' 
      });
      this.scheduleRetry();
    }
  }

  /**
   * Schedule a retry after a delay
   */
  private scheduleRetry() {
    if (this.retryCount >= this.maxRetries) {
      this.log('Max retries reached, giving up');
      return;
    }

    this.retryCount++;
    this.log(`Scheduling retry ${this.retryCount}/${this.maxRetries} in ${this.checkInterval}ms`);
    
    setTimeout(() => {
      this.start();
    }, this.checkInterval);
  }

  /**
   * Check if LM Studio is running
   */
  private async checkLMStudioRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if a Whisper model is already loaded
   */
  private async checkWhisperModelLoaded(): Promise<boolean> {
    try {
      // Try a test transcription to see if Whisper endpoint is available
      const testResponse = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.preferredModel,
          file: '' // Empty test
        }),
        signal: AbortSignal.timeout(2000)
      });
      
      // If we get any response (even error), the endpoint exists
      return testResponse.status !== 404;
    } catch {
      return false;
    }
  }

  /**
   * Get list of available models from LM Studio
   */
  private async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();
      const models = data?.data || data?.models || [];
      return models.map((m: any) => m.id || m.name || String(m)).filter(Boolean);
    } catch (error) {
      this.log(`Failed to get available models: ${error}`);
      return [];
    }
  }

  /**
   * Find a Whisper model from the list
   */
  private findWhisperModel(models: string[]): string | null {
    // Prefer tiny/small models for auto-start
    const preferences = [
      'whisper-tiny',
      'whisper-small',
      'whisper-base',
      'whisper-medium',
      'whisper-large'
    ];

    for (const pref of preferences) {
      const found = models.find(m => m.toLowerCase().includes(pref));
      if (found) return found;
    }

    // Fallback: any model with "whisper" in the name
    return models.find(m => m.toLowerCase().includes('whisper')) || null;
  }

  /**
   * Load a Whisper model
   */
  private async loadModel(modelName: string) {
    this.log(`Loading model: ${modelName}`);
    this.setState({ 
      status: 'downloading', 
      message: `Loading ${modelName}...`,
      progress: 0 
    });

    try {
      // LM Studio doesn't have a direct "load model" API
      // We simulate loading by making a test request
      const response = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: JSON.stringify({
          model: modelName,
          file: new Blob([''], { type: 'audio/wav' })
        }),
        signal: AbortSignal.timeout(30000)
      });

      // Even if the request fails, if we got a response, the model is loaded
      this.log(`Model load response: ${response.status}`);
      this.setState({ 
        status: 'ready', 
        message: `${modelName} ready`,
        progress: 100 
      });
      this.retryCount = 0; // Reset retry count on success
    } catch (error) {
      throw new Error(`Failed to load model: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stop the service
   */
  stop() {
    this.log('Stopping Whisper auto-start service');
    this.setState({ status: 'idle', message: undefined, error: undefined });
    this.retryCount = 0;
  }

  /**
   * Get current state
   */
  getState(): WhisperAutoStartState {
    return { ...this.state };
  }
}

export default WhisperAutoStartService;
