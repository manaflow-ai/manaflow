FROM oven/bun:1.3

# Create non-root user
RUN useradd -m -s /bin/bash testuser

WORKDIR /app

# Install the OLD Claude Agent SDK
RUN bun add @anthropic-ai/claude-agent-sdk@0.1.76

# Copy the test script and fix permissions
COPY test.ts .
RUN chown -R testuser:testuser /app

# Switch to non-root user
USER testuser

# Run the test
CMD ["bun", "run", "test.ts"]
