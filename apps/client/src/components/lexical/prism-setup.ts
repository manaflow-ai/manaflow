import Prism from "prismjs";

if (typeof globalThis !== "undefined") {
  (globalThis as typeof globalThis & { Prism?: typeof Prism }).Prism = Prism;
}
if (typeof window !== "undefined") {
  (window as typeof window & { Prism?: typeof Prism }).Prism = Prism;
}

export { Prism };
