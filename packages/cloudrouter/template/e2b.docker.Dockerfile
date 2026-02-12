# E2B Dockerfile for cmux devbox template WITH Docker support
# This template includes Docker-in-Docker for running containers

FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system packages including Docker dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    ca-certificates \
    gnupg \
    lsb-release \
    jq \
    netcat-openbsd \
    sudo \
    python3 \
    python3-pip \
    unzip \
    openssl \
    rsync \
    openssh-server \
    # VNC and desktop environment
    xfce4 \
    xfce4-goodies \
    dbus-x11 \
    tigervnc-standalone-server \
    # Fonts for proper rendering
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-color-emoji \
    # Docker dependencies
    apt-transport-https \
    iptables \
    && rm -rf /var/lib/apt/lists/*

# Install Docker
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Configure SSH server on port 10000 (since 22 may not be exposed by E2B)
RUN mkdir -p /var/run/sshd \
    && sed -i 's/#Port 22/Port 10000/' /etc/ssh/sshd_config \
    && echo "PermitRootLogin no" >> /etc/ssh/sshd_config \
    && echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config \
    && echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config

# Install Node.js 22 (latest LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest

# Install Bun globally (accessible to all users, not just root)
RUN curl -fsSL https://bun.sh/install | bash \
    && cp /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Install Rust globally (rustup + toolchain accessible to all users)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo sh -s -- -y --default-toolchain stable --no-modify-path \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo \
    && ln -s /usr/local/cargo/bin/* /usr/local/bin/ \
    && echo 'export RUSTUP_HOME=/usr/local/rustup' >> /etc/profile.d/rust.sh \
    && echo 'export CARGO_HOME=/usr/local/cargo' >> /etc/profile.d/rust.sh
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH="/usr/local/cargo/bin:${PATH}"

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install cmux-code (VSCode fork with OpenVSIX marketplace support)
# Fetch latest release from manaflow-ai/vscode-1
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then ARCH="x64"; fi && \
    RELEASE_URL=$(curl -s https://api.github.com/repos/manaflow-ai/vscode-1/releases/latest | grep "browser_download_url.*vscode-server-linux-${ARCH}-web.tar.gz" | cut -d '"' -f 4) && \
    wget -q "$RELEASE_URL" -O /tmp/cmux-code.tar.gz && \
    mkdir -p /app/cmux-code && \
    tar -xzf /tmp/cmux-code.tar.gz -C /app/cmux-code --strip-components=1 && \
    rm /tmp/cmux-code.tar.gz && \
    chmod -R 755 /app/cmux-code

# Install noVNC for web-based VNC access
RUN git clone --depth=1 https://github.com/novnc/noVNC.git /opt/noVNC \
    && git clone --depth=1 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify \
    && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html \
    && chmod -R 755 /opt/noVNC

# Install Chrome for headless browser automation
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Create user account (E2B expects a 'user' account)
RUN useradd -m -s /bin/bash -u 1000 user \
    && echo "user:user" | chpasswd \
    && usermod -aG docker user

# Setup for user
RUN mkdir -p /home/user/workspace /home/user/.vnc /home/user/.chrome-data /home/user/.chrome-visible /home/user/.config /home/user/.local/share/applications \
    && mkdir -p /home/user/.vscode-server-oss/data/User \
    && mkdir -p /home/user/.vscode-server-oss/data/User/profiles/default-profile \
    && mkdir -p /home/user/.vscode-server-oss/data/Machine \
    && mkdir -p /home/user/.vscode-server-oss/extensions \
    && chown -R user:user /home/user

# Configure cmux-code settings (OpenVSIX marketplace, disable workspace trust)
# extensions.verifySignature: false is required because OpenVSIX marketplace doesn't support extension signatures
RUN echo '{ \
  "workbench.colorTheme": "Default Dark Modern", \
  "workbench.startupEditor": "none", \
  "workbench.welcomePage.walkthroughs.openOnInstall": false, \
  "workbench.tips.enabled": false, \
  "workbench.secondarySideBar.defaultVisibility": "hidden", \
  "editor.fontSize": 14, \
  "editor.tabSize": 2, \
  "editor.minimap.enabled": false, \
  "editor.formatOnSave": true, \
  "files.autoSave": "afterDelay", \
  "files.autoSaveDelay": 1000, \
  "terminal.integrated.fontSize": 14, \
  "terminal.integrated.defaultProfile.linux": "cmux", \
  "terminal.integrated.shellIntegration.enabled": false, \
  "security.workspace.trust.enabled": false, \
  "security.workspace.trust.startupPrompt": "never", \
  "security.workspace.trust.untrustedFiles": "open", \
  "security.workspace.trust.emptyWindow": false, \
  "extensions.verifySignature": false, \
  "git.openDiffOnClick": true, \
  "scm.defaultViewMode": "tree", \
  "settingsSync.ignoredSettings": [] \
}' > /home/user/.vscode-server-oss/data/User/settings.json \
    && cp /home/user/.vscode-server-oss/data/User/settings.json /home/user/.vscode-server-oss/data/User/profiles/default-profile/settings.json \
    && cp /home/user/.vscode-server-oss/data/User/settings.json /home/user/.vscode-server-oss/data/Machine/settings.json \
    && chown -R user:user /home/user/.vscode-server-oss

# Set up VNC password (empty)
RUN echo "" | vncpasswd -f > /home/user/.vnc/passwd \
    && chmod 600 /home/user/.vnc/passwd \
    && chown user:user /home/user/.vnc/passwd

# Create VNC xstartup script
COPY worker/xstartup /home/user/.vnc/xstartup
RUN chmod +x /home/user/.vnc/xstartup \
    && chown user:user /home/user/.vnc/xstartup

# Create the start services script (Docker version)
COPY worker/start-services-docker.sh /usr/local/bin/start-services.sh
RUN chmod +x /usr/local/bin/start-services.sh

# Install Go for building worker daemon
RUN wget -q https://go.dev/dl/go1.24.2.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go1.24.2.linux-amd64.tar.gz \
    && rm go1.24.2.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:$PATH"

# Build Go worker daemon (standalone binary, no internal dependencies)
COPY go.mod go.sum /tmp/worker-build/
COPY cmd/worker /tmp/worker-build/cmd/worker/
RUN cd /tmp/worker-build && \
    go mod download && \
    go build -ldflags="-s -w" -o /usr/local/bin/worker-daemon ./cmd/worker && \
    rm -rf /tmp/worker-build

# Keep Node.js VNC auth proxy (simple enough to stay in JS)
COPY worker/vnc-auth-proxy.js /usr/local/bin/vnc-auth-proxy.js
# Keep browser-agent-runner for browser automation (uses puppeteer)
COPY worker/browser-agent-runner.js /usr/local/bin/browser-agent-runner.js
RUN cd /usr/local/bin && npm install ws puppeteer-core

# Make sure user can run services - add to sudoers
RUN echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set working directory
WORKDIR /home/user/workspace

# Environment variables
ENV DISPLAY=:1
ENV HOME=/home/user

# Expose ports (E2B handles exposure, no nginx needed)
# Note: 5901 (VNC) and 9222 (Chrome CDP) bind to localhost only for security
EXPOSE 39377 39378 39380 10000

# Default command
CMD ["/usr/local/bin/start-services.sh"]
