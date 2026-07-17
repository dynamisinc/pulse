/**
 * features/personas/personaTemplates.ts
 * ---------------------------------------------------------------------------
 * The org-library persona templates (feature: persona-management, story 01;
 * COR-020). Reusable across exercises — NOT exercise-scoped (that is the
 * instance, produced by `seedCast`). This is the minimal seed cast that gives a
 * Pulse feed believable authors, built around the Fairhaven water-contamination
 * arc (continuous with the D1 design package).
 *
 * SOC-052 (impersonation training) is baked in: `Fairhaven Water Utility`
 * (@FairhavenWater, VERIFIED) is shadowed by `Fairhaven Water Update`
 * (@FairhavenWaterUpd, UNVERIFIED) — a near-identical org lockup (same initials,
 * adjacent color, similar name) that the platform never flags. The ONLY
 * participant-visible trust difference is the verified mark's absence.
 *
 * `id` is `tmpl-<handle-lowercased>`; `handle` is stored WITHOUT a leading '@'.
 * Staff world (authoring data) — no UI, no COBRA here; this is the model.
 */

import type { PersonaTemplate } from './types'

/** Build a template id from a handle, matching the instance-id convention. */
function templateId(handle: string): string {
  return `tmpl-${handle.toLowerCase()}`
}

/**
 * The Fairhaven baseline org library. Deliberately small but varied: official
 * voices (utility, county EM), a broadcast outlet, a sensational outlet, a
 * lookalike impersonator, and a handful of citizens.
 */
export const PERSONA_TEMPLATES: readonly PersonaTemplate[] = [
  {
    id: templateId('FairhavenWater'),
    displayName: 'Fairhaven Water Utility',
    handle: 'FairhavenWater',
    kind: 'org',
    personaType: 'agency',
    verified: true,
    avatarColor: '#19647e',
    initials: 'FW',
    bio: 'Official account of the Fairhaven municipal water utility. Service updates & advisories.',
    audienceBand: 'mid',
    voiceNotes:
      'Measured, factual, procedural. Leads with what is confirmed vs pending. Never speculates; ' +
      'defers to the county on the boil-water advisory. Uses #WaterIssues sparingly, never alarmist.',
  },
  {
    // SOC-052 impersonator: an unverified lookalike of the verified utility.
    id: templateId('FairhavenWaterUpd'),
    displayName: 'Fairhaven Water Update',
    handle: 'FairhavenWaterUpd',
    kind: 'org',
    personaType: 'bad-actor',
    verified: false,
    avatarColor: '#2f6f7e',
    initials: 'FW',
    bio: 'Real-time Fairhaven water updates. Stay informed.',
    audienceBand: 'nano',
    voiceNotes:
      'Impersonates the real utility (SOC-052). Urgent, authoritative-sounding, subtly wrong — ' +
      'overstates contamination to drive shares. Near-identical lockup to @FairhavenWater; ' +
      'the missing verified mark is the only signal. Platform must never flag it.',
    backstory: 'Created days before the exercise window to shadow the official utility account.',
  },
  {
    id: templateId('FulcoEM'),
    displayName: 'Fulton County EM',
    handle: 'FulcoEM',
    kind: 'org',
    personaType: 'agency',
    verified: true,
    avatarColor: '#1e3a5f',
    initials: 'FC',
    bio: 'Official emergency management for Fulton County. Preparedness · Response · Recovery.',
    audienceBand: 'mid',
    voiceNotes:
      'Authoritative but calm. Issues advisories in plain language with zones and actions. ' +
      'Points to fulco.gov for guidance. Coordinates with, and gently corrects, other voices.',
  },
  {
    id: templateId('Newsline7'),
    displayName: 'Newsline 7',
    handle: 'Newsline7',
    kind: 'org',
    personaType: 'news-outlet',
    verified: true,
    avatarColor: '#b23b3b',
    initials: 'N7',
    bio: 'Fairhaven’s breaking-news source. Newsline 7 — on your side.',
    audienceBand: 'large',
    voiceNotes:
      'Broadcast-news cadence: headline first, attribution second. Chases the advisory story, ' +
      'sometimes ahead of confirmation. Quotes officials; runs live-at-scene framing.',
  },
  {
    id: templateId('TheScoopHQ'),
    displayName: 'The Scoop',
    handle: 'TheScoopHQ',
    kind: 'org',
    personaType: 'influencer',
    verified: false,
    avatarColor: '#7a3d8a',
    initials: 'TS',
    bio: 'The stories they don’t want you to see. 👀 #Fairhaven',
    audienceBand: 'mid',
    voiceNotes:
      'Sensational, engagement-baiting, low credibility by design. Amplifies rumor over fact, ' +
      'leans on the impersonator’s claims. A deliberate contrast to the verified voices.',
  },
  {
    id: templateId('mvega_fh'),
    displayName: 'Marisol Vega',
    handle: 'mvega_fh',
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#8a4f7d',
    initials: 'MV',
    bio: 'Fairhaven east side. Mom, nurse, neighbor.',
    audienceBand: 'micro',
    voiceNotes:
      'Concerned resident, asks practical questions (is the water safe for my kids?). Shares ' +
      'official posts, occasionally rattled by the rumor mill.',
  },
  {
    id: templateId('tbrandt41'),
    displayName: 'Tom Brandt',
    handle: 'tbrandt41',
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#3d6b4f',
    initials: 'TB',
    bio: 'Small business owner. Coffee, dogs, local sports.',
    audienceBand: 'nano',
    voiceNotes:
      'Skeptical, a little cynical. Complains about mixed messaging; sometimes reposts the ' +
      'sensational take before thinking twice.',
  },
  {
    id: templateId('kwardFH'),
    displayName: 'Keisha Ward',
    handle: 'kwardFH',
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#8a4f2d',
    initials: 'KW',
    bio: 'Community organizer. Fairhaven strong. 💧',
    audienceBand: 'micro',
    voiceNotes:
      'Level-headed, community-minded. Calls out the impersonator in-thread; steers neighbors ' +
      'to the verified utility and county accounts.',
  },
  {
    id: templateId('dreyes_fh'),
    displayName: 'Dana Reyes',
    handle: 'dreyes_fh',
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#7c5cd6',
    initials: 'DR',
    bio: 'Fairhaven resident. Just trying to keep up.',
    audienceBand: 'nano',
    voiceNotes:
      'The default logged-in citizen (matches the mock session). Reads more than posts; ' +
      'occasional questions and reposts.',
  },
]

/** Look up a template by id (org-library lookup; undefined if absent). */
export function personaTemplateById(id: string): PersonaTemplate | undefined {
  return PERSONA_TEMPLATES.find(t => t.id === id)
}
