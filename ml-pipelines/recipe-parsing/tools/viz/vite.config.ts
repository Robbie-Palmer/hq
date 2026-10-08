import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import { defineConfig, type Plugin } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const pipelineRoot = path.resolve(__dirname, "../..");
const canonicalIngredientsPath = path.resolve(
  pipelineRoot,
  "../../packages/recipe-parsing/src/data/canonical-ingredients.json",
);
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;
const DVC_SAVE_MESSAGE =
  "Saved data/ground-truth.json. Run `dvc add data/ground-truth.json` and commit the updated DVC metadata when you intend to persist this dataset change.";

class RequestBodyTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

function collectBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    req.on("data", (c: Buffer) => {
      if (settled) return;
      received += c.length;
      if (received > MAX_REQUEST_BODY_BYTES) {
        settled = true;
        reject(new RequestBodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString());
      }
    });
    req.on("error", reject);
  });
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

/**
 * Serves files from the pipeline root under the /pipeline/ URL prefix.
 * e.g. /pipeline/data/recipe-images/PXL_123.jpg -> ../../data/recipe-images/PXL_123.jpg
 */
function servePipelineFiles(): Plugin {
  return {
    name: "serve-pipeline-files",
    configureServer(server) {
      // Write endpoint for ground truth annotations
      server.middlewares.use("/pipeline/api/ground-truth", async (req, res, next) => {
        if (req.method !== "POST") return next();

        try {
          const body = await collectBody(req);
          const json = JSON.parse(body);
          // Basic structural check — full Zod validation happens at pipeline run time
          if (!json?.entries || !Array.isArray(json.entries)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Expected { entries: [...] }" }));
            return;
          }
          const target = path.join(pipelineRoot, "data/ground-truth.json");
          await fs.promises.writeFile(target, JSON.stringify(json, null, 2) + "\n");
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, message: DVC_SAVE_MESSAGE }));
        } catch (e) {
          res.statusCode = e instanceof RequestBodyTooLargeError ? 413 : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      // Write endpoint for canonical ingredients
      server.middlewares.use("/pipeline/api/canonical-ingredients", async (req, res, next) => {
        if (req.method !== "POST") return next();

        try {
          const body = await collectBody(req);
          const json = JSON.parse(body);
          if (!json?.ingredients || !Array.isArray(json.ingredients)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Expected { ingredients: [...] }" }));
            return;
          }
          await fs.promises.writeFile(
            canonicalIngredientsPath,
            JSON.stringify(json, null, 2) + "\n",
          );
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              message: "Saved packages/recipe-parsing/src/data/canonical-ingredients.json.",
            }),
          );
        } catch (e) {
          res.statusCode = e instanceof RequestBodyTooLargeError ? 413 : 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      // The ontology lives in the shared recipe-parsing package, outside pipelineRoot
      server.middlewares.use("/pipeline/data/canonical-ingredients.json", (req, res, next) => {
        if (req.method !== "GET") return next();
        res.setHeader("Content-Type", "application/json");
        fs.createReadStream(canonicalIngredientsPath)
          .on("error", () => {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not found" }));
          })
          .pipe(res);
      });

      // Read endpoint for pipeline files
      server.middlewares.use("/pipeline", (req, res, next) => {
        const filePath = path.join(pipelineRoot, req.url ?? "");
        const resolved = path.resolve(filePath);
        // Security: only serve files under pipelineRoot
        if (resolved !== pipelineRoot && !resolved.startsWith(pipelineRoot + path.sep)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          res.setHeader("Content-Type", contentTypeFor(resolved));
          const stream = fs.createReadStream(resolved);
          function cleanup() {
            stream.off("error", onStreamError);
            res.off("error", onResponseError);
            res.off("finish", cleanup);
            res.off("close", onResponseClose);
          }
          // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
          function onStreamError(error: NodeJS.ErrnoException) {
            cleanup();
            stream.destroy();
            if (!res.headersSent) {
              res.statusCode = error.code === "ENOENT" ? 404 : 500;
              res.end(error.code === "ENOENT" ? "Not found" : "Failed to read file");
            } else {
              res.destroy(error);
            }
          }
          function onResponseError() {
            cleanup();
            stream.destroy();
          }
          function onResponseClose() {
            cleanup();
            stream.destroy();
          }
          stream.on("error", onStreamError);
          res.on("error", onResponseError);
          res.on("finish", cleanup);
          res.on("close", onResponseClose);
          stream.pipe(res);
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), servePipelineFiles()],
  build: {
    target: "esnext",
  },
  server: {
    fs: {
      allow: [pipelineRoot, path.resolve(__dirname, "../../..")],
    },
  },
});
