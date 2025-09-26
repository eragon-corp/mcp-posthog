# Use a lightweight Node.js image
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# Install mcp-remote globally to avoid npx overhead on each run
RUN npm install -g mcp-remote@latest

# Set default environment variable for POSTHOG_REMOTE_MCP_URL
ENV POSTHOG_REMOTE_MCP_URL=https://mcp.posthog.com/mcp

# Copy the proxy server that will listen on $PORT and forward to the remote MCP
COPY server.js ./

# Cloud Run requires the container to listen on the PORT env var (default 8080)
ENV PORT=8080

# Start the HTTP proxy server
ENTRYPOINT ["node", "server.js"]
