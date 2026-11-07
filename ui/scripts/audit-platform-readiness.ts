#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { legacyADRAliases } from "@/content/adr-aliases";
import { getProjectWithADRs } from "@/lib/domain/project/projectQueries";
import { resolveEffectiveProjectStack } from "@/lib/domain/platform/platformQueries";
import { type DomainRepository, loadDomainRepository } from "@/lib/repository";

const financeProject = "personal-finance-app";
const platformProject = "personal-engineering-platform";
const selectedD1Technology = "cloudflare-d1";

const reconciledDecisionOwners = [
	{
		legacy: "personal-knowledge-graph:046-custom-agentic-code-review",
		canonical: "agentic-code-review:000-custom-agentic-code-review",
	},
	{
		legacy: "personal-knowledge-graph:055-stateful-ai-code-review",
		canonical: "agentic-code-review:001-stateful-ai-code-review",
	},
] as const;

const splitTemporalDecisionOwners = [
	{
		ref: "personal-knowledge-graph:058-temporal-platform-layers",
		ownershipText: "owns the knowledge graph representation",
	},
	{
		ref: "personal-engineering-platform:000-temporal-platform-layers",
		ownershipText: "owns the layer and slot definitions",
	},
] as const;

const requiredFinanceTechnologies = [
	"typescript",
	"cloudflare-pages",
	"cloudflare-workers",
	"postgresql",
	"neon",
	"drizzle",
	"hyperdrive",
	"opentelemetry",
	"posthog",
	"cloudflare-r2",
] as const;

export interface ReadinessCheck {
	details: Record<string, number | string | string[]>;
	id: string;
	passed: boolean;
}

export interface PlatformReadinessAudit {
	checks: ReadinessCheck[];
	findings: string[];
	passed: boolean;
	schemaVersion: 1;
}

function duplicates(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) repeated.add(value);
		seen.add(value);
	}
	return [...repeated].sort();
}

function addCheck(
	checks: ReadinessCheck[],
	findings: string[],
	id: string,
	details: ReadinessCheck["details"],
	checkFindings: string[],
): void {
	checks.push({ id, passed: checkFindings.length === 0, details });
	findings.push(...checkFindings.map((finding) => `${id}: ${finding}`));
}

function routeFileExists(
	outputDirectory: string,
	projectSlug: string,
	adrSlug: string,
	extension: "html" | "md",
): boolean {
	const base = path.join(
		outputDirectory,
		"projects",
		projectSlug,
		"adrs",
		adrSlug,
	);
	return extension === "md"
		? fs.existsSync(`${base}.md`)
		: fs.existsSync(`${base}.html`) || fs.existsSync(path.join(base, "index.html"));
}

function adrMigrationFindings(repository: DomainRepository): string[] {
	const aliasRefs = legacyADRAliases.map(({ alias }) => alias);
	return [
		...duplicates(aliasRefs).map((alias) => `duplicate legacy alias ${alias}`),
		...legacyADRAliases.flatMap((alias) => [
			...(!repository.adrs.has(alias.target)
				? [`${alias.alias} targets missing ADR ${alias.target}`]
				: []),
			...(repository.adrs.has(alias.alias)
				? [`${alias.alias} remains both a canonical ADR and an alias`]
				: []),
			...(alias.notes !== undefined && alias.notes.trim().length === 0
				? [`${alias.alias} has an empty preserved body`]
				: []),
		]),
	];
}

function canonicalOwnershipFindings(repository: DomainRepository): string[] {
	const aliasFindings = reconciledDecisionOwners.flatMap((owner) => [
		...(repository.adrAliases.get(owner.legacy) !== owner.canonical
			? [`${owner.legacy} does not resolve to ${owner.canonical}`]
			: []),
		...(!repository.adrs.has(owner.canonical)
			? [`canonical ADR ${owner.canonical} is missing`]
			: []),
		...(repository.adrs.has(owner.legacy)
			? [`legacy ADR ${owner.legacy} still owns a body`]
			: []),
	]);
	const splitFindings = splitTemporalDecisionOwners.flatMap((owner) => {
		const adr = repository.adrs.get(owner.ref);
		if (!adr) return [`split-ownership ADR ${owner.ref} is missing`];
		return adr.content.toLowerCase().includes(owner.ownershipText)
			? []
			: [
					`${owner.ref} does not declare ${JSON.stringify(owner.ownershipText)}`,
				];
	});
	return [...aliasFindings, ...splitFindings];
}

