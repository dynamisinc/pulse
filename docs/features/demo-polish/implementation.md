# Implementation: Demo polish (participant-first demo)

> The bridge between planning (`feature.md` + the 25 stories) and orchestration
> (`docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`, `docs/ORCHESTRATION_MECHANICS.md`, and the §8 adaptations in
> `docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md`). Written by P2. **Source of truth for wire shapes is §1 here.**
> The plan's §4 is the *intent*; this file makes it exact. Where they differ, this file wins and the
> difference is listed in §0.
>
> Status: **FROZEN 2026-10-07.** The orchestrator ratified DP-1…DP-10, DP-13 and DP-14. **DP-11 and DP-12 are
> open for Tom** (policy, not wire shape; DP-11 is decided at BM's Tier-2 review). Adding captions later
> (DP-12) would be an additive field. After the freeze any change goes through the orchestrator, never a
> builder (plan §4).

## 0. Decisions beyond the plan (for the orchestrator to ratify)

The plan was ambiguous or incomplete in the places below. Each choice is the smallest one that meets the demo
storyline (plan §3). Every story that is affected cites its decision ID.

| ID | Decision | Why |
|----|----------|-----|
| DP-1 | `MediaAsset` gains `CreatedScenarioTime` (DateTimeOffset). | Plan's library payload returns `uploadedAtScenario`; the plan's column list only had a wall-clock column. Scenario time must be stamped from the exercise clock (COR-053), never derived from wall-clock at read. |
| DP-2 | `PostMediaItem` is `IExerciseScoped` and carries its own `ExerciseId`. | Plan listed only `MediaAsset` and `PostReaction` as scoped. An unscoped child table is a "forgot the filter" hazard on an always-Critical axis; the central filter loop covers it for free. |
| DP-3 | `MediaAsset.PosterMediaAssetId` (nullable self-FK) and `MediaAssetView.posterUrl?`. | Library-picked videos must keep their poster (the run sheet stages videos that were never posted). Also lets the library hide poster images. `CreatePostMedia.posterMediaId?` stays as an optional override. |
| DP-4 | `Persona.Location` (nvarchar(100), nullable) is added in the one migration. | Plan's PE edits "location" but the entity has no such column. |
| DP-5 | `GET /api/feed` gains `includeReplies=true` (default false). | The plan makes the feed top-level only; the profile "Posts & replies" tab is unbuildable without a reply source. No new endpoint. The Likes tab is own-profile only and computed client-side from `viewer.liked`. |
| DP-6 | Legacy media placeholders (`{kind, alt}` with no `mediaId`) sent by the pre-demo frontend are **ignored** by `POST /api/posts` when *every* entry lacks `mediaId`. | Backend deploys Fri 10/9, frontend Mon 10/12; a 400 would break image posting in between. Mixed entries are a 400. |
| DP-7 | B1 also lands the **frozen seam skeleton** (interfaces + DTO skeleton, no behaviour) so Wave 1b builds in parallel. | Without it BP/B2/B3/BM cannot compile in isolated worktrees. See §1.4. |
| DP-8 | Reply-parent resolution is a seam (`IReplyParentResolver`, implemented by B2, consumed by BP). | BP and B2 would otherwise both edit `PostIngestService.cs` and `CreatePostRequest`. |
| DP-9 | Takedown category (`inappropriate`/`pii`/`real-world-reference`/`other`) is a query parameter carried in the console's `steering_action` telemetry payload only. No schema column, no Director notification. | Smallest slice of CTL-025 that still logs a category. The existing precedent is that the console is the single emitter of `steering_action` (see `PauseOverlayPublisher.cs`, `StorylineSteeringEndpoints.cs` comments). B6/PE-BE emit no telemetry. |
| DP-10 | Controller reactions are not supported: reaction endpoints require a participant session with a bound persona. | Staff never needed to like/repost in the storyline; engagement for the fiction is the seeded baseline. |
| DP-11 | `COR-002` is satisfied by *minting* (a SAS is only ever minted for in-scope media) not by *per-request access checks* on the blob. A leaked SAS is readable by anyone until expiry (≤ 13 h). | Plan §4 "Why read SAS". Direct-to-Blob URLs cannot be access-checked per request. Flagged for Tom's Tier-2 sign-off on BM; mitigations: GUID blob names, single-blob read-only SAS, HTTPS-only, bucketed short expiry, private container. |
| DP-12 | Video captions are not in the contract (no `captionsUrl`). The WebVTT CORS rule in I1 is future-proofing only. | Plan ships no caption path; flagged as an NFR-001 gap (WCAG 1.2.2) for the stock demo clips. Mitigation: alt/description is required on every video. |
| DP-13 | Wave-2 backend capacity (idle) builds **PE-BE** so the PATCH lands well before the 10/15 backend freeze; PE-FE stays in Wave 3. | Plan puts PE in Wave 3 but requires the backend half before the freeze. |
| DP-15 | `PostReaction` is soft-deleted: `DeletedAt` (nullable), plus a unique index filtered on `DeletedAt IS NULL`. Un-like or un-repost sets `DeletedAt`; re-like inserts a new active row; counts and `viewer` state read active rows only. | XC-010 ("soft delete everywhere; nothing is hard-deleted during a live exercise"). The first draft's unlike had to hard-delete. Found by Copilot on #418 and folded into B1 while it was building. The inactive rows also give the AAR a like/unlike history. |
| DP-14 | Call-site wiring of like/repost (`Feed.tsx` row, `ThreadView.tsx` `ThreadCard`) moves **from F3 to F0**; `Feed.tsx` ownership in Wave 2 is **F4** (F5 ships `FeedSkeleton.tsx` only). | Plan §6 gave F3/F4/F5 overlapping edits to `Feed.tsx`/`ThreadView.tsx`. Resolved by sequencing, see §4.3. |

## 1. Frozen contract

### 1.1 Conventions

- JSON is camelCase with explicit `[JsonPropertyName]` on every DTO member (as `ParticipantPostDto` does today).
  Optional members are **omitted when null** (`[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`),
  never emitted as `null`. Exception: `GET /api/threads` `focused` stays `null` when absent (existing contract).
- The C# snippets in §1.4–§1.5 are **shape contracts**: positional record members that carry no attribute still
  need an explicit `[property: JsonPropertyName("<camelCaseName>")]`, and every optional member also `[property:
  JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`. The camelCase name is the member name
  lower-cased on its first letter unless a comment says otherwise.
- Ids are GUID strings. Instants are round-trip ISO-8601 (`ToString("O")`), as `scenarioTime` is today.
- 4xx bodies are plain JSON strings (`Results.BadRequest("…")`), matching the existing endpoints. 429/503 use `{"error":"<code>"}`. Messages never confirm that a cross-exercise id exists (identical text for unknown and
  cross-exercise).
- **Scope is never read from the client.** No request has an `exerciseId`. The server stamps from
  `IExerciseContext` (COR-001).
- **Participant payloads never contain**: `origin`, `actingHumanId`, `createdWallClock`, `injectId`,
  `uploadedByHumanId`, `blobName`, `contentType`, `bytes`, `originalFileName`, the baseline fields,
  `personaType`, `castable`. Staff-only fields appear only on `Staff*` DTOs (XC-002).
- Soft delete only (XC-010): no hard-delete path is added anywhere in this push. That includes reactions: un-liking or un-reposting sets `PostReaction.DeletedAt` (DP-15).

### 1.2 Entities (`src/Pulse.WebApi/Data/Entities/`, created/edited by B1)

```csharp
public static class MediaKinds { public const string Image = "image"; public const string Video = "video"; }
public static class ReactionKinds { public const string Like = "like"; public const string Repost = "repost"; }

// NEW — MediaAsset.cs
public sealed class MediaAsset : IExerciseScoped
{
    public Guid Id { get; set; }                              // PK
    public Guid ExerciseId { get; set; }                      // required; IX_MediaAssets_ExerciseId
    public required string Kind { get; set; }                 // "image" | "video"; nvarchar(16)
    public required string ContentType { get; set; }          // SNIFFED canonical MIME; nvarchar(64)
    public required string BlobName { get; set; }             // "{ExerciseId:D}/{Id:N}.{ext}"; nvarchar(256); UNIQUE
    public long Bytes { get; set; }                           // > 0
    public int? Width { get; set; }                           // client-hinted, validated 1..16384
    public int? Height { get; set; }
    public double? DurationSec { get; set; }                  // video only; 0 < x <= 3600
    public required string OriginalFileName { get; set; }     // path + markup stripped; nvarchar(255). Staff-only.
    public required string UploadedByHumanId { get; set; }    // = the session's ActingHumanId; nvarchar(256). Staff-only.
    public DateTimeOffset CreatedScenarioTime { get; set; }   // DP-1; exercise clock at upload (COR-053)
    public DateTimeOffset CreatedWallClock { get; set; }      // server UTC; staff/telemetry-only
    public Guid? PosterMediaAssetId { get; set; }             // DP-3; videos only; FK -> MediaAssets (Restrict)
}

// NEW — PostMediaItem.cs
public sealed class PostMediaItem : IExerciseScoped
{
    public Guid Id { get; set; }                              // PK
    public Guid ExerciseId { get; set; }                      // DP-2; = Post.ExerciseId; required
    public Guid PostId { get; set; }                          // FK -> Posts (Restrict)
    public Guid MediaAssetId { get; set; }                    // FK -> MediaAssets (Restrict)
    public Guid? PosterMediaAssetId { get; set; }             // FK -> MediaAssets (Restrict); overrides the asset's poster
    public required string Alt { get; set; }                  // sanitized, 1..1000; nvarchar(1000). NFR-001: required
    public int Order { get; set; }                            // 0-based; column [Order] (reserved word: always quote in raw SQL)
}

// NEW — PostReaction.cs
public sealed class PostReaction : IExerciseScoped
{
    public Guid Id { get; set; }
    public Guid ExerciseId { get; set; }
    public Guid PostId { get; set; }                          // FK -> Posts (Restrict)
    public Guid PersonaId { get; set; }                       // logical ref (like Follow); resolved through the scoped Personas set
    public required string Kind { get; set; }                 // "like" | "repost"; nvarchar(16)
    public DateTimeOffset CreatedScenarioTime { get; set; }   // exercise clock (COR-053)
    public DateTimeOffset? DeletedAt { get; set; }            // DP-15; null = active; set by un-like/un-repost; never hard-deleted (XC-010)
}

// EDIT — Post.cs (additive)
public Guid? ParentPostId { get; set; }                       // self-FK -> Posts (Restrict); IX_Posts_ParentPostId
public int BaselineLikeCount { get; set; }                    // NOT NULL DEFAULT 0
public int BaselineRepostCount { get; set; }                  // NOT NULL DEFAULT 0
public int BaselineReplyCount { get; set; }                   // NOT NULL DEFAULT 0

// EDIT — Persona.cs (additive)
public Guid? AvatarMediaId { get; set; }                      // FK -> MediaAssets (Restrict)
public Guid? BannerMediaId { get; set; }                      // FK -> MediaAssets (Restrict)
public string? Location { get; set; }                         // DP-4; nvarchar(100); const MaxLocationLength = 100
```

### 1.3 EF configuration (`PulseDbContext`, B1)

| Entity | Config |
|---|---|
| `MediaAsset` | DbSet `MediaAssets`; key `Id`; `ExerciseId` required + index; unique `IX_MediaAssets_BlobName`; lengths as above; FK `PosterMediaAssetId -> MediaAssets.Id` `OnDelete(Restrict)`. Central exercise filter via the existing `IExerciseScoped` reflection loop (no per-entity filter code). |
| `PostMediaItem` | DbSet `PostMediaItems`; unique `IX_PostMediaItems_PostId_Order` `(PostId, Order)`; `IX_PostMediaItems_ExerciseId`; FKs `PostId`, `MediaAssetId`, `PosterMediaAssetId` all `Restrict`. No navigation properties (explicit joins; avoids filter/fix-up surprises). |
| `PostReaction` | DbSet `PostReactions`; **filtered** unique `IX_PostReactions_PostId_PersonaId_Kind` `HasFilter("[DeletedAt] IS NULL")` (at most one ACTIVE reaction per persona per kind; inactive history rows accumulate; re-like inserts a new row) (DP-15); `IX_PostReactions_ExerciseId`; FK `PostId` `Restrict`; `PersonaId` has no FK (house style, see `Follow`). |
| `Post` | `BaselineLikeCount/RepostCount/ReplyCount` `IsRequired().HasDefaultValue(0)`; `HasOne<Post>().WithMany().HasForeignKey(ParentPostId).OnDelete(Restrict)`; `IX_Posts_ParentPostId`. |
| `Persona` | `Location` `HasMaxLength(100)`; `AvatarMediaId`/`BannerMediaId` FKs to `MediaAssets` `Restrict`. |

Everything is `Restrict`/`NoAction`: no cascade path exists, so SQL Server's multiple-cascade-path error cannot
occur and a stray delete cannot remove history (XC-010).

### 1.4 Frozen seams (created by **B1**, interface-only, never edited by 1b builders)

Every file starts with `// FROZEN — demo-polish implementation.md §1.4. Change via the orchestrator only.` B1
creates them exactly as below (no bodies, no registrations). They are what lets BM, BP, B2, B3, B6 build in
parallel.

```csharp
// Features/Media/IMediaStore.cs          — implemented by BM (AzureBlobMediaStore, LocalFileMediaStore)
public interface IMediaStore
{
    bool IsConfigured { get; }                                   // false => POST /api/media answers 503
    // Streams `content` to the PRIVATE container; never buffers the whole body. Enforces maxBytes while
    // streaming (throws MediaTooLargeException, deleting the partial blob). Returns bytes written.
    Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken);
    Task DeleteAsync(string blobName, CancellationToken cancellationToken);   // best-effort cleanup
}

// Features/Media/IMediaUrlSigner.cs      — implemented by BM (BlobMediaUrlSigner, LocalMediaUrlSigner)
public interface IMediaUrlSigner
{
    // Absolute URL a browser can GET with no credentials. Read-only, single blob, HTTPS (Development: http).
    // Expiry is BUCKETED: bucketStart = floor(now, 1 h); expiresOn = bucketStart + 13 h, so any URL minted inside
    // one bucket is byte-identical (browser cache works) and has >= 12 h left. THROWS ExerciseScopeViolationException
    // when asset.ExerciseId != IExerciseContext.CurrentExerciseId (never mint outside the scope). No account-key path.
    Task<string> GetReadUrlAsync(MediaAsset asset, CancellationToken cancellationToken);
    Task<IReadOnlyDictionary<Guid, string>> GetReadUrlsAsync(IReadOnlyCollection<MediaAsset> assets, CancellationToken cancellationToken);
}

// Features/Social/Engagement/IPostEngagementReader.cs   — implemented by B3 (PostEngagementReader)
public sealed record PostEngagement(int RealLike, int RealRepost, int RealReply, bool ViewerLiked, bool ViewerReposted);
public interface IPostEngagementReader
{
    // REAL counts only (baseline is added by the projector). RealReply = non-deleted direct replies. Ids outside the
    // current exercise scope are simply absent from the result. ViewerLiked/Reposted are false when viewerPersonaId is null.
    Task<IReadOnlyDictionary<Guid, PostEngagement>> GetAsync(
        IReadOnlyCollection<Guid> postIds, Guid? viewerPersonaId, CancellationToken cancellationToken);
}

// Features/Social/IParticipantPostProjector.cs          — implemented by BP (ParticipantPostProjector)
public sealed record PostProjectionOptions(Guid? ViewerPersonaId = null, bool IncludeViewerState = false);
public interface IParticipantPostProjector
{
    // Same order as `posts`. counts = baseline + real (via IPostEngagementReader); media/posterUrl via IMediaUrlSigner;
    // inReplyTo resolved in scope; viewer only when IncludeViewerState && ViewerPersonaId != null. Soft-deleted posts are
    // the caller's concern (callers filter before projecting, except B2's tombstone path).
    Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
        IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken);
}

// Features/Social/Threads/IReplyParentResolver.cs       — implemented by B2 (ReplyParentResolver), consumed by BP
public enum ReplyParentOutcome { None, Resolved, NotFound }   // None: parentPostId null/empty. NotFound: unparseable, unknown, other-exercise OR soft-deleted (indistinguishable).
public sealed record ReplyParentResult(ReplyParentOutcome Outcome, Post? Parent);
public interface IReplyParentResolver
{
    Task<ReplyParentResult> ResolveAsync(string? parentPostId, CancellationToken cancellationToken);
}
```

`IFeedBroadcaster` (existing, `Features/Realtime/IFeedBroadcaster.cs`) gains, in **B6** (not B1), a default
interface method so existing test doubles keep compiling: `Task BroadcastPostRemovedAsync(Guid exerciseId, Guid
postId, CancellationToken cancellationToken = default) => Task.CompletedTask;`

**DTO skeleton (B1, no behaviour)** — new file `Features/Social/PostWireDtos.cs`, plus additive edits to
`Features/Social/ParticipantPostDto.cs`:

```csharp
public sealed record PostMediaDto(                      // OMIT null members
    [property: JsonPropertyName("id")] string Id,       // = MediaAsset.Id (stable list key)
    [property: JsonPropertyName("kind")] string Kind,   // "image" | "video"
    [property: JsonPropertyName("url")] string Url,     // read SAS
    [property: JsonPropertyName("alt")] string Alt,     // always present (NFR-001)
    string? PosterUrl = null,                           // "posterUrl"
    int? Width = null, int? Height = null,              // "width", "height"
    double? DurationSec = null);                        // "durationSec"
public sealed record PostInReplyToDto(
    [property: JsonPropertyName("postId")] string PostId,
    [property: JsonPropertyName("authorHandle")] string AuthorHandle);   // no leading '@'
public sealed record PostViewerStateDto(
    [property: JsonPropertyName("liked")] bool Liked,
    [property: JsonPropertyName("reposted")] bool Reposted);
public sealed record CreatePostMediaRequest(string? MediaId, string? Alt, string? PosterMediaId);   // "mediaId","alt","posterMediaId"
public sealed record EngagementBaselineRequest(int? Like, int? Repost, int? Reply);                  // "like","repost","reply"

// ParticipantPostDto.cs — becomes `public class` (NOT sealed) with a PROTECTED COPY CONSTRUCTOR; gains optional members:
//   IReadOnlyList<PostMediaDto>? Media       ("media")
//   PostInReplyToDto?            InReplyTo   ("inReplyTo")
//   PostViewerStateDto?          Viewer      ("viewer")
// FromPost(Post) behaviour is UNCHANGED in B1. B2 derives ThreadReplyDto from this class.
```

### 1.5 Wire shapes

#### 1.5.1 Upload and library — owner BM

```csharp
// POST /api/media   multipart/form-data
//   file         required  the bytes (streamed). Filename is NEVER used for typing; stored sanitized as OriginalFileName.
//   kind         optional  "image" | "video" hint. Must equal the SNIFFED kind or 415.
//   width,height optional  int 1..16384
//   durationSec  optional  double > 0 and <= 3600 (video only)
//   posterMediaId optional guid; video only; must be an image asset in this exercise uploaded by the same actor (DP-3)
// 201 MediaAssetView.   Limits: image <= 5 MiB (jpeg/png/gif/webp), video <= 100 MiB (mp4/webm). Types by MAGIC BYTES.
public sealed record MediaAssetView(                    // OMIT null members
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("url")] string Url,
    string? PosterUrl = null, int? Width = null, int? Height = null, double? DurationSec = null);

// GET /api/staff/media?kind=image|video&take=100   (take 1..200)  -> StaffMediaAssetView[] newest first by CreatedScenarioTime.
// Excludes assets that are some video's poster. Staff-only; the participant shape never includes the extra members.
public sealed record StaffMediaAssetView(
    string Id, string Kind, string Url, string FileName, string UploadedAtScenario,     // "fileName", "uploadedAtScenario" (O)
    string? PosterUrl = null, int? Width = null, int? Height = null, double? DurationSec = null);
```

```ts
// src/frontend/src/core/media/types.ts  (F0)
export type MediaKind = 'image' | 'video'
export interface MediaAssetView {
  id: string; kind: MediaKind; url: string; posterUrl?: string
  width?: number; height?: number; durationSec?: number
}
export interface StaffMediaAssetView extends MediaAssetView { fileName: string; uploadedAtScenario: string }
```

#### 1.5.2 Post write — owner BP (`POST /api/posts`, additive)

```csharp
public sealed class CreatePostRequest   // existing members unchanged; Media changes from JsonElement? to typed
{
    public IReadOnlyList<CreatePostMediaRequest>? Media { get; init; }   // <=4 images OR exactly 1 video; never mixed
    public string? ParentPostId { get; init; }                           // reply; resolved by IReplyParentResolver
    public EngagementBaselineRequest? EngagementBaseline { get; init; }  // STAFF controller-as-persona only; ignored for participants
}
```

Rules (400 on violation, identical wording for unknown vs cross-exercise ids): every `mediaId` resolves in
scope; a participant may attach only assets whose `UploadedByHumanId` equals their own `ActingHumanId`; `alt`
required after sanitization (1..1000); no duplicate `mediaId`; baseline values 0..1,000,000 (staff). Response
stays 201 with `ParticipantPostDto` (origin `participant`) or `StaffPostDto` (otherwise); `StaffPostDto` gains
`media` and `inReplyTo`, and `counts` = baseline + 0.

```ts
// src/frontend/src/features/social/types/post.ts  (F0)
export interface CreatePostMedia { mediaId: string; alt: string; posterMediaId?: string }
export interface EngagementBaseline { like?: number; repost?: number; reply?: number }   // STAFF ONLY
export interface CreatePostInput {            // existing fields unchanged except media
  /* exerciseId, timeZone, scenarioTime, authorPersonaId, actingHumanId, text, origin, injectId, linkPreview, counts */
  media?: CreatePostMedia[]
  parentPostId?: string
  engagementBaseline?: EngagementBaseline
}
```

#### 1.5.3 Post read — owner BP (feed, thread, SignalR `PostReceived`)

```ts
export interface PostMedia {
  id: string; kind: 'image' | 'video'; url: string; alt: string       // alt required (NFR-001)
  posterUrl?: string; width?: number; height?: number; durationSec?: number
}
export interface PostInReplyTo { postId: string; authorHandle: string }
export interface PostViewerState { liked: boolean; reposted: boolean }
export interface ParticipantPostView {
  id: string; authorPersonaId: string; text: string; scenarioTime: string
  media?: PostMedia[]
  inReplyTo?: PostInReplyTo
  counts: PostCounts                          // baseline + real
  viewer?: PostViewerState                    // the caller's persona; ABSENT on broadcasts and for staff
  linkPreview?: PostLinkPreview               // unchanged; the server never sends one this push
}
export interface PostLinkPreview { title: string; domain: string; imageLabel?: string; imageUrl?: string }  // imageUrl: client-type only (F2, mock-verified)
```

- `GET /api/feed?scope=all|following&includeReplies=true|false` → `ParticipantPostView[]`: top-level only unless
  `includeReplies` (DP-5), soft-deleted excluded, newest-first by scenario time, **`Take(200)`**, `viewer`
  populated for a persona-bound participant session.
- `GET /api/threads/{postId}` (B2) → `{ ancestors: ParticipantPostView[] /* root→parent */, focused:
  ParticipantPostView | null, replies: ThreadReply[] /* oldest first */ }` with `ThreadReply =
  ParticipantPostView & { replyToPersonaId: string; status: 'visible' | 'taken-down' }`. A soft-deleted reply is
  a tombstone: `status: 'taken-down'`, `text: ''`, no `media`, zero `counts`. A missing, cross-exercise,
  unparseable or soft-deleted *focused* id returns the existing byte-identical
  `{ancestors:[],focused:null,replies:[]}`. Soft-deleted ancestors are omitted. Ancestor walk is capped at depth
  50.
- SignalR `PostReceived` payload = the same `ParticipantPostView` **without `viewer`**, for top-level posts
  *and* replies (replies carry `inReplyTo`). SignalR `PostRemoved` payload = `{ postId: string }`, to the
  exercise-wide group.

#### 1.5.4 Reactions — owner B3

```csharp
// PUT|DELETE /api/posts/{postId:guid}/reactions/{kind}   kind ∈ like|repost (anything else: 400)
// Caller: participant session with a bound persona only (DP-10). Idempotent. 200 ReactionStateDto.
public sealed record ReactionStateDto(
    [property: JsonPropertyName("postId")] string PostId,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("active")] bool Active,
    [property: JsonPropertyName("counts")] ParticipantPostCounts Counts,      // baseline + real, after the change
    [property: JsonPropertyName("viewer")] PostViewerStateDto Viewer);
```

```ts
export interface ReactionState { postId: string; kind: 'like' | 'repost'; active: boolean; counts: PostCounts; viewer: PostViewerState }
```

#### 1.5.5 Takedown — owner B6

`DELETE /api/staff/posts/{postId:guid}?category=inappropriate|pii|real-world-reference|other` (default `other`;
anything else 400). Controller role, assigned to the resolved exercise. Sets `Post.DeletedAt` to the exercise's
scenario time; **204**; repeating is 204 with no second broadcast; unknown or cross-exercise id → 404.
Broadcasts `PostRemoved { postId }` to `exercise:{id}`. No telemetry from the server (DP-9).

#### 1.5.6 Persona read and edit — owners BP (read), PE-BE (edit)

`PersonaResponseDto` **and** `StaffPersonaResponseDto` gain `avatarUrl?`, `bannerUrl?` (read SAS for the
persona's `AvatarMediaId`/`BannerMediaId`) and `location?` (omitted when null). `personaType`/`castable` rules
are unchanged (SOC-052/D1-008 regression tests stay green).

```ts
// personas/types.ts (F0)  Persona gains:
avatarUrl?: string; bannerUrl?: string; location?: string
```

```csharp
// PATCH /api/staff/personas/{personaId:guid}   JSON merge-patch (RFC 7396). Controller role.
//   absent field  = unchanged.   null = clear (allowed ONLY for bio, location, avatarMediaId, bannerMediaId).
//   displayName 1..100 (sanitized, not null)   bio <= 512 (sanitized)   location <= 100 (sanitized)   verified bool (not null)
//   avatarMediaId / bannerMediaId: image MediaAsset in THIS exercise.
//   `handle`, `kind`, `personaType`, `exerciseId`, any unknown field => 400 (handle edits are excluded, plan §9).
// 200 StaffPersonaResponseDto (with avatarUrl/bannerUrl).  400 / 401 / 403 / 404 (unknown or cross-exercise persona).
```

### 1.6 Endpoint table

| Route | Caller | Success | Failure | Story |
|---|---|---|---|---|
| `POST /api/media` | participant (bound persona, not read-only) or staff | 201 `MediaAssetView` | 400, 401, 403, 413 (too large), 415 (type/sniff/kind mismatch), 429 (+`Retry-After`), 503 (store unconfigured) | BM |
| `GET /api/staff/media` | staff assigned to the exercise (any role) | 200 `StaffMediaAssetView[]` | 401, 403 | BM |
| `POST /api/posts` | as today | 201 | 400, 401, 403 | BP (+B2 resolver) |
| `GET /api/feed` | any live session | 200 `ParticipantPostView[]` | 400 (bad scope), 401 | BP |
| `GET /api/threads/{postId}` | any live session | 200 (always; not-found shape) | 401 | B2 |
| `PUT\|DELETE /api/posts/{id}/reactions/{kind}` | participant, bound persona, not read-only | 200 `ReactionState` | 400, 401, 403, 404 | B3 |
| `DELETE /api/staff/posts/{id}` | staff controller assigned | 204 | 401, 403, 404 | B6 |
| `PATCH /api/staff/personas/{id}` | staff controller assigned | 200 | 400, 401, 403, 404 | PE-BE |
| `GET /api/personas` | any live session | adds `avatarUrl?`, `bannerUrl?`, `location?` | — | BP |
| hub `/hubs/exercise` | live session | `PostReceived` v2, `PostRemoved` (group `exercise:{id}`); `ReviewItemChanged` (group `exercise:{id}:staff`, staff only) | — | BP, B6, B5 |
| `GET /dev-media/*` | **Development only** | file with range support | 404 outside Development | BM |

Participant writes (`/api/media`, reactions) are mapped inside `MapGroup(string.Empty).DenyReadOnlySessions()`
(COR-015). Staff routes reuse `EngineCockpitStaffAuthorizationFilter` (read) and
`EngineCockpitControllerRoleFilter` (write). `/api/media` is added to `ExerciseLifecycleGatedRoutes.Paths` (BM);
`/api/posts/**` is already covered by prefix.

### 1.7 Configuration (BM, I1)

| Key (app setting form) | Meaning | Default |
|---|---|---|
| `Azure:BlobStorage:Provider` (`Azure__BlobStorage__Provider`) | `Azure` \| `Local` \| `None`. `Local` is honoured **only** when `ASPNETCORE_ENVIRONMENT=Development`. `None` ⇒ upload answers 503, rest of API unaffected. | I1 sets `Azure` in UAT; code default `None` |
| `Azure:BlobStorage:ServiceUri` | `https://stpulse{env}.blob.core.windows.net` (no key, no SAS) | I1 |
| `Azure:BlobStorage:ContainerName` | private container | `post-media` |
| `Azure:BlobStorage:LocalRootPath` | Development only | `./.local-media` |
| `Media:Upload:ImageMaxBytes` / `VideoMaxBytes` | streamed limits | 5 242 880 / 104 857 600 |
| `Media:Upload:PermitPerMinute` | NFR-009 per-**account** limit: partitioned by the participant `AccountId` / staff user id, never the session id (a new sign-in must not reset it) | 30 |
| `Media:Sas:BucketMinutes` / `Media:Sas:LifetimeHours` | bucket width / minimum remaining life | 60 / 12 |

`Azure__BlobStorage__ConnectionString` and `Azure__BlobStorage__PhotoContainerName` are **removed** by I1
(nothing reads them today; no key may exist).

### 1.8 Telemetry (XC-004) — who emits what

| Action | Emitter | Event |
|---|---|---|
| Post (incl. media) | server (`PostIngestService`, existing) | `post`, `channel: social`; unchanged. When `ParentPostId` is set: `eventType: reply`, `target {post, newId}`, `payload { parentPostId }`. |
| Like / unlike | server (B3) | `reaction`, `payload { reaction: "like", liked: true\|false }` (same shape the frontend already emits), exactly one per **state change**; idempotent repeats emit nothing. |
| Repost / undo | server (B3) | `repost`, `payload { reposted: true\|false }` |
| Upload | none | structured log only (account, kind, bytes) |
| Takedown / persona edit | **console** (C5, PE-FE) via `buildAndEmit` | `steering_action`, `channel: system`, `actor { kind: system, actingHumanId, role }`, `target { entityType: post\|persona, entityId }`, `payload { action: "takedown"\|"persona_edit", category? , fields? }` |
| Run-sheet fire | none extra | the resulting post's own `post`/`reply` event |

In **live** mode the frontend must not also emit the events the server emits (no double count). In **mock** mode
the frontend keeps emitting (`USE_MOCK_DATA`). Scenario time for server-emitted events:
`IExerciseClock.CurrentScenarioTime(exerciseId) ?? exercise.CurrentScenarioTime ?? now` (the `FollowService`
pattern).

### 1.9 Run-sheet file schema (C3 import/export) — `pulse.runsheet.v1`

Definitions only. Status (`pending|fired|skipped|failed`, `firedPostId`) lives in browser storage, never in the
file.

```ts
export interface RunSheetFileV1 {
  schema: 'pulse.runsheet.v1'
  name: string                          // 1..120
  exportedAt?: string                   // informational ISO instant; never rendered in the fiction
  beats: RunSheetBeat[]                 // 0..200
}
export interface RunSheetBeat {
  id: string                            // unique in file, 1..40 chars [A-Za-z0-9_-]
  order: number                         // 1-based sort key, unique
  title: string                         // controller-facing, 1..120
  scenarioMinute: number                // integer >= 0; intended minute offset from StartEx; informational + sort hint ONLY (no scheduler)
  persona: { handle: string }           // no '@'; resolved against GET /api/personas (case-insensitive) at fire time
  text: string                          // <= 280 code points (the default char limit)
  media?: { mediaId: string; alt: string }[]      // library MediaAsset ids (<=4 images OR exactly 1 video)
  replyTo?: { beatId: string } | { postId: string } // another beat's fired post, or an existing post id
  engagementBaseline?: { like?: number; repost?: number; reply?: number }   // 0..1,000,000
  notes?: string                        // <= 500, controller-facing
}
```

Browser storage key `pulse.runsheet.v1:{exerciseId}` (`localStorage`; exercise-scoped, so switching exercise
never shows another exercise's sheet). Import validates with `zod`, rejects the whole file on the first
violation, never partially applies. `import(export(x))` deep-equals `x`.

### 1.10 Seed-pack schema (S1/S2) — `docs/demo/pack/pack.json`, `pulse.demopack.v1`

Media files live next to it under `docs/demo/pack/media/**`. Media references are pack-local `key`s; S1 resolves
them to uploaded `MediaAsset` ids and rewrites them when it exports the run sheet.

```jsonc
{
  "schema": "pulse.demopack.v1",
  "county": "Fairhaven County",                       // informational
  "personas": [{ "handle": "FulcoEM", "displayName": "…", "bio": "…", "location": "…",
                 "verified": true, "avatar": "avatars/fulco.jpg", "banner": "banners/county.jpg" }],   // handle must already exist; avatar/banner optional
  "media": [{ "key": "water-photo", "file": "media/water-photo.jpg", "kind": "image", "width": 1600, "height": 1067,
              "alt": "…" },
            { "key": "news-clip", "file": "media/news-clip.mp4", "kind": "video", "poster": "media/news-clip.poster.jpg",
              "durationSec": 24, "alt": "…" }],
  "posts": [{ "key": "p01", "persona": "Newsline7", "text": "…", "minutesBeforeAnchor": 340,
              "media": [{ "ref": "news-clip", "alt": "…" }],         // alt may override the media-level alt
              "replyTo": "p00",                                       // post key; parent must appear earlier in the array
              "baseline": { "like": 290, "repost": 150, "reply": 64 } }],
  "runSheet": { "name": "…", "beats": [ /* RunSheetBeat shape, with media[].ref (pack key) and replyTo.postKey (a pack post key) instead of ids */ ] }
}
```

Rules S1 enforces before any write: unique keys; all refs resolve; replies after parents; `minutesBeforeAnchor`
≥ 0 and descending order is *not* required (S1 sorts); text ≤ 280; every media item has non-empty `alt`; files
exist and pass the same limits as the server. `scenarioTime = anchor − minutesBeforeAnchor`, where the anchor
defaults to *now* (the frontend's `scenarioNow()` currently tracks wall-clock — `core/clock/exerciseClock.ts`)
and can be overridden with `-ScenarioAnchor`.

### 1.11 Frontend seam contracts (frozen props/signatures)

```ts
// core/media (F0) — world-neutral, no UI
export function validateMediaFile(file: File): { ok: true; kind: MediaKind } | { ok: false; error: string }   // size/MIME only; server sniffs
export function captureVideoPoster(file: File): Promise<{ poster: Blob; width: number; height: number; durationSec: number }>
export function readImageSize(file: File): Promise<{ width: number; height: number }>
export function uploadMedia(file: File, opts?: { posterMediaId?: string; width?: number; height?: number; durationSec?: number;
                            onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<MediaAssetView>
export function useMediaUpload(): { start(file: File): Promise<MediaAssetView>; state: 'idle'|'uploading'|'done'|'error'; progress: number; error?: string; cancel(): void }
export function useMediaLibrary(kind?: MediaKind): UseQueryResult<StaffMediaAssetView[]>        // GET /api/staff/media
// video flow (helper in uploadMedia.ts): poster first, then the video with posterMediaId.
export function uploadVideoWithPoster(file: File, handlers?: { onProgress?(f: number): void; signal?: AbortSignal }): Promise<MediaAssetView>

// personas (F0) — usePersonas/useStaffPersonas are useState/useEffect hooks (NOT React Query), so edits need an explicit refetch signal
export function invalidatePersonas(): void          // personas/personaService.ts; bumps a module-level version both hooks subscribe to

// social (F0) — shared with the controller (staff) world as pure data
export interface ReplyTarget { postId: string; authorHandle: string; authorDisplayName: string; excerpt: string }   // excerpt <= 140 chars
export function publishPost(input: CreatePostInput): Promise<CreatedPostView>        // livePostActions.ts; 201 body; rejects on non-2xx; NEVER swallows

// Slot / prop contracts used by the orchestrator mounts
interface LiveWorldColumnProps { onReplyAs(target: ReplyTarget): void; renderRowActions?(post: LiveWorldPost): ReactNode }        // C2
interface RunSheetPanelProps { /* self-contained; reads personas, library, exercise scope */ }                                   // C3
interface ControllerConsoleProps { liveWorldSlot?(ctx: ConsoleSlotContext): ReactNode; runSheetSlot?(ctx: ConsoleSlotContext): ReactNode }   // C4
interface ConsoleSlotContext { openComposer(opts?: { personaId?: string; replyTo?: ReplyTarget }): void }                        // C4 (type in ControllerConsole.tsx)
interface PersonaComposerProps { /* existing */ replyTo?: ReplyTarget; onClearReply?(): void }                                    // C1
interface PersonaContextPanelProps { /* existing */ actionsSlot?: ReactNode }                                                     // C4
interface PersonaEditButtonProps { persona: StaffPersona }                                                                       // PE-FE (self-contained dialog)
interface MediaLibraryPickerProps { kind?: MediaKind; max: number; selectedIds: string[]; onChange(ids: string[]): void }          // C1 (imported by C3)
interface TakedownActionProps { post: LiveWorldPost }                                                                            // C5
```

Frontend gotcha: `PostCard` and its parts are **participant** components (CSS Modules, no MUI/COBRA). The
controller never imports them; the Live world column renders its own COBRA-dense rows (two-worlds rule).

## 2. Per-story tech notes

Stories are numbered in wave order (`NN-<slug>.md`). IDs are the plan's (§5). "Exports" is what other stories
import.

| # | ID | Approach | Key files | Exports (that others import) |
|---|----|----------|-----------|------------------------------|
| 01 | I1 | Storage module drops `listKeys()`, sets `allowSharedKeyAccess:false`, declares the private `post-media` container and the account-scope `Storage Blob Data Contributor` assignment (copy `ai.bicep`'s `openAiUserAssignment`: deterministic `guid(...)` name, `if (backendPrincipalId != '')`). `webapp.bicep` swaps the key settings for `ServiceUri`/`ContainerName`. | `infrastructure/modules/storage.bicep`, `webapp.bicep`, `parameters/uat.bicepparam`, `infrastructure/README.md` | App settings in §1.7; module params `backendPrincipalId`, `corsAllowedOrigins`, `blobServiceUri` |
| 02 | B1 | Entities + config + ONE migration + frozen seam skeleton (§1.4). No behaviour. | `Data/Entities/*`, `Data/PulseDbContext.cs`, `Data/Migrations/*`, `Features/Media/I*.cs`, `Features/Social/{IParticipantPostProjector,PostWireDtos,ParticipantPostDto}.cs`, `Features/Social/Engagement/IPostEngagementReader.cs`, `Features/Social/Threads/IReplyParentResolver.cs` | Entities, `DbSet`s, every §1.4 interface/record |
| 03 | F0 | Decompose `PostCard` into `post/*`, split `social.module.css` per part, lift reaction wiring into `PostActions`, v2 types, v2 mocks, `core/media`, `publishPost` v2, stubs for every file a Wave-2 story later owns. | see §4 row F0 | `post/types.ts` (`PostView`), `core/media/*`, `ReplyTarget`, `publishPost`, `mockFixtures.ts` |
| 04 | B5 | Hub reads the staff session from the connection's `HttpContext`, joins `exercise:{id}:staff` only for a verified staff session on its own exercise; `EngineReviewBroadcaster` targets the staff group. | `Features/Realtime/ExerciseRealtimeHub.cs`, `Features/EngineRuntime/EngineReviewBroadcaster.cs` | `ExerciseRealtimeHub.StaffGroupNameFor(Guid)` (internal) |
| 05 | BM | `Features/Media/*`: magic-byte sniffer, streaming multipart reader (not `IFormFile`), per-kind limits, `AzureBlobMediaStore` (`DefaultAzureCredential`), `LocalFileMediaStore` (Dev), `BlobMediaUrlSigner` (user-delegation SAS, cached key), rate-limit policy `media-upload`, staff library. Add `Azure.Storage.Blobs` to the csproj. | `Features/Media/*` (+`AddMedia`/`MapMedia` extension pair) | implements `IMediaStore`, `IMediaUrlSigner`; `MediaAssetView` |
| 06 | BP | `PostIngestService` validates `media[]`/baseline, calls `IReplyParentResolver`, writes `PostMediaItem` in the same `SaveChanges`; `ParticipantPostProjector` implements the read side; `PostReadService` feed gets `Take(200)`/top-level; persona DTOs gain avatar/banner/location; broadcast uses the projector. Existing 5-arg `PostIngestService` ctor stays source-compatible (new deps are trailing optionals). | `Features/Social/{PostWriteEndpoints,PostIngestService,PostReadService,FeedEndpoints,ParticipantPostDto,PersonaEndpoints,PersonaReadService}.cs`, new `ParticipantPostProjector.cs` | implements `IParticipantPostProjector`; `PersonaReadService.GetStaffPersonaAsync(Guid)` (used by PE-BE) |
| 07 | B2 | `ReplyParentResolver`; `ThreadEndpoints` becomes a real read using the projector; `ThreadReplyDto : ParticipantPostDto`. | `Features/Social/ThreadEndpoints.cs`, `Features/Social/Threads/*` | implements `IReplyParentResolver`; `AddSocialThreads()` |
| 08 | B3 | `ReactionService` modelled on `FollowService` (idempotent, one telemetry event per state change, unique-index race fold); `PostEngagementReader`. | `Features/Social/Reactions/*`, `Features/Social/Engagement/PostEngagementReader.cs` | implements `IPostEngagementReader`; `AddSocialReactions()`/`MapSocialReactionEndpoints()` |
| 09 | B6 | Soft delete + `PostRemoved`. | `Features/Social/Moderation/*`, `Features/Realtime/{IFeedBroadcaster,SignalRFeedBroadcaster}.cs` | `BroadcastPostRemovedAsync` |
| 10 | F1 | Router lives **inside** `SocialChannel` (`<Routes>` under the `*` catch-all) so `App.tsx` and the location-blindness test are untouched; nav rail, right rail, compose modal, route elements. | `social/SocialChannel.*`, `social/layout/*` | `RightRail` slot props; `useSocialNavigation()` |
| 11 | F2 | `media/{MediaGrid,VideoPlayer,MediaViewer,MediaTabGrid}`; `PostMediaSlot` mounts them; parser keeps v2 fields. | `social/components/media/*`, `post/PostMediaSlot.*`, `post/PostLinkCard.*`, `services/realtimeFeed.ts` | `MediaTabGrid` (used by F5 Profile) |
| 12 | F3 | Persisted like/repost with rollback; compact counts; hide quote/share. | `post/PostActions.*`, `hooks/useReaction.ts`, `hooks/useAmplify.ts`, `services/{amplify,reactionService}.ts` | — (reuses `formatMagnitude`/`spokenMagnitude` from `services/audience.ts`; no new formatter) |
| 13 | F4 | Real `useThread` + `ReplyComposer`; attach tray; instant own post; reply filter in the pill stream. | `ThreadView.*`, `hooks/{useThread,useComposePost}.ts`, `Composer.*`, `ReplyComposer.*`, `ComposerMedia.*`, `post/PostReplyContext.*`, `pages/Feed.*`, `services/{feedStreamSource,ownPostStore}.ts` | `Composer` `onPosted(view)` fires in live mode too |
| 14 | F5 | Font, title/favicon, brand accent wiring, force-light, skeletons, avatar image, profile banner + tabs. | see §4 row F5 | — |
| 15 | F6 | Client-side trending/search/explore. | `social/explore/*`, `pages/HashtagFeed.*` | `TrendingPanel`, `SearchBox` (mounted by the orchestrator) |
| 16 | F7 | Derived notifications (Could). | `social/notifications/*` (+ minimal `NavRail`/`SocialRoutes` edit after F1) | — |
| 17 | C1 | Composer attach (upload + library), reply target, baseline, preview, visible errors. | `controller/components/PersonaComposer.*`, `hooks/useComposeAsPersona.ts`, `services/composeService.ts`, `controller/media/*` | `MediaLibraryPicker` |
| 18 | C2 | Live-world column (COBRA rows) over `resolveFeed` + `realtimeFeed`. | `controller/liveWorld/*` | `LiveWorldColumn`, `LiveWorldPost` |
| 19 | C3 | Run sheet store + UI + import/export; fires via `publishPost`. | `controller/runSheet/*` | `RunSheetPanel` |
| 20 | C4 | Console layout slots + chrome cleanup. | `controller/components/{ControllerConsole,PersonaContextPanel}.tsx`, `steering/PausePill.tsx`, `console/CommandPalette.tsx`, `staffShell/staffHeaderMocks.ts`, `staffShell/components/StaffHeader.tsx` | `ConsoleSlotContext`, `liveWorldSlot`, `runSheetSlot`, `actionsSlot` |
| 21 | PE | BE: merge-patch endpoint. FE: dialog + button. | `Features/Social/PersonaAdmin/*`; `controller/personaEdit/*` | `PersonaEditButton` |
| 22 | C5 | Takedown action + feed removal. | `controller/liveWorld/TakedownAction.tsx`, `controller/services/takedownService.ts`, `social/services/{realtimeFeed,removedPosts}.ts`, `social/pages/Feed.tsx` | — |
| 23 | C6 | Preview shows the real channel; StartEx/EndEx control (Could). | `staffShell/components/PreviewAsParticipant.tsx`, `controller/lifecycle/*` | — |
| 24 | S1 | PowerShell seeder over public APIs + run-sheet export. | `scripts/uat/Seed-DemoContent.ps1` | `docs/demo/pack/runsheet.demo.json` |
| 25 | S2 | Human + Claude pack authoring. | `docs/demo/pack/**` | `pack.json` |

## 3. Reuse map

Every path below was verified to exist at P2 time unless marked **new**.

### Backend (`src/Pulse.WebApi/`)

- Ingest funnel — `Features/Social/PostIngestService.cs` (sanitize, scope stamp, telemetry in the same
  `SaveChanges`, broadcast), `PostSanitizer.cs` (strip, never encode — reuse for alt, bio, display name,
  location, original file name), `PostAttributionResolver.cs` + `PostAttribution.cs` (who is posting; its
  `ActingHumanId` is the value `MediaAsset.UploadedByHumanId` must equal).
- Read path — `PostReadService.cs`, `FeedEndpoints.cs`, `ThreadEndpoints.cs` (the byte-identical not-found shape
  is the isolation guarantee), `ParticipantPostDto.cs` (the sole XC-002 projection), `PersonaEndpoints.cs` +
  `PersonaReadService.cs` (participant/staff DTO split).
- Idempotent persona-scoped write pattern — `Features/Social/Follows/FollowService.cs` + `FollowEndpoints.cs`
  (one event per state change, race fold on the unique index, `DenyReadOnlySessions` group,
  `ICurrentSessionPersonaAccessor`).
- Realtime —
  `Features/Realtime/{ExerciseRealtimeHub,IFeedBroadcaster,SignalRFeedBroadcaster,RealtimeExtensions}.cs`,
  `Features/EngineRuntime/EngineReviewBroadcaster.cs`.
- Staff authorization — `Features/EngineRuntime/EngineCockpitStaffAuthorizationFilter.cs` (live staff session +
  assigned), `EngineCockpitControllerRoleFilter.cs` (controller only),
  `Features/Identity/Staff/ICurrentStaffSessionAccessor.cs`.
- Scenario clock — `Features/EngineRuntime/Clock/IExerciseClock.cs` (`CurrentScenarioTime(exerciseId)`);
  fallback `exercise.CurrentScenarioTime ?? now`.
- Data — `Data/PulseDbContext.cs` (central filter loop + `GuardExerciseScope`), `Data/IExerciseScoped.cs`,
  `Data/ExerciseScopeViolationException.cs`, `Data/Entities/{Post,Persona,Follow,TelemetryEvent}.cs`,
  `Data/Migrations/`.
- Rate limiting — `Program.cs` has one `app.UseRateLimiter()`; every `Add*` registers its own named policy (see
  `Features/Identity/**/*Endpoints.cs`). Partition by the stable account id (participant `AccountId` / staff user id), never the session id (NFR-009 is per account) and not IP (the App Service proxy collapses IPs).
- Lifecycle gate — `Features/ExerciseConfiguration/Lifecycle/ExerciseLifecycleGatingMiddleware.cs`
  (`ExerciseLifecycleGatedRoutes.Paths`).
- Persona names/handles — `Features/Ops/EngineContentSeed/PersonaCastSeeder.cs` (read-only reference; handles
  stay, plan §9).
- Tests —
  `Pulse.WebApi.Tests/Data/{MsSqlContainerFixture,RequiresDockerFactAttribute,QueryFilterModelTests,QueryFilterIsolationTests,WriteGuardTests,IdempotentMigrationScriptTests}.cs`,
  `Features/Social/{SocialApiWebApplicationFactory,FeedThreadIsolationTests,PostWriteEndpointTests,CompositionRootWiringTests}.cs`,
  `Features/Realtime/ExerciseRealtimeHubIsolationTests.cs`,
  `Helpers/{TestSessions,FakeAuthenticatedSessionExtensions}.cs`.

### Infrastructure

- `infrastructure/modules/storage.bicep`, `webapp.bicep` (system-assigned identity, `principalId` output),
  `ai.bicep` (**role-assignment pattern** lines ~221–245), `main.bicep` (orchestrator plumbing),
  `parameters/uat.bicepparam`, `.github/workflows/{ci.yml (az bicep build step), deploy-infrastructure.yml}`.

### Frontend (`src/frontend/src/`)

- Participant social —
  `features/social/components/{PostCard,Composer,ThreadView,Avatar,VerifiedMark,WhoToFollow,NewPostsPill,QuoteComposer}.tsx`,
  `pages/{Feed,Profile,HashtagFeed}.tsx`, `SocialChannel.tsx`, hooks `useComposePost.ts`, `useReaction.ts`,
  `useAmplify.ts`, `useThread.ts`, `useFeed.ts`, `useFeedStream.ts`, services `postService.ts`,
  `feedService.ts`, `postStore.ts`, `livePostActions.ts`, `realtimeFeed.ts`, `feedStreamSource.ts`,
  `amplify.ts`, `audience.ts` (`formatMagnitude`), `sanitize.ts`, `theme/{social.module.css,tokens.ts}`,
  `utils/hashtags.ts`.
- Participant shell — `features/participant-shell/{BrandThemeProvider.tsx,brandTokens.ts
  (useBrand),chromeConfig.ts (useChromeConfig, isWatermarkRequired),mountContract.ts (useShellContext,
  affordancesAvailable, ShellContextProvider),ShellLayout.tsx}`,
  `components/{ChannelNav,ParticipantSignOutControl}.tsx`;
  `features/app-shell/{RoleAwareEntry,RouteFocusScope,participantLocationBlindness.test}.ts*` (**the router must
  not be read there**), `features/personas/{types,personaService,seedCast}.ts`.
- Core — `core/services/api.ts` (shared axios; bearer attach + refresh), `core/config/mockData.ts`
  (`USE_MOCK_DATA`), `core/realtime/connection.ts` (one shared hub connection; token already attached),
  `core/clock` (`scenarioNow`, `useScenarioTime`, `formatScenarioTime`), `core/exerciseContext`, `core/auth`
  (`useSession`, `endSession`), `core/telemetry` (`buildAndEmit`, `schema.ts`), `core/time/wallClock.ts`,
  `core/utils/validateEnv.ts`, `zod` (already a dependency), React Query via `core/services/queryClient.ts`.
- Staff/controller —
  `features/controller/components/{ControllerConsole,PersonaComposer,PersonaContextPanel,PersonaPicker}.tsx`,
  `steering/PausePill.tsx`, `ControllerConsoleRoute.tsx` (**orchestrator-owned slot wiring**),
  `console/CommandPalette.tsx`, `hooks/{useComposeAsPersona,useActivePersona}.ts`, `services/composeService.ts`,
  `identity/controllerIdentity.ts` (`callSign: 'SIMCELL-1'` is the source of truth),
  `features/staffShell/{staffHeaderMocks.ts,StaffShellFrame.tsx,toolRegistry.ts,staffShellTokens.ts,components/{StaffHeader,PreviewAsParticipant,PortalStub}.tsx}`,
  `features/staff/staffRouteRegistry.tsx` (not expected to change), `theme/styledComponents`
  (`CobraPrimaryButton`, `CobraSecondaryButton`, `CobraTextField`, …) — **staff surfaces only**.
- Icons: `@fortawesome/*` only, never `@mui/icons-material`. MUI 9: system props go in `sx`.
- Config files — `.gitattributes` (add `*.mp4 binary`, `*.webm binary`),
  `src/frontend/public/staticwebapp.config.json` (no CSP today; if one is ever added, `img-src`/`media-src` must
  allow the storage origin).

## 4. Wave Plan (DAG-ready)

Rules: builders own **disjoint files within a wave**; a file touched in more than one wave is sequenced (earlier
wave merges first); a row's tests are part of its owned files. Paths are relative to `src/Pulse.WebApi/` (BE),
`src/frontend/src/` (FE), or repo root (infra/scripts/docs). `Stack` tells the orchestrator which builder to
spawn and which Gate-0 command runs (`dotnet build + test` / `type-check + lint + test:run` / `az bicep build`).
Builder branch pattern: `build/demo-polish/<ID>-<slug>` off the wave umbrella (plan §8).

### 4.1 The table

| ID | Stack | Builder | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|----|-------|---------|---------------|-----------|--------------|------|--------|
| P1 | fe | frontend-agent | FE `features/app-shell/exerciseScopeRefreshComposition.test.tsx`, `features/staff/hooks/useSetActiveExercise.contextRefresh.test.tsx` — ✅ **done** (e73e4a0) | — | P2 | 0 | S |
| P2 | docs | story-agent | `docs/features/demo-polish/**` | plan confirmed | P1 | 0 | M |
| I1 | infra | backend-agent | `infrastructure/modules/storage.bicep`, `infrastructure/modules/webapp.bicep`, `infrastructure/parameters/uat.bicepparam`, `infrastructure/README.md` | P2 | B1, F0, B5 | 1 | S |
| B1 | backend | backend-agent | BE `Data/Entities/{MediaAsset,PostMediaItem,PostReaction,Post,Persona}.cs`; `Data/PulseDbContext.cs`; `Data/Migrations/*DemoPolish*` + `PulseDbContextModelSnapshot.cs`; **frozen seams** `Features/Media/{IMediaStore,IMediaUrlSigner}.cs`, `Features/Social/{IParticipantPostProjector,PostWireDtos,ParticipantPostDto}.cs`, `Features/Social/Engagement/IPostEngagementReader.cs`, `Features/Social/Threads/IReplyParentResolver.cs`; tests `Pulse.WebApi.Tests/Data/{QueryFilterModelTests,QueryFilterIsolationTests,WriteGuardTests,IdempotentMigrationScriptTests}.cs` + new `Data/DemoPolish*Tests.cs` | P2 | I1, F0, B5 | 1 | M |
| F0 | frontend | frontend-agent | FE `features/social/components/post/**` (new: `PostCard, PostHeader, PostBody, PostMediaSlot, PostLinkCard, PostActions, PostReplyContext`, per-part `*.module.css`, `types.ts`, `index.ts`); `features/social/components/PostCard.tsx` (becomes a re-export shim) + `PostCard*.test.tsx`; stubs `components/FeedSkeleton.tsx`, `components/media/MediaTabGrid.tsx`, `explore/ExplorePage.tsx`; `pages/Feed.tsx` and `components/ThreadView.tsx` (**wiring relocation only**); `theme/social.module.css` (split out of); `types/post.ts`; `services/{postService,feedService,postStore,livePostActions,mockFixtures}.ts`; `index.ts` barrel; `features/personas/{types,personaService,seedCast}.ts`; `core/media/**` (new); `public/mock-media/**` (new); `.gitattributes` | P2 (P3 soft) | I1, B1, B5 | 1 | L |
| B5 | backend | backend-agent | BE `Features/Realtime/ExerciseRealtimeHub.cs`, `Features/Realtime/RealtimeExtensions.cs` (only if registration changes), `Features/EngineRuntime/EngineReviewBroadcaster.cs`; tests `Features/Realtime/*Hub*Tests.cs`, new `Features/EngineRuntime/EngineReviewBroadcasterScopeTests.cs` | — | I1, B1, F0 | 1 | M |
| BM | backend | backend-agent | BE `Features/Media/**` (all except the two frozen interface files), `Pulse.WebApi.csproj`, `appsettings.json`, `appsettings.Development.json`, `Features/ExerciseConfiguration/Lifecycle/ExerciseLifecycleGatingMiddleware.cs` (+ its route-list test); tests `Pulse.WebApi.Tests/Features/Media/**` | B1 (I1 for UAT only) | BP, B2, B3, B6 | 1b | L |
| BP | backend | backend-agent | BE `Features/Social/{PostWriteEndpoints,PostIngestService,PostReadService,FeedEndpoints,ParticipantPostDto,PersonaEndpoints,PersonaReadService,PostSanitizer}.cs`; new `Features/Social/ParticipantPostProjector.cs`; tests for those files (`PostWriteEndpointTests`, `PostIngestService*Tests`, `FeedReadEndpointTests`, `PersonaEndpointsTests`, `PersonaResponseDtoTests`) + new `Features/Social/PostMedia*Tests.cs` | B1; frozen §1.4 interfaces (no BM/B3/B2 code needed to compile) | BM, B2, B3, B6 | 1b | M |
| B2 | backend | backend-agent | BE `Features/Social/ThreadEndpoints.cs`; `Features/Social/Threads/**` (except the frozen `IReplyParentResolver.cs`); tests `Features/Social/ThreadReadEndpointTests.cs` + new `Features/Social/Threads/**Tests.cs` | B1 | BM, BP, B3, B6 | 1b | M |
| B3 | backend | backend-agent | BE `Features/Social/Reactions/**`; `Features/Social/Engagement/PostEngagementReader.cs`; tests `Features/Social/Reactions/**` | B1 | BM, BP, B2, B6 | 1b | M |
| B6 | backend | backend-agent | BE `Features/Social/Moderation/**`; `Features/Realtime/{IFeedBroadcaster,SignalRFeedBroadcaster}.cs`; tests `Features/Social/Moderation/**`, `Features/Realtime/SignalRFeedBroadcasterTests.cs` | B1; B5 merged (shares `Features/Realtime`) | BM, BP, B2, B3 | 1b | S |
| F1 | frontend | frontend-agent | FE `features/social/SocialChannel.tsx`, `SocialChannel.module.css`, `SocialChannel*.test.tsx`; `features/social/layout/**` (new: `NavRail, RightRail, RightRailContent, PulseLogo, AccountCard, ComposeModal, SocialRoutes, useSocialNavigation` + route elements) | F0 | F2, F3, F4, F5, F6 | 2 | L |
| F2 | frontend | frontend-agent | FE `features/social/components/media/**` (`MediaGrid, VideoPlayer, MediaViewer, MediaTabGrid`, css), `components/post/PostMediaSlot.*`, `components/post/PostLinkCard.*`, `services/realtimeFeed.ts` (+test) | F0 | F1, F3, F4, F5, F6 | 2 | L |
| F3 | frontend | frontend-agent | FE `components/post/PostActions.*`, `hooks/useReaction.ts`, `hooks/useAmplify.ts`, `services/amplify.ts`, `services/reactionService.ts` (new), tests | F0 (B3 for the live check) | F1, F2, F4, F5, F6 | 2 | M |
| F4 | frontend | frontend-agent | FE `components/{ThreadView,Composer}.{tsx,module.css}`, `components/ReplyComposer.*`, `components/ComposerMedia.*` (new), `hooks/{useThread,useComposePost}.ts`, `components/post/PostReplyContext.*`, `pages/Feed.{tsx,module.css}`, `services/{feedStreamSource,ownPostStore}.ts`, tests | F0 (BM/BP/B2 for the live check) | F1, F2, F3, F5, F6 | 2 | L |
| F5 | frontend | frontend-agent | FE `index.html`, `public/favicon.svg` (new), `package.json` + `package-lock.json` (font), `main.tsx`, `index.css`, `features/social/theme/**`, `components/Avatar.*`, `pages/Profile.*`, `components/{FeedSkeleton,ProfileSkeleton}.*`, and — for the force-light sweep only — `components/{FollowerList,WhoToFollow,NewPostsPill,FollowButton}.module.css`. **Merges last in Wave 2.** | F0 | F1, F2, F3, F4, F6 | 2 | M |
| F6 | frontend | frontend-agent | FE `features/social/explore/**`, `pages/HashtagFeed.*`, tests | F0 | F1–F5 | 2 | M |
| PE-BE | backend | backend-agent | BE `Features/Social/PersonaAdmin/**`, tests `Features/Social/PersonaAdmin/**` | B1, BM, BP (merged) | F1–F6 (different stack) | 2 (backend idle slot, DP-13) | M |
| F7 | frontend | frontend-agent | FE `features/social/notifications/**`; minimal edits to F1's `layout/NavRail.tsx` and `layout/SocialRoutes.tsx` (only after F1 merged) | F1 | C-track | 3 (Could) | M |
| C1 | frontend | frontend-agent | FE `features/controller/components/PersonaComposer.{tsx,module.css}`, `hooks/useComposeAsPersona.ts`, `services/composeService.ts`, `controller/media/**` (new) | F0, BM (live), B2 (live) | C2, C3*, C4, PE-FE | 3 | M |
| C2 | frontend | frontend-agent | FE `features/controller/liveWorld/**` (new; not `TakedownAction.tsx`) | F0 | C1, C3, C4, PE-FE | 3 | M |
| C3 | frontend | frontend-agent | FE `features/controller/runSheet/**` (new) | F0; **C1's `MediaLibraryPicker` (merge C1 first, or code against the frozen props in §1.11)** | C1*, C2, C4, PE-FE | 3 | M |
| C4 | frontend | frontend-agent | FE `features/controller/components/{ControllerConsole,PersonaContextPanel}.tsx`, `components/steering/PausePill.tsx`, `console/CommandPalette.tsx`, `features/staffShell/staffHeaderMocks.ts`, `features/staffShell/components/StaffHeader.tsx`, tests | — | C1–C3, PE-FE | 3 | S |
| PE-FE | frontend | frontend-agent | FE `features/controller/personaEdit/**` (new) | F0, PE-BE | C1–C4 | 3 | S–M |
| C5 | frontend | frontend-agent | FE `controller/liveWorld/TakedownAction.tsx` (new), `controller/services/takedownService.ts` (new), `social/services/{realtimeFeed,removedPosts}.ts`, `social/pages/Feed.tsx` | B6, C2, F2, F4 | — | 3 (after) | S |
| C6 | frontend | frontend-agent | FE `features/staffShell/components/{PreviewAsParticipant,PortalStub}.tsx` (+tests), `controller/lifecycle/**` (new) | F1 | — | 3 (Could) | S |
| S1 | script | backend-agent | `scripts/uat/Seed-DemoContent.ps1`, `scripts/uat/Seed-DemoContent.Tests.ps1`, `docs/demo/pack/schema/**` | PE-BE, BM, BP, B2 live in UAT (freeze 10/15) | S2 | seed | M |
| S2 | content | 🧑 + Claude | `docs/demo/pack/**` (everything except `schema/`) | P3, names decision (10/14) | S1 | seed | M |

\* C3 ↔ C1: the only cross-story file edge in Wave 3 (the library picker). Orchestrator merges C1 first and
rebases C3.

### 4.2 Orchestrator-owned integration seams (no builder owns these)

| Seam | File(s) | Rule |
|------|---------|------|
| API composition root | `src/Pulse.WebApi/Program.cs` | Orchestrator adds, after each backend merge, exactly: `AddMedia(config)`/`MapMedia()` + the Development-only `/dev-media` static-file mapping (BM); `AddSocialThreads()` (B2, **before** the first reply is posted); `AddSocialReactions()`/`MapSocialReactionEndpoints()` inside the `DenyReadOnlySessions()` group (B3); `AddSocialModeration()`/`MapSocialModerationEndpoints()` (B6); `AddPersonaAdmin()`/`MapPersonaAdminEndpoints()` (PE-BE). After every merge: **grep `Program.cs` for the new line** and confirm the route answers 401 (not 404) unauthenticated — the #310→#317 lesson. Builders add their own `*CompositionRootWiringTests`-style test files; the orchestrator makes them pass. |
| Bicep composition root | `infrastructure/main.bicep` | **Delegated to I1 for Wave 1** (no other story touches infra). (1) add local `blobServiceUri = 'https://${storageName}.blob.${az.environment().suffixes.storage}'`. It must be `az.environment()`: `main.bicep`'s `environment` parameter shadows the function (BCP265). It is a plain local, **not** a module output — webApp↔storage would otherwise form a cycle, same reason as the `ai` module); (2) pass `blobServiceUri` and `blobStorageContainerName` to `webApp`; (3) delete the `storageConnectionString:` line from the `webApp` call; (4) pass `backendPrincipalId: deployWebApp ? webApp.outputs.principalId! : ''` and `corsAllowedOrigins: empty(frontendUrl) ? [] : [frontendUrl]` to `storage`; (4a) pass `blobStorageProvider: deployStorage ? 'Azure' : 'None'` (fail closed where no storage exists); (5) `az bicep build` + `build-params` locally. 🧑 Tom then runs **Deploy Infrastructure**. `infrastructure/main.json` is a stale committed artifact — do not hand-edit. |
| Participant app root | `App.tsx`, `features/app-shell/**`, `features/participant-shell/**` | **No change expected**: F1's router sits inside `SocialChannel` under the existing `*` catch-all, so the location-blindness test stays valid. Orchestrator-only if needed: hiding the duplicate `ParticipantSignOutControl` row in `participant-shell/ShellLayout.tsx` once F1's account card ships. |
| Right-rail slot mounts | `features/social/layout/RightRailContent.tsx` | F1 creates it with "Who to follow" only. After F1 **and** F6 merge, the orchestrator adds `<SearchBox/>` and `<TrendingPanel/>` (one-file edit). |
| Console slot wiring | `features/controller/ControllerConsoleRoute.tsx` | After C1–C4 merge the orchestrator: passes `liveWorldSlot`/`runSheetSlot`; holds the `replyTo: ReplyTarget \| null` state and passes it to `PersonaComposer` through `dockSlots`; maps `LiveWorldColumn.onReplyAs` → `ctx.openComposer({ replyTo })`; passes `actionsSlot={<PersonaEditButton persona={activePersona}/>}` to `PersonaContextPanel`; after C5, passes `renderRowActions={post => <TakedownAction post={post}/>}`. |
| Staff route registry | `features/staff/staffRouteRegistry.tsx` | Not expected to change (the run sheet and live world live inside the console). |
| Feature barrels | `features/controller/index.ts`, `features/social/index.ts` | `social/index.ts` is F0's; no Wave-2 builder edits it. New controller directories are imported by path from the route file. |

### 4.3 Collision register — files two stories would otherwise touch, and how each is resolved

| File | Stories | Resolution |
|------|---------|------------|
| `Features/Social/PostIngestService.cs`, `CreatePostRequest` | BP, B2 | **Interface seam** `IReplyParentResolver` (B1 freezes, B2 implements, BP consumes). BP is the sole editor. B2's end-to-end reply test is green at Gate 2 after BP merges. |
| `Features/Social/ParticipantPostDto.cs` | B1, BP, B2 | **Sequence** B1 → BP (B1: skeleton, unsealed + protected copy ctor; BP: behaviour). B2 derives `ThreadReplyDto` in its own file. |
| `Features/Realtime/{IFeedBroadcaster,SignalRFeedBroadcaster}.cs` | B5, B6 | B5 does **not** touch them (it owns the hub + review broadcaster). B6 is the only editor, in Wave 1b, after B5. Default interface method keeps ~9 existing test doubles compiling. |
| `Program.cs` | BM, B2, B3, B6, PE-BE | **Orchestrator edit** (table 4.2). |
| `PersonaEndpoints.cs` / `PersonaReadService.cs` | BP, PE-BE | BP edits (Wave 1b); PE-BE adds new files and calls `PersonaReadService.GetStaffPersonaAsync(Guid)` (BP adds it) — Wave 2, after BP merged. |
| `Data/PulseDbContext.cs`, migration | B1 only | One migration (plan §4). Nobody else adds entities or columns. If a later story discovers a need, it goes to the orchestrator (a second migration is a Tier-2 event). |
| Standing isolation tests | B1, B2, B3, BP, BM | **Add new test files; never edit another story's.** B1 may extend the `QueryFilter*`/`WriteGuard` suites (it owns them this push). |
| `social.module.css` (418 lines, all PostCard) | F0, F2, F3, F5 | F0 **splits** it into per-part modules (`post/*.module.css`); thereafter each part's owner edits only its own module; F5 owns what remains (`.tokens`). |
| `Feed.tsx` | F0 (W1), F4 (W2), C5 (W3) | **Sequence by wave.** F5's loading state ships as `FeedSkeleton.tsx` (F0 stub → F5 content), mounted by F0. |
| `ThreadView.tsx` | F0 (W1 relocation), F4 (W2) | Sequence. |
| `Profile.tsx`, `Avatar.tsx` | F5 only | F2 supplies `MediaTabGrid` (F0 stub → F2 content), F5 imports it. |
| `HashtagFeed.tsx` | F6 only | F1 passes callbacks from its route elements. |
| `realtimeFeed.ts` | F2 (W2), C5 (W3) | Sequence. F4 depends only on the *type* of `inReplyTo` (F0); the runtime parser retention is F2's — verified at Gate 2. |
| `feedStreamSource.ts` | F4 only | Reply filtering for the pill. |
| `PostHeader.tsx`, `PostBody.tsx`, `PostCard.tsx`, `post/types.ts` | none after F0 | **Frozen after F0** (plan gave `PostHeader` to F3; no F3 AC needs it). F0 already mounts every slot (`PostMediaSlot`, `PostReplyContext`, `PostActions`). A Wave-2 builder who needs a change asks the orchestrator. |
| `index.html`, `package.json`, `package-lock.json` | F5 only | The only new npm dependency in the push is the self-hosted font. Nobody else runs `npm install <pkg>`. |
| `ControllerConsole.tsx` | C4 only | C2/C3 are mounted through C4's slot props by the orchestrator. |
| `ControllerConsoleRoute.tsx` | orchestrator only | Table 4.2. |
| `PersonaContextPanel.tsx` | C4 only | PE-FE exposes `PersonaEditButton`; mounted through C4's `actionsSlot`. |
| `controller/liveWorld/**` | C2, C5 | C2 first; C5 adds one new file (`TakedownAction.tsx`) through C2's `renderRowActions` prop. |
| `infrastructure/main.bicep` | I1 (modules), orchestrator (plumbing) | Table 4.2. I1 verifies each module with `az bicep build --file <module>`; the full-template build happens on the orchestrator's plumbing commit. |

### 4.4 Gate shape

- Gate 0 (CI): `dotnet build + test` for BE rows, `lint + type-check + test:run` for FE rows, `az bicep build`
  for infra — on the wave umbrella → `main` PR.
- Gate 1 (per story, `code-review`): **always Critical** (plan §4): isolation break (reaction, reply parent,
  media asset or SAS resolving outside the exercise); upload accepted on extension/MIME header alone; SAS
  granting more than read on one blob, or any account-key fallback; COBRA on a participant path. Plus the
  standing ones: unsanitized free text, provenance on a participant payload.
- **Tier-2 (Tom)**: I1, B1, BM, B3, B5. Everything else is Tier 1 (`code-review` + Copilot).
- Done = ACs met + risk-class tests + CI green + **no Critical/High** at Gate 1 (plan §8.2). Mediums/Lows become
  follow-up issues.

## 5. Mock seam notes (F0 → every Wave-2/3 frontend builder)

The mocks are the seam: after F0 merges, **every Wave-2 and Wave-3 frontend builder works on `npm run dev`**
(mock is always on in dev: `USE_MOCK_DATA = import.meta.env.DEV || VITE_USE_MOCK_DATA === 'true'`) with no
backend. Each builder then makes **one live check against UAT** once its backend dependency is deployed (F2:
BM+BP; F3: B3; F4: BM+BP+B2; C1: BM+B2; C5: B6; PE-FE: PE-BE).

**Fixtures (`features/social/services/mockFixtures.ts`, exported ids documented in the file header).** Must
cover:

1. 1-, 2-, 3- and 4-image posts with `width`/`height` (incl. one portrait) — the four `MediaGrid` layouts.
2. A video post with `posterUrl` + `durationSec`, and one video with **no** poster (fallback path).
3. A thread: root → reply → reply-to-reply (ancestry depth 2); the focused post has three direct replies, one
   `taken-down` tombstone and one reply with media. Replies carry `inReplyTo`.
4. Posts where `viewer.liked` and `viewer.reposted` are true.
5. Counts at 0, 9, 999, 1 000, 1 450, 12 300 (compact-count boundaries).
6. Avatars + banners for the cast (`/mock-media/avatars/*`, `/mock-media/banners/*`), one persona with **no**
   avatar (fallback), two with `location`; the verified agency and its unverified lookalike side by side.
7. Several `#WaterIssues` posts across the last scenario hours (trending) and `@mentions` of the mock viewer.
8. Replies present in `postStore` so `resolveFeed()` (top-level) excludes them and `resolveFeed(scope, {
   includeReplies: true })` includes them.
9. Posts authored by the mock viewer persona (own posts; Likes tab; instant-own-post test).

**Assets.** `src/frontend/public/mock-media/` ≤ 3 MB total: 6 photos (SVG/JPEG), avatars/banners (SVG), one
short H.264 MP4 + poster. The MP4 should be one of Tom's **P3** test clips (≤ 2 MB). If P3 has not landed, ship
the video fixture with its poster only and stub `HTMLMediaElement.play/pause` in tests — do not fetch from the
internet. `.gitattributes` gets `*.mp4 binary` and `*.webm binary` (the file already marks png/jpg/gif/webp
binary).

**Mock upload adapter (`core/media/uploadMedia.ts`, selected by `USE_MOCK_DATA`).** `validateMediaFile` runs
first and returns the same user-facing messages the server's 413/415 map to. It then simulates progress (≥ 4
ticks, abortable), registers `{ id: 'mock-media-<uuid>', kind, url: URL.createObjectURL(file), width, height,
durationSec, posterUrl }` in an in-memory `mockMediaRegistry`, and returns the `MediaAssetView`. Object URLs are
**not** revoked on component unmount (the post still renders them); they die with the page. Mock
`createPost`/`publishPost` resolve `CreatePostMedia.mediaId` through the registry to build full `PostMedia`,
append to `postStore` (so the pill / own-post / Live-world mock paths work), bump the parent's reply count for a
reply, and honour `engagementBaseline` for staff. `useMediaLibrary` returns the registry plus four canned items
so the C1/C3 pickers have content.

**Opaque ids.** Mock persona/post ids are strings like `persona-fulcoem` / `post-seed-…`; live ids are GUIDs.
Code must treat every id as an opaque string (no GUID parsing in the frontend).

**Not mocked (live only).** Real SAS expiry, range requests, the 100 MB path, rate limiting and `PostRemoved`
over the hub — covered by the 10/10 UAT media smoke test and the 10/16 walk.

## 6. Migration notes (B1)

1. **One migration.** `dotnet ef migrations add DemoPolishMediaRepliesReactions --project src/Pulse.WebApi`
   (design-time factory `Data/PulseDbContextFactory.cs`). Iterate by deleting and regenerating *before* the PR;
   never ship two. Previous head: `20260802124443_ExerciseCreatedAt`.
2. **Additive only**: 3 new tables, 4 new `Posts` columns + self-FK + index, 3 new `Personas` columns + 2 FKs.
   Defaults cover existing rows (ints `DEFAULT 0`, everything else nullable) — so the expected migration
   contains **no `migrationBuilder.Sql(...)`**.
3. **If any hand-written SQL is added** and it names a column added *in the same migration*, it MUST be wrapped
   in `EXEC(N'…')` (inner single quotes doubled). Why (#413): in the idempotent deploy script one migration is
   **one batch**; SQL Server compiles the whole batch first, so a statement naming a not-yet-existing column
   fails with Msg 207 and *nothing in the batch runs* while the deploy still looks green. The column named
   `Order` is a reserved word — always bracket it in raw SQL.
4. **Prove it before merge**: `IdempotentMigrationScriptTests` (empty DB → apply the generated idempotent script
   batch-by-batch → replay is a no-op, all migrations recorded) **and** a new test that migrates to
   `20260802124443_ExerciseCreatedAt`, inserts legacy `Posts`/`Personas` rows, applies the script, and asserts
   the rows survive with `ParentPostId NULL`, baselines `0`, avatar/banner/location `NULL`. Run `dotnet ef
   migrations has-pending-model-changes` (must be clean) and read the generated `--idempotent` script once.
5. **Deploy (Fri 10/9)**: B1 merges first → backend deploy. Then the orchestrator checks the deploy log for any
   sqlcmd `Msg` line, `GET /api/exercise-context` = 200, and `Reset-DemoState.ps1 -CheckOnly` = `READY`. If it
   fails, **fix forward** with a new migration decision from Tom — never edit an applied migration.
6. Collation: the model sets `SQL_Latin1_General_CP1_CI_AS`; the unique `BlobName` index is therefore
   case-insensitive (blob names are lower-case GUID paths, so no collision risk).

## 7. Per-wave kickoff prompts (paste into a fresh session)

These adapt `PARTICIPANT-FIRST-DEMO-PLAN.md` §8 to the story files. Always-read context for every session:
`CLAUDE.md`, `docs/design/D0-FOUNDATIONS.md`, this file §1 (the frozen contract) and §4 (ownership). Story files
are `docs/features/demo-polish/NN-<slug>.md`.

**Wave 0 (done by Thu 10/8).** P1 (CI flake; frontend-agent) and P2 (this folder). Exit: `main` CI green;
contract frozen; stories committed.

**Wave 1 — foundation (Thu 10/8 → Fri 10/9)**
```
Build demo-polish Wave 1 per docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md §4–§6, docs/features/demo-polish/implementation.md
(§1 contract FROZEN, §4 ownership) and docs/ORCHESTRATION_MECHANICS.md with the plan's §8 adaptations (short-lived umbrella).
Umbrella: feature/demo-w1-foundation off latest origin/main.
Stories (own worktree each, build/demo-polish/<ID>-<slug>, owned files ONLY):
  - 01-blob-storage-keyless (I1)        backend-agent (Bicep)  · Tier-2 · World: infra
  - 02-schema-media-replies-reactions (B1) backend-agent       · Tier-2 · creates the §1.4 frozen seam files
  - 03-client-seam-contract-v2 (F0)     frontend-agent         · World: participant (no COBRA) + world-neutral core/media
  - 04-role-scoped-realtime-groups (B5) backend-agent          · Tier-2
B1 owns the ONE EF migration; EXEC-wrap any hand-written SQL naming a same-migration column; IdempotentMigrationScriptTests
must replay it (lesson #413). Do NOT change the contract. Do NOT edit Program.cs or main.bicep (orchestrator).
Workflow fan-out (build+test in one worktree → Gate-1 code-review, ≤5 builders/≤5 reviewers). Merge clean branches serially;
then the orchestrator does the main.bicep plumbing (implementation.md §4.2), Gate 2, and the PR to main.
After merge: confirm the backend deploy, run the §6 migration checks, remind Tom: 🧑 Deploy Infrastructure (I1) Fri AM, then Reset-DemoState.ps1 (~8 min after deploy).
```

**Wave 1b — server features (Fri 10/9 → Sat 10/10; starts after B1 merges)**
```
Build demo-polish Wave 1b (server) per the same docs. Umbrella: feature/demo-w1b-server off latest origin/main (must include B1, B5).
Stories (backend-agent each, own worktree):
  05-media-pipeline (BM) · Tier-2   06-post-v2-read-write (BP)   07-replies-and-threads (B2)
  08-reactions (B3) · Tier-2        09-controller-takedown (B6)
All five build against the FROZEN §1.4 interfaces; none may edit another's files or the frozen files. BP keeps the existing 5-arg
PostIngestService constructor source-compatible. Always-Critical at Gate 1: isolation (reaction/reply parent/media/SAS outside the
exercise), upload accepted on extension/MIME alone, SAS broader than read-on-one-blob or any account-key fallback.
Orchestrator after merge: Program.cs wiring (implementation.md §4.2) + grep each new line; Gate 2 (B2's reply-flow test must be green now);
PR to main; backend deploy; Reset-DemoState. Sat: UAT media smoke test (upload an MP4, play, seek → 206 Range, read SAS) in Chrome AND Safari.
Cut line 1 (Sat): if BM is not live, Wave 2 keeps building on mocks and BM gets Sunday.
```

**Wave 2 — participant fan-out (Sat 10/10 → Mon 10/12)**
```
Build demo-polish Wave 2 (participant) per the same docs. Umbrella: feature/demo-w2-participant off latest origin/main (must include F0).
Stories (frontend-agent each, own worktree, owned files ONLY): 10-app-frame-navigation (F1) · 11-media-display (F2) · 12-engagement (F3) ·
13-threads-composer (F4) · 14-brand-profile-finish (F5 — merges LAST; does the force-light sweep) · 15-explore (F6, second small run if needed).
Parallel backend slot: 21-persona-profile-edit, BACKEND HALF ONLY (PE-BE, backend-agent, its own tiny umbrella feature/demo-w2b-persona-admin
off latest origin/main, own PR) — must merge before the Thu 10/15 backend freeze; the orchestrator wires Program.cs for it.
World: participant — per-brand skin, NO COBRA, NO default MUI, FontAwesome only, scenario time only, WCAG 2.1 AA, desktop-first.
Design reference: docs/design/D1-social-app/README.md (+ the .dc.html prototype) — match layout/IA.
Build against the v2 mocks (npm run dev); one live check each once its backend is deployed. Frozen post/* files (PostCard, PostHeader, PostBody,
types) are changed by the orchestrator only. The orchestrator mounts the right-rail slots (after F1+F6) and removes the duplicate sign-out row.
Cut line 2 (Mon 10/12): if behind, cut F6 search (keep trending) and F7.
Gate 1 → serial merge (F5 last) → Gate 2 → PR → frontend deploy.
```

**Wave 3 — controller (Mon 10/12 → Thu 10/15)**
```
Build demo-polish Wave 3 (controller) per the same docs. Umbrella: feature/demo-w3-controller off latest origin/main.
Stories (frontend-agent each): 17-post-as-persona-v2 (C1) · 18-live-world-column (C2) · 19-run-sheet (C3; merge after C1 — imports its MediaLibraryPicker) ·
20-console-cleanup (C4) · 21-persona-profile-edit FRONTEND HALF (PE-FE). After C2+F2+F4+B6 are in: 22-takedown-ui (C5). Could: 23-preview-and-startex (C6), 16-notifications-lite (F7).
World: staff — COBRA (@/theme/styledComponents), dense, keyboard-first, desktop-first. The Live world column shows PARTICIPANT CONTENT inside STAFF
CHROME and must never be confusable with a participant view (labelled frame, mono meta, no PostCard). C4 builds the main-area slots; the
orchestrator mounts C2/C3/PE/C5 through ControllerConsoleRoute.tsx (implementation.md §4.2). Backend freeze EOD Thu 10/15 = Cut line 3.
```

**Seeding (Fri 10/16 → Sun 10/18)**
```
24-seed-script (S1, backend-agent, branch off main, PR straight to main) over PUBLIC APIs only; S2 (🧑 + Claude) authors docs/demo/pack/*.
Frontend-only fix PRs go straight to main after the 10/16 UAT walk. Backend is frozen.
```
