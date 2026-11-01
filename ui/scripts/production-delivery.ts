import { pathToFileURL } from "node:url";

const productionOrigin = "https://robbiepalmer.me";
const cloudflareApiOrigin = "https://api.cloudflare.com/client/v4";
const pagesProject = "personal-site";
const productionBranch = "main";

type Fetcher = typeof fetch;
type Wait = (milliseconds: number) => Promise<void>;
type CloudflareRequest = <T>(
	path: string,
	operation: string,
	init?: RequestInit,
) => Promise<T>;

type Probe = {
	path: string;
	accept: string;
	marker: string;
};

type PagesDeployment = {
	id: string;
	project_name: string;
	environment: "preview" | "production";
	latest_stage?: { status?: string };
	source?: {
		config?: {
			branch?: string;
			commit_hash?: string;
		};
	};
};

type PagesProject = {
	name: string;
	production_branch: string;
	canonical_deployment?: PagesDeployment | null;
};

type ApiEnvelope<T> = {
	success: boolean;
	errors?: Array<{ code?: number; message?: string }>;
	result: T;
};

export type RollbackInput = {
	accountId: string;
	apiToken: string;
	failedRevision: string;
	targetRevision: string;
};

export type RollbackResult = {
	failedRevision: string;
	targetRevision: string;
	targetDeploymentId: string;
};

const probes: Probe[] = [
	{ path: "/", accept: "text/html", marker: "<title>Robbie Palmer" },
	{ path: "/llms.txt", accept: "text/plain", marker: "# Robbie Palmer" },
	{
		path: "/projects/agent-coordinator.md",
		accept: "text/markdown",
		marker: "# Agent Coordinator",
	},
];

const wait: Wait = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

function validateRevision(revision: string, label: string): void {
	if (!/^[0-9a-f]{40}$/.test(revision)) {
		throw new Error(`${label} must be a full lowercase Git revision`);
	}
}

function validateRollbackInput(input: RollbackInput): void {
	validateRevision(input.failedRevision, "failed revision");
	validateRevision(input.targetRevision, "target revision");
	if (input.failedRevision === input.targetRevision) {
		throw new Error("target revision must differ from failed revision");
	}
	if (!input.accountId || !input.apiToken) {
		throw new Error("Cloudflare account ID and API token are required");
	}
}

async function readEnvelope<T>(response: Response, operation: string): Promise<T> {
	if (!response.ok) {
		throw new Error(`${operation} failed with HTTP ${response.status}`);
	}
	const body = (await response.json()) as ApiEnvelope<T>;
	if (!body.success) {
		const detail = body.errors
			?.map((error) => error.message ?? String(error.code ?? "unknown"))
			.join("; ");
		const detailSuffix = detail ? `: ${detail}` : "";
		throw new Error(`${operation} failed${detailSuffix}`);
	}
	return body.result;
}

function deploymentRevision(deployment: PagesDeployment | undefined): string | undefined {
	return deployment?.source?.config?.commit_hash;
}

function assertProductionDeployment(
	deployment: PagesDeployment,
	revision: string,
): void {
	if (
		deployment.project_name !== pagesProject ||
		deployment.environment !== "production" ||
		deployment.latest_stage?.status !== "success" ||
		deployment.source?.config?.branch !== productionBranch ||
		deploymentRevision(deployment) !== revision
	) {
		throw new Error(
			`revision ${revision} is not a successful ${productionBranch} deployment for ${pagesProject}`,
		);
	}
}

async function runProbe(fetcher: Fetcher, probe: Probe): Promise<void> {
	const response = await fetcher(`${productionOrigin}${probe.path}`, {
		headers: { accept: probe.accept },
		redirect: "error",
		signal: AbortSignal.timeout(20_000),
	});
	const body = await response.text();
	if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
	if (response.url && new URL(response.url).origin !== productionOrigin) {
		throw new Error(`unexpected response origin ${new URL(response.url).origin}`);
	}
	if (!body.includes(probe.marker)) {
		throw new Error(`response did not contain ${JSON.stringify(probe.marker)}`);
	}
}

