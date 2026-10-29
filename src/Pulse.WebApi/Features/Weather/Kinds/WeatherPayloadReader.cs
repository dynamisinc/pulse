namespace Pulse.WebApi.Features.Weather.Kinds;

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather.Contracts;

/// <summary>
/// The synchronous half of the weather payload rules (story 01): shape, closed vocabularies, bounds and plain-text cleaning,
/// building the NORMALIZED record. Unknown keys are never read, so they never survive into the stored or projected payload.
/// Exercise-dependent checks (zone existence, supersession) are the descriptors' async half.
/// </summary>
/// <remarks>
/// Errors are field-level: <c>"payload.{path}: {problem}"</c>. Every string is measured after
/// <see cref="WeatherPlainText.Clean"/>; an over-long value is an error, never truncated.
/// </remarks>
internal static partial class WeatherPayloadReader
{
    /// <summary>Reads a <c>weather_product</c> payload.</summary>
    /// <param name="payload">The payload.</param>
    /// <param name="fromStore">
    /// <c>true</c> when reading a STORED payload (projection, publish options): the server-derived <c>supersedesPermalink</c>
    /// is kept. On a write it is ignored, so a client can never supply it.
    /// </param>
    /// <param name="errors">Receives every problem.</param>
    /// <returns>The normalized payload, or null when any error was found.</returns>
    public static WeatherProductPayload? ReadProduct(JsonObject payload, bool fromStore, List<string> errors)
    {
        var start = errors.Count;
        var r = new Fields(errors);

        var productType = r.Enum(payload, "productType", WeatherVocabulary.ProductTypes);
        var hazard = r.Enum(payload, "hazard", WeatherVocabulary.Hazards);
        var action = r.Enum(payload, "action", WeatherVocabulary.ProductActions);
        var zoneSlugs = r.SlugList(payload, "zoneSlugs", WeatherLimits.MaxZones);
        var effectiveText = r.Instant(payload, "effectiveScenarioTime", out var effective);
        var expiresText = r.Instant(payload, "expiresScenarioTime", out var expires);
        if (effectiveText is not null && expiresText is not null && expires <= effective)
        {
            r.Fail("expiresScenarioTime", "must be after effectiveScenarioTime");
        }

        // Write-only rules (supersession presence, the forced warning alert) are skipped on a stored read: they guard
        // authoring, and a later change to them must never blank an already-published product's projection.
        var supersedes = r.OptionalGuid(payload, "supersedesContentId");
        if (action is not null && !fromStore)
        {
            var superseding = WeatherVocabulary.SupersedingActions.Contains(action, StringComparer.Ordinal);
            if (superseding && supersedes is null)
            {
                r.Fail("supersedesContentId", $"is required for action '{action}'");
            }
            else if (!superseding && supersedes is not null)
            {
                r.Fail("supersedesContentId", "must be absent for action 'new'");
            }
        }

        string? supersedesPermalink = null;
        if (fromStore)
        {
            supersedesPermalink = r.OptionalString(payload, "supersedesPermalink", 512, multiline: false);
            if (supersedesPermalink is not null
                && (!ChannelVocabulary.IsHostRelativePath(supersedesPermalink)
                    || !supersedesPermalink.StartsWith("/" + ChannelVocabulary.Weather + "/", StringComparison.Ordinal)))
            {
                // Only a host-relative WEATHER permalink is ever echoed (FC-9.3); anything else is dropped.
                supersedesPermalink = null;
            }
        }

        var ibw = ReadIbw(payload, r);
        if (productType == WeatherVocabulary.ProductWarning && ibw is null && !r.Has(start, "ibw"))
        {
            r.Fail("ibw", "is required for a warning");
        }

        var actions = r.StringList(payload, "actions", WeatherLimits.MaxActions, WeatherLimits.ActionMaxLength) ?? [];
        var delivery = ReadDelivery(payload, r);
        if (!fromStore && delivery is not null && !delivery.RaiseAlert
            && productType == WeatherVocabulary.ProductWarning && action != WeatherVocabulary.ActionCancel)
        {
            r.Fail("delivery.raiseAlert", "a warning always raises its alert");
        }

        if (errors.Count > start)
        {
            return null;
        }

        return new WeatherProductPayload
        {
            ProductType = productType!,
            Hazard = hazard!,
            Action = action!,
            SupersedesContentId = supersedes,
            SupersedesPermalink = supersedesPermalink,
            ZoneSlugs = zoneSlugs!,
            EffectiveScenarioTime = effectiveText!,
            ExpiresScenarioTime = expiresText!,
            Ibw = ibw,
            Actions = actions,
            Delivery = delivery!,
        };
    }

