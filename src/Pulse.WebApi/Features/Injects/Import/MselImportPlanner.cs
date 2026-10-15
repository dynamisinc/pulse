namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Turns a read <see cref="MselTable"/> into one planned outcome per data row (demo-feedback story 03): the header check,
/// the social filter (DF-9), the planned minute (DF-11), and the mapping of every social row onto a single-post run-sheet
/// item — including the Pulse extension columns for alt text and the engagement baseline (story 14, DF-17). A pure
/// function over facts the service read IN SCOPE — no I/O, no DI — so every rule is unit-testable.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (XC-001).</b> The persona, media and assignee lists hold only rows of the resolved exercise, so a handle
/// that exists only in another exercise fails with exactly the message an unknown handle gets.
/// </para>
/// <para>
/// <b>Content security (NFR-004).</b> Every text cell the import keeps goes through <see cref="PostSanitizer"/> (strip,
/// never encode) and is length-bounded here, before <see cref="InjectItemValidator"/> sees it; the readers already
/// bounded each raw cell.
/// </para>
/// <para>
/// <b>What is decided later.</b> Whether a candidate creates, updates or leaves an item unchanged needs the run sheet
/// as it is at the save, so that is <see cref="InjectQueueService"/>'s import path; this planner only says which rows are
/// candidates and what they ask for.
/// </para>
/// </remarks>
public static class MselImportPlanner
{
    /// <summary>The most characters an <c>Inject #</c> may have (the <c>InjectItem.ExternalRef</c> column).</summary>
    public const int MaxInjectNumberLength = InjectItem.MaxExternalRefLength;

    /// <summary>The MSEL headers, as Cadence writes them.</summary>
    public const string InjectNumberHeader = "Inject #";

    /// <summary>The title header.</summary>
    public const string TitleHeader = "Title";

    /// <summary>The post-text header.</summary>
    public const string DescriptionHeader = "Description";

    /// <summary>The scheduled (wall) time header.</summary>
    public const string ScheduledTimeHeader = "Scheduled Time";

    /// <summary>The scenario day header.</summary>
    public const string ScenarioDayHeader = "Scenario Day";

    /// <summary>The scenario time header.</summary>
    public const string ScenarioTimeHeader = "Scenario Time";

    /// <summary>The persona header.</summary>
    public const string SourceHeader = "From / Source";

    /// <summary>The filter header.</summary>
    public const string DeliveryMethodHeader = "Delivery Method";

    /// <summary>The notes header.</summary>
    public const string NotesHeader = "Notes";

    /// <summary>The assignee header.</summary>
    public const string ResponsibleControllerHeader = "Responsible Controller";

    /// <summary>The Pulse extension column: comma-separated media-library file names.</summary>
    public const string PulseMediaHeader = "Pulse Media";

    /// <summary>
    /// The Pulse extension column (story 14, DF-17): the alt text for each <see cref="PulseMediaHeader"/> file, separated
    /// by <see cref="AltSeparator"/>, in the same order.
    /// </summary>
    public const string PulseMediaAltHeader = "Pulse Media Alt";

    /// <summary>The Pulse extension column (story 14, DF-17): the post's engagement baseline <c>like</c>.</summary>
    public const string PulseLikesHeader = "Pulse Likes";

    /// <summary>The Pulse extension column (story 14, DF-17): the post's engagement baseline <c>repost</c>.</summary>
    public const string PulseRepostsHeader = "Pulse Reposts";

    /// <summary>The Pulse extension column (story 14, DF-17): the post's engagement baseline <c>reply</c>.</summary>
    public const string PulseRepliesHeader = "Pulse Replies";

    /// <summary>The separator between the entries of a <see cref="PulseMediaAltHeader"/> cell.</summary>
    public const char AltSeparator = '|';

    private const int MinutesPerDay = 24 * 60;

    private static readonly string[] RequiredHeaders =
        [InjectNumberHeader, DeliveryMethodHeader, SourceHeader, DescriptionHeader];

    private static readonly string[] KnownHeaders =
    [
        InjectNumberHeader, TitleHeader, DescriptionHeader, ScheduledTimeHeader, ScenarioDayHeader, ScenarioTimeHeader,
        SourceHeader, DeliveryMethodHeader, NotesHeader, ResponsibleControllerHeader, PulseMediaHeader,
        PulseMediaAltHeader, PulseLikesHeader, PulseRepostsHeader, PulseRepliesHeader,
    ];

