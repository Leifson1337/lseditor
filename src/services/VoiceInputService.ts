/**
 * VoiceInputService
 *
 * Handles microphone access, audio recording, and speech-to-text transcription.
 * Supports two backends:
 *   1. Web SpeechRecognition API (browser-built-in, works in Electron/Chromium)
 *   2. Whisper via LM Studio  /v1/audio/transcriptions (local, offline, private)
 *
 * Performance design:
 *   - AudioContext and stream are acquired lazily on first use.
 *   - When "always ready" mode is enabled, the stream is kept warm (but not actively
 *     recording) so mic activation is instant.
 *   - MediaRecorder is only created and started when the user presses the mic button.
 *   - Live/streaming mode: MediaRecorder fires ondataavailable every 2 s; each chunk
 *     is forwarded to Whisper in the background, firing onPartial callbacks as results
 *     arrive. onFinal is called with the accumulated transcript when recording stops.
 */

export interface VoiceSettings {
  enabled: boolean;
  useWhisper: boolean;
  whisperModel: string;
  whisperBaseUrl: string;
  micDeviceId: string;
  alwaysReady: boolean;
}

export const defaultVoiceSettings: VoiceSettings = {
  enabled: false,
  useWhisper: false,
  whisperModel: '',
  whisperBaseUrl: 'http://localhost:1234',
  micDeviceId: '',
  alwaysReady: false
};

export type VoiceState = 'idle' | 'acquiring' | 'ready' | 'recording' | 'transcribing' | 'error';

export interface MicDevice {
  deviceId: string;
  label: string;
}

type StateListener = (state: VoiceState) => void;

export class VoiceInputService {
  private static instance: VoiceInputService | null = null;

  // Settings & state
  private settings: VoiceSettings = { ...defaultVoiceSettings };
  private state: VoiceState = 'idle';
  private stateListeners: StateListener[] = [];

  // Audio infrastructure (kept alive for performance)
  private warmStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;

  // Whisper streaming
  private audioChunks: Blob[] = [];         // pending chunks for the final send
  private partialTranscript: string[] = []; // accumulated partials during streaming
  private pendingChunkRequests = 0;         // count of in-flight chunk transcriptions
  private recordingMimeType = '';

  // Callbacks stored across the recording session
  private stopCallback: ((text: string) => void) | null = null;
  private errorCallback: ((err: string) => void) | null = null;
  private partialCallback: ((text: string) => void) | null = null;

  // Browser SpeechRecognition (typed as any — no lib types in this target)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;

  // Auto-wake tracking
  private whisperWarmedUp = false;

  // Debug log
  private debugLog: string[] = [];

  // ── Singleton ────────────────────────────────────────────────────────────────

  static getInstance(): VoiceInputService {
    if (!VoiceInputService.instance) {
      VoiceInputService.instance = new VoiceInputService();
    }
    return VoiceInputService.instance;
  }

  // ── Debug log ────────────────────────────────────────────────────────────────

  getDebugLog(): string[] {
    return [...this.debugLog];
  }

  clearDebugLog(): void {
    this.debugLog = [];
  }

