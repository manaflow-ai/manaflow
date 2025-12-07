"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const apps = [
  {
    id: "github",
    href: "/algorithm",
    label: "GitHub",
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
    ),
  },
  // Future apps can be added here
  // {
  //   id: "twitter",
  //   href: "/algorithm/twitter",
  //   label: "Twitter",
  //   icon: <TwitterIcon />,
  // },
]

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
          <h1 className="text-xl font-bold">Apps</h1>
        </div>

        {/* App tabs */}
        <div className="flex px-4 gap-1">
          {apps.map((app) => {
            const isActive = app.href === "/algorithm"
              ? pathname === "/algorithm"
              : pathname.startsWith(app.href)
            return (
              <Link
                key={app.id}
                href={app.href}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-blue-500 text-white"
                    : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/50"
                }`}
              >
                {app.icon}
                {app.label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Content */}
      {children}
    </div>
  )
}