    /// <summary>Reads a <c>forecast</c> payload.</summary>
    /// <param name="payload">The payload.</param>
    /// <param name="errors">Receives every problem.</param>
    /// <returns>The normalized payload, or null when any error was found.</returns>
    public static ForecastPayload? ReadForecast(JsonObject payload, List<string> errors)
    {
        var start = errors.Count;
        var r = new Fields(errors);

        var zoneSlug = r.Slug(payload, "zoneSlug");
        var current = ReadCurrent(payload, r);
        var periods = ReadPeriods(payload, r);
        var discussion = r.OptionalString(payload, "discussion", WeatherLimits.DiscussionMaxLength, multiline: true);
        var uncertainty = r.OptionalString(payload, "uncertaintyNote", WeatherLimits.UncertaintyNoteMaxLength, multiline: true);

        if (errors.Count > start)
        {
            return null;
        }

        return new ForecastPayload
        {
            ZoneSlug = zoneSlug!,
            Current = current!,
            Periods = periods!,
            Discussion = discussion,
            UncertaintyNote = uncertainty,
        };
    }

    private static WeatherIbw? ReadIbw(JsonObject payload, Fields r)
    {
        var ibw = r.OptionalObject(payload, "ibw");
        if (ibw is null)
        {
            return null;
        }

        var nested = r.Nested("ibw");
        var what = nested.String(ibw, "what", WeatherLimits.IbwFieldMaxLength, multiline: true);
        var where = nested.String(ibw, "where", WeatherLimits.IbwFieldMaxLength, multiline: true);
        var when = nested.String(ibw, "when", WeatherLimits.IbwFieldMaxLength, multiline: true);
        var impacts = nested.String(ibw, "impacts", WeatherLimits.IbwFieldMaxLength, multiline: true);
        return what is null || where is null || when is null || impacts is null
            ? null
            : new WeatherIbw { What = what, Where = where, When = when, Impacts = impacts };
    }

    private static WeatherDelivery? ReadDelivery(JsonObject payload, Fields r)
    {
        // Absent = the defaults (alert on, no post); the editor (story 11) always sends it explicitly.
        if (!payload.ContainsKey("delivery") || payload["delivery"] is null)
        {
            return new WeatherDelivery();
        }

        var delivery = r.OptionalObject(payload, "delivery");
        if (delivery is null)
        {
            return null;
        }

        var nested = r.Nested("delivery");
        var raiseAlert = nested.OptionalBool(delivery, "raiseAlert") ?? true;
        var post = new WeatherDeliveryPost();
        var postObject = nested.OptionalObject(delivery, "post");
        if (postObject is not null)
        {
            var postFields = nested.Nested("post");
            var text = postFields.OptionalString(postObject, "text", int.MaxValue, multiline: true);
            if (text is not null && WeatherPlainText.CodePointLength(text) > WeatherLimits.PostTextMaxCodePoints)
            {
                postFields.Fail("text", $"must be at most {WeatherLimits.PostTextMaxCodePoints} characters");
            }

            post = new WeatherDeliveryPost { Enabled = postFields.OptionalBool(postObject, "enabled") ?? false, Text = text };
        }

        return new WeatherDelivery { RaiseAlert = raiseAlert, Post = post };
    }

