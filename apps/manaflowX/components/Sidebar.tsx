"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const navItems = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    href: "/algorithm",
    label: "Algorithm",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    ),
  },
  {
    href: "/issues",
    label: "Issues",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
    ),
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-[68px] 2xl:w-[275px] shrink-0 h-screen sticky top-0 flex flex-col border-r border-gray-800 py-2 px-2 2xl:px-4">
      <nav className="flex flex-col gap-1 mt-2">
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 px-3 py-3 rounded-full transition-colors ${
                isActive
                  ? "font-bold bg-gray-900"
                  : "hover:bg-gray-900/50"
              }`}
            >
              <span className={isActive ? "text-white" : "text-gray-400"}>
                {item.icon}
              </span>
              <span className={`hidden 2xl:block text-xl ${isActive ? "text-white" : "text-gray-400"}`}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
