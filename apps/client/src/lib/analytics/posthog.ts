import posthog from "posthog-js";
import { env } from "@/client-env";
import { isElectron } from "../electron";

const DEFAULT_API_HOST = "https://us.i.posthog.com";
const DEFAULT_UI_HOST = "https://us.posthog.com";

let initialized = false;

function registerPlatform() {
  posthog.register({
    platform: isElectron ? "manaflow-client-electron" : "manaflow-client-web",
  });
}

interface PosthogUserProperties {
  email?: string;
  name?: string;
  team_id?: string;
}

export function initPosthog() {
  if (initialized) {
    return posthog;
  }

  if (!env.NEXT_PUBLIC_POSTHOG_KEY || import.meta.env.DEV) {
    return null;
  }

  const apiHost = env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_API_HOST;

  posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: apiHost,
    ui_host: env.NEXT_PUBLIC_POSTHOG_HOST ? undefined : DEFAULT_UI_HOST,
    capture_pageview: "history_change",
    capture_pageleave: true,
    autocapture: true,
    debug: import.meta.env.DEV,
    defaults: "2025-05-24",
    disable_surveys: true,
  });

  registerPlatform();

  initialized = true;
  return posthog;
}

export function getPosthogClient() {
  if (initialized) {
    return posthog;
  }

  return initPosthog();
}

export function identifyPosthogUser(
  id: string,
  properties: PosthogUserProperties
) {
  const client = getPosthogClient();
  if (!client) {
    return;
  }

  client.identify(id, properties);
}

export function resetPosthog() {
  if (!initialized) {
    return;
  }

  posthog.reset();

  registerPlatform();
}
