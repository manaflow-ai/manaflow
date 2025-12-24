import { heroui } from "@heroui/react";
import type { default as createPlugin } from "tailwindcss/plugin";

const plugin: ReturnType<typeof createPlugin> = heroui();
export default plugin;