function legacyRouteFindings(outputDirectory: string | undefined): string[] {
	if (outputDirectory === undefined) return [];
	return legacyADRAliases.flatMap((alias) => {
		const separator = alias.alias.indexOf(":");
		const projectSlug = alias.alias.slice(0, separator);
		const adrSlug = alias.alias.slice(separator + 1);
		return (["html", "md"] as const).flatMap((extension) =>
			routeFileExists(outputDirectory, projectSlug, adrSlug, extension)
				? []
				: [`missing ${extension.toUpperCase()} route for ${alias.alias}`],
		);
	});
}

function auditAliases(
	repository: DomainRepository,
	outputDirectory: string | undefined,
	checks: ReadinessCheck[],
	findings: string[],
): void {
	const preservedBodies = legacyADRAliases.filter(
		(alias) => alias.notes !== undefined,
	).length;
	addCheck(
		checks,
		findings,
		"adr-migration-integrity",
		{
			aliases: legacyADRAliases.length,
			preservedBodies,
		},
		adrMigrationFindings(repository),
	);

	addCheck(
		checks,
		findings,
		"canonical-decision-ownership",
		{
			reconciledAliases: reconciledDecisionOwners.length,
			splitOwnershipRecords: splitTemporalDecisionOwners.length,
		},
		canonicalOwnershipFindings(repository),
	);

	addCheck(
		checks,
		findings,
		"legacy-adr-routes",
		{
			aliases: legacyADRAliases.length,
			generatedFilesChecked:
				outputDirectory === undefined ? 0 : legacyADRAliases.length * 2,
		},
		legacyRouteFindings(outputDirectory),
	);
}

type FinanceTechnologyUse = ReturnType<
	typeof resolveEffectiveProjectStack
>["technologies"][number];

function technologyProvenanceFindings(
	repository: DomainRepository,
	use: FinanceTechnologyUse,
): string[] {
	const evidenceFindings =
		!use.evidenceADRs || use.evidenceADRs.length === 0
			? [`${use.technology} lacks exact source evidence`]
			: use.evidenceADRs.flatMap((evidenceADR) =>
					repository.adrs.has(evidenceADR)
						? []
						: [
								`${use.technology} references missing evidence ADR ${evidenceADR}`,
							],
				);
	return [
		...(!use.decision || !repository.adrs.has(use.decision)
			? [`${use.technology} lacks a resolvable platform decision`]
			: []),
		...(!use.adoptionDecision && !use.adoptionRationale
			? [`${use.technology} lacks project adoption evidence`]
			: []),
		...(use.adoptionDecision !== undefined &&
		repository.adrs.has(use.adoptionDecision)
			? []
			: use.adoptionDecision !== undefined
				? [
						`${use.technology} adoption references missing ADR ${use.adoptionDecision}`,
					]
				: []),
		...evidenceFindings,
	];
}

function financeStackFindings(
	repository: DomainRepository,
	technologySlugs: string[],
	renderedTechnologies: string[],
	technologyUses: FinanceTechnologyUse[],
): string[] {
	const requiredFindings = requiredFinanceTechnologies.flatMap((technology) => {
		const count = technologySlugs.filter((candidate) => candidate === technology).length;
		return count === 1
			? []
			: [`${technology} appears ${count} times instead of once`];
	});
	return [
		...requiredFindings,
		...(technologySlugs.includes(selectedD1Technology)
			? ["Cloudflare D1 is selected in the effective stack"]
			: []),
		...duplicates(renderedTechnologies).map(
			(technology) => `rendered current technologies repeat ${technology}`,
		),
		...technologyUses.flatMap((use) =>
			technologyProvenanceFindings(repository, use),
		),
	];
}

function auditFinanceProvenance(
	repository: DomainRepository,
	checks: ReadinessCheck[],
	findings: string[],
): void {
	const stack = resolveEffectiveProjectStack(repository, financeProject);
	const view = getProjectWithADRs(repository, financeProject);
	const technologySlugs = stack.technologies.map(({ technology }) => technology);
	const renderedTechnologies = [
		...(view?.technologies.map(({ slug }) => slug) ?? []),
		...(view?.platformTechnologies?.map(({ slug }) => slug) ?? []),
	];

	addCheck(
		checks,
		findings,
		"personal-finance-provenance",
		{
			layers: stack.layers,
			technologies: technologySlugs,
		},
		financeStackFindings(
			repository,
			technologySlugs,
			renderedTechnologies,
			stack.technologies,
		),
	);
}

