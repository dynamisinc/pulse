namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// easy-login/01 (Frozen contract AC) — pins <c>EasyLoginDtos.cs</c> to the frozen TypeScript in
/// <c>docs/features/easy-login/implementation.md</c>, field for field. Each test serialises a fully populated
/// instance with DEFAULT serializer options (so nothing depends on host configuration) and compares it with the
/// TypeScript type transcribed here as expected JSON: same keys, same nesting, same JSON kinds (string / number /
/// boolean / array / object). A second set proves every optional member is OMITTED when null, never <c>null</c>.
/// Plain <c>[Fact]</c>s: no database.
/// </summary>
public sealed class EasyLoginDtoContractTests
{
    private const string Instant = "2026-10-20T13:45:00.0000000+00:00";

    // ---------------------------------------------------------------- populated: keys and shapes, field for field

    [Fact]
    public void RosterPersonaDto_MatchesTheFrozenType()
    {
        AssertWire(
            NewPersona(),
            """
            { "id": "p-1", "handle": "FulcoEM", "displayName": "Fulco EM", "kind": "org", "autoCreated": false }
            """);
    }

    [Fact]
    public void RosterLinkDto_MatchesTheFrozenType()
    {
        AssertWire(
            NewLink(),
            $$"""
            {
              "status": "active", "issuedAt": "{{Instant}}", "revokedAt": "{{Instant}}", "lastUsedAt": "{{Instant}}",
              "useCount": 3, "joinUrl": "https://spa.example/join/tok", "needsReissue": true
            }
            """);
    }

    [Fact]
    public void RosterEntryDto_MatchesTheFrozenType()
    {
        AssertWire(
            NewEntry(),
            $$"""
            {
              "id": "a-1", "name": "Jane Smith", "agency": "Fulco EM", "role": "EOC Liaison", "email": "jane@example.org",
              "signInName": "jsmith", "exerciseRole": "pio",
              "persona": { "id": "p-1", "handle": "FulcoEM", "displayName": "Fulco EM", "kind": "org", "autoCreated": false },
              "link": {
                "status": "active", "issuedAt": "{{Instant}}", "revokedAt": "{{Instant}}", "lastUsedAt": "{{Instant}}",
                "useCount": 3, "joinUrl": "https://spa.example/join/tok", "needsReissue": true
              },
              "access": "enabled", "liveSessions": 2, "lastSignInAt": "{{Instant}}", "createdAt": "{{Instant}}"
            }
            """);
    }

    [Fact]
    public void RosterListDto_MatchesTheFrozenType()
    {
        var dto = new RosterListDto
        {
            Participants = [MinimalEntry()],
            JoinLinksAvailable = true,
            Capabilities = new RosterCapabilitiesDto { EmailLinks = false },
        };

        AssertWire(
            dto,
            $$"""
            {
              "participants": [
                {
                  "id": "a-2", "name": "Ng", "signInName": "ng1", "exerciseRole": "participant",
                  "link": { "status": "none", "useCount": 0 },
                  "access": "disabled", "liveSessions": 0, "createdAt": "{{Instant}}"
                }
              ],
              "joinLinksAvailable": true,
              "capabilities": { "emailLinks": false }
            }
            """);
    }

    [Fact]
    public void RosterRowWrite_MatchesTheFrozenType()
    {
        var dto = new RosterRowWrite
        {
            Name = "Jane Smith",
            Agency = "Fulco EM",
            Role = "EOC Liaison",
            Email = "jane@example.org",
            PersonaHandle = "@FulcoEM",
            SignInName = "jsmith",
        };

        AssertWire(
            dto,
            """
            {
              "name": "Jane Smith", "agency": "Fulco EM", "role": "EOC Liaison", "email": "jane@example.org",
              "personaHandle": "@FulcoEM", "signInName": "jsmith"
            }
            """);
    }

