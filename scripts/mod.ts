#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
//
// SnapShare Vault Downloader
//
// Usage:
//   deno run -A jsr:@snapshare/download "https://snapshare.link/d#key=...&file=...&name=...&parts=...&plan=..."
//
// Or with explicit args:
//   deno run -A scripts/mod.ts --url <cdn> --key <key> --name <file> --parts <n>
//
// Supports resume: re-run the same command to continue from where it left off.

const PART_SIZE = 100 * 1024 * 1024; // 100MB, must match server
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

// --- Crypto ---

function base64UrlDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "==".slice(0, (4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(base64url: string): Promise<CryptoKey> {
  const raw = base64UrlDecode(base64url);
  return crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}

async function decryptChunk(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
  const buf = new Uint8Array(data);
  const iv = new Uint8Array(buf.buffer as ArrayBuffer, 0, 12);
  const ciphertext = new Uint8Array(buf.buffer as ArrayBuffer, 12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}

// --- Network ---

async function downloadChunk(url: string): Promise<ArrayBuffer> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.arrayBuffer();
    } catch (e) {
      if (attempt === MAX_RETRIES) throw e;
      console.log(`  ⚠ retry ${attempt}/${MAX_RETRIES}: ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY * attempt));
    }
  }
  throw new Error("unreachable");
}

// --- Helpers ---

function fmt(bytes: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
  return (bytes / 1024 ** i).toFixed(i > 1 ? 2 : 0) + " " + u[i];
}

function fmtTime(s: number): string {
  if (s < 60) return `${Math.ceil(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${Math.ceil(s % 60)}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

// --- Parse download URL ---

function parseDownloadUrl(url: string): { cdnUrl: string; key: string; name: string; parts: number; fileHash: string } {
  const fragment = url.split("#")[1];
  if (!fragment) throw new Error("Invalid download URL: missing # fragment");

  const params = new URLSearchParams(fragment);
  const key = params.get("key");
  const file = params.get("file");
  const name = params.get("name") || "download.bin";
  const parts = parseInt(params.get("parts") || "0");
  const plan = params.get("plan") || "30d";
  const fileHash = params.get("hash") || "";

  if (!key || !file || !parts) throw new Error("Invalid download URL: missing key, file, or parts");

  const cdnHost = plan === "7d" ? "paid-cdn-7days.snapshare.link" : "paid-cdn.snapshare.link";
  return { cdnUrl: `https://${cdnHost}/${file}`, key, name, parts, fileHash };
}

// --- Helpers: default download directory ---

function getDownloadsDir(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
  const downloads = `${home}/Downloads`;
  try {
    Deno.statSync(downloads);
    return downloads;
  } catch {
    return ".";
  }
}

// --- Main ---

async function main() {
  let cdnUrl: string;
  let keyStr: string;
  let fileName: string;
  let partsTotal: number;
  let outDir: string | undefined;

  const rawArgs = Deno.args;

  if (rawArgs.length >= 1 && rawArgs[0].startsWith("http")) {
    const parsed = parseDownloadUrl(rawArgs[0]);
    cdnUrl = parsed.cdnUrl;
    keyStr = parsed.key;
    fileName = parsed.name;
    partsTotal = parsed.parts;
    outDir = rawArgs[1]; // optional
  } else {
    const { parseArgs } = await import("@std/cli/parse-args");
    const args = parseArgs(rawArgs, {
      string: ["url", "key", "name", "parts", "out"],
      alias: { u: "url", k: "key", n: "name", p: "parts", o: "out" },
    });

    if (!args.url || !args.key || !args.parts) {
      console.log(`
📦 SnapShare Vault Downloader

Usage:
  deno run -A jsr:@snapshare/download "<download-url>" [output-dir]
  deno run -A jsr:@snapshare/download --url <cdn> --key <key> --name <file> --parts <n> [--out <dir>]

Files are saved to ~/Downloads by default.
Supports resume — re-run the same command to continue a partial download.
`);
      Deno.exit(1);
    }

    cdnUrl = args.url;
    keyStr = args.key;
    fileName = args.name || "download.bin";
    partsTotal = parseInt(args.parts);
    outDir = args.out;
  }

  // Default to ~/Downloads
  const dir = outDir || getDownloadsDir();
  const filePath = `${dir}/${fileName}`;

  console.log(`\n📦 SnapShare Vault Download`);
  console.log(`   File:  ${filePath}`);
  console.log(`   Parts: ${partsTotal}\n`);

  const key = await importKey(keyStr);

  // Resume detection
  let startChunk = 1;
  try {
    const stat = await Deno.stat(filePath);
    const done = Math.floor(stat.size / PART_SIZE);
    if (done >= partsTotal) {
      console.log(`✅ Already downloaded (${fmt(stat.size)})\n`);
      Deno.exit(0);
    }
    if (done > 0) {
      await Deno.truncate(filePath, done * PART_SIZE);
      startChunk = done + 1;
      console.log(`🔄 Resuming from chunk ${startChunk}/${partsTotal} (${fmt(done * PART_SIZE)} done)\n`);
    }
  } catch { /* new file */ }

  const file = await Deno.open(filePath, {
    write: true,
    create: true,
    append: startChunk > 1,
    truncate: startChunk === 1,
  });

  const t0 = Date.now();
  let totalBytes = 0;

  try {
    for (let i = startChunk; i <= partsTotal; i++) {
      const enc = await downloadChunk(`${cdnUrl}/${i}`);
      const dec = await decryptChunk(key, enc);
      await file.write(new Uint8Array(dec));

      totalBytes += dec.byteLength;
      const elapsed = (Date.now() - t0) / 1000;
      const done = i - startChunk + 1;
      const remaining = ((partsTotal - i) / done) * elapsed;
      const pct = Math.round((i / partsTotal) * 100);
      const speed = elapsed > 0 ? totalBytes / elapsed : 0;
      const bar = "█".repeat(Math.floor(pct / 2.5)) + "░".repeat(40 - Math.floor(pct / 2.5));

      Deno.stdout.writeSync(
        new TextEncoder().encode(`\r  ${bar} ${pct}% (${i}/${partsTotal}) ${fmt(speed)}/s ${fmtTime(elapsed)} / ~${fmtTime(remaining)} left`)
      );
    }

    file.close();

    const stat = await Deno.stat(filePath);
    console.log(`\n\n✅ Done: ${filePath} (${fmt(stat.size)})`);

    // File integrity info
    console.log(`\n🔍 Computing SHA-256...`);
    const fileData = await Deno.readFile(filePath);
    const hashBuf = await crypto.subtle.digest("SHA-256", fileData);
    const actualHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    console.log(`   SHA-256: ${actualHash}`);
    console.log();
  } catch (e) {
    try { file.close(); } catch { /* ignore */ }
    console.error(`\n\n❌ Failed: ${e instanceof Error ? e.message : e}`);
    console.log(`   Re-run the same command to resume.\n`);
    Deno.exit(1);
  }
}

main();
