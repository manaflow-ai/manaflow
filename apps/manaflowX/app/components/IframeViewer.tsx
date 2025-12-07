"use client"

import { useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"

// =============================================================================
// Icons
// =============================================================================

export const VNCIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
)

export const WorkspaceIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
)

export const VSCodeIcon = (
  <svg className="w-4 h-4" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="vscode-d" x1="63.9222" x2="63.9222" y1="0.329902" y2="127.67" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fff"/>
        <stop offset="1" stopColor="#fff" stopOpacity="0"/>
      </linearGradient>
    </defs>
    <mask id="vscode-a" width="128" height="128" x="0" y="0" maskUnits="userSpaceOnUse" style={{maskType: "alpha"}}>
      <path fill="#fff" fillRule="evenodd" d="M90.767 127.126a7.968 7.968 0 0 0 6.35-.244l26.353-12.681a8 8 0 0 0 4.53-7.209V21.009a8 8 0 0 0-4.53-7.21L97.117 1.12a7.97 7.97 0 0 0-9.093 1.548l-50.45 46.026L15.6 32.013a5.328 5.328 0 0 0-6.807.302l-7.048 6.411a5.335 5.335 0 0 0-.006 7.888L20.796 64 1.74 81.387a5.336 5.336 0 0 0 .006 7.887l7.048 6.411a5.327 5.327 0 0 0 6.807.303l21.974-16.68 50.45 46.025a7.96 7.96 0 0 0 2.743 1.793Zm5.252-92.183L57.74 64l38.28 29.058V34.943Z" clipRule="evenodd"/>
    </mask>
    <g mask="url(#vscode-a)">
      <path fill="#0065A9" d="M123.471 13.82 97.097 1.12A7.973 7.973 0 0 0 88 2.668L1.662 81.387a5.333 5.333 0 0 0 .006 7.887l7.052 6.411a5.333 5.333 0 0 0 6.811.303l103.971-78.875c3.488-2.646 8.498-.158 8.498 4.22v-.306a8.001 8.001 0 0 0-4.529-7.208Z"/>
      <path fill="#007ACC" d="m123.471 114.181-26.374 12.698A7.973 7.973 0 0 1 88 125.333L1.662 46.613a5.333 5.333 0 0 1 .006-7.887l7.052-6.411a5.333 5.333 0 0 1 6.811-.303l103.971 78.874c3.488 2.647 8.498.159 8.498-4.219v.306a8.001 8.001 0 0 1-4.529 7.208Z"/>
      <path fill="#1F9CF0" d="M97.098 126.882A7.977 7.977 0 0 1 88 125.333c2.952 2.952 8 .861 8-3.314V5.98c0-4.175-5.048-6.266-8-3.313a7.977 7.977 0 0 1 9.098-1.549L123.467 13.8A8 8 0 0 1 128 21.01v85.982a8 8 0 0 1-4.533 7.21l-26.369 12.681Z"/>
      <path fill="url(#vscode-d)" fillRule="evenodd" d="M90.69 127.126a7.968 7.968 0 0 0 6.349-.244l26.353-12.681a8 8 0 0 0 4.53-7.21V21.009a8 8 0 0 0-4.53-7.21L97.039 1.12a7.97 7.97 0 0 0-9.093 1.548l-50.45 46.026-21.974-16.68a5.328 5.328 0 0 0-6.807.302l-7.048 6.411a5.336 5.336 0 0 0-.006 7.888L20.718 64 1.662 81.386a5.335 5.335 0 0 0 .006 7.888l7.048 6.411a5.328 5.328 0 0 0 6.807.303l21.975-16.681 50.45 46.026a7.959 7.959 0 0 0 2.742 1.793Zm5.252-92.184L57.662 64l38.28 29.057V34.943Z" clipRule="evenodd" opacity="0.25" style={{mixBlendMode: "overlay"}}/>
    </g>
  </svg>
)

// =============================================================================
// IframeViewer Component
// =============================================================================

interface IframeViewerProps {
  url: string
  title: string
  icon: React.ReactNode
  color: string
  isExpanded: boolean
  onToggle: () => void
}

export function IframeViewer({
  url,
  title,
  icon,
  color,
  isExpanded,
  onToggle
}: IframeViewerProps) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="border-b border-gray-800">
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-900/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={color}>{icon}</span>
          <span className={`text-sm font-medium ${color}`}>{title}</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isExpanded && (
        <div className="relative bg-black">
          <iframe
            src={url}
            className="w-full h-[400px] border-0"
            title={title}
            allow="clipboard-read; clipboard-write"
          />
          <div className="absolute top-2 right-2 flex items-center gap-1">
            <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
              <Dialog.Trigger asChild>
                <button
                  className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 text-xs text-gray-300 rounded flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  Expand
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50" />
                <Dialog.Content className="fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] w-[95vw] h-[90vh] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-50 flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <Dialog.Title className={`text-sm font-medium ${color} flex items-center gap-2`}>
                      {icon}
                      {title}
                    </Dialog.Title>
                    <div className="flex items-center gap-2">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open in new tab
                      </a>
                      <Dialog.Close asChild>
                        <button
                          className="p-1 text-gray-500 hover:text-white rounded transition-colors"
                          aria-label="Close"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </Dialog.Close>
                    </div>
                  </div>
                  <Dialog.Description className="sr-only">
                    Full-screen view of {title}
                  </Dialog.Description>
                  <div className="flex-1 bg-black">
                    <iframe
                      src={url}
                      className="w-full h-full border-0"
                      title={`${title} (Expanded)`}
                      allow="clipboard-read; clipboard-write"
                    />
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 bg-gray-800/80 hover:bg-gray-700 text-xs text-gray-300 rounded flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open in new tab
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
