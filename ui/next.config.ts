import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

type WebpackCompiler = {
  outputPath: string;
  hooks: {
    afterEmit: {
      tap: (pluginName: string, callback: () => void) => void;
    };
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createNextConfig(phase: string): NextConfig {
  return {
    // Keep Turbopack's development artifacts separate from production builds.
    // Reusing .next after `next build` can leave dev looking for incompatible
    // Pages Router manifests such as pages/_app/build-manifest.json.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    output: "export",
    images: {
      unoptimized: true,
      remotePatterns: [
        {
          protocol: "https",
          hostname: "a.storyblok.com",
          pathname: "/f/337048/**",
        },
        {
          protocol: "https",
          hostname: "ugc.production.linktr.ee",
          pathname:
            "/4f88d739-d63c-434e-9683-0ca5142a4358_FF-CIRCULAR-DOUBLE-OUTLINE-SALMON-OUTER.png",
        },
        {
          protocol: "https",
          hostname: "res.cloudinary.com",
          pathname: "/dmukukwp6/image/upload/deskhog_smiling_36bb2647ff",
        },
      ],
    },
    // `next build` runs its own `tsc` type-check, but a dedicated `//ui:check`
    // (PR CI) / `//ui:check:static` (deploy workflows) step already does, so the
    // in-build pass is redundant serial work (~11s/build, measured). Skip it.
    // `eslint.ignoreDuringBuilds` likewise disables Next's built-in ESLint
    // integration — unused here, since linting is done by Biome in those same
    // check steps — and is set defensively in case ESLint is ever added.
    typescript: { ignoreBuildErrors: true },
    eslint: { ignoreDuringBuilds: true },
    // Dev-only: proxy auth requests to the local recipe-api Worker.
    // In production the Cloudflare Pages Function (functions/api/auth/) handles this.
    ...(phase === PHASE_DEVELOPMENT_SERVER
      ? {
          async rewrites() {
            return [
              {
                source: "/.well-known/agent-configuration",
                destination:
                  "http://localhost:8787/.well-known/agent-configuration",
              },
              {
                source: "/api/auth/:path*",
                destination: "http://localhost:8787/api/auth/:path*",
              },
              {
                source: "/api/profile/diet",
                destination: "http://localhost:8787/api/profile/diet",
              },
              {
                source: "/api/profile/bootstrap",
                destination: "http://localhost:8787/api/profile/bootstrap",
              },
              {
                source: "/api/profile/diet/options",
                destination: "http://localhost:8787/api/profile/diet/options",
              },
              {
                source: "/api/profile/recipe-box",
                destination: "http://localhost:8787/api/profile/recipe-box",
              },
              {
                source: "/api/profile/cooking-insights",
                destination:
                  "http://localhost:8787/api/profile/cooking-insights",
              },
              {
                source: "/api/profile/cooking-sessions",
                destination:
                  "http://localhost:8787/api/profile/cooking-sessions",
              },
              {
                source: "/api/households/:path*",
                destination: "http://localhost:8787/api/households/:path*",
              },
              {
                source: "/api/notifications/:path*",
                destination: "http://localhost:8787/notifications/:path*",
              },
              {
                source: "/api/pantry/:path*",
                destination: "http://localhost:8787/pantry/:path*",
              },
              {
                source: "/api/shopping-lists/:path*",
                destination: "http://localhost:8787/shopping-lists/:path*",
              },
              {
                source: "/api/recipes/:path*",
                destination: "http://localhost:8787/recipes/:path*",
              },
              {
                source: "/api/recipe-drafts/:path*",
                destination: "http://localhost:8787/recipe-drafts/:path*",
              },
              {
                source: "/api/recipe-imports/:path*",
                destination: "http://localhost:8787/recipe-imports/:path*",
              },
            ];
          },
        }
      : {}),
    turbopack: {
      root: path.join(__dirname, ".."),
    },
    // Prevent 'fs' and 'path' from being bundled into client-side chunks.
    // Recipe .cook files are read server-side at build time only; these modules
    // are never called in the browser, so replacing them with empty modules is safe.
    webpack(config, { isServer }) {
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
      };

      if (isServer) {
        config.plugins = config.plugins ?? [];
        config.plugins.push({
          apply(compiler: WebpackCompiler) {
            compiler.hooks.afterEmit.tap("CooklangServerWasmPathPlugin", () => {
              const outputPath = compiler.outputPath;
              const sourceDir = path.join(outputPath, "chunks/static/wasm");
              const targetDir = path.join(outputPath, "static/wasm");
              const staticExportWasmDir = path.join(
                outputPath,
                "..",
                "static/wasm",
              );

              if (!fs.existsSync(sourceDir)) {
                return;
              }

              fs.mkdirSync(targetDir, { recursive: true });
              fs.mkdirSync(staticExportWasmDir, { recursive: true });
              for (const filename of fs.readdirSync(sourceDir)) {
                if (filename.endsWith(".wasm")) {
                  const sourceFile = path.join(sourceDir, filename);
                  fs.copyFileSync(sourceFile, path.join(targetDir, filename));
                  fs.copyFileSync(
                    sourceFile,
                    path.join(staticExportWasmDir, filename),
                  );
                }
              }
            });
          },
        });
      }

      if (!isServer) {
        config.resolve = {
          ...config.resolve,
          fallback: {
            ...config.resolve?.fallback,
            fs: false,
            path: false,
          },
        };
      }
      return config;
    },
  };
}

export default createNextConfig;
