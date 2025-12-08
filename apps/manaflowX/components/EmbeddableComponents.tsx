"use client"

import { useState } from "react"
import Image from "next/image"
import {
  IframeViewer,
  VNCIcon,
  VSCodeIcon,
} from "../app/components/IframeViewer"

// Build URLs from Morph instance ID
function buildMorphUrls(instanceId: string) {
  const slug = instanceId.replace("_", "-")
  return {
    vscode: `https://code-server-${slug}.http.cloud.morph.so/?folder=/root/workspace`,
    vnc: `https://novnc-${slug}.http.cloud.morph.so/vnc.html?autoconnect=true&resize=scale`,
  }
}

type EmbedType = "vscode" | "vnc"

interface XEmbedProps {
  type?: EmbedType
  instance?: string // morphvm_xxx
  url?: string // direct URL override
  title?: string
  node?: unknown // passed by Streamdown
}

// Custom component for <x-embed> elements in markdown
export function XEmbed({ type = "vscode", instance, url, title }: XEmbedProps) {
  const [isExpanded, setIsExpanded] = useState(true) // Default expanded for embeds

  // Build URL from instance or use direct URL
  let embedUrl = url
  if (!embedUrl && instance) {
    const urls = buildMorphUrls(instance)
    embedUrl = urls[type]
  }

  if (!embedUrl) {
    return (
      <div className="my-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
        Missing URL or instance for embed (type: {type})
      </div>
    )
  }

  const config: Record<
    EmbedType,
    { icon: React.ReactNode; color: string; defaultTitle: string; aspectRatio?: "16/9" | "4/3" | "square" | "auto" }
  > = {
    vscode: {
      icon: VSCodeIcon,
      color: "text-blue-400",
      defaultTitle: "VS Code",
    },
    vnc: {
      icon: VNCIcon,
      color: "text-cyan-400",
      defaultTitle: "Live Browser View",
      aspectRatio: "16/9",
    },
  }

  const { icon, color, defaultTitle, aspectRatio } = config[type] || config.vscode

  return (
    <div className="my-4 not-prose">
      <IframeViewer
        url={embedUrl}
        title={title || defaultTitle}
        icon={icon}
        color={color}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        aspectRatio={aspectRatio}
      />
    </div>
  )
}

// Custom image component to avoid hydration issues
// Markdown renders images inside <p> tags, but div wrappers cause "div inside p" errors
// Using span wrappers instead keeps the HTML valid
interface MarkdownImageProps {
  src?: string
  alt?: string
  node?: unknown
}

function MarkdownImage({ src, alt }: MarkdownImageProps) {
  if (!src) return null

  return (
    <span className="block my-2">
      <Image
        src={src}
        alt={alt || "Image"}
        width={500}
        height={300}
        className="rounded-lg max-w-full h-auto"
        unoptimized
        style={{ display: "block" }}
      />
    </span>
  )
}

// Export components map for Streamdown
// These map HTML element names to React components
// We use type assertion because x-embed is a custom element not in JSX.IntrinsicElements
export const embeddableComponents = {
  "x-embed": XEmbed,
  "img": MarkdownImage,
} as Record<string, React.ComponentType<unknown>>
