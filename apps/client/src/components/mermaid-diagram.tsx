import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

function getThemeFromDocument(): "dark" | "default" {
  if (typeof document === "undefined") {
    return "default";
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "default";
}

export function MermaidDiagram({ chart, className }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const lastThemeRef = useRef<"dark" | "default" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "default">(() => getThemeFromDocument());
  const renderIdRef = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    mountedRef.current = true;

    const observer = new MutationObserver(() => {
      const nextTheme = getThemeFromDocument();
      setTheme((currentTheme) =>
        currentTheme === nextTheme ? currentTheme : nextTheme
      );
    });

    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => {
      mountedRef.current = false;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !chart.trim()) {
      return;
    }

    if (lastThemeRef.current !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        theme,
        securityLevel: "strict",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        fontSize: 14,
        flowchart: {
          useMaxWidth: false,
          htmlLabels: true,
          curve: "basis",
          padding: 20,
          nodeSpacing: 40,
          rankSpacing: 60,
        },
      });
      lastThemeRef.current = theme;
    }

    const currentRenderId = ++renderIdRef.current;
    const renderDiagram = async () => {
      try {
        const id = `mermaid-${Date.now()}-${currentRenderId}`;
        const { svg } = await mermaid.render(id, chart);
        // Only update if this is still the latest render
        const latestContainer = containerRef.current;
        if (
          currentRenderId === renderIdRef.current &&
          mountedRef.current &&
          latestContainer &&
          latestContainer.isConnected
        ) {
          latestContainer.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (currentRenderId === renderIdRef.current && mountedRef.current) {
          console.error("[MermaidDiagram] Failed to render:", err);
          setError(err instanceof Error ? err.message : "Failed to render diagram");
        }
      }
    };

    void renderDiagram();
  }, [chart, theme]);

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
        <p className="font-medium">Diagram render error</p>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className ?? "overflow-auto [&_svg]:min-w-fit"}
    />
  );
}
