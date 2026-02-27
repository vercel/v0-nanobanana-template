"use client"

import { useState } from "react"
import { X, AlertTriangle, Info } from "lucide-react"

interface SetupItem {
  key: string
  envVar: string
  label: string
  href: string
  linkText: string
  severity: "required" | "optional"
}

const SETUP_ITEMS: SetupItem[] = [
  {
    key: "ai",
    envVar: "AI_GATEWAY_API_KEY",
    label: "is required to enable image generation.",
    href: "https://vercel.com/docs/ai-gateway",
    linkText: "Set up AI Gateway",
    severity: "required",
  },
  {
    key: "db",
    envVar: "Supabase",
    label: "is required for rate limiting, usage tracking, and generation history.",
    href: "https://vercel.com/integrations/supabase",
    linkText: "Add Supabase integration",
    severity: "required",
  },
  {
    key: "blob",
    envVar: "BLOB_READ_WRITE_TOKEN",
    label: "is required to store generated images.",
    href: "https://vercel.com/docs/vercel-blob",
    linkText: "Set up Vercel Blob",
    severity: "required",
  },
  {
    key: "auth",
    envVar: "Sign in with Vercel",
    label: "is not configured. Without it the app runs in anonymous-only mode.",
    href: "https://vercel.com/docs/sign-in-with-vercel",
    linkText: "Learn how",
    severity: "optional",
  },
]

interface SetupBannerProps {
  authConfigured: boolean
  aiConfigured: boolean
  dbConfigured: boolean
  blobConfigured: boolean
}

export function SetupBanner({ authConfigured, aiConfigured, dbConfigured, blobConfigured }: SetupBannerProps) {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set())

  const configMap: Record<string, boolean> = {
    ai: aiConfigured,
    db: dbConfigured,
    blob: blobConfigured,
    auth: authConfigured,
  }

  const missing = SETUP_ITEMS.filter(
    (item) => !configMap[item.key] && !dismissedKeys.has(item.key),
  )

  if (missing.length === 0) return null

  const dismiss = (key: string) =>
    setDismissedKeys((prev) => new Set(prev).add(key))

  // Show required items as amber warnings, optional items as blue info
  const required = missing.filter((i) => i.severity === "required")
  const optional = missing.filter((i) => i.severity === "optional")

  return (
    <div className="flex flex-col gap-2 mb-3">
      {required.length > 0 && (
        <div className="bg-amber-500/15 border border-amber-500/30 text-amber-200 px-4 py-3 rounded-md">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <p className="text-sm font-medium">Setup required</p>
              {required.map((item) => (
                <p key={item.key} className="text-sm text-amber-200/80">
                  <code className="bg-amber-500/20 px-1 rounded text-amber-100">
                    {item.envVar}
                  </code>{" "}
                  {item.label}{" "}
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-amber-100"
                  >
                    {item.linkText} &rarr;
                  </a>
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {optional.map((item) => (
        <div
          key={item.key}
          className="bg-blue-500/15 border border-blue-500/30 text-blue-200 px-4 py-3 rounded-md flex items-center gap-3"
        >
          <Info className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm flex-1">
            <code className="bg-blue-500/20 px-1 rounded text-blue-100">
              {item.envVar}
            </code>{" "}
            {item.label}{" "}
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-100"
            >
              {item.linkText} &rarr;
            </a>
          </p>
          <button
            onClick={() => dismiss(item.key)}
            className="hover:text-blue-100"
            aria-label={`Dismiss ${item.envVar} notice`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