async function runProbeWithRetries(
	fetcher: Fetcher,
	probe: Probe,
	attempts: number,
	pause: Wait,
	attempt = 1,
): Promise<void> {
	try {
		await runProbe(fetcher, probe);
	} catch (error) {
		const failure = error instanceof Error ? error.message : String(error);
		if (attempt >= attempts) {
			throw new Error(`production probe ${probe.path} failed: ${failure}`);
		}
		await pause(attempt * 500);
		await runProbeWithRetries(fetcher, probe, attempts, pause, attempt + 1);
	}
}

export async function smokeProductionSite(
	fetcher: Fetcher = fetch,
	attempts = 5,
	pause: Wait = wait,
): Promise<void> {
	await Promise.all(
		probes.map((probe) => runProbeWithRetries(fetcher, probe, attempts, pause)),
	);
}

async function confirmRollback(
	request: CloudflareRequest,
	projectPath: string,
	targetRevision: string,
	pause: Wait,
	attempt = 1,
): Promise<boolean> {
	const updated = await request<PagesProject>(
		projectPath,
		"confirm Pages rollback",
	);
	if (deploymentRevision(updated.canonical_deployment ?? undefined) === targetRevision) {
		return true;
	}
	if (attempt >= 5) return false;
	await pause(attempt * 1_000);
	return confirmRollback(request, projectPath, targetRevision, pause, attempt + 1);
}

export async function rollbackProduction(
	input: RollbackInput,
	fetcher: Fetcher = fetch,
	pause: Wait = wait,
): Promise<RollbackResult> {
	validateRollbackInput(input);

	const projectPath = `/accounts/${encodeURIComponent(input.accountId)}/pages/projects/${pagesProject}`;
	const request: CloudflareRequest = async <T>(
		path: string,
		operation: string,
		init?: RequestInit,
	) =>
		readEnvelope<T>(
			await fetcher(`${cloudflareApiOrigin}${path}`, {
				...init,
				headers: {
					authorization: `Bearer ${input.apiToken}`,
					"content-type": "application/json",
					...init?.headers,
				},
				redirect: "error",
				signal: AbortSignal.timeout(20_000),
			}),
			operation,
		);

	const project = await request<PagesProject>(projectPath, "read Pages project");
	if (
		project.name !== pagesProject ||
		project.production_branch !== productionBranch
	) {
		throw new Error("Cloudflare Pages project does not match the production contract");
	}
	const current = project.canonical_deployment;
	if (!current || deploymentRevision(current) !== input.failedRevision) {
		throw new Error(
			`production no longer serves failed revision ${input.failedRevision}; refusing stale rollback`,
		);
	}

	const deployments = await request<PagesDeployment[]>(
		`${projectPath}/deployments?env=production&per_page=50`,
		"list production deployments",
	);
	const targets = deployments.filter(
		(deployment) => deploymentRevision(deployment) === input.targetRevision,
	);
	if (targets.length !== 1) {
		throw new Error(
			`expected one production deployment for target revision ${input.targetRevision}, found ${targets.length}`,
		);
	}
	const target = targets[0];
	if (!target) throw new Error("rollback target disappeared");
	assertProductionDeployment(target, input.targetRevision);

	await request<PagesDeployment>(
		`${projectPath}/deployments/${encodeURIComponent(target.id)}/rollback`,
		"roll back Pages production",
		{ method: "POST", body: "{}" },
	);

	const confirmed = await confirmRollback(
		request,
		projectPath,
		input.targetRevision,
		pause,
	);
	if (!confirmed) {
		throw new Error("Pages accepted the rollback but did not activate the target revision");
	}

	return {
		failedRevision: input.failedRevision,
		targetRevision: input.targetRevision,
		targetDeploymentId: target.id,
	};
}

async function main(): Promise<void> {
	const [command] = process.argv.slice(2);
	if (command === "smoke") {
		await smokeProductionSite();
		console.log("Production site HTML and agent-readable pages are healthy.");
		return;
	}
	if (command === "rollback") {
		const result = await rollbackProduction({
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
			apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
			failedRevision: process.env.FAILED_REVISION ?? "",
			targetRevision: process.env.TARGET_REVISION ?? "",
		});
		console.log(
			`Rolled back Pages production from ${result.failedRevision} to ${result.targetRevision} using deployment ${result.targetDeploymentId}.`,
		);
		return;
	}
	throw new Error("usage: production-delivery <smoke|rollback>");
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
