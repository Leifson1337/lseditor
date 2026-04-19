import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import axios from 'axios';
import si from 'systeminformation';

const MIN_VRAM_MB = 4096;
const OLLAMA_SETUP_URL = 'https://ollama.com/download/OllamaSetup.exe';

/** Candidate direct-download URLs for LM Studio Windows installer (tried in order). */
const LM_STUDIO_INSTALLER_URLS = [
  'https://installers.lmstudio.ai/windows/latest/LM-Studio-Setup.exe',
  'https://releases.lmstudio.ai/windows/latest/LM-Studio-Setup.exe'
];

export interface GPUDetectionResult {
  hasDedicatedGPU: boolean;
  name: string;
  vramMB: number;
  vramGB: number;
}

function isIntelGpu(vendor: string, model: string): boolean {
  const v = `${vendor} ${model}`.toLowerCase();
  return v.includes('intel');
}

function isNvidiaVendor(vendor: string, model: string): boolean {
  const v = `${vendor} ${model}`.toLowerCase();
  return v.includes('nvidia') || v.includes('geforce') || v.includes('quadro') || v.includes('rtx') || v.includes('gtx');
}

function isAmdDedicated(vendor: string, model: string): boolean {
  const v = `${vendor} ${model}`.toLowerCase();
  if (v.includes('intel')) return false;
  return (
    v.includes('amd') ||
    v.includes('ati') ||
    v.includes('radeon rx') ||
    v.includes('radeon pro') ||
    /\brx\s*\d{3,4}/i.test(model)
  );
}

/**
 * Detects a dedicated NVIDIA/AMD GPU with at least 4GB VRAM (as reported by the system).
 */
export async function detectGPU(): Promise<GPUDetectionResult> {
  const graphics = await si.graphics();
  const controllers = graphics.controllers ?? [];

  let best: { name: string; vramMB: number } | null = null;

  for (const c of controllers) {
    const vendor = c.vendor || '';
    const model = c.model || '';
    const bus = (c.bus || '').toLowerCase();
    const vramMB = typeof c.vram === 'number' && c.vram > 0 ? Math.round(c.vram) : 0;

    // Requirement: NVIDIA / AMD dedicated only
    if (isIntelGpu(vendor, model)) {
      continue;
    }

    const nvidia = isNvidiaVendor(vendor, model);
    const amd = isAmdDedicated(vendor, model);
    if (!nvidia && !amd) {
      continue;
    }

    // PCIe / discrete – prefer controller with reported VRAM
    const looksDiscrete = bus.includes('pcie') || bus.includes('pci') || vramMB >= MIN_VRAM_MB;
    if (!looksDiscrete && vramMB === 0) {
      // Some drivers do not report VRAM; accept clear dedicated GPU names
      const nameHint = `${vendor} ${model}`.toLowerCase();
      if (!/(rtx|gtx|rx|radeon|quadro|firepro|w\d{4})/i.test(nameHint)) {
        continue;
      }
    }

    if (vramMB >= MIN_VRAM_MB || (vramMB === 0 && (nvidia || amd))) {
      const label = [vendor, model].filter(Boolean).join(' ').trim() || 'Dedicated GPU';
      const effectiveVram = vramMB >= MIN_VRAM_MB ? vramMB : MIN_VRAM_MB;
      if (!best || effectiveVram > best.vramMB) {
        best = { name: label, vramMB: effectiveVram };
      }
    }
  }

  if (!best) {
    return {
      hasDedicatedGPU: false,
      name: '',
      vramMB: 0,
      vramGB: 0
    };
  }

  return {
    hasDedicatedGPU: true,
    name: best.name,
    vramMB: best.vramMB,
    vramGB: Math.round((best.vramMB / 1024) * 10) / 10
  };
}

export type DownloadProgressHandler = (loaded: number, total: number | null, status: string) => void;

/**
 * Downloads the installer for Ollama or LM Studio. Returns the path to the saved file.
 */
export async function downloadBackend(
  type: 'ollama' | 'lmstudio',
  destDir: string,
  onProgress?: DownloadProgressHandler
): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });

  const fileName = type === 'ollama' ? 'OllamaSetup.exe' : 'LM-Studio-Setup.exe';
  const targetPath = path.join(destDir, fileName);

  const url =
    type === 'ollama'
      ? OLLAMA_SETUP_URL
      : (await resolveLmStudioDownloadUrl());

  onProgress?.(0, null, 'Connecting…');

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 0,
    maxRedirects: 5,
    validateStatus: s => s >= 200 && s < 400
  });

  const total = parseInt(String(response.headers['content-length'] || ''), 10);
  const writer = fs.createWriteStream(targetPath);
  let loaded = 0;

  return await new Promise((resolve, reject) => {
    response.data.on('data', (chunk: Buffer) => {
      loaded += chunk.length;
      onProgress?.(loaded, Number.isFinite(total) ? total : null, 'Downloading…');
    });
    response.data.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', () => {
      onProgress?.(loaded, loaded, 'Download complete.');
      resolve(targetPath);
    });
    response.data.pipe(writer);
  });
}

async function resolveLmStudioDownloadUrl(): Promise<string> {
  for (const u of LM_STUDIO_INSTALLER_URLS) {
    try {
      const head = await axios.head(u, { timeout: 15000, maxRedirects: 5, validateStatus: () => true });
      if (head.status >= 200 && head.status < 400) {
        return u;
      }
    } catch {
      // try next
    }
  }
  // Last fallback: first URL (user may get 404 and a message in the UI)
  return LM_STUDIO_INSTALLER_URLS[0]!;
}

/**
 * Silent Ollama install on Windows: OllamaSetup.exe /S
 */
export async function installOllamaSilent(installerPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('installOllamaSilent is only supported on Windows.');
  }
  if (!fs.existsSync(installerPath)) {
    throw new Error(`Installer not found: ${installerPath}`);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(installerPath, ['/S'], {
      windowsHide: true,
      stdio: 'ignore',
      detached: false
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Ollama installer exited with code ${code}.`));
      }
    });
  });
}
