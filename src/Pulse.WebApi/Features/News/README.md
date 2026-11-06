# News channel — backend (E4)

E4 is mostly frontend. Its backend is one content kind, registered by `AddNewsChannel()`
(`NewsServiceCollectionExtensions.cs`, one line in `Program.cs`). Story 01 (#718) owns everything here.

## The article kind (`ArticleKindDescriptor`)

| Member | Value |
|---|---|
| `Kind` / `ChannelId` | `article` / `news` |
| `BodyPolicy` | `article-rich` (`ArticleBodyProfile`) |
| `AllowedMediaKinds` | `image`, `video` (a `document` is refused by the funnel) |
| Media rules | At most one hero. A `role: "hero"` entry must be the item `heroMediaId` names; the funnel stores the hero from `heroMediaId` only, so a role-only hero is refused. A video hero needs a poster frame (`MediaAsset.PosterMediaAssetId`). |
| `DefaultAlertMapping` | `null` on purpose: it cannot see the item, and only a breaking article suggests an alert |
| `SuggestAlert(item)` | The same advisory with `headline` = the article's headline verbatim, **only** when the stored payload has `breaking`. Otherwise null. The funnel never raises from it (NWS-012, FC-7a). |

### Payload (E4-C1)

Write shape. Anything else is a field-level 400; nothing is stripped or repaired:

```jsonc
{
  "breaking":  { "text": "1..120" } | null,              // optional
  "dateline":  { "place": "1..80", "agency": "1..40"? } | null, // optional; agency optional/nullable
  "slugCode":  "1..48",                                   // optional
  "storyType": "breaking_hard_news" | "follow_up" | "human_interest" | "press_conference_recap" // optional, staff-only
}
```

- Lengths are Unicode code points, measured after trimming. Every string must be plain, single-line text. `<`, `>`,
  control characters, line/paragraph separators, zero-width characters and bidi marks/overrides are refused.
- Payload strings are plain text and must be rendered as **text** (a React text node). A literal `&lt;` is stored as typed
  and must never be fed to an HTML sink.
- The stored form is normalized. `breaking` and `dateline` are always present (null when unset). `slugCode` and
  `storyType` appear only when set.
- The kicker, dek, byline, category, hero and media are `ContentItem` columns. They are never payload keys, and a
  `kicker` key is refused.

### Participant projection (XC-002)

`ProjectPayload` always returns exactly these three keys:

```json
{ "breaking": { "text": "…" } | null, "dateline": { "place": "…", "agency": "…"? } | null, "slugCode": "…" | null }
```

`storyType` and unknown stored keys are never projected. A stored part that does not read cleanly projects as `null`
and is never echoed raw.

## Body markup contract (`article-rich`)

This is what story 06 (`ArticleBody`) can expect in `bodyHtml`, and the only markup story 17's editor should emit:

| Markup | Notes |
|---|---|
| `p`, `br`, `strong`, `em`, `h2`, `h3`, `ul`, `ol`, `li` | No attributes. |
| `blockquote` | Plain, or `class="pull-quote"` exactly. Any other class value is removed. |
| `cite` | No attributes. The pull quote's attribution: `<blockquote class="pull-quote"><p>…</p><cite>Name</cite></blockquote>`. |
| `figure data-media-id="<guid>"` + `figcaption` | References an item in the article's `media[]` by id (a GUID; the server is stricter than the client's `[A-Za-z0-9_-]{1,64}`). There is no `img`: render the media from `media[]`. A non-GUID id is removed. |
| `a href` | `http`, `https`, `mailto` or a host-relative path. `rel="noopener noreferrer nofollow"` is forced. A bad scheme removes the `href`. |
| `<pulse-post data-id="<guid>"></pulse-post>` | Embedded-post placeholder (story 06 renders the read-only `PostCard`). A non-GUID id is removed. Emit an explicit close tag: a self-closed `<pulse-post/>` is an open tag, so the content that follows nests inside it. |

Everything else is stripped. That includes `script`, `style` and `iframe` (with their contents), `img`, `h1`, `h4`,
tables, `div` and `span`, every `on*` handler and every `style` attribute.

## Foundation additions made by story 01 (additive, defaults unchanged)

- `PayloadValidationContext.Media` and `.HeroMediaId`. These carry the write's resolved media to the descriptor,
  which needs them for the hero rules.
- `IContentKindDescriptor.SuggestAlert(ContentItem)`. A default member that returns `DefaultAlertMapping`. The F17
  publish dialog should call this, not read the property (the article returns null from the property).
- `SanitizerProfile.AttributeValuePatterns`. Optional value rules that can only narrow what a profile allows.
  They are enforced in `ContentSanitizer`.
