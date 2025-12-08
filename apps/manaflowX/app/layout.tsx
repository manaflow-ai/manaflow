import type { Metadata } from "next"
import { StackProvider, StackTheme } from "@stackframe/stack"
import { stackClientApp } from "../stack/client"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import ConvexClientProvider from "@/components/ConvexClientProvider"
import { AppShell } from "@/components/AppShell"
import { ThemeProvider } from "@/components/ThemeProvider"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "xagi",
  description: "optimal coding interface",
  icons: {
    icon: "/favicon.svg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ThemeProvider>
          <StackProvider app={stackClientApp}>
            <StackTheme>
              <ConvexClientProvider>
                <AppShell>{children}</AppShell>
              </ConvexClientProvider>
            </StackTheme>
          </StackProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
