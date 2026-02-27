"use client"

import useSWR from "swr"

interface InitData {
  user: {
    email: string
    name?: string
    picture?: string
  } | null
  usage: {
    allowed: boolean
    remaining: number
    resetTime: number
  }
  authConfigured: boolean
  aiConfigured: boolean
  dbConfigured: boolean
  blobConfigured: boolean
}

const fetcher = async (url: string): Promise<InitData> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Init request failed: ${response.status}`)
  }
  return response.json()
}

/**
 * Single SWR call that fetches both auth and usage data in one request.
 * Both useAuth and useUsage consume this same cached response,
 * eliminating 2 separate network requests on page load.
 */
export function useInit() {
  return useSWR<InitData>("/api/init", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    dedupingInterval: 5000,
  })
}
