import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { fundWithFriendbot } from '@/lib/stellar'

/**
 * POST /api/stellar/fund
 *
 * Testnet-only endpoint that calls Friendbot to fund the user's Stellar
 * account with test XLM. Useful for re-funding during development without
 * going through the Stellar Lab UI.
 *
 * Body: { publicKey: string }
 *
 * Security:
 *  - Requires an authenticated session (returns 401 otherwise)
 *  - Only enabled when STELLAR_NETWORK !== 'mainnet'
 *  - Rate-limited in production by your hosting layer (e.g. Vercel Edge Config)
 */
export async function POST(request: Request) {
  // Auth guard
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Mainnet guard
  if (process.env.STELLAR_NETWORK === 'mainnet') {
    return NextResponse.json(
      { error: 'Friendbot is not available on mainnet' },
      { status: 403 },
    )
  }

  let publicKey: string
  try {
    const body = await request.json()
    publicKey = body?.publicKey
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    return NextResponse.json({ error: 'Invalid Stellar public key' }, { status: 400 })
  }

  try {
    await fundWithFriendbot(publicKey)
    return NextResponse.json({ funded: true, publicKey })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Friendbot request failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
