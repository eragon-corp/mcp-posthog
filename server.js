// Minimal HTTP proxy that listens on $PORT and forwards to the remote MCP
// Injects Authorization header from POSTHOG_AUTH_HEADER

const http = require("http");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const REMOTE_MCP_URL = process.env.POSTHOG_REMOTE_MCP_URL || "https://mcp.posthog.com/mcp";
const AUTH_INPUT = process.env.POSTHOG_AUTH_HEADER || "";

function getAuthHeaderValue() {
  if (!AUTH_INPUT) return undefined;
  if (AUTH_INPUT.toLowerCase().startsWith("bearer ")) return AUTH_INPUT;
  return `Bearer ${AUTH_INPUT}`;
}

function getTargetUrl(incomingPath, incomingSearch) {
  const remote = new URL(REMOTE_MCP_URL);
  // Map incoming /mcp and /sse to remote host
  let targetPath = incomingPath;
  if (incomingPath.startsWith("/mcp")) {
    // Use the configured remote MCP path
    targetPath = remote.pathname;
  } else if (incomingPath.startsWith("/sse")) {
    // Derive SSE path from the remote MCP path if possible
    const ssePath = remote.pathname.replace(/\bmcp\b/, "sse");
    targetPath = ssePath === remote.pathname ? "/sse" : ssePath;
  }
  const target = new URL(remote.origin);
  target.pathname = targetPath;
  target.search = incomingSearch || "";
  return target;
}

function filterHopByHop(headers) {
  const hopByHop = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ]);
  const result = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!hopByHop.has(k.toLowerCase())) result[k] = v;
  }
  return result;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Bad request");
      return;
    }

    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("PostHog MCP proxy is running. Use /mcp and /sse endpoints.");
      return;
    }

    const targetUrl = getTargetUrl(url.pathname, url.search);

    const incomingHeaders = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v || ""])
    );

    const headers = filterHopByHop(incomingHeaders);
    const authHeader = getAuthHeaderValue();
    if (authHeader) headers["authorization"] = authHeader;

    // Ensure Host header matches target
    headers["host"] = new URL(targetUrl).host;

    const isBodyAllowed = req.method && !["GET", "HEAD"].includes(req.method);
    const body = isBodyAllowed ? req : undefined;

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
      // Pass through streaming for SSE and tool responses
      duplex: isBodyAllowed ? "half" : undefined,
    });

    // Write status and headers
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (["content-length"].includes(key)) return; // let node set when possible
      responseHeaders[key] = value;
    });
    res.writeHead(upstream.status, responseHeaders);

    if (upstream.body) {
      // Stream the body
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) {
          await new Promise((r) => res.once("drain", r));
        }
      }
    }
    res.end();
  } catch (err) {
    console.error("Proxy error:", err);
    if (!res.headersSent) res.statusCode = 502;
    res.end("Bad gateway");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy listening on http://0.0.0.0:${PORT} -> ${REMOTE_MCP_URL}`);
});


