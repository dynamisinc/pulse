/**
 * features/social/index.channelsExports.test.ts
 * ---------------------------------------------------------------------------
 * Channels-foundation 21, "Barrel exports": `@/features/social` additionally exports what
 * the portal and news consume, and each export is the SAME binding as its deep-path
 * original (so no consumer can end up with a second copy of a hook or a scope). The route
 * helpers build the existing in-channel paths, host-relative. The barrel stays free of
 * staff / COBRA / MUI imports (read through Vite's `?raw`, as `twoWorldsLayout.test.ts`
 * does).
 */
import { describe, expect, it } from 'vitest'
import * as barrel from '@/features/social'
import barrelSource from './index.ts?raw'
import { useTrending } from './explore/useTrending'
import { SocialBrandScope } from './theme/SocialBrandScope'
import { socialPaths, socialPostPath, socialProfilePath } from './layout/socialNavigation'
import { useRecentPublicPosts } from './hooks/useRecentPublicPosts'
import { usePostById } from './hooks/usePostById'
import { useComposeWithLink } from './hooks/useComposeWithLink'
import { PostCard } from './components/post/PostCard'

describe('social barrel: channels-foundation 21 exports', () => {
  it('exports each addition as the same binding as its deep-path original', () => {
    expect(barrel.useTrending).toBe(useTrending)
    expect(barrel.SocialBrandScope).toBe(SocialBrandScope)
    expect(barrel.socialPaths).toBe(socialPaths)
    expect(barrel.socialPostPath).toBe(socialPostPath)
    expect(barrel.socialProfilePath).toBe(socialProfilePath)
    expect(barrel.useRecentPublicPosts).toBe(useRecentPublicPosts)
    expect(barrel.usePostById).toBe(usePostById)
    expect(barrel.useComposeWithLink).toBe(useComposeWithLink)
    // The read-only card is the existing card (a prop), not a fork.
    expect(barrel.PostCard).toBe(PostCard)
  })

  it('the route helpers build the existing in-channel paths, host-relative', () => {
    expect(socialPostPath('p-1')).toBe(socialPaths.thread('p-1'))
    expect(socialPostPath('p-1')).toBe('/i/status/p-1')
    expect(socialPostPath('p 1', 'FulcoEM')).toBe('/FulcoEM/status/p%201')
    expect(socialProfilePath('FulcoEM')).toBe(socialPaths.profile('FulcoEM'))
    expect(socialProfilePath('a/b')).toBe('/a%2Fb')
    for (const path of [socialPostPath('x'), socialProfilePath('y')]) {
      expect(path.startsWith('/')).toBe(true)
      expect(path.startsWith('//')).toBe(false)
      expect(path).not.toContain('://')
    }
  })

  it('keeps the barrel free of staff / COBRA / MUI imports', () => {
    const specifiers = [...barrelSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1] ?? '')
    // Non-vacuous: the scan really read the barrel.
    expect(specifiers).toContain('./explore/useTrending')
    for (const specifier of specifiers) {
      expect(specifier).not.toMatch(/^@mui\/|^@\/theme(\/|$)|cobra|styledComponents|staff/i)
    }
  })
})