    [Fact]
    public void RosterImportRowDto_And_RosterImportResultDto_MatchTheFrozenTypes()
    {
        var dto = new RosterImportResultDto
        {
            DryRun = true,
            TotalRows = 2,
            CreatedCount = 1,
            UpdatedCount = 0,
            UnchangedCount = 0,
            FailedCount = 1,
            Rows =
            [
                new RosterImportRowDto
                {
                    RowNumber = 1,
                    Name = "Jane Smith",
                    SignInName = "jsmith",
                    Status = RosterRowStatuses.Created,
                    PersonaHandle = "jane_smith",
                    PersonaCreated = true,
                    Message = "created",
                },
                new RosterImportRowDto
                {
                    RowNumber = 2,
                    Name = "Bad Persona",
                    Status = RosterRowStatuses.Failed,
                    PersonaCreated = false,
                },
            ],
        };

        AssertWire(
            dto,
            """
            {
              "dryRun": true, "totalRows": 2, "createdCount": 1, "updatedCount": 0, "unchangedCount": 0, "failedCount": 1,
              "rows": [
                {
                  "rowNumber": 1, "name": "Jane Smith", "signInName": "jsmith", "status": "created",
                  "personaHandle": "jane_smith", "personaCreated": true, "message": "created"
                },
                { "rowNumber": 2, "name": "Bad Persona", "status": "failed", "personaCreated": false }
              ]
            }
            """);
    }

    [Fact]
    public void RosterActionResultDto_MatchesTheFrozenType()
    {
        var dto = new RosterActionResultDto
        {
            ParticipantId = "a-1",
            Link = new RosterLinkDto { Status = RosterLinkStatuses.Revoked, IssuedAt = Instant, RevokedAt = Instant, UseCount = 4 },
            Access = RosterAccessStates.Enabled,
            SessionsEnded = 2,
        };

        AssertWire(
            dto,
            $$"""
            {
              "participantId": "a-1",
              "link": { "status": "revoked", "issuedAt": "{{Instant}}", "revokedAt": "{{Instant}}", "useCount": 4 },
              "access": "enabled", "sessionsEnded": 2
            }
            """);
    }

    [Fact]
    public void RosterCardsDto_MatchesTheFrozenTypes()
    {
        var dto = new RosterCardsDto
        {
            ExerciseName = "Looking Glass",
            Cards =
            [
                new RosterCardDto
                {
                    ParticipantId = "a-1",
                    Name = "Jane Smith",
                    Agency = "Fulco EM",
                    Role = "EOC Liaison",
                    SignInName = "jsmith",
                    JoinUrl = "https://spa.example/join/tok",
                    QrSvgDataUri = "data:image/svg+xml;base64,PHN2Zz4=",
                },
            ],
            Skipped = [new RosterCardSkipDto { ParticipantId = "a-9", Reason = RosterCardSkipReasons.TokenUnrecoverable }],
        };

        AssertWire(
            dto,
            """
            {
              "exerciseName": "Looking Glass",
              "cards": [
                {
                  "participantId": "a-1", "name": "Jane Smith", "agency": "Fulco EM", "role": "EOC Liaison",
                  "signInName": "jsmith", "joinUrl": "https://spa.example/join/tok",
                  "qrSvgDataUri": "data:image/svg+xml;base64,PHN2Zz4="
                }
              ],
              "skipped": [ { "participantId": "a-9", "reason": "tokenUnrecoverable" } ]
            }
            """);
    }

    [Fact]
    public void DayWordStatusDto_MatchesTheFrozenType()
    {
        var dto = new DayWordStatusDto
        {
            TimeZone = "America/New_York",
            Today = "2026-10-20",
            TodayEndsAt = Instant,
            TodaySet = true,
            SetAt = Instant,
            SetByName = "Pat Controller",
            ReplacedCount = 1,
            Upcoming = [new DayWordUpcomingDto { Date = "2026-10-21", SetAt = Instant }],
        };

        AssertWire(
            dto,
            $$"""
            {
              "timeZone": "America/New_York", "today": "2026-10-20", "todayEndsAt": "{{Instant}}", "todaySet": true,
              "setAt": "{{Instant}}", "setByName": "Pat Controller", "replacedCount": 1,
              "upcoming": [ { "date": "2026-10-21", "setAt": "{{Instant}}" } ]
            }
            """);
    }

    [Fact]
    public void DayWordPutBody_MatchesTheFrozenType()
    {
        AssertWire(
            new DayWordPutBody { Word = "maple-harbor-42", Date = "2026-10-21" },
            """{ "word": "maple-harbor-42", "date": "2026-10-21" }""");
    }

    [Fact]
    public void DayWordSetResultDto_MatchesTheFrozenType()
    {
        var dto = new DayWordSetResultDto
        {
            Date = "2026-10-20",
            Word = "maple-harbor-42",
            Generated = true,
            Replaced = false,
            SetAt = Instant,
            ValidUntil = Instant,
        };

        AssertWire(
            dto,
            $$"""
            {
              "date": "2026-10-20", "word": "maple-harbor-42", "generated": true, "replaced": false,
              "setAt": "{{Instant}}", "validUntil": "{{Instant}}"
            }
            """);
    }

