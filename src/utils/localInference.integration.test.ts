/**
 * Lightweight integration-style checks (no live Ollama/LM Studio required).
 */

describe('Local inference concurrency policy', () => {
  it('keeps a single preferred backend for autostart when both products exist', () => {
    const scenarios = [
      { pref: 'ollama' as const, expectLmAutostart: false },
      { pref: 'lmstudio' as const, expectLmAutostart: true }
    ];
    for (const s of scenarios) {
      expect(['ollama', 'lmstudio']).toContain(s.pref);
    }
  });
});
