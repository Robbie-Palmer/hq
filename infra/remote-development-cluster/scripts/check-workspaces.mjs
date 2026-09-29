import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const workspacesDirectory = new URL("../workspaces/", import.meta.url);
const inventory = JSON.parse(
  readFileSync(new URL("inventory.json", workspacesDirectory), "utf8"),
);
const rootKustomization = YAML.parse(
  readFileSync(new URL("kustomization.yaml", workspacesDirectory), "utf8"),
);
assert.deepEqual(rootKustomization.resources, [
  "storage-class.yaml",
  "operator",
  "pilot",
]);

const manifestPaths = [
  "storage-class.yaml",
  ...inventory.workspaces.map((workspace) => {
    const workspaceKustomization = YAML.parse(
      readFileSync(
        new URL(`${workspace.id}/kustomization.yaml`, workspacesDirectory),
        "utf8",
      ),
    );
    assert.deepEqual(workspaceKustomization.resources, ["workspace.yaml"]);
    return `${workspace.id}/workspace.yaml`;
  }),
];
const resources = manifestPaths.flatMap((path) =>
  YAML.parseAllDocuments(
    readFileSync(new URL(path, workspacesDirectory), "utf8"),
  ).map((document) => document.toJSON()),
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

  assert.equal(deployment.spec.replicas, 0);
  assert.deepEqual(
    deployment.spec.template.spec.nodeSelector,
    workspace.nodeSelector,
  );
  assert.equal(
    deployment.spec.template.metadata.annotations[
      "cluster-autoscaler.kubernetes.io/safe-to-evict"
    ],
    "false",
  );
  assert.equal(
    deployment.spec.template.metadata.labels[
      "remote-development.robbiepalmer.dev/tenant-workspace"
    ],
    "true",
  );
  assert.equal(
    deployment.spec.template.spec.tolerations[0].key,
    "remote-development.robbiepalmer.dev/role",
  );
  assert.equal(
    deployment.spec.template.spec.tolerations[0].value,
    "workspace",
  );
  const antiAffinity =
    deployment.spec.template.spec.affinity.podAntiAffinity
      .requiredDuringSchedulingIgnoredDuringExecution[0];
  assert.equal(antiAffinity.topologyKey, "kubernetes.io/hostname");
  assert.deepEqual(antiAffinity.namespaceSelector, {});
  assert.equal(
    antiAffinity.labelSelector.matchLabels[
      "remote-development.robbiepalmer.dev/tenant-workspace"
    ],
    "true",
  );
  assert.equal(
    claim.spec.resources.requests.storage,
    `${workspace.volumeSizeGiB}Gi`,
  );
  assert.equal(claim.spec.storageClassName, workspace.storageClass);
  assert.equal(service.spec.type ?? "ClusterIP", "ClusterIP");
  assert.equal(service.spec.ports[0].port, workspace.endpoint.targetPort);
  assert.equal(workspace.endpoint.kind, "kubectl-port-forward");

  const cache = deployment.spec.template.spec.volumes.find(
    (volume) => volume.name === "cache",
  );
  assert.equal(
    cache.emptyDir.sizeLimit,
    `${inventory.cachePolicy.sizeLimitGiB}Gi`,
  );
}

assert.equal(
  new Set(
    inventory.workspaces.map((workspace) => workspace.endpoint.localPort),
  ).size,
  inventory.workspaces.length,
  "workspace localhost ports must be unique",
);

console.log("Workspace manifests match the machine-readable inventory.");
