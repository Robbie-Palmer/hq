#!/usr/bin/env tsx

import { format, isValid, parse } from "date-fns";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { listImages, uploadImage } from "./lib/cloudflare";
import { env } from "./lib/env";
export function validateDate(dateStr: string): boolean {
	const parsed = parse(dateStr, "yyyy-MM-dd", new Date());
	if (!isValid(parsed)) {
		return false;
	}
	// Ensure no normalization occurred (e.g., "2025-02-30" → "2025-03-02")
	return format(parsed, "yyyy-MM-dd") === dateStr;
}

function compareIsoDates(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function extractValidDateSuffix(imageId: string): string | null {
	const date = /(\d{4}-\d{2}-\d{2})$/.exec(imageId)?.[1];
	return date && validateDate(date) ? date : null;
}

export interface ImageParts {
	rootName: string;
	date: string;
	ext: string;
}

export function parseCalVerImageFilename(
	filename: string,
	validExtensions: string,
): ImageParts | null {
	const pattern = new RegExp(
		`^(.+)-(\\d{4}-\\d{2}-\\d{2})\\.(${validExtensions})$`,
	);
	const match = filename.match(pattern);
	if (!match?.[1] || !match[2] || !match[3]) {
		return null;
	}
	return {
		rootName: match[1],
		date: match[2],
		ext: match[3],
	};
}

function validateLocalImages(files: string[], sourceDir: string): number {
	let errors = 0;
	const rootNames = new Map<string, string>();
	for (const filename of files) {
		const filepath = join(sourceDir, filename);
		if (!statSync(filepath).isFile()) continue;
		const parts = parseCalVerImageFilename(filename, env.VALID_IMAGE_EXTENSIONS);
		if (!parts) {
			console.log(`   ❌ Invalid filename format: ${filename}`);
			console.log("      Expected: {name}-YYYY-MM-DD.{ext} (e.g., hero-image-2025-11-27.jpg)");
			errors++;
			continue;
		}
		if (!validateDate(parts.date)) {
			console.log(`   ❌ Invalid date in filename: ${filename} (date: ${parts.date})`);
			errors++;
			continue;
		}
		const duplicate = rootNames.get(parts.rootName);
		if (duplicate) {
			console.log("   ❌ Duplicate root name found:");
			console.log(`      - ${duplicate}`);
			console.log(`      - ${filename}`);
			console.log("      Only keep the latest version in source-images/");
			errors++;
			continue;
		}
		rootNames.set(parts.rootName, filename);
	}
	return errors;
}

function latestExistingVersion(existingIds: Set<string>, rootName: string) {
	return Array.from(existingIds)
		.filter((id) => id.startsWith(`blog/${rootName}-`))
		.map(extractValidDateSuffix)
		.filter((date): date is string => date !== null)
		.sort((left, right) => compareIsoDates(right, left))[0];
}

type UploadOutcome = "failed" | "ignored" | "skipped" | "uploaded";

async function uploadFile(
	filename: string,
	sourceDir: string,
	existingIds: Set<string>,
): Promise<UploadOutcome> {
	const filepath = join(sourceDir, filename);
	if (!statSync(filepath).isFile()) return "ignored";
	const parts = parseCalVerImageFilename(filename, env.VALID_IMAGE_EXTENSIONS);
	if (!parts) return "ignored";
	const imageId = `blog/${parts.rootName}-${parts.date}`;
	console.log("");
	console.log(`Processing: ${filename}`);
	console.log(`   Image ID: ${imageId}`);
	if (existingIds.has(imageId)) {
		console.log("   ⏭️  Skipped (already exists in Cloudflare Images)");
		return "skipped";
	}
	const latest = latestExistingVersion(existingIds, parts.rootName);
	if (latest && compareIsoDates(parts.date, latest) <= 0) {
		console.log("   ❌ Version validation failed:");
		console.log(`      Latest existing version: ${latest}`);
		console.log(`      New version: ${parts.date}`);
		console.log("      New version must be later than existing versions");
		return "failed";
	}
	if (latest) console.log(`   Newer version detected (latest existing: ${latest})`);

	const response = await uploadImage(filepath, imageId);
	if (response.success) {
		console.log("   ✅ Successfully uploaded");
		return "uploaded";
	}
	console.log(`   ❌ Failed to upload (HTTP ${response.statusCode})`);
	if (response.message) console.log(`   Error: ${response.message}`);
	return "failed";
}

async function main() {
	console.log("Starting image sync to Cloudflare Images...");
	console.log("");

	const sourceDir = "source-images/blog";
	try {
		statSync(sourceDir);
	} catch {
		console.log("⚠️  No source-images/blog directory found");
		console.log(
			"   Create it and add your images with CalVer naming: {name}-YYYY-MM-DD.{ext}",
		);
		process.exit(0);
	}

	let uploaded = 0;
	let skipped = 0;
	let failed = 0;
	let validationErrors = 0;

	console.log("1️⃣  Validating local image naming...");
	const files = readdirSync(sourceDir);
	validationErrors = validateLocalImages(files, sourceDir);

	if (validationErrors > 0) {
		console.log("");
		console.log(
			`❌ Found ${validationErrors} validation error(s). Fix them before uploading.`,
		);
		process.exit(1);
	}

	console.log("   ✅ All local images have valid CalVer naming");
	console.log("");

	console.log("2️⃣  Fetching existing images from Cloudflare...");
	const images = await listImages();
	const existingIds = new Set(images.map((img) => img.id || ""));
	console.log(`   Found ${existingIds.size} existing images in Cloudflare`);
	console.log("");

	console.log("3️⃣  Uploading new images...");
	for (const filename of files) {
		const outcome = await uploadFile(filename, sourceDir, existingIds);
		if (outcome === "uploaded") uploaded++;
		if (outcome === "skipped") skipped++;
		if (outcome === "failed") failed++;
	}

	console.log("");
	console.log("Summary:");
	console.log(`   ✅ Uploaded: ${uploaded}`);
	console.log(`   ⏭️  Skipped: ${skipped}`);
	console.log(`   ❌ Failed: ${failed}`);
	if (failed > 0) {
		console.log("");
		console.log("⚠️  Some images failed to upload. Check the logs above.");
		process.exit(1);
	}
	console.log("");
	console.log("Image sync completed successfully!");
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
