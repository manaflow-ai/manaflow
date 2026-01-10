# cmux-local worker image
# Minimal image with Claude Code + tmux + ttyd for web terminal

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install essentials
RUN apt-get update && apt-get install -y \
    curl \
    git \
    tmux \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install ttyd for web terminal (detect architecture)
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        curl -L https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.aarch64 -o /usr/local/bin/ttyd; \
    else \
        curl -L https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 -o /usr/local/bin/ttyd; \
    fi && \
    chmod +x /usr/local/bin/ttyd

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Create workspace
WORKDIR /workspace

# Expose ttyd port
EXPOSE 7681

# Default: start web terminal with bash
CMD ["ttyd", "-p", "7681", "bash"]
