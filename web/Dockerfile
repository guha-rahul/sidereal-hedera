# SPDX-License-Identifier: Apache-2.0

FROM node:20-bookworm

ENV PNPM_HOME="/pnpm"
ENV PATH="/root/.foundry/bin:${PNPM_HOME}:${PATH}"
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
ENV SIDEREAL_ENABLE_DEMO_API=1
ENV SETTLE_SECONDS=4

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

# The demo API shells out to `forge` to run the contract test suite.
RUN curl -L https://foundry.paradigm.xyz | bash \
  && /root/.foundry/bin/foundryup

RUN corepack enable \
  && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @sidereal/sdk build \
  && pnpm --filter @sidereal/app run build

EXPOSE 10000

CMD ["pnpm", "--filter", "@sidereal/app", "start"]
