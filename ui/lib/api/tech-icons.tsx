import type { SimpleIcon } from "simple-icons";
import {
  siAnsible,
  siApacheflink,
  siApachekafka,
  siApacheparquet,
  siArduino,
  siBetterauth,
  siBitbucket,
  siClaude,
  siCloudflare,
  siCloudflarepages,
  siCloudflareworkers,
  siCoderabbit,
  siCplusplus,
  siDependabot,
  siDocker,
  siDotnet,
  siDrizzle,
  siDuckdb,
  siDvc,
  siEnte,
  siFastapi,
  siFastify,
  siGeopandas,
  siGithub,
  siGithubactions,
  siGo,
  siGoogle,
  siGooglebigquery,
  siGooglecloud,
  siGooglegemini,
  siGrafana,
  siHetzner,
  siHono,
  siHuggingface,
  siJellyfin,
  siJenkins,
  siK3s,
  siKeras,
  siKnip,
  siKotlin,
  siKubernetes,
  siLeaflet,
  siLucide,
  siMdx,
  siMermaid,
  siNetdata,
  siNextdotjs,
  siNixos,
  siNodedotjs,
  siNvidia,
  siOpencode,
  siOpencv,
  siOpentelemetry,
  siPlotly,
  siPnpm,
  siPostgresql,
  siPosthog,
  siPrisma,
  siPrometheus,
  siPulumi,
  siPython,
  siPytorch,
  siQbittorrent,
  siQodo,
  siR,
  siRabbitmq,
  siRadarr,
  siReact,
  siRenovate,
  siRevealdotjs,
  siSamsung,
  siShadcnui,
  siShortcut,
  siSimpleicons,
  siSonarqubecloud,
  siSonarr,
  siSpacy,
  siSwift,
  siTailscale,
  siTailwindcss,
  siTanstack,
  siTerraform,
  siTiktok,
  siTrakt,
  siTrivy,
  siTypescript,
  siVitest,
  siX,
  siZod,
} from "simple-icons";

const simpleIcons: Readonly<Record<string, SimpleIcon>> = {
  ansible: siAnsible,
  apacheflink: siApacheflink,
  apachekafka: siApachekafka,
  apacheparquet: siApacheparquet,
  arduino: siArduino,
  betterauth: siBetterauth,
  bitbucket: siBitbucket,
  claude: siClaude,
  cloudflare: siCloudflare,
  cloudflarepages: siCloudflarepages,
  cloudflareworkers: siCloudflareworkers,
  coderabbit: siCoderabbit,
  cplusplus: siCplusplus,
  dependabot: siDependabot,
  docker: siDocker,
  dotnet: siDotnet,
  drizzle: siDrizzle,
  duckdb: siDuckdb,
  dvc: siDvc,
  ente: siEnte,
  fastapi: siFastapi,
  fastify: siFastify,
  geopandas: siGeopandas,
  github: siGithub,
  githubactions: siGithubactions,
  go: siGo,
  google: siGoogle,
  googlebigquery: siGooglebigquery,
  googlecloud: siGooglecloud,
  googlegemini: siGooglegemini,
  grafana: siGrafana,
  hetzner: siHetzner,
  hono: siHono,
  huggingface: siHuggingface,
  jellyfin: siJellyfin,
  jenkins: siJenkins,
  k3s: siK3s,
  keras: siKeras,
  knip: siKnip,
  kotlin: siKotlin,
  kubernetes: siKubernetes,
  leaflet: siLeaflet,
  lucide: siLucide,
  mdx: siMdx,
  mermaid: siMermaid,
  netdata: siNetdata,
  nextdotjs: siNextdotjs,
  nixos: siNixos,
  nodedotjs: siNodedotjs,
  nvidia: siNvidia,
  opencode: siOpencode,
  opencv: siOpencv,
  opentelemetry: siOpentelemetry,
  plotly: siPlotly,
  pnpm: siPnpm,
  postgresql: siPostgresql,
  posthog: siPosthog,
  prisma: siPrisma,
  prometheus: siPrometheus,
  pulumi: siPulumi,
  python: siPython,
  pytorch: siPytorch,
  qbittorrent: siQbittorrent,
  qodo: siQodo,
  r: siR,
  rabbitmq: siRabbitmq,
  radarr: siRadarr,
  react: siReact,
  renovate: siRenovate,
  revealdotjs: siRevealdotjs,
  samsung: siSamsung,
  shadcnui: siShadcnui,
  shortcut: siShortcut,
  simpleicons: siSimpleicons,
  sonarqubecloud: siSonarqubecloud,
  sonarr: siSonarr,
  spacy: siSpacy,
  swift: siSwift,
  tailscale: siTailscale,
  tailwindcss: siTailwindcss,
  tanstack: siTanstack,
  terraform: siTerraform,
  tiktok: siTiktok,
  trakt: siTrakt,
  trivy: siTrivy,
  typescript: siTypescript,
  vitest: siVitest,
  x: siX,
  zod: siZod,
};