type RenderedPlatformManifest = NonNullable<
	NonNullable<ReturnType<typeof getProjectWithADRs>>["platformManifest"]
>;

function renderedSlotFindings(
	repository: DomainRepository,
	manifest: RenderedPlatformManifest,
): string[] {
	return manifest.slots.flatMap((slot) => {
		const adopterFindings = slot.adopters.flatMap((adopter) => {
			const stack = resolveEffectiveProjectStack(repository, adopter);
			return [...stack.technologies, ...stack.policies].some(
				(use) => use.slot === slot.slug,
			)
				? []
				: [`${slot.slug} lists non-adopter ${adopter}`];
		});
		const consumerFindings = slot.layerConsumers.flatMap((consumer) => {
			const layers = new Set(resolveEffectiveProjectStack(repository, consumer).layers);
			return manifest.policies.some(
				(policy) => policy.slot === slot.slug && layers.has(policy.layer),
			)
				? []
				: [`${slot.slug} lists invalid layer consumer ${consumer}`];
		});
		return [...adopterFindings, ...consumerFindings];
	});
}

function auditSlotUsers(
	repository: DomainRepository,
	checks: ReadinessCheck[],
	findings: string[],
): void {
	const platform = getProjectWithADRs(repository, platformProject);
	const manifest = platform?.platformManifest;
	addCheck(
		checks,
		findings,
		"rendered-slot-users",
		{ slots: manifest?.slots.length ?? 0 },
		manifest
			? renderedSlotFindings(repository, manifest)
			: ["rendered platform manifest is missing"],
	);
}

export function d1SelectionFindings(content: string, source: string): string[] {
	const findings: string[] = [];
	let heading = "";
	for (const [index, line] of content.split("\n").entries()) {
		if (/^#{1,6}\s/u.test(line)) heading = line;
		if (!/(?:\bD1\b|Cloudflare D1)/iu.test(line)) continue;
		if (
			/(?:historical|rejected|alternative|not selected|superseded)/iu.test(
				`${heading} ${line}`,
			)
		) {
			continue;
		}
		findings.push(`${source}:${index + 1} presents D1 without a historical or rejected label`);
	}
	return findings;
}

function auditD1Prose(
	contentDirectory: string,
	checks: ReadinessCheck[],
	findings: string[],
): void {
	const projectDirectories = [financeProject, "recipe-site"];
	const sourceFiles = projectDirectories.flatMap((project) => {
		const directory = path.join(contentDirectory, project);
		return fs
			.readdirSync(directory, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".mdx"))
			.map((entry) => path.join(entry.parentPath, entry.name));
	});
	const proseFindings = sourceFiles.flatMap((sourceFile) =>
		d1SelectionFindings(
			fs.readFileSync(sourceFile, "utf8"),
			path.relative(contentDirectory, sourceFile),
		),
	);
	addCheck(
		checks,
		findings,
		"d1-selection-state",
		{ filesScanned: sourceFiles.length },
		proseFindings,
	);
}

export function buildPlatformReadinessAudit(
	options: {
		contentDirectory?: string;
		outputDirectory?: string;
		repository?: DomainRepository;
	} = {},
): PlatformReadinessAudit {
	const repository = options.repository ?? loadDomainRepository();
	const contentDirectory =
		options.contentDirectory ?? path.join(process.cwd(), "content", "projects");
	const checks: ReadinessCheck[] = [];
	const findings: string[] = [];

	auditAliases(repository, options.outputDirectory, checks, findings);
	auditFinanceProvenance(repository, checks, findings);
	auditSlotUsers(repository, checks, findings);
	auditD1Prose(contentDirectory, checks, findings);

	return {
		schemaVersion: 1,
		passed: findings.length === 0,
		checks,
		findings,
	};
}

function main(): void {
	const outputArgument = process.argv.find((argument) => argument.startsWith("--out="));
	const outputDirectory = outputArgument?.slice("--out=".length);
	const audit = buildPlatformReadinessAudit({ outputDirectory });
	console.log(JSON.stringify(audit, null, 2));
	if (!audit.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
