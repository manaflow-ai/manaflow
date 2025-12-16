FROM lukemathwalker/cargo-chef:latest-rust-1 AS chef

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo chef prepare --recipe-path recipe.json

FROM lukemathwalker/cargo-chef:latest-rust-1 AS builder

ARG GIT_COMMIT=unknown

WORKDIR /app

COPY --from=chef /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json --target x86_64-unknown-linux-gnu

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN GIT_COMMIT=$GIT_COMMIT cargo build --release --locked --target x86_64-unknown-linux-gnu

FROM gcr.io/distroless/cc-debian12

ENV PORT=8080 \
    GLOBAL_PROXY_BACKEND_SCHEME=https \
    GLOBAL_PROXY_MORPH_DOMAIN_SUFFIX=.http.cloud.morph.so \
    GLOBAL_PROXY_WORKSPACE_DOMAIN_SUFFIX=.vm.freestyle.sh

WORKDIR /app

COPY --from=builder /app/target/x86_64-unknown-linux-gnu/release/global-proxy /usr/local/bin/global-proxy

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/global-proxy"]