    [Fact]
    public void RosterEmailLinksBody_And_RosterEmailResultDto_MatchTheFrozenTypes()
    {
        AssertWire(new RosterEmailLinksBody { ParticipantIds = ["a-1", "a-2"] }, """{ "participantIds": ["a-1", "a-2"] }""");

        var result = new RosterEmailResultDto
        {
            Results =
            [
                new RosterEmailResultItemDto { ParticipantId = "a-1", Status = RosterEmailStatuses.Sent },
                new RosterEmailResultItemDto { ParticipantId = "a-2", Status = RosterEmailStatuses.Skipped, Reason = "no email" },
            ],
        };

        AssertWire(
            result,
            """
            {
              "results": [
                { "participantId": "a-1", "status": "sent" },
                { "participantId": "a-2", "status": "skipped", "reason": "no email" }
              ]
            }
            """);
    }

    [Fact]
    public void SignInBodies_MatchTheFrozenRouteTable()
    {
        AssertWire(new JoinRequestBody { Token = "tok" }, """{ "token": "tok" }""");
        AssertWire(new WordSignInRequestBody { SignInName = "jsmith", Word = "maple-harbor-42" }, """{ "signInName": "jsmith", "word": "maple-harbor-42" }""");
    }

    [Fact]
    public void LoginEnvelope_IsTheExistingLoginResponse_FieldForField()
    {
        // The frozen LoginEnvelope is "exactly what POST /api/auth/login answers today": the reused DTO, not a fork.
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();
        var expiresAt = new DateTimeOffset(2026, 10, 20, 14, 45, 0, TimeSpan.Zero);
        var dto = ParticipantLoginResponseDto.From(new SessionIssueResult
        {
            Session = new Session
            {
                Id = Guid.NewGuid(),
                TokenHash = "hash",
                Kind = "participant",
                ExerciseId = exerciseId,
                PrincipalId = accountId.ToString(),
                AccountId = accountId,
                Role = "pio",
                PersonaId = personaId,
                ActingHumanId = accountId.ToString(),
                IsReadOnly = false,
                IssuedAt = expiresAt.AddHours(-1),
                ExpiresAt = expiresAt,
            },
            SessionToken = "session-token",
            RefreshToken = "refresh-token",
        });

        AssertWire(
            dto,
            $$"""
            {
              "token": "session-token", "refreshToken": "refresh-token",
              "session": {
                "exerciseId": "{{exerciseId}}", "accountId": "{{accountId}}", "role": "pio", "personaId": "{{personaId}}",
                "actingHumanId": "{{accountId}}", "isReadOnly": false, "expiresAt": "{{expiresAt:O}}"
              }
            }
            """);
    }

    [Fact]
    public void RequestBodies_DeserializeFromTheFrozenJson()
    {
        var row = JsonSerializer.Deserialize<RosterRowWrite>(
            """{ "name": "Jane", "agency": "A", "role": "R", "email": "e@x.org", "personaHandle": "@FulcoEM", "signInName": "jane" }""");
        row.Should().BeEquivalentTo(new RosterRowWrite
        {
            Name = "Jane",
            Agency = "A",
            Role = "R",
            Email = "e@x.org",
            PersonaHandle = "@FulcoEM",
            SignInName = "jane",
        });

        JsonSerializer.Deserialize<DayWordPutBody>("{}")!.Word.Should().BeNull("both day-word fields are optional");
        JsonSerializer.Deserialize<JoinRequestBody>("""{ "token": "tok" }""")!.Token.Should().Be("tok");
        JsonSerializer.Deserialize<JoinRequestBody>("{}")!.Token.Should().BeNull("a missing field is a 400 in the handler, not a deserialization failure");
        JsonSerializer.Deserialize<WordSignInRequestBody>("""{ "signInName": "jsmith", "word": "w" }""")
            .Should().BeEquivalentTo(new WordSignInRequestBody { SignInName = "jsmith", Word = "w" });
        JsonSerializer.Deserialize<RosterEmailLinksBody>("""{ "participantIds": ["a"] }""")!.ParticipantIds
            .Should().Equal("a");
    }

    // ---------------------------------------------------------------- optional members are omitted, never null

