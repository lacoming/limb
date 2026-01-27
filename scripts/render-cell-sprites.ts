/**
 * Renders 24 turntable frames from cell3d.glb via headless Chromium.
 * Serves public/ over HTTP, loads render-cell.html, calls renderAndExport(deg), saves PNGs.
 * Run: pnpm render:sprites
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const OUT_DIR = path.join(PUBLIC, "sprites", "cell");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
};

function staticServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const base = (req.url ?? "/").split("?")[0];
      const p = base === "/" ? "/render-cell.html" : base;
      const file = path.join(PUBLIC, p);
      const resolved = path.resolve(file);
      if (!resolved.startsWith(PUBLIC)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const ext = path.extname(p);
        const mime = MIME[ext] ?? "application/octet-stream";
        res.setHeader("Content-Type", mime);
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      resolve({ server, port });
    });
  });
}

function ensureOutDir(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function main(): Promise<void> {
  const { server, port } = await staticServer();
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseUrl}/render-cell.html`, {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  await page.waitForFunction(
    () => typeof (window as unknown as { renderAndExport?: (d: number) => string }).renderAndExport === "function",
    { timeout: 15000 }
  );

  ensureOutDir();

  const angles = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345];
  for (const deg of angles) {
    const base64 = await page.evaluate(
      (d: number) => (window as unknown as { renderAndExport: (x: number) => string }).renderAndExport(d),
      deg
    );
    if (!base64 || !base64.startsWith("data:image/png;base64,")) {
      throw new Error(`renderAndExport(${deg}) did not return PNG base64`);
    }
    const raw = Buffer.from(base64.replace(/^data:image\/png;base64,/, ""), "base64");
    const name = `cell_${String(deg).padStart(3, "0")}.png`;
    fs.writeFileSync(path.join(OUT_DIR, name), raw);
    console.log(`Wrote ${name}`);
  }

  await browser.close();
  server.close();
  console.log(`Done. ${angles.length} frames in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
