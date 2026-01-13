#!/usr/bin/env bun
import { freestyle } from "freestyle-sandboxes";

const { result } = await freestyle.serverless.runs.create({
  code: `
    const a = 15, b = 27;
    const sum = a + b;
    const product = a * b;
    return {
      equation: \`\${a} + \${b} = \${sum}\`,
      product
    };
  `
});

console.log(result);
