export function isPreviewDeployment(hostname: string): boolean {
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
    /^pr-\d+\..+\.pages\.dev$/i.test(hostname)
  );
}
