/* Hardware detection + GPU → VRAM heuristic.
   Browser APIs are limited: deviceMemory caps at 8GB, GPU may be masked.
   Best-effort + manual override path. */

/**
 * Detect available signals about user's hardware.
 * @returns {Promise<HardwareSpec>}
 */
export async function detectHardware() {
  const spec = {
    cpuCores: navigator.hardwareConcurrency || null,
    deviceMemoryGB: navigator.deviceMemory || null, // capped at 8
    deviceMemoryCapped: !!navigator.deviceMemory && navigator.deviceMemory >= 8,
    platform: navigator.platform || "",
    userAgent: navigator.userAgent || "",
    isAppleSilicon: detectAppleSilicon(),
    gpu: detectGPU(),
    detectedAt: Date.now(),
  };
  spec.estimatedVramGB = estimateVram(spec);
  return spec;
}

function detectAppleSilicon() {
  const ua = navigator.userAgent || "";
  // Mac with Apple Silicon usually presents as MacIntel + recent Safari/Chrome
  // Hardware concurrency >= 8 + Mac is a strong signal post-M1
  if (!/Mac/.test(navigator.platform || "")) return false;
  if (navigator.maxTouchPoints > 1) return true; // iPad/iPhone
  return (navigator.hardwareConcurrency || 0) >= 8;
}

function detectGPU() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { vendor: null, renderer: null, raw: null };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) {
      // Some browsers (esp Firefox+RFP) mask this
      return { vendor: gl.getParameter(gl.VENDOR) || null, renderer: gl.getParameter(gl.RENDERER) || null, raw: null, masked: true };
    }
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || null;
    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || null;
    return { vendor, renderer, raw: renderer };
  } catch (e) {
    return { vendor: null, renderer: null, raw: null, error: e.message };
  }
}

/* Mapping table — GPU name (substring match) → VRAM in GB.
   Order matters: most specific first. */