    private static ForecastCurrent? ReadCurrent(JsonObject payload, Fields r)
    {
        var current = r.RequiredObject(payload, "current");
        if (current is null)
        {
            return null;
        }

        var c = r.Nested("current");
        var tempF = c.Int(current, "tempF", WeatherLimits.MinTempF, WeatherLimits.MaxTempF);
        var condition = c.String(current, "condition", WeatherLimits.ShortTextMaxLength, multiline: false);
        var code = c.Enum(current, "conditionCode", WeatherVocabulary.ConditionCodes);
        var windMph = c.Int(current, "windMph", 0, WeatherLimits.MaxWindMph);
        var windDir = c.String(current, "windDir", WeatherLimits.WindDirMaxLength, multiline: false);
        var humidity = c.Int(current, "humidityPct", 0, 100);
        var observed = c.Instant(current, "observedScenarioTime", out _);

        return tempF is null || condition is null || code is null || windMph is null || windDir is null || humidity is null
               || observed is null
            ? null
            : new ForecastCurrent
            {
                TempF = tempF.Value,
                Condition = condition,
                ConditionCode = code,
                WindMph = windMph.Value,
                WindDir = windDir,
                HumidityPct = humidity.Value,
                ObservedScenarioTime = observed,
            };
    }

    private static List<ForecastPeriod>? ReadPeriods(JsonObject payload, Fields r)
    {
        var array = r.Array(payload, "periods", 1, WeatherLimits.MaxPeriods);
        if (array is null)
        {
            return null;
        }

        var periods = new List<ForecastPeriod>(array.Count);
        var ok = true;
        for (var i = 0; i < array.Count; i++)
        {
            var p = r.Nested($"periods[{i}]");
            if (array[i] is not JsonObject period)
            {
                r.Fail($"periods[{i}]", "must be an object");
                ok = false;
                continue;
            }

            var label = p.String(period, "label", WeatherLimits.ShortTextMaxLength, multiline: false);
            var beforeTemperatures = r.ErrorCount;
            var tempF = p.OptionalInt(period, "tempF", WeatherLimits.MinTempF, WeatherLimits.MaxTempF);
            var hiF = p.OptionalInt(period, "hiF", WeatherLimits.MinTempF, WeatherLimits.MaxTempF);
            var loF = p.OptionalInt(period, "loF", WeatherLimits.MinTempF, WeatherLimits.MaxTempF);
            var temperatureOk = r.ErrorCount == beforeTemperatures;
            var single = tempF is not null;
            var pair = hiF is not null && loF is not null;
            var partialPair = (hiF is not null) != (loF is not null);
            if (temperatureOk && (single == pair || partialPair))
            {
                p.Fail("tempF", "give either tempF or both hiF and loF");
                temperatureOk = false;
            }
            else if (temperatureOk && hiF < loF)
            {
                p.Fail("hiF", "must not be below loF");
                temperatureOk = false;
            }

            var condition = p.String(period, "condition", WeatherLimits.ShortTextMaxLength, multiline: false);
            var code = p.Enum(period, "conditionCode", WeatherVocabulary.ConditionCodes);
            var precip = p.Int(period, "precipPct", 0, 100);
            var windText = p.String(period, "windText", WeatherLimits.ShortTextMaxLength, multiline: false);
            var detail = p.String(period, "detail", WeatherLimits.PeriodDetailMaxLength, multiline: true);

            if (label is null || !temperatureOk || condition is null || code is null || precip is null || windText is null
                || detail is null)
            {
                ok = false;
                continue;
            }

            periods.Add(new ForecastPeriod
            {
                Label = label,
                TempF = tempF,
                HiF = hiF,
                LoF = loF,
                Condition = condition,
                ConditionCode = code,
                PrecipPct = precip.Value,
                WindText = windText,
                Detail = detail,
            });
        }

        return ok ? periods : null;
    }

    // The wire convention for every *ScenarioTime (mirrors isIsoScenarioTime in channels guards.ts): ISO-8601 with an offset.
    [GeneratedRegex(@"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,7})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})\z", RegexOptions.CultureInvariant)]
    private static partial Regex IsoInstantPattern();

