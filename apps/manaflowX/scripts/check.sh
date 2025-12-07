#!/bin/bash
(bunx tsgo && echo "✓ tsc passed") &
(bun lint && echo "✓ lint passed") &
wait
