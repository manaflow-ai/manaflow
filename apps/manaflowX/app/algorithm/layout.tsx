"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

const tabs = [
  {
    id: "general",
    href: "/algorithm",
    label: "General",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: "github",
    href: "/algorithm/github",
    label: "GitHub",
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
    ),
  },
  {
    id: "x",
    href: "/algorithm/x",
    label: "X",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    id: "gmail",
    href: "#",
    label: "Gmail",
    comingSoon: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
      </svg>
    ),
  },
  {
    id: "sentry",
    href: "#",
    label: "Sentry",
    comingSoon: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.53 8.893a8.202 8.202 0 0 1 4.25 5.603h-1.6a.6.6 0 0 0 0 1.2h1.806a8.202 8.202 0 0 1-.066.903H9.38a.6.6 0 1 0 0 1.2h1.35a8.16 8.16 0 0 1-3.722 4.395.6.6 0 0 0 .592 1.044 9.36 9.36 0 0 0 4.36-5.439h1.62a.6.6 0 1 0 0-1.2h-1.4c.04-.297.062-.599.066-.903h1.934a.6.6 0 0 0 0-1.2h-1.727a9.41 9.41 0 0 0-3.063-5.378l3.267-5.426c.437-.726 1.487-.726 1.924 0l7.212 11.98a.6.6 0 0 0 1.028-.62l-7.212-11.98z"/>
      </svg>
    ),
  },
  {
    id: "posthog",
    href: "#",
    label: "PostHog",
    comingSoon: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1.5 18a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0-4.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0-4.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0-4.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
      </svg>
    ),
  },
  {
    id: "linear",
    href: "#",
    label: "Linear",
    comingSoon: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2.117 17.469a.718.718 0 0 1-.018-1.012L14.457 4.1a.718.718 0 0 1 1.012.018l4.413 4.413a.718.718 0 0 1 .018 1.012L7.542 21.9a.718.718 0 0 1-1.012-.018l-4.413-4.413zM1.2 12.74a.72.72 0 0 1 0-1.017l5.063-5.063a.72.72 0 0 1 1.017 0l5.063 5.063a.72.72 0 0 1 0 1.017l-5.063 5.063a.72.72 0 0 1-1.017 0L1.2 12.74z"/>
      </svg>
    ),
  },
  {
    id: "slack",
    href: "#",
    label: "Slack",
    comingSoon: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
      </svg>
    ),
  },
  {
    id: "discord",
    href: "#",
    label: "Discord",
    comingSoon: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
    ),
  },
  {
    id: "notion",
    href: "#",
    label: "Notion",
    comingSoon: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.934zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.449.327s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933l3.222-.187zM2.196 1.5l13.168-.934c1.635-.14 2.055-.046 3.082.7l4.249 2.986c.7.514.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.987c0-.839.374-1.54 1.589-1.487z"/>
      </svg>
    ),
  },
]

function TabItem({ tab, isActive }: { tab: typeof tabs[number]; isActive: boolean }) {
  const [showTooltip, setShowTooltip] = useState(false)

  if (tab.comingSoon) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span
          className="flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 border-transparent text-gray-600 cursor-not-allowed"
        >
          {tab.icon}
          {tab.label}
        </span>
        {showTooltip && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 bg-gray-800 text-gray-200 text-xs rounded-lg whitespace-nowrap z-20 shadow-lg border border-gray-700">
            {tab.label} MCP coming soon!
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-800 border-l border-t border-gray-700 rotate-45" />
          </div>
        )}
      </div>
    )
  }

  return (
    <Link
      href={tab.href}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        isActive
          ? "border-blue-500 text-white"
          : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/50"
      }`}
    >
      {tab.icon}
      {tab.label}
    </Link>
  )
}

export default function AlgorithmLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-sm border-b border-gray-800">
        <div className="px-4 py-4">
          <h1 className="text-xl font-bold">Algorithm</h1>
        </div>

        {/* Tabs */}
        <div className="flex px-4 gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.href === "/algorithm"
              ? pathname === "/algorithm"
              : pathname.startsWith(tab.href)
            return (
              <TabItem key={tab.id} tab={tab} isActive={isActive} />
            )
          })}
        </div>
      </div>

      {/* Content */}
      {children}
    </div>
  )
}