const GPU_VRAM_TABLE = [
  // NVIDIA RTX 50-series (2025)
  { match: /RTX 5090/i, vram: 32 },
  { match: /RTX 5080/i, vram: 16 },
  { match: /RTX 5070 Ti/i, vram: 16 },
  { match: /RTX 5070/i, vram: 12 },
  { match: /RTX 5060 Ti/i, vram: 16 },
  { match: /RTX 5060/i, vram: 12 },

  // RTX 40-series
  { match: /RTX 4090/i, vram: 24 },
  { match: /RTX 4080 (Super|Ti)/i, vram: 16 },
  { match: /RTX 4080/i, vram: 16 },
  { match: /RTX 4070 Ti Super/i, vram: 16 },
  { match: /RTX 4070 Ti/i, vram: 12 },
  { match: /RTX 4070 Super/i, vram: 12 },
  { match: /RTX 4070/i, vram: 12 },
  { match: /RTX 4060 Ti/i, vram: 8 }, // can be 16 — we lowball
  { match: /RTX 4060/i, vram: 8 },
  { match: /RTX 4050/i, vram: 6 },

  // RTX 30-series
  { match: /RTX 3090 Ti/i, vram: 24 },
  { match: /RTX 3090/i, vram: 24 },
  { match: /RTX 3080 Ti/i, vram: 12 },
  { match: /RTX 3080/i, vram: 10 },
  { match: /RTX 3070 Ti/i, vram: 8 },
  { match: /RTX 3070/i, vram: 8 },
  { match: /RTX 3060 Ti/i, vram: 8 },
  { match: /RTX 3060/i, vram: 12 },
  { match: /RTX 3050/i, vram: 8 },

  // RTX 20-series
  { match: /RTX 2080 Ti/i, vram: 11 },
  { match: /RTX 2080/i, vram: 8 },
  { match: /RTX 2070/i, vram: 8 },
  { match: /RTX 2060/i, vram: 6 },

  // Pro / data-center
  { match: /A100|H100/i, vram: 80 },
  { match: /A6000/i, vram: 48 },
  { match: /A5000/i, vram: 24 },
  { match: /A4000/i, vram: 16 },
  { match: /Tesla T4/i, vram: 16 },

  // GTX 16/10
  { match: /GTX 1660/i, vram: 6 },
  { match: /GTX 1080 Ti/i, vram: 11 },
  { match: /GTX 1080/i, vram: 8 },
  { match: /GTX 1070/i, vram: 8 },

  // AMD RX 9000
  { match: /RX 9070 XT/i, vram: 16 },
  { match: /RX 9070/i, vram: 16 },

  // AMD RX 7000
  { match: /RX 7900 XTX/i, vram: 24 },
  { match: /RX 7900 XT/i, vram: 20 },
  { match: /RX 7800 XT/i, vram: 16 },
  { match: /RX 7700 XT/i, vram: 12 },
  { match: /RX 7600 XT/i, vram: 16 },
  { match: /RX 7600/i, vram: 8 },

  // AMD RX 6000
  { match: /RX 6950 XT|RX 6900 XT/i, vram: 16 },
  { match: /RX 6800 XT|RX 6800/i, vram: 16 },
  { match: /RX 6700 XT/i, vram: 12 },
  { match: /RX 6600 XT|RX 6600/i, vram: 8 },

  // Intel Arc
  { match: /Arc A770/i, vram: 16 },
  { match: /Arc A750/i, vram: 8 },
  { match: /Arc A380/i, vram: 6 },
  { match: /Arc B580/i, vram: 12 },
  { match: /Arc B570/i, vram: 10 },

  // Apple Silicon (memory unified — GPU shares system RAM)
  { match: /Apple M4 (Pro|Max|Ultra)/i, vram: -1, isUnified: true }, // depends on RAM
  { match: /Apple M4/i, vram: -1, isUnified: true },
  { match: /Apple M3/i, vram: -1, isUnified: true },
  { match: /Apple M2/i, vram: -1, isUnified: true },
  { match: /Apple M1/i, vram: -1, isUnified: true },

  // Integrated graphics
  { match: /Intel.*UHD/i, vram: 1, integrated: true },
  { match: /Intel.*Iris/i, vram: 2, integrated: true },
  { match: /Radeon.*Vega/i, vram: 2, integrated: true },
];

export function estimateVram(spec) {
  const r = spec?.gpu?.renderer || "";

  if (spec.isAppleSilicon) {
    // Apple unified memory — assume ~75% of RAM available to GPU
    const ram = spec.deviceMemoryCapped ? 16 : (spec.deviceMemoryGB || 8);
    return Math.floor(ram * 0.75);
  }

  for (const entry of GPU_VRAM_TABLE) {
    if (entry.match.test(r)) {
      if (entry.vram > 0) return entry.vram;
    }
  }

  // Fallback heuristics
  if (/integrated|UHD|Iris/i.test(r)) return 2;
  return null;
}

export function describeHardware(spec) {
  const parts = [];
  if (spec.cpuCores) parts.push(`${spec.cpuCores} cores`);
  if (spec.deviceMemoryGB) {
    const ram = spec.deviceMemoryCapped ? `≥${spec.deviceMemoryGB}` : spec.deviceMemoryGB;
    parts.push(`${ram} GB RAM`);
  }
  if (spec.gpu?.renderer) {
    const short = spec.gpu.renderer.replace(/^ANGLE\s*\(([^,]+),\s*/i, "").replace(/,.*$/, "").trim();
    parts.push(short || spec.gpu.renderer);
  } else if (spec.gpu?.masked) {
    parts.push("GPU mascarada pelo browser");
  }
  if (spec.isAppleSilicon) parts.push("Apple Silicon");
  if (spec.estimatedVramGB) parts.push(`~${spec.estimatedVramGB}GB VRAM estimado`);
  return parts.join(" · ");
}
