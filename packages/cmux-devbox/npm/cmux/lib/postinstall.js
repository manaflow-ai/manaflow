#!/usr/bin/env node

// Post-install message for cmux
// Only show in interactive terminals to avoid noise in CI

const isCI = process.env.CI === 'true' ||
             process.env.CONTINUOUS_INTEGRATION === 'true' ||
             process.env.BUILD_NUMBER !== undefined ||
             process.env.GITHUB_ACTIONS === 'true';

const isInteractive = process.stdout.isTTY && !isCI;

if (isInteractive) {
  const message = `
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   ✨ cmux installed successfully!                       │
│                                                         │
│   Get started:                                          │
│     $ cmux login          # Login to your account       │
│     $ cmux start          # Create a cloud VM           │
│     $ cmux --help         # See all commands            │
│                                                         │
│   Documentation: https://manaflow.com/docs               │
│                                                         │
└─────────────────────────────────────────────────────────┘
`;
  console.log(message);
}
