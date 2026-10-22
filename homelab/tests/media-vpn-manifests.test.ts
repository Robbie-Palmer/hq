import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseAllDocuments } from "yaml";

interface Resource {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string };
  spec?: Record<string, unknown>;
  data?: Record<string, string>;
}

const homelabDirectory = fileURLToPath(new URL("..", import.meta.url));

function render(): Resource[] {
  const result = spawnSync(
    "kubectl",
    ["kustomize", "k3s/overlays/home-media"],
    { cwd: homelabDirectory, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return parseAllDocuments(result.stdout).map((document) => document.toJS() as Resource);
}

function resource(resources: Resource[], kind: string, name: string): Resource {
  const match = resources.find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  assert.ok(match, `${kind}/${name} must be rendered`);
  return match;
}

function resourceWithNamePrefix(
  resources: Resource[],
  kind: string,
  namePrefix: string,
): Resource {
  const match = resources.find(
    (candidate) =>
      candidate.kind === kind && candidate.metadata.name.startsWith(`${namePrefix}-`),
  );
  assert.ok(match, `${kind}/${namePrefix}-* must be rendered`);
  return match;
}

test("qBittorrent shares its pod network with a fail-closed Gluetun sidecar", () => {
  const resources = render();
  const deployment = resource(resources, "Deployment", "qbittorrent") as Resource & {
    spec: {
      replicas: number;
      template: {
        metadata: { annotations: Record<string, string> };
        spec: {
          initContainers: Array<Record<string, unknown>>;
          containers: Array<Record<string, unknown>>;
          volumes: Array<Record<string, unknown>>;
        };
      };
    };
  };
  const pod = deployment.spec.template.spec;
  const gluetun = pod.initContainers.find((container) => container.name === "gluetun") as {
    image: string;
    env: Array<Record<string, unknown>>;
    lifecycle: { postStart: { exec: { command: string[] } } };
    restartPolicy: string;
    securityContext: { capabilities: { add: string[]; drop: string[] } };
    startupProbe: { exec: { command: string[] } };
    volumeMounts: Array<Record<string, unknown>>;
  };
  const qbittorrent = pod.containers.find(
    (container) => container.name === "qbittorrent",
  ) as { securityContext?: { capabilities?: { add?: string[] } } };

  assert.equal(deployment.spec.replicas, 1);
  assert.equal(deployment.spec.template.metadata.annotations["secrets.doppler.com/reload"], "true");
  assert.equal(gluetun.image, "ghcr.io/qdm12/gluetun:v3.41.3");
  assert.equal(gluetun.restartPolicy, "Always");
  assert.deepEqual(gluetun.startupProbe.exec.command, [
    "/opt/homelab/check-tunnel-ready.sh",
  ]);
  assert.deepEqual(gluetun.lifecycle.postStart.exec.command, [
    "/opt/homelab/remove-wireguard-policy-rules.sh",
  ]);
  assert.deepEqual(gluetun.securityContext.capabilities.add, ["NET_ADMIN", "NET_RAW"]);
  assert.deepEqual(gluetun.securityContext.capabilities.drop, ["ALL"]);
  assert.ok(!qbittorrent.securityContext?.capabilities?.add?.includes("NET_ADMIN"));
  assert.deepEqual(
    pod.initContainers.map((container) => container.name),
    ["prepare-vpn-config", "gluetun"],
  );
  assert.deepEqual(
    pod.volumes.find((volume) => volume.name === "tun"),
    { name: "tun", hostPath: { path: "/dev/net/tun", type: "CharDevice" } },
  );

  const env = Object.fromEntries(gluetun.env.map((entry) => [entry.name, entry]));
  assert.deepEqual(env.WIREGUARD_PRIVATE_KEY, {
    name: "WIREGUARD_PRIVATE_KEY",
    valueFrom: {
      secretKeyRef: {
        name: "proton-vpn",
        key: "PROTON_VPN_WIREGUARD_PRIVATE_KEY",
      },
    },
  });
  assert.equal(env.PORT_FORWARD_ONLY?.value, "on");
  assert.equal(env.VPN_PORT_FORWARDING?.value, "on");
  assert.equal(env.FIREWALL_INPUT_PORTS?.value, "8080");
  assert.equal(
    env.VPN_PORT_FORWARDING_UP_COMMAND?.value,
    "/opt/homelab/set-forwarded-port.sh {{PORT}} {{VPN_INTERFACE}}",
  );
  assert.equal(
    env.VPN_PORT_FORWARDING_DOWN_COMMAND?.value,
    "/opt/homelab/clear-forwarded-port.sh",
  );
  assert.deepEqual(
    gluetun.volumeMounts.find((volume) => volume.name === "vpn-scripts"),
    { name: "vpn-scripts", mountPath: "/opt/homelab", readOnly: true },
  );
});

test("the media namespace receives only the Proton WireGuard private key", () => {
  const resources = render();
  const secret = resource(resources, "DopplerSecret", "proton-vpn") as Resource & {
    spec: {
      tokenSecret: { name: string };
      managedSecret: { name: string; namespace: string };
      project: string;
      config: string;
      secrets: string[];
    };
  };
  assert.equal(secret.spec.project, "homelab");
  assert.equal(secret.spec.config, "prd");
  assert.equal(secret.spec.tokenSecret.name, "doppler-token");
  assert.deepEqual(secret.spec.managedSecret, { name: "proton-vpn", namespace: "media" });
  assert.deepEqual(secret.spec.secrets, ["PROTON_VPN_WIREGUARD_PRIVATE_KEY"]);
});

test("the host starts K3s without an interactive VPN and no longer scales media on route state", () => {
  const wrapper = readFileSync(
    new URL("../ansible/roles/colima_k3s/templates/start-colima-k3s.sh.j2", import.meta.url),
    "utf8",
  );
  const reconciler = readFileSync(
    new URL("../k3s/overlays/home-media/media-vpn-gate.sh", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(wrapper, /route -n get|utun/);
  assert.doesNotMatch(reconciler, /route -n get|utun/);
  assert.match(reconciler, /desired=1/);
});

test("qBittorrent local API access is limited to the shared pod loopback", () => {
  const resources = render();
  const scripts = resourceWithNamePrefix(resources, "ConfigMap", "qbittorrent-vpn-scripts");
  assert.match(scripts.data?.["prepare-config.sh"] ?? "", /WebUI\\LocalHostAuth.*false/);
  assert.match(scripts.data?.["prepare-config.sh"] ?? "", /Connection\\UPnP.*false/);
  assert.match(scripts.data?.["set-forwarded-port.sh"] ?? "", /listen_port.*port/);
  assert.match(scripts.data?.["clear-forwarded-port.sh"] ?? "", /listen_port.*0/);
  assert.match(scripts.data?.["check-tunnel-ready.sh"] ?? "", /ip link show tun0/);
  assert.match(
    scripts.data?.["remove-wireguard-policy-rules.sh"] ?? "",
    /ip rule del table 51820/,
  );
});
