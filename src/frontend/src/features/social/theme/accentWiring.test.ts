/**
 * features/social/theme/accentWiring.test.ts
 * ---------------------------------------------------------------------------
 * Story 14 (F5), "Brand accent wired": the static half of the proof. The runtime
 * half (`SocialBrandScope.test.tsx`) shows `--pulse-ac` is SET from the brand;
 * this shows the things the AC names — the Follow button, hashtags, the active tab
 * underline and focus rings — actually READ it, and that the production tree
 * mounts the scope. Together they close the original defect ("the social CSS reads
 * `--pulse-ac` which nothing sets").
 *
 * jsdom applies no stylesheets, so the CSS is read from disk (Vitest blanks
 * `*.css` imports, `?raw` included; see `src/test/readSource.ts`).
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import appSource from '../../../App.tsx?raw'
import registrationSource from '../registerSocialChannel.tsx?raw'
import postBodySource from '../components/post/PostBody.tsx?raw'

function css(pathFromSocial: string): string {
  // Comments stripped: only live declarations count as "reading" the variable.
  const text = readSrcFile(`features/social/${pathFromSocial}`)
  expect(text.trim().length, `${pathFromSocial} is empty`).toBeGreaterThan(0)
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('the accent consumers all read the variable the scope sets', () => {
  it('the card token root derives --pc-accent from --pulse-ac', () => {
    expect(css('theme/social.module.css')).toMatch(/--pc-accent:\s*var\(--pulse-ac\b/)
  })

  it('hashtags paint --pc-accent (so they follow --pulse-ac)', () => {
    expect(postBodySource).toMatch(/color:\s*'var\(--pc-accent\)'/)
  })

  it('the Follow button fill/outline reads --pulse-ac', () => {
    expect(css('components/FollowButton.module.css')).toMatch(/--fb-accent:\s*var\(--pulse-ac\b/)
  })

  it('the profile active-tab underline and focus rings read the accent (and never a bare var)', () => {
    const profile = css('pages/Profile.module.css')
    expect(profile).toMatch(/--pf-accent:\s*var\(--pulse-ac\b/)
    expect(profile).toMatch(/\.tabActive::after\s*\{[^}]*background:\s*var\(--pf-accent\)/)
    expect(profile).toMatch(/\.tab:focus-visible\s*\{[^}]*outline:[^;]*var\(--pf-accent\)/)
    // The Followers stat's focus ring used a bare `var(--pulse-ac)` with no fallback, which
    // computes to NO outline when nothing sets the variable. It now goes through --pf-accent.
    expect(profile).not.toMatch(/var\(--pulse-ac\)/)
  })

  it('the "new posts" pill fill reads --pulse-ac', () => {
    expect(css('components/NewPostsPill.module.css')).toMatch(/--np-accent:\s*var\(--pulse-ac\b/)
  })
})

describe('the production tree mounts the scope', () => {
  it('Social registers with SocialBrandScope as its theme scope, under BrandThemeProvider', () => {
    // Pins the wiring that makes `--pulse-ac` exist at all. If the scope moves (e.g. into
    // SocialChannel itself), update this test, do not delete it. Since channels-foundation
    // 12 the channel router mounts the registered element inside its `themeScope`.
    expect(registrationSource).toMatch(/element:\s*<SocialChannel\s*\/>/)
    expect(registrationSource).toMatch(/themeScope:\s*SocialBrandScope\b/)
    expect(appSource).toMatch(/import '\.\/features\/social\/registerSocialChannel'/)
    expect(appSource).toMatch(/<BrandThemeProvider>[\s\S]*<ShellLayout>[\s\S]*<ChannelRouter\s*\/>/)
  })
})