    /// <summary>Typed field access that records a field-level error for every problem.</summary>
    private sealed class Fields(List<string> errors, string prefix = "payload")
    {
        public Fields Nested(string path) => new(errors, $"{prefix}.{path}");

        public void Fail(string key, string problem) => errors.Add($"{prefix}.{key}: {problem}");

        /// <summary>Whether an error was already recorded for <paramref name="key"/> (or under it) since <paramref name="start"/>.</summary>
        public bool Has(int start, string key)
        {
            var path = $"{prefix}.{key}";
            for (var i = start; i < errors.Count; i++)
            {
                if (errors[i].StartsWith(path + ":", StringComparison.Ordinal)
                    || errors[i].StartsWith(path + ".", StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        public int ErrorCount => errors.Count;

        public string? String(JsonObject o, string key, int max, bool multiline)
        {
            if (!IsPresent(o, key))
            {
                Fail(key, "is required");
                return null;
            }

            if (TryString(o, key, max, multiline, out var value) && value is null)
            {
                Fail(key, "must not be empty");
            }

            return value;
        }

        public string? OptionalString(JsonObject o, string key, int max, bool multiline) =>
            TryString(o, key, max, multiline, out var value) ? value : null;

        /// <summary>Reads and cleans a string; <c>false</c> (with an error) when it is not a string or is too long.</summary>
        private bool TryString(JsonObject o, string key, int max, bool multiline, out string? value)
        {
            value = null;
            if (!IsPresent(o, key))
            {
                return true;
            }

            if (o[key]!.GetValueKind() != JsonValueKind.String)
            {
                Fail(key, "must be a string");
                return false;
            }

            var cleaned = WeatherPlainText.Clean(o[key]!.GetValue<string>(), multiline);
            if (cleaned.Length > max)
            {
                Fail(key, $"must be at most {max} characters");
                return false;
            }

            value = cleaned.Length == 0 ? null : cleaned;
            return true;
        }

        public string? Enum(JsonObject o, string key, IReadOnlyList<string> allowed)
        {
            if (!IsPresent(o, key))
            {
                Fail(key, "is required");
                return null;
            }

            var node = o[key]!;
            if (node.GetValueKind() == JsonValueKind.String && allowed.Contains(node.GetValue<string>(), StringComparer.Ordinal))
            {
                return node.GetValue<string>();
            }

            Fail(key, $"must be one of {string.Join(", ", allowed)}");
            return null;
        }

        public string? Slug(JsonObject o, string key)
        {
            if (!IsPresent(o, key))
            {
                Fail(key, "is required");
                return null;
            }

            var node = o[key]!;
            if (node.GetValueKind() == JsonValueKind.String && ChannelVocabulary.IsSlug(node.GetValue<string>()))
            {
                return node.GetValue<string>();
            }

            Fail(key, "must be a zone slug ([a-z0-9-]{1,80})");
            return null;
        }

        public List<string>? SlugList(JsonObject o, string key, int max)
        {
            var array = Array(o, key, 1, max);
            if (array is null)
            {
                return null;
            }

            var slugs = new List<string>(array.Count);
            var ok = true;
            for (var i = 0; i < array.Count; i++)
            {
                var node = array[i];
                if (node is null || node.GetValueKind() != JsonValueKind.String || !ChannelVocabulary.IsSlug(node.GetValue<string>()))
                {
                    Fail($"{key}[{i}]", "must be a zone slug ([a-z0-9-]{1,80})");
                    ok = false;
                    continue;
                }

                var slug = node.GetValue<string>();
                if (slugs.Contains(slug, StringComparer.Ordinal))
                {
                    Fail($"{key}[{i}]", $"duplicate zone '{slug}'");
                    ok = false;
                    continue;
                }

                slugs.Add(slug);
            }

            return ok ? slugs : null;
        }

        public List<string>? StringList(JsonObject o, string key, int maxItems, int maxLength)
        {
            if (!IsPresent(o, key))
            {
                return [];
            }

            var array = Array(o, key, 0, maxItems);
            if (array is null)
            {
                return null;
            }

            var values = new List<string>(array.Count);
            for (var i = 0; i < array.Count; i++)
            {
                var node = array[i];
                if (node is null || node.GetValueKind() != JsonValueKind.String)
                {
                    Fail($"{key}[{i}]", "must be a string");
                    continue;
                }

                var cleaned = WeatherPlainText.Clean(node.GetValue<string>(), multiline: false);
                if (cleaned.Length == 0)
                {
                    Fail($"{key}[{i}]", "must not be empty");
                }
                else if (cleaned.Length > maxLength)
                {
                    Fail($"{key}[{i}]", $"must be at most {maxLength} characters");
                }
                else
                {
                    values.Add(cleaned);
                }
            }

            return values.Count == array.Count ? values : null;
        }

        public JsonArray? Array(JsonObject o, string key, int min, int max)
        {
            if (!IsPresent(o, key))
            {
                Fail(key, "is required");
                return null;
            }

            if (o[key] is not JsonArray array)
            {
                Fail(key, "must be an array");
                return null;
            }

            if (array.Count < min || array.Count > max)
            {
                Fail(key, $"must have {min} to {max} entries");
                return null;
            }

            return array;
        }

        public JsonObject? RequiredObject(JsonObject o, string key)
        {
            if (!IsPresent(o, key))
            {
                Fail(key, "is required");
                return null;
            }

            return OptionalObject(o, key);
        }

        public JsonObject? OptionalObject(JsonObject o, string key)
        {
            if (!IsPresent(o, key))
            {
                return null;
            }

            if (o[key] is JsonObject value)
            {
                return value;
            }

            Fail(key, "must be an object");
            return null;
        }

        public int? Int(JsonObject o, string key, int min, int max)
        {
            if (!IsPresent(o, key))
            {
                Fail(key, "is required");
                return null;
            }

            return OptionalInt(o, key, min, max);
        }

        public int? OptionalInt(JsonObject o, string key, int min, int max)
        {
            if (!IsPresent(o, key))
            {
                return null;
            }

            if (o[key] is JsonValue value && value.GetValueKind() == JsonValueKind.Number
                && value.TryGetValue<int>(out var number) && number >= min && number <= max)
            {
                return number;
            }

            Fail(key, $"must be a whole number from {min} to {max}");
            return null;
        }

        public bool? OptionalBool(JsonObject o, string key)
        {
            if (!IsPresent(o, key))
            {
                return null;
            }

            var kind = o[key]!.GetValueKind();
            if (kind is JsonValueKind.True or JsonValueKind.False)
            {
                return kind == JsonValueKind.True;
            }

            Fail(key, "must be true or false");
            return null;
        }

        public Guid? OptionalGuid(JsonObject o, string key)
        {
            if (!IsPresent(o, key))
            {
                return null;
            }

            var node = o[key]!;
            if (node.GetValueKind() == JsonValueKind.String
                && Guid.TryParseExact(node.GetValue<string>(), "D", out var id) && id != Guid.Empty)
            {
                return id;
            }

            Fail(key, "must be a content id");
            return null;
        }

        public string? Instant(JsonObject o, string key, out DateTimeOffset instant)
        {
            instant = default;
            if (!IsPresent(o, key))
            {
                Fail(key, "is required");
                return null;
            }

            var node = o[key]!;
            if (node.GetValueKind() == JsonValueKind.String)
            {
                var text = node.GetValue<string>();
                if (IsoInstantPattern().IsMatch(text)
                    && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out instant))
                {
                    return text;
                }
            }

            Fail(key, "must be a scenario-time ISO-8601 instant with an offset");
            return null;
        }

        // A JSON null counts as absent: optional fields may be sent as null.
        private static bool IsPresent(JsonObject o, string key) => o.TryGetPropertyValue(key, out var node) && node is not null;
    }
}
