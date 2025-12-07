import { getConvexProvidersConfig } from "@stackframe/stack";

const authConfig = {
  providers: getConvexProvidersConfig({
    projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
  }),
};

export default authConfig;
