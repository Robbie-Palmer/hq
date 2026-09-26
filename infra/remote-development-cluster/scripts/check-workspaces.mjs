import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const inventory = JSON.parse(
  readFileSync(new URL("../workspaces/inventory.json", import.meta.url), "utf8"),
);
const rendered = execFileSync(
  "kubectl",
  ["kustomize", new URL("../workspaces", import.meta.url).pathname],
  { encoding: "utf8" },
);
const resources = YAML.parseAllDocuments(rendered).map((document) =>
  document.toJSON(),
);

const storageClass = resources.find(
  (resource) =>
    resource.kind === "StorageClass" &&
    resource.metadata.name === "hcloud-volumes-retain",
);
assert.equal(storageClass.reclaimPolicy, "Retain");
assert.equal(storageClass.volumeBindingMode, "WaitForFirstConsumer");

for (const workspace of inventory.workspaces) {
  const deployment = resources.find(
    (resource) =>
      resource.kind === "Deployment" &&
      resource.metadata.namespace === workspace.namespace,
  );
  const claim = resources.find(
    (resource) =>
      resource.kind === "PersistentVolumeClaim" &&
      resource.metadata.namespace === workspace.namespace,
  );
  const service = resources.find(
    (resource) =>
      resource.kind === "Service" &&
      resource.metadata.namespace === workspace.namespace,
  );

  assert.ok(deployment, `missing Deployment for ${workspace.id}`);
  assert.ok(claim, `missing PVC for ${workspace.id}`);
  assert.ok(service, `missing Service for ${workspace.id}`);

  assert.deepEqual(
    deployment.spec.template.spec.nodeSelector,
    workspace.nodeSelector,
  );
  assert.equal(
    deployment.spec.template.spec.tolerations[0].value,
    workspace.id,
  );
  assert.equal(
    claim.spec.resources.requests.storage,
    `${workspace.volumeSizeGiB}Gi`,
  );
  assert.equal(claim.spec.storageClassName, workspace.storageClass);
  assert.equal(service.spec.ports[0].nodePort, workspace.endpoint.port);

  const cache = deployment.spec.template.spec.volumes.find(
    (volume) => volume.name === "cache",
  );
  assert.equal(
    cache.emptyDir.sizeLimit,
    `${inventory.cachePolicy.sizeLimitGiB}Gi`,
  );
}

console.log("Workspace manifests match the machine-readable inventory.");
