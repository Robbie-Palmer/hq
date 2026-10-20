import { createServer, type ServerResponse } from "node:http";

interface HealthPayload {
  service: string;
  status: "ok";
}

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

function respond(response: ServerResponse, status: number, payload: HealthPayload): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(payload)}\n`);
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    respond(response, 200, { service: "typescript", status: "ok" });
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end('{"error":"not found"}\n');
});

server.listen(port, host, () => {
  process.stdout.write(`typescript service listening on ${host}:${port}\n`);
});
