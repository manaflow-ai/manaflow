#!/bin/bash
cd "$(dirname "$0")" && docker build -t claude-sdk-test . && docker run --rm claude-sdk-test