  private log(msg: string): void {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    this.debugLog.push(entry);
    console.debug('[VoiceInputService]', msg);
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  updateSettings(s: Partial<VoiceSettings>): void {
    const wasAlwaysReady = this.settings.alwaysReady;
    const prevUrl = this.settings.whisperBaseUrl;
    const prevModel = this.settings.whisperModel;
    this.settings = { ...this.settings, ...s };

    // Reset warm-up flag if endpoint/model changed
    if (
      s.whisperBaseUrl !== undefined && s.whisperBaseUrl !== prevUrl ||
      s.whisperModel !== undefined && s.whisperModel !== prevModel
    ) {
      this.whisperWarmedUp = false;
      this.log('Whisper endpoint/model changed — warm-up reset.');
    }

    if (this.settings.alwaysReady && !wasAlwaysReady) {
      this.warmUp();
    } else if (!this.settings.alwaysReady && wasAlwaysReady) {
      this.releaseWarmStream();
    }
  }

  getSettings(): VoiceSettings {
    return { ...this.settings };
  }

  // ── State ────────────────────────────────────────────────────────────────────

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  getState(): VoiceState {
    return this.state;
  }

  private setState(s: VoiceState): void {
    this.state = s;
    this.stateListeners.forEach(l => l(s));
  }

  // ── Mic enumeration ──────────────────────────────────────────────────────────

  async getAvailableMics(): Promise<MicDevice[]> {
    try {
      // Need permission first to get labels
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
        s.getTracks().forEach(t => t.stop());
      });
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`
        }));
    } catch {
      return [];
    }
  }

  // ── Stream helpers ───────────────────────────────────────────────────────────

  /** Pre-acquire the mic stream for instant start when alwaysReady is on. */
  async warmUp(): Promise<void> {
    if (this.warmStream) return;
    try {
      this.warmStream = await this.acquireStream();
      this.log('Warm stream acquired.');
    } catch {
      // silently ignore - user may not have granted permission yet
    }
  }

  private async acquireStream(): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: this.settings.micDeviceId
        ? { deviceId: { exact: this.settings.micDeviceId } }
        : true
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  private releaseWarmStream(): void {
    this.warmStream?.getTracks().forEach(t => t.stop());
    this.warmStream = null;
    this.log('Warm stream released.');
  }

  // ── Auto-wake Whisper model ───────────────────────────────────────────────────

  /**
   * Send a minimal dummy request to wake up a lazy-loaded Whisper model.
   * The server will likely return an error (no audio), but that's fine — the
   * goal is just to ensure the model is loaded in memory before real use.
   */
  private async autoWakeWhisper(): Promise<void> {
    if (this.whisperWarmedUp) return;
    const baseUrl = this.settings.whisperBaseUrl.replace(/\/$/, '');
    this.log(`Auto-waking Whisper model at ${baseUrl}/v1/audio/transcriptions …`);

    try {
      // Send a trivial 1-byte blob — the server will reject it, but the model
      // will be loaded by the time we send real audio.
      const tiny = new Blob([new Uint8Array(1)], { type: 'audio/webm' });
      const form = new FormData();
      form.append('file', tiny, 'warmup.webm');
      if (this.settings.whisperModel) form.append('model', this.settings.whisperModel);
      form.append('response_format', 'json');

      const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(8000)
      });
      this.log(`Auto-wake response: HTTP ${res.status}`);
    } catch (e) {
      this.log(`Auto-wake fetch error (expected): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.whisperWarmedUp = true;
    }
  }

  // ── Public recording API ─────────────────────────────────────────────────────

  /**
   * Start recording. Returns a cleanup function that stops recording early.
   * @param onResult   Called with final transcription when recording stops.
   * @param onError    Called with an error message on failure.
   * @param onPartial  (optional) Called with incremental transcription results
   *                   during live Whisper streaming or browser interim results.
   */
  async startRecording(
    onResult: (text: string) => void,
    onError: (err: string) => void,
    onPartial?: (text: string) => void
  ): Promise<() => void> {
    if (this.state === 'recording') {
      this.stopRecording();
      return () => {};
    }

    this.stopCallback = onResult;
    this.errorCallback = onError;
    this.partialCallback = onPartial ?? null;

    if (this.settings.useWhisper) {
      return this.startWhisperRecording(onResult, onError, onPartial);
    } else {
      return this.startBrowserSpeechRecognition(onResult, onError, onPartial);
    }
  }

  /** Stop an ongoing recording and trigger final transcription. */
  stopRecording(): void {
    if (this.recorder && this.state === 'recording') {
      this.recorder.stop();
    }
    if (this.recognition && this.state === 'recording') {
      this.recognition.stop();
    }
  }

  // ── Browser SpeechRecognition ────────────────────────────────────────────────

  private startBrowserSpeechRecognition(
    onResult: (text: string) => void,
    onError: (err: string) => void,
    onPartial?: (text: string) => void
  ): () => void {
    const SRClass = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SRClass) {
      onError('SpeechRecognition API nicht verfügbar. Bitte Whisper in den Einstellungen aktivieren.');
      return () => {};
    }

    this.recognition = new SRClass();
    this.recognition.continuous = false;
    this.recognition.interimResults = true; // enable for onPartial
    this.recognition.lang = navigator.language || 'de-DE';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => this.setState('recording');

    this.recognition.onresult = (event: any) => {
      const results: any[] = Array.from(event.results as any[]);

      // Fire onPartial for interim results
      if (onPartial) {
        const interimText = results
          .filter((r: any) => !r.isFinal)
          .map((r: any) => r[0].transcript)
          .join(' ')
          .trim();
        if (interimText) onPartial(interimText);
      }

      // Collect final results
      const finalText = results
        .filter((r: any) => r.isFinal)
        .map((r: any) => r[0].transcript)
        .join(' ')
        .trim();

      if (finalText) {
        this.setState('idle');
        onResult(finalText);
      }
    };

    this.recognition.onerror = (event: any) => {
      this.setState('error');
      onError(`Spracherkennung Fehler: ${event.error}`);
      this.setState('idle');
    };

    this.recognition.onend = () => {
      if (this.state === 'recording') {
        this.setState('idle');
      }
    };

    try {
      this.recognition.start();
      this.setState('recording');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(msg);
    }

    return () => this.recognition?.stop();
  }

  // ── Whisper live streaming ────────────────────────────────────────────────────

  private async startWhisperRecording(
    onResult: (text: string) => void,
    onError: (err: string) => void,
    onPartial?: (text: string) => void
  ): Promise<() => void> {
    this.setState('acquiring');

    // Auto-wake the model in the background (fire-and-forget, don't block)
    this.autoWakeWhisper().catch(() => {});

    let stream: MediaStream;
    try {
      stream = this.warmStream ?? (await this.acquireStream());
      this.log('Stream acquired for Whisper recording.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setState('error');
      onError(`Mikrofon-Zugriff verweigert: ${msg}`);
      this.setState('idle');
      return () => {};
    }

    // Reset accumulation state
    this.audioChunks = [];
    this.partialTranscript = [];
    this.pendingChunkRequests = 0;

    // Pick best supported audio format
    this.recordingMimeType =
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', '']
        .find(m => !m || MediaRecorder.isTypeSupported(m)) ?? '';

    this.recorder = new MediaRecorder(
      stream,
      this.recordingMimeType ? { mimeType: this.recordingMimeType } : undefined
    );

    this.log(`MediaRecorder created. mimeType="${this.recordingMimeType}"`);

    // ── ondataavailable: called every 2 s (timeslice) ──────────────────────────
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) {
        this.audioChunks.push(e.data);
      }

      // Only send chunks large enough to contain meaningful audio
      if (e.data.size > 1000) {
        this.log(`Chunk received: ${e.data.size} bytes — sending to Whisper.`);
        this.sendChunkToWhisper(e.data, onPartial);
      } else {
        this.log(`Chunk received: ${e.data.size} bytes — too small, skipping.`);
      }
    };

    // ── onstop: finalize and combine partials ──────────────────────────────────
    this.recorder.onstop = async () => {
      this.log(`Recording stopped. Pending chunk requests: ${this.pendingChunkRequests}`);

      // Release stream unless it was our warm stream
      if (stream !== this.warmStream) {
        stream.getTracks().forEach(t => t.stop());
      }

      if (this.audioChunks.length === 0) {
        this.log('No audio chunks collected — aborting transcription.');
        this.setState('idle');
        return;
      }

      this.setState('transcribing');

      // Send the full accumulated audio for a final clean transcription, then
      // combine with any streaming partials we already have.
      const fullBlob = new Blob(this.audioChunks, {
        type: this.recordingMimeType || 'audio/webm'
      });
      this.audioChunks = [];

      try {
        this.log(`Sending full audio blob (${fullBlob.size} bytes) for final transcription.`);
        const finalText = await this.transcribeWithWhisper(fullBlob, 'final');

        // Prefer the full-blob result if non-empty; otherwise fall back to
        // concatenated partials (which may already be available if streaming worked).
        const combined = finalText.trim() || this.partialTranscript.join(' ').trim();
        this.log(`Final transcription: "${combined}"`);
        this.partialTranscript = [];
        this.setState('idle');
        onResult(combined);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log(`Final transcription error: ${msg}`);

        // Fall back to accumulated partials if we have them
        const fallback = this.partialTranscript.join(' ').trim();
        if (fallback) {
          this.log(`Falling back to accumulated partials: "${fallback}"`);
          this.partialTranscript = [];
          this.setState('idle');
          onResult(fallback);
        } else {
          this.setState('error');
          onError(`Transkription fehlgeschlagen: ${msg}`);
          this.setState('idle');
        }
      }
    };

    this.recorder.onerror = () => {
      this.log('MediaRecorder error event fired.');
      this.setState('error');
      onError('Aufnahme-Fehler.');
      this.setState('idle');
    };

    // timeslice = 2000 ms → ondataavailable fires every 2 seconds
    this.recorder.start(2000);
    this.setState('recording');
    this.log('MediaRecorder started (timeslice=2000ms).');

    return () => {
      if (this.recorder?.state === 'recording') {
        this.recorder.stop();
      }
    };
  }

  /**
   * Fire off a background Whisper request for a single audio chunk.
   * Results are appended to partialTranscript and forwarded via onPartial.
   */
  private sendChunkToWhisper(
    chunk: Blob,
    onPartial?: (text: string) => void
  ): void {
    this.pendingChunkRequests++;

    this.transcribeWithWhisper(chunk, 'chunk')
      .then(text => {
        const trimmed = text.trim();
        if (trimmed) {
          this.log(`Partial result: "${trimmed}"`);
          this.partialTranscript.push(trimmed);
          if (onPartial) onPartial(trimmed);
        }
      })
      .catch(e => {
        this.log(`Chunk transcription error: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        this.pendingChunkRequests = Math.max(0, this.pendingChunkRequests - 1);
      });
  }

  // ── Whisper HTTP ─────────────────────────────────────────────────────────────

  private async transcribeWithWhisper(audio: Blob, label = ''): Promise<string> {
    const baseUrl = this.settings.whisperBaseUrl.replace(/\/$/, '');
    const model = this.settings.whisperModel;
    const ext = this.recordingMimeType.includes('ogg') ? 'ogg' : 'webm';

    const form = new FormData();
    form.append('file', audio, `audio.${ext}`);
    if (model) form.append('model', model);
    form.append('response_format', 'json');
    form.append('language', navigator.language?.split('-')[0] || 'de');

    this.log(`POST /v1/audio/transcriptions [${label}] size=${audio.size}`);

    const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch { /* ignore */ }
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const payload = await response.json();
    const text = payload?.text ?? payload?.transcript ?? '';
    return String(text).trim();
  }

  // ── Dispose ──────────────────────────────────────────────────────────────────

  dispose(): void {
    this.stopRecording();
    this.releaseWarmStream();
    this.stateListeners = [];
    this.stopCallback = null;
    this.errorCallback = null;
    this.partialCallback = null;
    VoiceInputService.instance = null;
    this.log('VoiceInputService disposed.');
  }
}
