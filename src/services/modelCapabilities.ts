/**
 * Model capability catalog & classifier.
 *
 * Local OpenAI-compatible servers (LM Studio, Ollama, llama.cpp, vLLM, …) all
 * expose a flat list of model ids with little-to-no capability metadata. To
 * decide whether a given model can drive the agentic tool loop we combine three
 * signals, in order of trust:
 *
 *   1. Explicit metadata reported by the server (Ollama `capabilities`,
 *      OpenAI-style `supports_tool_calls`, …).
 *   2. A curated catalog of well-known model families (below) — the same idea as
 *      opencode's models.dev catalog, trimmed to the families that actually run
 *      locally.
 *   3. A name heuristic for everything else (rules out embeddings / rerankers /
 *      audio / pure-vision models, recognises common "instruct"/"coder" tags).
 *
 * Anything we can't place is reported as `'unknown'` — the caller may then run a
 * one-off live probe and cache the verdict.
 */

export type ToolSupport = boolean | 'unknown';

export type ModelKind =
  | 'chat'        // general text / instruct / coder model — can (usually) call tools
  | 'embedding'   // text-embedding model — never tool-capable
  | 'reranker'    // cross-encoder / reranker — never tool-capable
  | 'audio'       // whisper / tts / stt — never tool-capable
  | 'image';      // diffusion / image-gen — never tool-capable

export interface ModelClassification {
  /** Whether the model can emit native tool/function calls. */
  toolSupport: ToolSupport;
  /** Whether the model accepts image input. */
  vision: boolean;
  /** Coarse model category. */
  kind: ModelKind;
  /** Human-readable explanation of how the verdict was reached (for tooltips). */
  reason: string;
}

interface CatalogEntry {
  /** Lower-cased substrings that identify this family in a model id. */
  match: string[];
  toolSupport: ToolSupport;
  vision?: boolean;
  kind?: ModelKind;
  label: string;
}

/**
 * Non-chat model markers. These models can never participate in tool calling,
 * so they are reported as a hard `false` and excluded from the agent.
 */
const NON_CHAT_PATTERNS: Array<{ re: RegExp; kind: ModelKind; label: string }> = [
  { re: /(?:^|[\s:/_-])(?:nomic-embed|bge|gte|e5|embed(?:ding)?|text-embedding|all-minilm|mxbai-embed|snowflake-arctic-embed|jina-embed)(?:$|[\s:/_-])/, kind: 'embedding', label: 'Embedding-Modell' },
  { re: /(?:^|[\s:/_-])(?:rerank(?:er)?|bge-rerank|cross-encoder)(?:$|[\s:/_-])/, kind: 'reranker', label: 'Reranker-Modell' },
  { re: /(?:^|[\s:/_-])(?:whisper|distil-whisper|stt|tts|parler|bark|xtts|piper|kokoro|outetts)(?:$|[\s:/_-])/, kind: 'audio', label: 'Audio-Modell' },
  { re: /(?:^|[\s:/_-])(?:stable-diffusion|sdxl|flux|dall-?e|playground-v2|kandinsky)(?:$|[\s:/_-])/, kind: 'image', label: 'Bild-Modell' },
];

/**
 * Curated catalog of model families known to (or known NOT to) support tool
 * calling. Ordered most-specific first so e.g. "qwen2.5-coder" wins over a
 * generic "qwen" rule. Kept deliberately compact — it only needs the families
 * people actually run locally.
 */
