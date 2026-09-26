#!/usr/bin/env node

import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer";

// Configuration
const PAGES_TO_TEST = [
	{ name: "home", path: "/" },
	{ name: "blog-list", path: "/blog" },
	{
		name: "blog-post",
		path: "/blog/2020-07-25-why-you-should-not-buy-a-house",
	},
];

const THRESHOLDS = {
	performance: 90,
	accessibility: 95,
	"best-practices": 90,
	seo: 90,
};

// Device presets
const DEVICE_CONFIGS = {
	desktop: {
		formFactor: "desktop",
		screenEmulation: {
			mobile: false,
			width: 1350,
			height: 940,
			deviceScaleFactor: 1,
			disabled: false,
		},
		throttling: {
			// Cable connection
			rttMs: 40,
			throughputKbps: 10240,
			cpuSlowdownMultiplier: 1,
		},
	},
	mobile: {
		formFactor: "mobile",
		screenEmulation: {
			mobile: true,
			width: 412,
			height: 823,
			deviceScaleFactor: 2.625,
			disabled: false,
		},
		throttling: {
			// Simulated 4G connection
			rttMs: 150,
			throughputKbps: 1638.4,
			cpuSlowdownMultiplier: 4,
		},
	},
};

// Parse LIGHTHOUSE_DEVICE env: "desktop", "mobile", or "both" (default: "desktop")
const deviceArg = process.env.LIGHTHOUSE_DEVICE || "desktop";
const devicesToTest =
	deviceArg === "both" ? ["desktop", "mobile"] : [deviceArg];

function getLighthouseFlags(device) {
	const config = DEVICE_CONFIGS[device];
	if (!config) {
		throw new Error(`Unknown device: ${device}. Use "desktop", "mobile", or "both".`);
	}
	return {
		output: ["html", "json"],
		onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
		skipAudits: ["uses-http2"],
		...config,
	};
}

const LIGHTHOUSE_CONFIG = {
	extends: "lighthouse:default",
	settings: {
		maxWaitForFcp: 15000,
		maxWaitForLoad: 35000,
	},
};

const BASE_URL = process.env.LIGHTHOUSE_URL || "http://localhost:3000";
const REPORTS_DIR = join(process.cwd(), "lighthouse-reports");

async function checkServerAvailable(url) {
	try {
		const response = await fetch(url, { method: "HEAD" });
		return response.ok;
	} catch {
		return false;
	}
}

async function runLighthouse(url, port, device) {
	const flags = getLighthouseFlags(device);
	const result = await lighthouse(url, { ...flags, port }, LIGHTHOUSE_CONFIG);
	return result ?? undefined;
}

function formatScore(score) {
	if (score === null) return "N/A";
	const percentage = Math.round(score * 100);
	if (percentage >= 90) return `\x1b[32m${percentage}\x1b[0m`;
	if (percentage >= 50) return `\x1b[33m${percentage}\x1b[0m`;
	return `\x1b[31m${percentage}\x1b[0m`;
}

function checkThresholds(result) {
	const scores = {};
	let passed = true;
	for (const [category, threshold] of Object.entries(THRESHOLDS)) {
		const score = result.categories[category]?.score;
		const percentage = score !== null ? Math.round((score ?? 0) * 100) : 0;
		scores[category] = percentage;
		if (percentage < threshold) {
			passed = false;
		}
	}
	return { scores, passed };
}

async function requireServer() {
	console.log("Checking server availability...");
	if (await checkServerAvailable(BASE_URL)) {
		console.log("Server is running.\n");
		return;
	}
	console.error(`\x1b[31mError: Server not reachable at ${BASE_URL}\x1b[0m`);
	console.error("\nMake sure to either:");
	console.error("  1. Start the dev server first: pnpm dev");
	console.error("  2. Use: mise run //ui:lighthouse:serve (builds and serves automatically)");
	console.error("  3. Set LIGHTHOUSE_URL to a running server");
	process.exit(1);
}

async function chromeExecutablePath() {
	const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH;
	if (configuredPath) return configuredPath;
	try {
		const channelPath = puppeteer.executablePath("chrome");
		if (existsSync(channelPath)) return channelPath;
	} catch {
		// Fall back to Puppeteer's managed browser below.
	}
	return puppeteer.executablePath();
}

async function runPageAudit(chrome, device, page) {
	const url = `${BASE_URL}${page.path}`;
	const testName = `${page.name}-${device}`;
	console.log(`\nTesting: ${testName} (${url})`);
	const runnerResult = await runLighthouse(url, chrome.port, device);
	if (!runnerResult) {
		console.error(`  Failed to get results for ${testName}`);
		return null;
	}
	const { lhr, report } = runnerResult;
	if (Array.isArray(report) && report[0] && report[1]) {
		await writeFile(join(REPORTS_DIR, `${testName}.html`), report[0]);
		await writeFile(join(REPORTS_DIR, `${testName}.json`), report[1]);
	}
	const { scores, passed } = checkThresholds(lhr);
	console.log("  Scores:");
	for (const [category, score] of Object.entries(scores)) {
		const threshold = THRESHOLDS[category];
		const status = score >= threshold ? "PASS" : "FAIL";
		console.log(
			`    ${category}: ${formatScore(score / 100)} (threshold: ${threshold}) [${status}]`,
		);
	}
	return { name: testName, device, path: page.path, scores, passed };
}

async function runAudits(chrome) {
	const results = [];
	let allPassed = true;
	for (const device of devicesToTest) {
		console.log(`\n--- ${device.toUpperCase()} ---`);
		for (const page of PAGES_TO_TEST) {
			const result = await runPageAudit(chrome, device, page);
			if (result) results.push(result);
			if (!result?.passed) allPassed = false;
		}
	}
	return { results, allPassed };
}

function printSummary(results) {
	console.log("\n==============================");
	console.log("Summary");
	console.log("==============================\n");
	for (const device of devicesToTest) {
		console.log(`${device.toUpperCase()}:`);
		for (const result of results.filter((item) => item.device === device)) {
			const status = result.passed
				? "\x1b[32mPASS\x1b[0m"
				: "\x1b[31mFAIL\x1b[0m";
			console.log(`  ${result.name}: ${status}`);
		}
	}
}

async function main() {
	console.log("Lighthouse Performance Testing");
	console.log("==============================");
	console.log(`Base URL: ${BASE_URL}`);
	console.log(`Devices: ${devicesToTest.join(", ")}`);
	console.log(`Reports: ${REPORTS_DIR}`);
	console.log("");

	await requireServer();

	await mkdir(REPORTS_DIR, { recursive: true });

	console.log("Launching Chrome...");
	const chromePath = await chromeExecutablePath();
	const chrome = await launch({
		chromePath,
		chromeFlags: ["--headless", "--disable-gpu", "--no-sandbox"],
	});

	let auditResult;
	try {
		auditResult = await runAudits(chrome);
	} finally {
		await chrome.kill();
	}

	printSummary(auditResult.results);
	console.log(`\nReports saved to: ${REPORTS_DIR}/`);
	console.log("  Open HTML reports in browser for detailed analysis.\n");
	if (!auditResult.allPassed) {
		console.log(
			"\x1b[31mSome pages failed to meet performance thresholds.\x1b[0m",
		);
		process.exit(1);
	}
	console.log("\x1b[32mAll pages passed performance thresholds!\x1b[0m");
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
