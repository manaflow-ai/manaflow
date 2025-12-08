import { withWorkflow } from "workflow/next"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ["morphcloud", "ssh2", "node-ssh", "cpu-features"],
}

export default withWorkflow(nextConfig)