    /// <summary>
    /// One case per contract type that has optional members (and the two containers that nest them), each built with
    /// every optional member absent, and the exact key set the frozen TypeScript allows in that state.
    /// </summary>
    public static TheoryData<string, object, string[]> AbsentOptionalMembers() => new()
    {
        {
            nameof(RosterLinkDto),
            new RosterLinkDto { Status = RosterLinkStatuses.None, UseCount = 0 },
            ["status", "useCount"]
        },
        {
            nameof(RosterEntryDto),
            MinimalEntry(),
            ["id", "name", "signInName", "exerciseRole", "link", "access", "liveSessions", "createdAt"]
        },
        {
            nameof(RosterListDto),
            new RosterListDto
            {
                Participants = [MinimalEntry()],
                JoinLinksAvailable = false,
                Capabilities = new RosterCapabilitiesDto { EmailLinks = false },
            },
            ["participants", "joinLinksAvailable", "capabilities"]
        },
        {
            nameof(RosterRowWrite),
            new RosterRowWrite(),
            []
        },
        {
            nameof(RosterImportRowDto),
            new RosterImportRowDto { RowNumber = 1, Name = "n", Status = RosterRowStatuses.Unchanged, PersonaCreated = false },
            ["rowNumber", "name", "status", "personaCreated"]
        },
        {
            nameof(RosterActionResultDto),
            new RosterActionResultDto
            {
                ParticipantId = "a",
                Link = new RosterLinkDto { Status = RosterLinkStatuses.None, UseCount = 0 },
                Access = RosterAccessStates.Disabled,
                SessionsEnded = 0,
            },
            ["participantId", "link", "access", "sessionsEnded"]
        },
        {
            nameof(RosterCardDto),
            new RosterCardDto
            {
                ParticipantId = "a",
                Name = "n",
                SignInName = "s",
                JoinUrl = "https://spa.example/join/t",
                QrSvgDataUri = "data:image/svg+xml;base64,AA==",
            },
            ["participantId", "name", "signInName", "joinUrl", "qrSvgDataUri"]
        },
        {
            nameof(DayWordStatusDto),
            new DayWordStatusDto
            {
                TimeZone = "UTC",
                Today = "2026-10-20",
                TodayEndsAt = Instant,
                TodaySet = false,
                ReplacedCount = 0,
                Upcoming = [],
            },
            ["timeZone", "today", "todayEndsAt", "todaySet", "replacedCount", "upcoming"]
        },
        {
            nameof(DayWordPutBody),
            new DayWordPutBody(),
            []
        },
        {
            nameof(RosterEmailLinksBody),
            new RosterEmailLinksBody(),
            []
        },
        {
            nameof(RosterEmailResultItemDto),
            new RosterEmailResultItemDto { ParticipantId = "a", Status = RosterEmailStatuses.Sent },
            ["participantId", "status"]
        },
        {
            nameof(JoinRequestBody),
            new JoinRequestBody(),
            []
        },
        {
            nameof(WordSignInRequestBody),
            new WordSignInRequestBody(),
            []
        },
    };

    [Theory]
    [MemberData(nameof(AbsentOptionalMembers))]
    public void AbsentOptionalMembers_AreOmitted_NeverSerializedAsNull(string type, object dto, string[] expectedKeys)
    {
        var json = JsonSerializer.Serialize(dto, dto.GetType());

        json.Should().NotContain(
            "null", "{0} must omit an absent optional member rather than write null (the frozen client parsers fail closed on null)",
            type);
        Keys(dto).Should().BeEquivalentTo(
            expectedKeys, "{0} with every optional member absent carries exactly its required keys", type);
    }

