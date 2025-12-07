"use client"

interface XIconProps {
  className?: string
  size?: number
}

export function XIcon({ className = "", size = 24 }: XIconProps) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full bg-black border border-border ${className}`}
      style={{ padding: size * 0.15 }}
    >
      <svg
        fill="currentColor"
        height={size * 0.6}
        viewBox="0 0 24 24"
        width={size * 0.6}
        xmlns="http://www.w3.org/2000/svg"
        color="#fff"
        style={{ flex: "0 0 auto", lineHeight: 1 }}
      >
        <title>X (Twitter)</title>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </div>
  )
}
