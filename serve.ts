import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Public origin for the portfolio. This is deliberately an allowlist server:
// repository metadata, Markdown profiles, source-control data, and private photos
// are never mapped to a public URL.
const ROOT = dirname(fileURLToPath(import.meta.url));
const configuredPort = Number.parseInt(process.env.PORT ?? "8788", 10);
const PORT = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 8788;

const PUBLIC_FILES = new Map<string, { file: string; type: string; cache: string }>([
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8", cache: "no-cache, no-transform" }],
  ["/style.css", { file: "style.css", type: "text/css; charset=utf-8", cache: "no-cache" }],
  ["/nojs.css", { file: "nojs.css", type: "text/css; charset=utf-8", cache: "no-cache" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8", cache: "no-cache" }],
  ["/vendor/three.module.min.js", { file: "node_modules/three/build/three.module.min.js", type: "text/javascript; charset=utf-8", cache: "public, max-age=604800" }],
  ["/assets/mark.svg", { file: "assets/mark.svg", type: "image/svg+xml; charset=utf-8", cache: "public, max-age=86400" }],
  ["/assets/banff-portrait-test.png", { file: "assets/banff-portrait-test.png", type: "image/png", cache: "no-cache" }],
  ["/assets/portrait-placeholder.svg", { file: "assets/portrait-placeholder.svg", type: "image/svg+xml; charset=utf-8", cache: "public, max-age=86400" }],
]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' mailto:",
  ].join("; "),
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function responseHeaders(contentType?: string, cache = "no-store") {
  return {
    ...SECURITY_HEADERS,
    "Cache-Control": cache,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function firstForwardedValue(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value ?? "").split(",")[0].trim();
}

function send(
  response: ServerResponse,
  status: number,
  body: Buffer | string | null,
  contentType: string | undefined = "text/plain; charset=utf-8",
  extraHeaders: Record<string, string> = {},
) {
  response.writeHead(status, {
    ...responseHeaders(contentType),
    ...extraHeaders,
  });
  response.end(body);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const authority = firstForwardedValue(request.headers.host) || `127.0.0.1:${PORT}`;
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url ?? "/", `http://${authority}`);
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  const forwardedHost = (
    firstForwardedValue(request.headers["x-forwarded-host"]) ||
    firstForwardedValue(request.headers.host) ||
    requestUrl.host
  ).split(":")[0].toLowerCase();
  const forwardedProtocol = (
    firstForwardedValue(request.headers["x-forwarded-proto"]) ||
    ("encrypted" in request.socket && request.socket.encrypted ? "https" : "http")
  ).toLowerCase();

  if (forwardedHost === "me.sarria.ca" && forwardedProtocol === "http") {
    send(response, 308, null, undefined, {
      Location: `https://me.sarria.ca${requestUrl.pathname}${requestUrl.search}`,
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed");
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const publicFile = PUBLIC_FILES.get(pathname);
  if (!publicFile) {
    send(response, 404, "Not found");
    return;
  }

  try {
    const body = await readFile(join(ROOT, publicFile.file));
    response.writeHead(200, responseHeaders(publicFile.type, publicFile.cache));
    response.end(request.method === "HEAD" ? null : body);
  } catch {
    send(response, 404, "Not found");
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    if (!response.headersSent) send(response, 500, "Internal server error");
    else response.destroy();
  });
});

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.maxRequestsPerSocket = 100;

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Qi portfolio origin listening on http://127.0.0.1:${PORT}`);
});
