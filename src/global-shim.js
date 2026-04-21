window.global = window;
self.global = self;

// Provide Buffer explicitly in global scope (for xterm addons)
let BufferPolyfill = undefined;
try {
  if (typeof require === 'function') {
    BufferPolyfill = require('buffer').Buffer;
  }
} catch (e) {}
if (!BufferPolyfill && typeof window.Buffer !== 'undefined') {
  BufferPolyfill = window.Buffer;
}
window.Buffer = BufferPolyfill;
global.Buffer = BufferPolyfill;
self.Buffer = BufferPolyfill;