// Custom SVG icons available in /public/tech-icons/
const customIcons = new Set([
  "aws",
  "codex",
  "java",
  "stanford",
  "neo4j",
  "tsql",
  "csharp",
  "scikit-image",
  "weaviate",
  "openrouter",
  "openai",
  "neon",
  "claudecode",
  "svgl",
  "shiki",
  "embla-carousel",
  "fusejs",
  "mise",
  "doppler",
  "ksqldb",
  "t3code",
  "quixstreams",
  "strimzi",
  "dbt",
]);

const fullColorCustomIcons = new Set(["t3code"]);

// Map technology names to their slugs for edge cases
const techSlugOverrides: Record<string, string> = {
  "c++": "cplusplus",
  "c#": "csharp",
  tensorrt: "nvidia",
  "t-sql": "tsql",
  "stanford nlp": "stanford",
  "scikit-image": "scikit-image",
  "bitbucket pipelines": "bitbucket",
  tailwind: "tailwindcss",
  ccpm: "claude",
  codeql: "github",
  "embla carousel": "embla-carousel",
  turbopack: "nextdotjs",
  "fuse.js": "fusejs",
};

export function getTechSlug(name: string): string {
  const override =
    techSlugOverrides[name] || techSlugOverrides[name.toLowerCase()];
  if (override) {
    return override;
  }
  // Map name to default naming conventions
  return name
    .toLowerCase()
    .replace(/\./g, "dot")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

interface TechIconProps {
  name: string;
  iconSlug?: string; // Optional: use this slug instead of deriving from name
  className?: string;
  invertInDarkMode?: boolean;
}

const getSimpleIcon = (iconSlug: string): SimpleIcon | null => {
  return simpleIcons[iconSlug] ?? null;
};

type IconData =
  | { type: "custom"; slug: string }
  | { type: "simple"; icon: SimpleIcon };

export function resolveIconData(
  name: string,
  iconSlug?: string,
): IconData | null {
  const slug = iconSlug || getTechSlug(name);
  if (customIcons.has(slug)) {
    return { type: "custom", slug };
  }
  let simpleIcon = getSimpleIcon(slug);
  if (!simpleIcon && name.includes(" ")) {
    const [firstWord] = name.split(" ");
    if (firstWord) {
      simpleIcon = getSimpleIcon(getTechSlug(firstWord));
    }
  }
  if (simpleIcon) {
    return { type: "simple", icon: simpleIcon };
  }
  return null;
}

export function TechIcon({
  name,
  iconSlug,
  className = "w-3 h-3",
  invertInDarkMode = true,
}: Readonly<TechIconProps>) {
  const iconData = resolveIconData(name, iconSlug);
  if (!iconData) return null;

  if (iconData.type === "custom") {
    let colorFilter = "brightness-0";
    if (fullColorCustomIcons.has(iconData.slug)) {
      colorFilter = "";
    } else if (invertInDarkMode) {
      colorFilter = "brightness-0 dark:invert";
    }

    return (
      // biome-ignore lint/performance/noImgElement: SSG site uses Cloudflare Images CDN, not Next.js Image
      <img
        src={`/tech-icons/${iconData.slug}.svg`}
        alt={name}
        className={`${className} block object-contain ${colorFilter}`.trim()}
      />
    );
  }

  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{iconData.icon.title}</title>
      <path d={iconData.icon.path} />
    </svg>
  );
}

export function hasTechIcon(name: string, iconSlug?: string): boolean {
  return resolveIconData(name, iconSlug) !== null;
}

export function getTechIconKey(name: string, iconSlug?: string): string | null {
  const iconData = resolveIconData(name, iconSlug);
  if (!iconData) return null;

  if (iconData.type === "custom") {
    return `custom:${iconData.slug}`;
  }

  return `simple:${iconData.icon.slug}`;
}

export function getTechIconUrl(name: string, iconSlug?: string): string | null {
  const iconData = resolveIconData(name, iconSlug);
  if (!iconData) return null;

  if (iconData.type === "custom") {
    return `/tech-icons/${iconData.slug}.svg`;
  }

  const svg = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${iconData.icon.title}</title><path fill="currentColor" d="${iconData.icon.path}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