const CATALOG: CatalogEntry[] = [
  // ── Strong tool-callers (coder / agentic families) ───────────────────────
  { match: ['qwen2.5-coder', 'qwen3-coder', 'qwen2.5coder'], toolSupport: true, label: 'Qwen Coder' },
  { match: ['qwen3', 'qwen2.5', 'qwen-2.5', 'qwen2'], toolSupport: true, label: 'Qwen' },
  { match: ['deepseek-coder-v2', 'deepseek-coder'], toolSupport: true, label: 'DeepSeek Coder' },
  { match: ['deepseek-v3', 'deepseek-v2', 'deepseek-chat'], toolSupport: true, label: 'DeepSeek' },
  { match: ['devstral', 'codestral', 'ministral'], toolSupport: true, label: 'Mistral Code' },
  { match: ['mistral-small', 'mistral-large', 'mistral-nemo', 'mistral-7b', 'mixtral', 'mistral'], toolSupport: true, label: 'Mistral' },
  { match: ['llama-3.3', 'llama3.3', 'llama-3.1', 'llama3.1'], toolSupport: true, label: 'Llama 3.1/3.3' },
  { match: ['llama-3.2', 'llama3.2'], toolSupport: true, label: 'Llama 3.2' },
  { match: ['hermes-3', 'hermes3', 'nous-hermes', 'hermes-2-pro'], toolSupport: true, label: 'Hermes' },
  { match: ['firefunction', 'functionary', 'gorilla'], toolSupport: true, label: 'Function-tuned' },
  { match: ['command-r-plus', 'command-r', 'command-a', 'cohere'], toolSupport: true, label: 'Cohere Command' },
  { match: ['glm-4', 'glm4', 'chatglm'], toolSupport: true, label: 'GLM' },
  { match: ['kimi-k2', 'kimi'], toolSupport: true, label: 'Kimi' },
  { match: ['gpt-oss', 'gpt-4o', 'gpt-4.1', 'gpt-4.5', 'gpt-4-turbo', 'gpt-5', 'o1', 'o3', 'o4'], toolSupport: true, label: 'GPT' },
  { match: ['watt-tool', 'smollm2', 'granite-3', 'granite3'], toolSupport: true, label: 'Tool-tuned' },
  { match: ['phi-4', 'phi4', 'phi-3.5', 'phi3.5'], toolSupport: true, label: 'Phi' },

  // ── Vision-capable chat models (also tool-capable) ───────────────────────
  { match: ['llama-3.2-vision', 'llama3.2-vision', 'pixtral'], toolSupport: true, vision: true, label: 'Vision-Chat' },
  { match: ['qwen2-vl', 'qwen2.5-vl', 'qwen-vl'], toolSupport: true, vision: true, label: 'Qwen-VL' },
  { match: ['llava', 'bakllava', 'moondream', 'minicpm-v'], toolSupport: false, vision: true, label: 'Vision-only' },

  // ── Known weak / non-tool chat models ────────────────────────────────────
  { match: ['gemma-2', 'gemma2', 'gemma-3', 'gemma3', 'codegemma', 'gemma'], toolSupport: 'unknown', label: 'Gemma' },
  { match: ['llama-2', 'llama2'], toolSupport: false, label: 'Llama 2' },
  { match: ['starcoder', 'codellama', 'stable-code', 'deepseek-r1'], toolSupport: 'unknown', label: 'Code/Reasoning' },
  { match: ['tinyllama', 'orca-mini', 'vicuna', 'wizardlm', 'openchat'], toolSupport: 'unknown', label: 'Community Chat' },
];

const normalize = (id: string) => id.toLowerCase().trim();

/** Coerce assorted truthy/falsy capability flags into a boolean. */
const coerceFlag = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'supported', 'enabled'].includes(v)) return true;
    if (['false', '0', 'no', 'unsupported', 'disabled'].includes(v)) return false;
  }
  return undefined;
};

/**
 * Read capability signals directly off server-reported metadata. Handles both
 * the OpenAI-style boolean flags and the Ollama `capabilities: string[]` shape.
 * Returns `undefined` for a dimension when the metadata says nothing about it.
 */