    [Fact]
    public void EveryContractProperty_HasAnExplicitCamelCaseJsonName_AndEveryNullableOneIsOmittedWhenNull()
    {
        var contractTypes = typeof(RosterEntryDto).Assembly.GetTypes()
            .Where(t => t.Namespace == typeof(RosterEntryDto).Namespace && t.IsClass && t.IsSealed && !t.IsAbstract)
            .Where(t => t.Name.EndsWith("Dto", StringComparison.Ordinal)
                || t.Name.EndsWith("Body", StringComparison.Ordinal)
                || t.Name == nameof(RosterRowWrite))
            .ToList();

        contractTypes.Should().HaveCount(
            21, "one C# type per frozen TypeScript type (plus the inline item and body shapes), no more, no fewer");

        var nullability = new NullabilityInfoContext();
        foreach (var type in contractTypes)
        {
            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var name = property.GetCustomAttribute<JsonPropertyNameAttribute>();
                name.Should().NotBeNull("{0}.{1} must carry an explicit [JsonPropertyName]", type.Name, property.Name);
                name!.Name.Should().Be(
                    char.ToLowerInvariant(property.Name[0]) + property.Name[1..],
                    "{0}.{1} is camelCase on the wire", type.Name, property.Name);

                if (nullability.Create(property).ReadState == NullabilityState.Nullable)
                {
                    property.GetCustomAttribute<JsonIgnoreAttribute>()?.Condition.Should().Be(
                        JsonIgnoreCondition.WhenWritingNull,
                        "{0}.{1} is optional, so it is omitted when null", type.Name, property.Name);
                    property.GetCustomAttribute<JsonIgnoreAttribute>().Should().NotBeNull(
                        "{0}.{1} is optional and must be [JsonIgnore(WhenWritingNull)]", type.Name, property.Name);
                }
            }
        }
    }

    [Fact]
    public void TheUnionLiterals_AreTheFrozenVocabulary()
    {
        new[] { RosterLinkStatuses.Active, RosterLinkStatuses.Revoked, RosterLinkStatuses.None }
            .Should().Equal("active", "revoked", "none");
        new[] { RosterAccessStates.Enabled, RosterAccessStates.Disabled }.Should().Equal("enabled", "disabled");
        new[] { RosterRowStatuses.Created, RosterRowStatuses.Updated, RosterRowStatuses.Unchanged, RosterRowStatuses.Failed }
            .Should().Equal("created", "updated", "unchanged", "failed");
        new[]
        {
            RosterCardSkipReasons.NotFound, RosterCardSkipReasons.NoActiveLink,
            RosterCardSkipReasons.Disabled, RosterCardSkipReasons.TokenUnrecoverable,
        }.Should().Equal("notFound", "noActiveLink", "disabled", "tokenUnrecoverable");
        new[] { RosterEmailStatuses.Sent, RosterEmailStatuses.Skipped, RosterEmailStatuses.Failed }
            .Should().Equal("sent", "skipped", "failed");
    }

    // ---------------------------------------------------------------- helpers

    private static RosterPersonaDto NewPersona() => new()
    {
        Id = "p-1",
        Handle = "FulcoEM",
        DisplayName = "Fulco EM",
        Kind = "org",
        AutoCreated = false,
    };

    private static RosterLinkDto NewLink() => new()
    {
        Status = RosterLinkStatuses.Active,
        IssuedAt = Instant,
        RevokedAt = Instant,
        LastUsedAt = Instant,
        UseCount = 3,
        JoinUrl = "https://spa.example/join/tok",
        NeedsReissue = true,
    };

    private static RosterEntryDto NewEntry() => new()
    {
        Id = "a-1",
        Name = "Jane Smith",
        Agency = "Fulco EM",
        Role = "EOC Liaison",
        Email = "jane@example.org",
        SignInName = "jsmith",
        ExerciseRole = "pio",
        Persona = NewPersona(),
        Link = NewLink(),
        Access = RosterAccessStates.Enabled,
        LiveSessions = 2,
        LastSignInAt = Instant,
        CreatedAt = Instant,
    };

    private static RosterEntryDto MinimalEntry() => new()
    {
        Id = "a-2",
        Name = "Ng",
        SignInName = "ng1",
        ExerciseRole = "participant",
        Link = new RosterLinkDto { Status = RosterLinkStatuses.None, UseCount = 0 },
        Access = RosterAccessStates.Disabled,
        LiveSessions = 0,
        CreatedAt = Instant,
    };

    private static IEnumerable<string> Keys(object dto) =>
        JsonNode.Parse(JsonSerializer.Serialize(dto, dto.GetType()))!.AsObject().Select(p => p.Key).ToList();

    /// <summary>
    /// Serialises with DEFAULT options and compares to the transcribed TypeScript shape, canonicalised (object keys
    /// sorted) so the failure message shows exactly which key or value differs.
    /// </summary>
    private static void AssertWire(object dto, string expectedJson)
    {
        var actual = Canonical(JsonNode.Parse(JsonSerializer.Serialize(dto, dto.GetType())));
        var expected = Canonical(JsonNode.Parse(expectedJson));

        actual.Should().Be(expected, "{0} must match the frozen TypeScript field for field", dto.GetType().Name);
    }

    private static string Canonical(JsonNode? node) => node switch
    {
        null => "null",
        JsonObject obj => "{" + string.Join(
            ",",
            obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => JsonSerializer.Serialize(p.Key) + ":" + Canonical(p.Value))) + "}",
        JsonArray array => "[" + string.Join(",", array.Select(Canonical)) + "]",
        _ => node.ToJsonString(),
    };
}