    private static readonly string[] TimeFormats =
    [
        "H:mm", "HH:mm", "H:mm:ss", "HH:mm:ss", "h:mm tt", "hh:mm tt", "h:mm:ss tt", "hh:mm:ss tt", "htt", "h tt",
    ];

    private static readonly string[] DateTimeFormats =
    [
        "yyyy-MM-dd HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss", "M/d/yyyy H:mm", "M/d/yyyy H:mm:ss",
        "M/d/yyyy h:mm tt", "M/d/yyyy h:mm:ss tt",
    ];

    /// <summary>
    /// Whether a <c>Delivery Method</c> is social (DF-9): trimmed and case-insensitive, it equals <c>Social Media</c>,
    /// <c>Social</c> or <c>Pulse</c>, or contains <c>social</c>.
    /// </summary>
    /// <param name="deliveryMethod">The cell.</param>
    /// <returns><c>true</c> for a social-media inject.</returns>
    public static bool IsSocial(string? deliveryMethod)
    {
        var value = deliveryMethod?.Trim() ?? string.Empty;
        return value.Contains("social", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "Pulse", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Plans every data row of <paramref name="table"/> against the exercise's facts.</summary>
    /// <param name="table">The read file.</param>
    /// <param name="facts">The persona, media and assignee facts of the resolved exercise.</param>
    /// <returns>The plan, or the readable header refusal.</returns>
    public static MselImportPlan Plan(MselTable table, MselImportFacts facts)
    {
        ArgumentNullException.ThrowIfNull(table);
        ArgumentNullException.ThrowIfNull(facts);

        var columns = MapHeaders(table.Headers);
        var missing = RequiredHeaders.Where(header => !columns.ContainsKey(header)).ToList();
        if (missing.Count > 0)
        {
            return MselImportPlan.Refused(
                $"the header row is missing the required column(s): {string.Join(", ", missing)}.");
        }

        var minutes = PlannedMinutes(table.Rows, columns);
        var firstRowByRef = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var rows = new List<PlannedImportRow>(table.Rows.Count);
        var socialRows = 0;

        foreach (var row in table.Rows)
        {
            var cells = new RowCells(row, columns);
            var injectNumber = Clean(cells[InjectNumberHeader]);
            var titleCell = Clean(cells[TitleHeader]);
            var planned = minutes[row.RowNumber];

            var deliveryMethod = cells[DeliveryMethodHeader].Trim();
            if (!IsSocial(deliveryMethod))
            {
                var shown = Clean(deliveryMethod) is { } method ? method : "blank";
                rows.Add(PlannedImportRow.Final(
                    row.RowNumber,
                    injectNumber,
                    titleCell,
                    personaHandle: null,
                    planned.Minute,
                    InjectImportRowStatuses.Skipped,
                    $"not a social-media inject (Delivery Method: {shown})"));
                continue;
            }

            socialRows++;
            rows.Add(PlanSocialRow(row, cells, injectNumber, titleCell, planned, facts, firstRowByRef));
        }

        return MselImportPlan.Planned(rows, socialRows);
    }

    private static PlannedImportRow PlanSocialRow(
        MselRow row,
        RowCells cells,
        string? injectNumber,
        string? titleCell,
        PlannedMinuteResult planned,
        MselImportFacts facts,
        Dictionary<string, int> firstRowByRef)
    {
        var warnings = new List<string>();
        if (planned.Warning is not null)
        {
            warnings.Add(planned.Warning);
        }

        var source = Clean(cells[SourceHeader]);
        var sourceShown = source?.TrimStart('@').Trim();

        PlannedImportRow Fail(string message, string? handle = null) => PlannedImportRow.Final(
            row.RowNumber, injectNumber, titleCell ?? FallbackTitle(injectNumber), handle ?? sourceShown, planned.Minute,
            InjectImportRowStatuses.Failed, message);

        // The Inject # is the idempotency key (DF-10): without one a re-import could never find the item again.
        if (injectNumber is null)
        {
            return Fail("Inject # is empty; every imported row needs one (a re-import finds its item by it).");
        }

        if (injectNumber.Length > MaxInjectNumberLength)
        {
            return Fail($"Inject # is longer than {MaxInjectNumberLength} characters.");
        }

        if (firstRowByRef.TryGetValue(injectNumber, out var firstRow))
        {
            return Fail(string.Create(CultureInfo.InvariantCulture, $"duplicate of row {firstRow}"));
        }

        firstRowByRef[injectNumber] = row.RowNumber;

        // Persona: handle, then exact display name, in this exercise only.
        if (string.IsNullOrEmpty(sourceShown))
        {
            return Fail("From / Source is empty; it must name a persona in this exercise.");
        }

        var persona = facts.Personas.FirstOrDefault(
            candidate => string.Equals(NormalizeHandle(candidate.Handle), sourceShown, StringComparison.OrdinalIgnoreCase));
        if (persona is null)
        {
            var byName = facts.Personas
                .Where(candidate => string.Equals(candidate.DisplayName.Trim(), source!.Trim(), StringComparison.OrdinalIgnoreCase)
                    || string.Equals(candidate.DisplayName.Trim(), sourceShown, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (byName.Count > 1)
            {
                return Fail($"From / Source '{sourceShown}' matches more than one persona's display name; use the handle.");
            }

            persona = byName.FirstOrDefault();
        }

        if (persona is null)
        {
            return Fail($"unknown persona '{sourceShown}': no persona in this exercise has that handle or display name.");
        }

        var handle = NormalizeHandle(persona.Handle);

        // Post text.
        var text = Clean(cells[DescriptionHeader]);
        if (text is null)
        {
            return Fail("Description is empty (it is the post text).", handle);
        }

        var textLength = InjectItemValidator.CodePoints(text);
        if (textLength > InjectItemValidator.MaxTextLength)
        {
            return Fail(
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"Description is {textLength} characters after cleaning; a post is at most {InjectItemValidator.MaxTextLength}."),
                handle);
        }

        // Title (fallback "Inject {#}") and notes, truncated with a warning.
        var title = titleCell ?? FallbackTitle(injectNumber)!;
        if (InjectItemValidator.CodePoints(title) > InjectItemValidator.MaxTitleLength)
        {
            title = TruncateCodePoints(title, InjectItemValidator.MaxTitleLength);
            warnings.Add($"Title truncated to {InjectItemValidator.MaxTitleLength} characters.");
        }

        var notes = Clean(cells[NotesHeader]);
        if (notes is not null && InjectItemValidator.CodePoints(notes) > InjectItemValidator.MaxNotesLength)
        {
            notes = TruncateCodePoints(notes, InjectItemValidator.MaxNotesLength);
            warnings.Add($"Notes truncated to {InjectItemValidator.MaxNotesLength} characters.");
        }

        // Media by library file name.
        var media = new List<PlannedMedia>();
        if (Clean(cells[PulseMediaHeader]) is { } mediaCell)
        {
            var images = 0;
            var videos = 0;
            foreach (var name in mediaCell.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var asset = facts.Media
                    .Where(candidate => string.Equals(candidate.FileName.Trim(), name, StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(candidate => candidate.CreatedWallClock)
                    .ThenBy(candidate => candidate.Id)
                    .FirstOrDefault();
                if (asset is null)
                {
                    return Fail($"unknown Pulse Media file '{name}': no file of that name in this exercise's media library.", handle);
                }

                if (asset.Kind == MediaKinds.Video)
                {
                    videos++;
                }
                else
                {
                    images++;
                }

                media.Add(new PlannedMedia(asset.Id, AltFor(name)));
            }

            if (images > InjectItemValidator.MaxMedia || videos > 1 || (videos > 0 && images > 0))
            {
                return Fail(
                    "Pulse Media has more than 4 images or more than one video (a post carries up to 4 images or exactly 1 video).",
                    handle);
            }
        }

        // Alt text per file (story 14, DF-17; NFR-001), else the file-name stem.
        if (ApplyAltText(cells, media, warnings) is { } altFailure)
        {
            return Fail(altFailure, handle);
        }

        // Engagement baseline (story 14, DF-17): blank is not set; anything but a whole number 0..MaxBaseline fails.
        var like = ParseBaseline(cells, PulseLikesHeader);
        var repost = ParseBaseline(cells, PulseRepostsHeader);
        var reply = ParseBaseline(cells, PulseRepliesHeader);
        if ((like.Error ?? repost.Error ?? reply.Error) is { } baselineFailure)
        {
            return Fail(baselineFailure, handle);
        }

        // Assignee by display name; unknown is a warning, never a failure. Only a MATCHED name says who the item is for:
        // a blank or unmatched cell leaves a new item unassigned and an existing item with whoever it has (Gate-1 M-2),
        // so re-importing the same Cadence file never wipes an assignment made in the console.
        Guid? assigneeId = null;
        var keepExistingAssignee = true;
        if (Clean(cells[ResponsibleControllerHeader]) is { } controller)
        {
            var matches = facts.Assignees
                .Where(candidate => string.Equals(candidate.DisplayName.Trim(), controller, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (matches.Count == 1)
            {
                assigneeId = matches[0].Id;
                keepExistingAssignee = false;
            }
            else
            {
                warnings.Add(matches.Count == 0
                    ? $"Responsible Controller '{controller}' is not a staff member of this exercise; left unassigned."
                    : $"Responsible Controller '{controller}' matches more than one staff member; left unassigned.");
            }
        }

        var candidate = new ImportCandidate(
            injectNumber,
            title,
            notes,
            planned.Minute,
            assigneeId,
            keepExistingAssignee,
            persona.Id,
            text,
            media,
            like.Value,
            repost.Value,
            reply.Value);

        return PlannedImportRow.ForCandidate(row.RowNumber, injectNumber, title, handle, planned.Minute, candidate, warnings);
    }

    /// <summary>
    /// Story 14 (DF-17): sets each file's alt text from <c>Pulse Media Alt</c> — the cell sanitized as every text cell
    /// is, split on <see cref="AltSeparator"/>, each entry trimmed. A blank cell or a blank entry keeps the file-name stem
    /// the media loop already put there; fewer entries than files leaves the rest on the stem with a warning; an entry
    /// longer than <see cref="InjectItemValidator.MaxAltLength"/> is truncated with a warning; alt text on a row without
    /// media is ignored with a warning. More entries than files is the row's failure, returned here.
    /// </summary>
    /// <remarks>
    /// The bound is UTF-16 units, the unit <see cref="InjectItemValidator"/> (and the funnel) measure alt text in after
    /// sanitizing, so a truncated entry always passes the write path; a surrogate pair is never split.
    /// </remarks>
    private static string? ApplyAltText(RowCells cells, List<PlannedMedia> media, List<string> warnings)
    {
        if (Clean(cells[PulseMediaAltHeader]) is not { } altCell)
        {
            return null;
        }

        if (media.Count == 0)
        {
            warnings.Add("Pulse Media Alt ignored: the row has no Pulse Media.");
            return null;
        }

        var entries = altCell.Split(AltSeparator);
        if (entries.Length > media.Count)
        {
            return string.Create(
                CultureInfo.InvariantCulture,
                $"Pulse Media Alt has {Count(entries.Length, "entry", "entries")} for {Count(media.Count, "Pulse Media file", "Pulse Media files")}.");
        }

        if (entries.Length < media.Count)
        {
            warnings.Add(string.Create(
                CultureInfo.InvariantCulture,
                $"Pulse Media Alt has {Count(entries.Length, "entry", "entries")} for {Count(media.Count, "Pulse Media file", "Pulse Media files")}; the rest use the file name."));
        }

        for (var index = 0; index < entries.Length; index++)
        {
            if (Clean(entries[index]) is not { } alt)
            {
                continue; // a blank entry keeps the stem
            }

            if (alt.Length > InjectItemValidator.MaxAltLength)
            {
                alt = FitAlt(alt);
                warnings.Add(string.Create(
                    CultureInfo.InvariantCulture,
                    $"Pulse Media Alt entry {index + 1} truncated to {InjectItemValidator.MaxAltLength} characters."));
            }

            media[index] = media[index] with { Alt = alt };
        }

        return null;
    }

    /// <summary>
    /// Story 14 (DF-17): one engagement column. Blank (after sanitizing) is not set. Otherwise the cell must be a whole
    /// number 0..<see cref="InjectItemValidator.MaxBaseline"/>: the readers write a numeric <c>.xlsx</c> cell in invariant
    /// shortest form (Excel's <c>962.0</c> reads <c>962</c>, a fraction keeps its decimals), and text is parsed with the
    /// invariant culture (sign, decimal point and exponent allowed; no thousands separator, so <c>1,5</c> is never 15).
    /// Negative, fractional, too large or not a number is the row's failure, naming the column.
    /// </summary>
    private static (int? Value, string? Error) ParseBaseline(RowCells cells, string header)
    {
        if (Clean(cells[header]) is not { } value)
        {
            return (null, null);
        }

        if (decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            && number == decimal.Truncate(number)
            && number is >= 0 and <= InjectItemValidator.MaxBaseline)
        {
            return ((int)number, null);
        }

        return (null, string.Create(
            CultureInfo.InvariantCulture,
            $"{header} '{value}' is not a whole number from 0 to {InjectItemValidator.MaxBaseline:N0}."));
    }

    private static string Count(int count, string singular, string plural) =>
        string.Create(CultureInfo.InvariantCulture, $"{count} {(count == 1 ? singular : plural)}");

    /// <summary>Bounds sanitized alt text to <see cref="InjectItemValidator.MaxAltLength"/> UTF-16 units, never splitting a pair.</summary>
    private static string FitAlt(string alt)
    {
        if (alt.Length <= InjectItemValidator.MaxAltLength)
        {
            return alt;
        }

        var cut = InjectItemValidator.MaxAltLength;
        if (char.IsHighSurrogate(alt[cut - 1]))
        {
            cut--;
        }

        return alt[..cut].TrimEnd();
    }

    /// <summary>
    /// DF-11: minutes from the earliest (Scenario Day, Scenario Time) of ANY data row (the StartEx row) to the row's own;
    /// Scenario Day defaults to 1. When no row has a Scenario Time, the same rule on Scheduled Time. A row without the
    /// chosen time is unplanned (<c>null</c>).
    /// </summary>
    private static Dictionary<int, PlannedMinuteResult> PlannedMinutes(
        IReadOnlyList<MselRow> rows,
        Dictionary<string, int> columns)
    {
        var parsed = rows.Select(row =>
        {
            var cells = new RowCells(row, columns);
            return (Row: row, Day: ParseDay(cells[ScenarioDayHeader]), Scenario: cells[ScenarioTimeHeader].Trim(),
                Scheduled: cells[ScheduledTimeHeader].Trim());
        }).ToList();

        var useScenario = parsed.Any(entry => ParseTimeOfDay(entry.Scenario) is not null);
        var header = useScenario ? ScenarioTimeHeader : ScheduledTimeHeader;

        var keys = new Dictionary<int, (int? Key, string? Warning)>();
        foreach (var entry in parsed)
        {
            var raw = useScenario ? entry.Scenario : entry.Scheduled;
            var time = ParseTimeOfDay(raw);
            string? warning = null;
            if (time is null && raw.Length > 0)
            {
                warning = $"{header} '{Clean(raw)}' is not a time of day; left unplanned.";
            }
            else if (entry.Day.Warning is not null && time is not null)
            {
                warning = entry.Day.Warning;
            }

            keys[entry.Row.RowNumber] = (time is { } minutes ? (entry.Day.Day * MinutesPerDay) + minutes : null, warning);
        }

        var start = keys.Values.Select(value => value.Key).Where(key => key is not null).DefaultIfEmpty(null).Min();
        return keys.ToDictionary(
            pair => pair.Key,
            pair => new PlannedMinuteResult(
                pair.Value.Key is { } key && start is { } origin ? key - origin : null,
                pair.Value.Warning));
    }

    private static (int Day, string? Warning) ParseDay(string cell)
    {
        var value = cell.Trim();
        if (value.Length == 0)
        {
            return (1, null);
        }

        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            && number == Math.Floor(number)
            && number is >= 0 and <= 10_000)
        {
            return ((int)number, null);
        }

        return (1, $"Scenario Day '{Clean(value)}' is not a whole number; day 1 assumed.");
    }

    /// <summary>
    /// Minutes since midnight for a time-of-day cell (<c>HH:mm</c>, <c>h:mm tt</c>, a date-time, or an Excel time
    /// serial), or <c>null</c> when it is blank or not a time.
    /// </summary>
    /// <param name="cell">The cell text.</param>
    /// <returns>The minute of the day, or <c>null</c>.</returns>
    public static int? ParseTimeOfDay(string cell)
    {
        ArgumentNullException.ThrowIfNull(cell);

        var value = cell.Trim();
        if (value.Length == 0)
        {
            return null;
        }

        if (TimeOnly.TryParseExact(value, TimeFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var time))
        {
            return (time.Hour * 60) + time.Minute;
        }

        if (DateTime.TryParseExact(value, DateTimeFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateTime))
        {
            return (dateTime.Hour * 60) + dateTime.Minute;
        }

        // An Excel time serial (a fraction of a day) that survived as text.
        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var fraction)
            && fraction is >= 0 and < 1)
        {
            return (int)Math.Floor((fraction * MinutesPerDay) + 1e-9);
        }

        return null;
    }

    private static Dictionary<string, int> MapHeaders(IReadOnlyList<string> headers)
    {
        var columns = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < headers.Count; index++)
        {
            var header = headers[index].Trim();
            var known = KnownHeaders.FirstOrDefault(candidate => string.Equals(candidate, header, StringComparison.OrdinalIgnoreCase));
            if (known is not null)
            {
                columns.TryAdd(known, index); // the first of a repeated header wins
            }
        }

        return columns;
    }

    /// <summary>Sanitizes (NFR-004: strip, never encode) and trims; <c>null</c> when nothing is left.</summary>
    internal static string? Clean(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var cleaned = PostSanitizer.Sanitize(value).Trim();
        return cleaned.Length == 0 ? null : cleaned;
    }

    private static string NormalizeHandle(string handle) => handle.Trim().TrimStart('@').Trim();

    private static string? FallbackTitle(string? injectNumber) => injectNumber is null ? null : $"Inject {injectNumber}";

    /// <summary>The fallback alt text: the file name without its extension (the whole name when that leaves nothing).</summary>
    private static string AltFor(string fileName)
    {
        var stem = Path.GetFileNameWithoutExtension(fileName).Trim();
        return FitAlt(stem.Length > 0 ? stem : fileName);
    }

    private static string TruncateCodePoints(string value, int maxCodePoints)
    {
        var builder = new StringBuilder(value.Length);
        var count = 0;
        foreach (var rune in value.EnumerateRunes())
        {
            if (count == maxCodePoints)
            {
                break;
            }

            builder.Append(rune.ToString());
            count++;
        }

        return builder.ToString().TrimEnd();
    }

    /// <summary>A row's cells by header (blank when the column is absent or the row is short).</summary>
    private readonly struct RowCells
    {
        private readonly MselRow _row;
        private readonly Dictionary<string, int> _columns;

        public RowCells(MselRow row, Dictionary<string, int> columns)
        {
            _row = row;
            _columns = columns;
        }

        public string this[string header] =>
            _columns.TryGetValue(header, out var index) && index < _row.Cells.Count ? _row.Cells[index] : string.Empty;
    }

    private sealed record PlannedMinuteResult(int? Minute, string? Warning);
}

/// <summary>The in-scope facts the planner maps a row against. Every list holds rows of the resolved exercise only.</summary>
/// <param name="Personas">The exercise's personas.</param>
/// <param name="Media">The exercise's media-library files (poster frames excluded).</param>
/// <param name="Assignees">The staff assigned to the exercise (the run sheet's assignee list).</param>
public sealed record MselImportFacts(
    IReadOnlyList<ImportPersona> Personas,
    IReadOnlyList<ImportMedia> Media,
    IReadOnlyList<ImportAssignee> Assignees);

/// <summary>A persona of the exercise.</summary>
/// <param name="Id">The persona id.</param>
/// <param name="Handle">The stored handle.</param>
/// <param name="DisplayName">The display name.</param>
public sealed record ImportPersona(Guid Id, string Handle, string DisplayName);

/// <summary>A media-library file of the exercise.</summary>
/// <param name="Id">The asset id.</param>
/// <param name="FileName">The original file name.</param>
/// <param name="Kind">The kind literal (<c>image</c>/<c>video</c>).</param>
/// <param name="CreatedWallClock">When it was uploaded (the newest of two same-named files wins).</param>
public sealed record ImportMedia(Guid Id, string FileName, string Kind, DateTimeOffset CreatedWallClock);

/// <summary>A staff member assigned to the exercise.</summary>
/// <param name="Id">The staff user id.</param>
/// <param name="DisplayName">The display name.</param>
public sealed record ImportAssignee(Guid Id, string DisplayName);

/// <summary>One media reference a candidate asks for.</summary>
/// <param name="AssetId">The library asset id.</param>
/// <param name="Alt">
/// The sanitized alt text: the file's <c>Pulse Media Alt</c> entry (story 14), else the file name without its extension.
/// </param>
public sealed record PlannedMedia(Guid AssetId, string Alt);

/// <summary>What a social row asks for: one single-post run-sheet item keyed by its <c>Inject #</c>.</summary>
/// <param name="ExternalRef">The sanitized <c>Inject #</c> (DF-10).</param>
/// <param name="Title">The item title.</param>
/// <param name="Notes">The item notes, or <c>null</c>.</param>
/// <param name="PlannedMinute">The planned minute (DF-11), or <c>null</c>.</param>
/// <param name="AssigneeId">The matched assignee, or <c>null</c>.</param>
/// <param name="KeepExistingAssignee">
/// Whether the row's <c>Responsible Controller</c> is blank or did not match anyone. A new item is then unassigned; an
/// existing item keeps whoever a controller assigned in the console (the file says nothing usable about it). Only a
/// matched name changes an existing item's assignee.
/// </param>
/// <param name="PersonaId">The resolved persona.</param>
/// <param name="Text">The sanitized post text.</param>
/// <param name="Media">The media, in cell order.</param>
/// <param name="BaselineLike">The <c>Pulse Likes</c> baseline (story 14), or <c>null</c> when the cell is blank.</param>
/// <param name="BaselineRepost">The <c>Pulse Reposts</c> baseline (story 14), or <c>null</c> when the cell is blank.</param>
/// <param name="BaselineReply">The <c>Pulse Replies</c> baseline (story 14), or <c>null</c> when the cell is blank.</param>
public sealed record ImportCandidate(
    string ExternalRef,
    string Title,
    string? Notes,
    int? PlannedMinute,
    Guid? AssigneeId,
    bool KeepExistingAssignee,
    Guid PersonaId,
    string Text,
    IReadOnlyList<PlannedMedia> Media,
    int? BaselineLike,
    int? BaselineRepost,
    int? BaselineReply);

/// <summary>One data row's plan: a final outcome (skipped/failed), or a candidate the queue decides on.</summary>
public sealed class PlannedImportRow
{
    private PlannedImportRow(
        int rowNumber,
        string? injectNumber,
        string? title,
        string? personaHandle,
        int? plannedMinute,
        string? finalStatus,
        string? message,
        ImportCandidate? candidate,
        IReadOnlyList<string> warnings)
    {
        RowNumber = rowNumber;
        InjectNumber = injectNumber;
        Title = title;
        PersonaHandle = personaHandle;
        PlannedMinute = plannedMinute;
        FinalStatus = finalStatus;
        Message = message;
        Candidate = candidate;
        Warnings = warnings;
    }

    /// <summary>The spreadsheet row number.</summary>
    public int RowNumber { get; }

    /// <summary>The sanitized <c>Inject #</c>, if any.</summary>
    public string? InjectNumber { get; }

    /// <summary>The title shown in the report.</summary>
    public string? Title { get; }

    /// <summary>The persona handle shown in the report.</summary>
    public string? PersonaHandle { get; }

    /// <summary>The planned minute.</summary>
    public int? PlannedMinute { get; }

    /// <summary><c>skipped</c> or <c>failed</c> for a final row; <c>null</c> for a candidate.</summary>
    public string? FinalStatus { get; }

    /// <summary>The reason for a final row.</summary>
    public string? Message { get; }

    /// <summary>The candidate, for a social row that mapped cleanly.</summary>
    public ImportCandidate? Candidate { get; }

    /// <summary>The candidate's warnings (truncations, an unknown assignee, an unreadable time).</summary>
    public IReadOnlyList<string> Warnings { get; }

    /// <summary>A row that is skipped or failed before the run sheet is consulted.</summary>
    /// <param name="rowNumber">The row number.</param>
    /// <param name="injectNumber">The Inject #.</param>
    /// <param name="title">The title.</param>
    /// <param name="personaHandle">The persona handle or source cell.</param>
    /// <param name="plannedMinute">The planned minute.</param>
    /// <param name="status">The final status.</param>
    /// <param name="message">The reason.</param>
    /// <returns>The planned row.</returns>
    public static PlannedImportRow Final(
        int rowNumber,
        string? injectNumber,
        string? title,
        string? personaHandle,
        int? plannedMinute,
        string status,
        string message) =>
        new(rowNumber, injectNumber, title, personaHandle, plannedMinute, status, message, null, []);

    /// <summary>A social row that mapped onto a candidate item.</summary>
    /// <param name="rowNumber">The row number.</param>
    /// <param name="injectNumber">The Inject #.</param>
    /// <param name="title">The title.</param>
    /// <param name="personaHandle">The resolved handle.</param>
    /// <param name="plannedMinute">The planned minute.</param>
    /// <param name="candidate">The candidate.</param>
    /// <param name="warnings">The warnings.</param>
    /// <returns>The planned row.</returns>
    public static PlannedImportRow ForCandidate(
        int rowNumber,
        string injectNumber,
        string title,
        string personaHandle,
        int? plannedMinute,
        ImportCandidate candidate,
        IReadOnlyList<string> warnings) =>
        new(rowNumber, injectNumber, title, personaHandle, plannedMinute, null, null, candidate, warnings);

    /// <summary>The report row for this plan with <paramref name="status"/> and the given extra message.</summary>
    /// <param name="status">The status.</param>
    /// <param name="message">A message to put before the warnings, or <c>null</c>.</param>
    /// <returns>The report row.</returns>
    public InjectImportRowDto ToReport(string status, string? message)
    {
        // The reason reads exactly as written ("duplicate of row 3", "already fired; not changed"); only when warnings
        // follow it is it closed with a period so the joined message reads as sentences.
        var parts = new List<string>();
        if (!string.IsNullOrEmpty(message))
        {
            parts.Add(Warnings.Count > 0 ? EndSentence(message) : message);
        }

        parts.AddRange(Warnings);
        return new InjectImportRowDto
        {
            RowNumber = RowNumber,
            InjectNumber = InjectNumber,
            Title = Title,
            PersonaHandle = PersonaHandle,
            PlannedMinute = PlannedMinute,
            Status = status,
            Message = parts.Count == 0 ? null : string.Join(" ", parts),
        };
    }

    /// <summary>The report row of a final (skipped/failed) plan.</summary>
    /// <returns>The report row.</returns>
    public InjectImportRowDto ToFinalReport() => ToReport(FinalStatus!, Message);

    private static string EndSentence(string part) =>
        part.EndsWith('.') || part.EndsWith(')') ? part : part + ".";
}

/// <summary>The planner's result: the planned rows, or a header refusal (400).</summary>
public sealed class MselImportPlan
{
    private MselImportPlan(IReadOnlyList<PlannedImportRow> rows, int socialRows, string? error)
    {
        Rows = rows;
        SocialRows = socialRows;
        Error = error;
    }

    /// <summary>The planned rows, in file order.</summary>
    public IReadOnlyList<PlannedImportRow> Rows { get; }

    /// <summary>How many rows were social candidates (including those that then failed).</summary>
    public int SocialRows { get; }

    /// <summary>The header refusal, or <c>null</c>.</summary>
    public string? Error { get; }

    /// <summary>A planned file.</summary>
    /// <param name="rows">The rows.</param>
    /// <param name="socialRows">The social count.</param>
    /// <returns>The plan.</returns>
    public static MselImportPlan Planned(IReadOnlyList<PlannedImportRow> rows, int socialRows) => new(rows, socialRows, null);

    /// <summary>A refused file.</summary>
    /// <param name="error">The reason.</param>
    /// <returns>The plan.</returns>
    public static MselImportPlan Refused(string error) => new([], 0, error);
}