const classifyFromMetadata = (
  metadata: any
): { toolSupport?: boolean; vision?: boolean; kind?: ModelKind } | undefined => {
  if (!metadata || typeof metadata !== 'object') return undefined;

  // Ollama (/api/show) reports a capabilities array, the most reliable signal.
  const caps = metadata.capabilities ?? metadata.details?.capabilities;
  if (Array.isArray(caps) && caps.length) {
    const set = new Set(caps.map((c: any) => String(c).toLowerCase()));
    if (set.has('embedding') || set.has('embed')) {
      return { toolSupport: false, vision: false, kind: 'embedding' };
    }
    return {
      toolSupport: set.has('tools') || set.has('function_calling'),
      vision: set.has('vision'),
    };
  }

  // OpenAI-compatible boolean flags (LM Studio occasionally surfaces these).
  const toolFlags = [
    metadata.supports_tool_calls,
    metadata.supports_function_calling,
    metadata.supports_function_calls,
    metadata.tool_calling,
    metadata.function_calling,
    metadata.capabilities?.tool_calls,
    metadata.capabilities?.function_calling,
  ];
  let toolSupport: boolean | undefined;
  for (const flag of toolFlags) {
    const resolved = coerceFlag(flag);
    if (resolved !== undefined) { toolSupport = resolved; break; }
  }

  const visionFlag = coerceFlag(metadata.supports_vision ?? metadata.vision);
  if (toolSupport === undefined && visionFlag === undefined) return undefined;
  return { toolSupport, vision: visionFlag };
};

/**
 * Classify a model by id (and optional server metadata) into tool-support,
 * vision and a coarse kind. This is the single source of truth used by both the
 * model picker and the completion path.
 */
export const classifyModel = (modelId: string, metadata?: any): ModelClassification => {
  const id = normalize(modelId || '');
  if (!id) {
    return { toolSupport: 'unknown', vision: false, kind: 'chat', reason: 'Kein Modell ausgewählt.' };
  }

  // 1) Trust explicit server metadata first.
  const fromMeta = classifyFromMetadata(metadata);
  if (fromMeta && fromMeta.toolSupport !== undefined) {
    return {
      toolSupport: fromMeta.toolSupport,
      vision: fromMeta.vision ?? false,
      kind: fromMeta.kind ?? 'chat',
      reason: 'Vom Server gemeldet (capabilities).',
    };
  }

  // 2) Hard-exclude non-chat model families.
  for (const { re, kind, label } of NON_CHAT_PATTERNS) {
    if (re.test(id)) {
      return { toolSupport: false, vision: fromMeta?.vision ?? false, kind, reason: `${label} – kein Tool-Support.` };
    }
  }

  // 3) Curated family catalog.
  for (const entry of CATALOG) {
    if (entry.match.some(m => id.includes(m))) {
      return {
        toolSupport: entry.toolSupport,
        vision: fromMeta?.vision ?? entry.vision ?? false,
        kind: entry.kind ?? 'chat',
        reason:
          entry.toolSupport === true
            ? `Bekannte Familie „${entry.label}" – Tool-Support.`
            : entry.toolSupport === false
              ? `Bekannte Familie „${entry.label}" – kein Tool-Support.`
              : `Familie „${entry.label}" – Tool-Support unklar, wird geprüft.`,
      };
    }
  }

  // 4) Name heuristic for the long tail.
  if (/(?:tool|function)[\s_-]?call/.test(id)) {
    return { toolSupport: true, vision: fromMeta?.vision ?? false, kind: 'chat', reason: 'Name deutet auf Tool-Support hin.' };
  }
  const vision = fromMeta?.vision ?? /(?:vision|-vl\b|llava|multimodal)/.test(id);
  return {
    toolSupport: 'unknown',
    vision,
    kind: 'chat',
    reason: 'Unbekanntes Modell – Tool-Support wird per Live-Test geprüft.',
  };
};

/** Convenience: just the tool-support verdict. */
export const inferToolSupport = (modelId: string, metadata?: any): ToolSupport =>
  classifyModel(modelId, metadata).toolSupport;
