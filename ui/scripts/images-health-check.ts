#!/usr/bin/env tsx

import { listImages } from "./lib/cloudflare";
import { env } from "./lib/env";

type Images = Awaited<ReturnType<typeof listImages>>;

function printImages(images: Images): void {
	console.log("   ✅ API connection successful");
	console.log(`   📊 Total images in account: ${images.length}`);
	const allIds = images
		.map((image) => image.id)
		.filter((id): id is string => typeof id === "string")
		.sort((left, right) => left.localeCompare(right, "en"));
	for (const [label, ids] of [
		["📸 Featured", allIds.filter((id) => id.includes("-featured-"))],
		["🖼️  Embedded", allIds.filter((id) => !id.includes("-featured-"))],
	] as const) {
		if (ids.length === 0) continue;
		console.log(`   ${label} images (${ids.length}):`);
		for (const id of ids) console.log(`      - ${id}`);
	}
}

function checkVariants(images: Images | undefined): void {
	console.log("2️⃣  Checking image variants...");
	if (!images) {
		console.log("   ⚠️  Skipped because the image list could not be loaded");
		return;
	}
	const variantNames = images[0]?.variants?.map((url) => url.split("/").at(-1));
	if (!variantNames) {
		console.log("   ⚠️  No images found - upload images to verify variants");
		return;
	}
	const configured = variantNames.includes("og");
	console.log(
		configured
			? "   ✅ og variant configured (1200w for OpenGraph metadata)"
			: "   ❌ og variant missing",
	);
	console.log("");
	console.log("   💡 Configure variants in Cloudflare Dashboard:");
	console.log(`      https://dash.cloudflare.com/${env.CF_ACCOUNT_ID}/images/variants`);
}

function testImageUrl(images: Images | undefined): void {
	console.log("3️⃣  Testing image URL generation...");
	if (!images) {
		console.log("   ⚠️  Skipped because the image list could not be loaded");
		return;
	}
	const firstImageId = images[0]?.id;
	if (!firstImageId) {
		console.log("   ⚠️  No images found in account (upload some with 'mise run //ui:images:sync')");
		return;
	}
	console.log(`   🧪 Test image ID: ${firstImageId}`);
	console.log(
		`   🌐 Test URL: https://imagedelivery.net/${env.NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH}/${firstImageId}/og`,
	);
	console.log("   💡 Open this URL in browser to verify image loads");
}

async function main() {
	console.log("Running Cloudflare Images health check...");
	console.log("");

	console.log("1️⃣  Testing API connectivity...");
	let images: Images | undefined;
	try {
		images = await listImages();
		printImages(images);
	} catch (error) {
		console.log("   ❌ API connection failed");
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		console.log(`   Error: ${errorMessage}`);
	}

	console.log("");
	checkVariants(images);
	console.log("");

	testImageUrl(images);

	console.log("");
	console.log("🏁 Health check complete!");
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
