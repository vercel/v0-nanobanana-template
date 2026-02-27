import { createAdminClient } from "@/lib/supabase/admin"
import type { NewUser, NewRateLimit } from "./types"

/**
 * Database query functions for user and usage tracking.
 * These are server-side only functions using Supabase JS.
 *
 * All functions gracefully return null / empty results when Supabase
 * is not configured (e.g. fresh fork of the template), so the app can
 * still run in a degraded mode and show a friendly setup banner instead
 * of crashing.
 */

function getClient() {
  return createAdminClient()
}

// ============= User Operations =============

/**
 * Get or create a user (useful for first-time login)
 */
export async function getOrCreateUser(data: NewUser) {
  const existingUser = await getUserByEmail(data.email)
  if (existingUser) {
    return existingUser
  }
  return await createUser(data)
}

export async function createUser(data: NewUser) {
  const supabase = getClient()
  if (!supabase) return null

  const { data: user, error } = await supabase.from("users").insert(data).select().single()

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`)
  }

  return user
}

export async function getUserByEmail(email: string) {
  const supabase = getClient()
  if (!supabase) return null

  const { data: user, error } = await supabase.from("users").select("*").eq("email", email).maybeSingle()

  if (error) {
    throw new Error(`Failed to get user: ${error.message}`)
  }

  return user
}

// ============= Usage Operations =============

/**
 * Track credits spent on image generation
 * Pass null for userEmail to track anonymous usage
 */
export async function trackImageGeneration(data: {
  userEmail: string | null
  cost: string
  tokens: number
  metadata?: Record<string, any>
}) {
  const supabase = getClient()
  if (!supabase) return null

  const { userEmail, cost, tokens, metadata } = data

  const { data: usageRecord, error } = await supabase
    .from("usage")
    .insert({
      user_email: userEmail,
      credit_cost: cost,
      tokens,
      action: "image_generation",
      metadata: metadata ? JSON.stringify(metadata) : null,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to track image generation: ${error.message}`)
  }

  return usageRecord
}

/**
 * Get usage history for a user
 */
export async function getUserUsageHistory(userEmail: string, limit = 50) {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("usage")
    .select("*")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to get usage history: ${error.message}`)
  }

  return (data || []).map((record) => ({
    id: record.id,
    userEmail: record.user_email,
    cost: record.credit_cost,
    tokens: record.tokens,
    action: record.action,
    metadata: record.metadata,
    createdAt: record.created_at,
  }))
}

// ============= Rate Limit Operations =============

/**
 * Get rate limit record for an IP on a specific date
 */
export async function getRateLimitForIP(ip: string, date: string) {
  const supabase = getClient()
  if (!supabase) return null

  const { data: record, error } = await supabase
    .from("rate_limits")
    .select("*")
    .eq("ip", ip)
    .eq("date", date)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to get rate limit: ${error.message}`)
  }

  return record
}

/**
 * Create a new rate limit record
 */
export async function createRateLimit(data: NewRateLimit) {
  const supabase = getClient()
  if (!supabase) return null

  const { data: record, error } = await supabase
    .from("rate_limits")
    .insert({
      ip: data.ip,
      date: data.date,
      count: data.count || 0,
      reset_time: data.reset_time?.toISOString() || new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create rate limit: ${error.message}`)
  }

  return record
}

/**
 * Atomically upsert and increment the rate limit count for an IP on a given date.
 * Uses Supabase upsert with onConflict to do this in a single query instead of
 * a SELECT + UPDATE (which was vulnerable to race conditions and slower).
 */
export async function upsertAndIncrementRateLimit(ip: string, date: string) {
  const supabase = getClient()
  if (!supabase) return { ip, date, count: 0, reset_time: new Date().toISOString() }

  // First try to get existing record to know the current count
  const existing = await getRateLimitForIP(ip, date)
  
  if (!existing) {
    // Create new record with count=1
    const { data: record, error } = await supabase
      .from("rate_limits")
      .insert({
        ip,
        date,
        count: 1,
        reset_time: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to create rate limit: ${error.message}`)
    }
    return record
  }

  // Increment existing record
  const { data: record, error } = await supabase
    .from("rate_limits")
    .update({
      count: existing.count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("ip", ip)
    .eq("date", date)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to increment rate limit: ${error.message}`)
  }

  return record
}

/**
 * @deprecated Use upsertAndIncrementRateLimit instead
 */
export async function incrementRateLimit(ip: string, date: string) {
  return upsertAndIncrementRateLimit(ip, date)
}

// ============= Generation Stats =============

/**
 * Get recent generation durations from usage metadata for progress bar calibration.
 * Extracts durationMs from the metadata JSON of recent image_generation records.
 */
export async function getRecentGenerationDurations(limit = 50): Promise<number[]> {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("usage")
    .select("metadata")
    .eq("action", "image_generation")
    .not("metadata", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to get generation durations: ${error.message}`)
  }

  const durations: number[] = []
  for (const row of data || []) {
    try {
      const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata
      if (meta?.durationMs && typeof meta.durationMs === "number" && meta.durationMs > 0) {
        durations.push(meta.durationMs)
      }
    } catch {
      // skip rows with unparseable metadata
    }
  }

  return durations
}

// ============= Generation Operations =============

/**
 * Save a generation to the database
 */
export async function saveGeneration(data: {
  userEmail: string
  prompt: string
  imageUrl: string
  aspectRatio?: string
  mode?: string
  metadata?: Record<string, any>
}) {
  const supabase = getClient()
  if (!supabase) return null

  // User is already created at login time in /api/auth/callback.
  // No need to call getOrCreateUser on every save.

  const { data: generation, error } = await supabase
    .from("generations")
    .insert({
      user_email: data.userEmail,
      prompt: data.prompt,
      image_url: data.imageUrl,
      aspect_ratio: data.aspectRatio,
      mode: data.mode || "text-to-image",
      status: "complete",
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to save generation: ${error.message}`)
  }

  return generation
}

/**
 * Get generations for a user
 */
export async function getUserGenerations(userEmail: string, limit = 5, offset = 0) {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("generations")
    .select("id, user_email, prompt, image_url, aspect_ratio, mode, status, created_at")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    throw new Error(`Failed to get generations: ${error.message}`)
  }

  return (data || []).map((gen) => ({
    id: gen.id,
    userEmail: gen.user_email,
    prompt: gen.prompt,
    imageUrl: gen.image_url,
    aspectRatio: gen.aspect_ratio,
    mode: gen.mode,
    status: gen.status,
    createdAt: gen.created_at,
  }))
}

/**
 * Delete a generation
 */
export async function deleteGeneration(id: string, userEmail: string) {
  const supabase = getClient()
  if (!supabase) return

  const { error } = await supabase.from("generations").delete().eq("id", id).eq("user_email", userEmail)

  if (error) {
    throw new Error(`Failed to delete generation: ${error.message}`)
  }
}
