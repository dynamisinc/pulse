namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Helpers;
using static Pulse.WebApi.Tests.Features.Identity.DayWord.DayWordTestSupport;

/// <summary>
/// easy-login/05 over HTTP (AC1 to AC4; Authorization, Content security and abuse) — the three staff routes and
/// <c>POST /api/auth/word</c>. Plain <c>[Fact]</c>s run a self-hosted pipeline with a never-connecting database and
/// cover every path that returns before SQL: 401 with no staff session (with <c>no-store</c>), 400s, the bodyless 401
/// on an unresolved host, the <c>easy-login-word</c> limiter (default 10 a minute and config-driven), the route metadata
/// (anonymous, 16 KiB body bound, limiter policy) and the DI composition on the REAL <c>Program</c> host. The
/// <c>[RequiresDockerFact]</c>s drive the real pipeline (host resolution, session authentication, default-deny
/// authorization, limiter) with real session tokens: 200 / 204 / 400 / 401 / 403, <c>no-store</c> on every staff
/// response, and the sign-in envelope.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class DayWordEndpointsHttpTests
{
    private const string StaffRoute = "/api/staff/day-word";
    private const string WordRoute = "/api/auth/word";

    private readonly MsSqlContainerFixture _fixture;

    public DayWordEndpointsHttpTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    // =================================================================== no database

    [Theory]
    [InlineData("GET")]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    public async Task StaffRoutes_WithNoStaffSession_Are401_AndNoStore(string method)
    {
        using var host = await StartLightHostAsync();
        using var client = host.GetTestClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), StaffRoute);
        if (method == "PUT")
        {
            request.Content = JsonContent.Create(new { word = "Maple Harbor 42" });
        }

        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "EL-13: no staff session is a 401, before any database access");
        (response.Headers.CacheControl?.NoStore).Should().BeTrue("every staff day-word response, refusals included, is no-store");
    }

    [Fact]
    public async Task WordSignIn_NullBody_Is400ProblemDetails()
    {
        using var host = await StartLightHostAsync();
        using var client = host.GetTestClient();

        using var response = await client.PostAsync(WordRoute, new StringContent("null", Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadDetailAsync(response)).Should().Be("A JSON body with signInName and word is required.");
        (response.Headers.CacheControl?.NoStore).Should().BeTrue("every word sign-in answer is no-store (Gate-2 S-3)");
    }

    [Theory]
    [InlineData("{\"word\":\"Maple Harbor 42\"}", WordLoginService.SignInNameRequiredError)]
    [InlineData("{\"signInName\":\"jsmith\"}", WordLoginService.WordRequiredError)]
    [InlineData("{\"signInName\":\"jsmith\",\"word\":\"\"}", WordLoginService.WordRequiredError)]
    [InlineData("{\"signInName\":\"\",\"word\":\"Maple Harbor 42\"}", WordLoginService.SignInNameRequiredError)]
    public async Task WordSignIn_AMissingField_Is400ProblemDetails(string json, string detail)
    {
        using var host = await StartLightHostAsync();
        using var client = host.GetTestClient();

        using var response = await client.PostAsync(WordRoute, new StringContent(json, Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        (await ReadDetailAsync(response)).Should().Be(detail);
    }

    [Fact]
    public async Task WordSignIn_AnOversizedField_Is400_AndNeverEchoesIt()
    {
        using var host = await StartLightHostAsync();
        using var client = host.GetTestClient();
        var longWord = "secretword" + new string('x', DayWordNormalizer.MaxRawLength);

        using var byWord = await client.PostAsJsonAsync(WordRoute, new { signInName = "jsmith", word = longWord });
        using var byName = await client.PostAsJsonAsync(
            WordRoute, new { signInName = new string('n', WordLoginService.MaxRawSignInNameLength + 1), word = "Maple Harbor 42" });

        byWord.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await byWord.Content.ReadAsStringAsync();
        body.Should().NotContain("secretword", "an error body never carries the word");
        (await ReadDetailAsync(byWord)).Should().Be(WordLoginService.WordTooLongError);
        byName.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadDetailAsync(byName)).Should().Be(WordLoginService.SignInNameTooLongError);
    }

    [Fact]
    public async Task WordSignIn_OnAnUnresolvedHost_IsTheBodyless401()
    {
        using var host = await StartLightHostAsync();
        using var client = host.GetTestClient();

        using var response = await client.PostAsJsonAsync(WordRoute, new { signInName = "jsmith", word = "Maple Harbor 42" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await response.Content.ReadAsByteArrayAsync()).Should().BeEmpty("the refusal is bodyless: it says nothing about which half was wrong");
        (response.Headers.CacheControl?.NoStore).Should().BeTrue("every word sign-in answer is no-store, refusals included (Gate-2 S-3)");
    }

    [Fact]
    public async Task WordSignIn_IsRateLimitedPerIp_TenAMinuteByDefault()
    {
        using var host = await StartLightHostAsync();
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            using var allowed = await client.PostAsync(WordRoute, new StringContent("null", Encoding.UTF8, "application/json"));
            allowed.StatusCode.Should().Be(HttpStatusCode.BadRequest, "attempt {0} is inside the default 10-a-minute window", attempt);
        }

        using var eleventh = await client.PostAsync(WordRoute, new StringContent("null", Encoding.UTF8, "application/json"));
        eleventh.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "EL-16: the easy-login-word policy refuses the 11th attempt");
    }

    [Fact]
    public async Task WordSignIn_RateLimit_ComesFromEasyLoginOptions()
    {
        using var host = await StartLightHostAsync(new Dictionary<string, string?>
        {
            ["Authentication:EasyLogin:WordPermitPerMinute"] = "3",
        });
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 3; attempt++)
        {
            using var allowed = await client.PostAsync(WordRoute, new StringContent("null", Encoding.UTF8, "application/json"));
            allowed.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using var fourth = await client.PostAsync(WordRoute, new StringContent("null", Encoding.UTF8, "application/json"));
        fourth.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "operators size the bucket with Authentication:EasyLogin:WordPermitPerMinute");
    }

    [Fact]
    public async Task TheRoutes_AreMappedOnce_WithTheirMetadata()
    {
        using var host = await StartLightHostAsync();
        var endpoints = host.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();

        var keys = endpoints.SelectMany(PreAuthAllowlist.KeysFor).ToList();
        keys.Should().BeEquivalentTo(
            ["GET /api/staff/day-word", "PUT /api/staff/day-word", "DELETE /api/staff/day-word", "POST /api/auth/word"]);

        var word = endpoints.Single(e => e.RoutePattern.RawText == WordRoute);
        word.Metadata.GetMetadata<IAllowAnonymous>().Should().NotBeNull("the sign-in route is pre-auth (.AllowAnonymousPreAuth())");
        word.Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize.Should().Be(
            LoginRequestLimits.MaxLoginRequestBodyBytes, "an anonymous sign-in carries the 16 KiB login body bound");
        word.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName.Should().Be(DayWordEndpoints.WordSignInRateLimitPolicy);
        DayWordEndpoints.WordSignInRateLimitPolicy.Should().Be("easy-login-word");

        foreach (var staff in endpoints.Where(e => e.RoutePattern.RawText == StaffRoute))
        {
            staff.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull("the staff routes stay behind the default-deny gate");
        }
    }

    [Fact]
    public void AddDayWord_SharesTheHasherWithTheViewOnlyCredential_AndIsIdempotent()
    {
        var once = new ServiceCollection();
        once.AddSharedReadOnly();
        once.AddDayWord();

        var services = new ServiceCollection();
        services.AddSharedReadOnly();
        services.AddDayWord();
        services.AddDayWord();

        services.Count(d => d.ServiceType == typeof(ISharedCredentialHasher)).Should().Be(1, "TryAdd: one hasher across slices");
        services.Count(d => d.ServiceType == typeof(TimeProvider)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(ExerciseFactsReader)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(WordLoginService)).Should().Be(1);
        services.Count.Should().Be(once.Count, "Gate-2 CR-001: a repeat call registers nothing more");

        // Gate-2 CR-001: counting descriptors cannot see a duplicate rate-limit policy, which only throws when the
        // options are BUILT (at host start). Build them: the easy-login-word policy must be added exactly once.
        using var provider = services.BuildServiceProvider();
        var build = () => provider.GetRequiredService<IOptions<RateLimiterOptions>>().Value;
        build.Should().NotThrow("a second AddDayWord() must not add the easy-login-word policy again");
    }

    [Fact]
    public async Task AddDayWord_ComposesIntoTheRealProgramHost()
    {
        // Program.cs wires AddEasyLoginFoundation() + AddDayWord() (the backend seam commit), so this host adds nothing:
        // it proves the slice's whole dependency graph resolves on the REAL host (a missing registration cannot hide
        // behind a hand-built container). Re-registering here is what threw once Program.cs wired them (Gate-2 CR-001);
        // a repeat call is now a no-op, pinned above.
        await using var factory = new DummyDatabaseFactory();

        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<DayWordService>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<WordLoginService>().Should().NotBeNull();
        await Task.CompletedTask;
    }

    // =================================================================== real pipeline, real SQL

    [RequiresDockerFact]
    public async Task AController_GetsPutsAndDeletes_AndEveryResponseIsNoStore()
    {
        var (exercise, staffUserId, token) = await SeedStaffAsync("controller");
        await using var host = await DayWordHttpTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = host.CreateClient("staff.example.test", token);

        using var put = await client.PutAsJsonAsync(StaffRoute, new { word = "Maple Harbor 42" });
        put.StatusCode.Should().Be(HttpStatusCode.OK);
        (put.Headers.CacheControl?.NoStore).Should().BeTrue();
        var set = JsonDocument.Parse(await put.Content.ReadAsStringAsync()).RootElement;
        set.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["date", "word", "generated", "replaced", "setAt", "validUntil"]);
        set.GetProperty("word").GetString().Should().Be("Maple Harbor 42");
        set.GetProperty("date").GetString().Should().Be("2026-10-13");

        using var get = await client.GetAsync(StaffRoute);
        get.StatusCode.Should().Be(HttpStatusCode.OK);
        (get.Headers.CacheControl?.NoStore).Should().BeTrue();
        var statusJson = await get.Content.ReadAsStringAsync();
        var status = JsonDocument.Parse(statusJson).RootElement;
        status.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["timeZone", "today", "todayEndsAt", "todaySet", "setAt", "setByName", "replacedCount", "upcoming"]);
        status.GetProperty("setByName").GetString().Should().Be(StaffDisplayName);
        statusJson.Should().NotContainEquivalentOf("maple", "no later call can read the word");

        using var delete = await client.DeleteAsync(StaffRoute);
        delete.StatusCode.Should().Be(HttpStatusCode.NoContent);
        (delete.Headers.CacheControl?.NoStore).Should().BeTrue();

        using var again = await client.DeleteAsync(StaffRoute + "?date=2026-10-13");
        again.StatusCode.Should().Be(HttpStatusCode.NoContent, "idempotent");

        using var cleared = await client.GetAsync(StaffRoute);
        var clearedStatus = JsonDocument.Parse(await cleared.Content.ReadAsStringAsync()).RootElement;
        clearedStatus.GetProperty("todaySet").GetBoolean().Should().BeFalse();
        clearedStatus.TryGetProperty("setAt", out _).Should().BeFalse("an absent optional field is omitted, never null");
        clearedStatus.TryGetProperty("setByName", out _).Should().BeFalse();
        _ = exercise;
        _ = staffUserId;
    }

    [RequiresDockerFact]
    public async Task ABadDate_Is400ProblemDetails_WithAReadableDetail()
    {
        var (_, _, token) = await SeedStaffAsync("planner");
        await using var host = await DayWordHttpTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = host.CreateClient("staff.example.test", token);

        using var put = await client.PutAsJsonAsync(StaffRoute, new { word = "Maple Harbor 42", date = "2026-10-12" });
        using var delete = await client.DeleteAsync(StaffRoute + "?date=13-10-2026");

        put.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        put.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        (await ReadDetailAsync(put)).Should().Be(DayWordService.PastDateError);
        (await put.Content.ReadAsStringAsync()).Should().NotContainEquivalentOf("maple");
        (put.Headers.CacheControl?.NoStore).Should().BeTrue();
        delete.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ReadDetailAsync(delete)).Should().Be(DayWordService.DateFormatError);
    }

    [RequiresDockerFact]
    public async Task AnEvaluator_Is403_AndNoStore()
    {
        var (_, _, token) = await SeedStaffAsync("evaluator");
        await using var host = await DayWordHttpTestHost.StartAsync(_fixture.ConnectionString!);
        using var client = host.CreateClient("staff.example.test", token);

        using var get = await client.GetAsync(StaffRoute);
        using var put = await client.PutAsJsonAsync(StaffRoute, new { });

        get.StatusCode.Should().Be(HttpStatusCode.Forbidden, "EL-13: evaluators observe; they do not hand out credentials");
        (get.Headers.CacheControl?.NoStore).Should().BeTrue();
        put.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task AParticipantOrReadOnlySession_OrAnAnonymousCaller_NeverReachesTheStaffRoutes()
    {
        var exercise = await SeedExerciseAsync(_fixture, hostname: HostFor());
        var participantToken = $"participant-{Guid.NewGuid():N}";
        var readOnlyToken = $"readonly-{Guid.NewGuid():N}";
        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(TestSessions.NewSession(participantToken, exercise.Id));
            seed.Sessions.Add(TestSessions.NewSession(readOnlyToken, exercise.Id, kind: "readonly", isReadOnly: true));
            await seed.SaveChangesAsync();
        }

        await using var host = await DayWordHttpTestHost.StartAsync(_fixture.ConnectionString!);
        using var participant = host.CreateClient(exercise.Hostname!, participantToken);
        using var readOnly = host.CreateClient(exercise.Hostname!, readOnlyToken);
        using var anonymous = host.CreateClient(exercise.Hostname!);

        using var asParticipant = await participant.PutAsJsonAsync(StaffRoute, new { word = "Maple Harbor 42" });
        using var readOnlyGet = await readOnly.GetAsync(StaffRoute);
        using var readOnlyPut = await readOnly.PutAsJsonAsync(StaffRoute, new { word = "Maple Harbor 42" });
        using var readOnlyDelete = await readOnly.DeleteAsync(StaffRoute);
        using var asAnonymous = await anonymous.GetAsync(StaffRoute);

        asParticipant.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a participant session is not a staff session");
        readOnlyGet.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a shared view-only session is not a staff session");
        readOnlyPut.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        readOnlyDelete.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (readOnlyGet.Headers.CacheControl?.NoStore).Should().BeTrue();
        asAnonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "the default-deny gate refuses an anonymous staff call");
        (await ReadWordsAsync(_fixture, exercise.Id)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task WordSignIn_EndToEnd_AnswersTheLoginEnvelope_AndARotationTakesEffectOnTheNextAttempt()
    {
        var (exercise, _, token) = await SeedStaffAsync("controller", HostFor());
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith", role: "pio", personaId: Guid.NewGuid());
        await using var host = await DayWordHttpTestHost.StartAsync(_fixture.ConnectionString!);
        using var staff = host.CreateClient("staff.example.test", token);
        using var anonymous = host.CreateClient(exercise.Hostname!);

        using var first = await staff.PutAsJsonAsync(StaffRoute, new { });
        var firstWord = JsonDocument.Parse(await first.Content.ReadAsStringAsync()).RootElement.GetProperty("word").GetString()!;

        using var signIn = await anonymous.PostAsJsonAsync(WordRoute, new { signInName = "JSmith", word = firstWord.ToUpperInvariant() });
        signIn.StatusCode.Should().Be(HttpStatusCode.OK);
        (signIn.Headers.CacheControl?.NoStore).Should().BeTrue(
            "Gate-2 S-3: the 200 carries the session and refresh tokens, so no cache may keep it (as for /api/auth/join)");
        var envelope = JsonDocument.Parse(await signIn.Content.ReadAsStringAsync()).RootElement;
        envelope.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["token", "refreshToken", "session"]);
        var session = envelope.GetProperty("session");
        session.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["exerciseId", "accountId", "role", "personaId", "actingHumanId", "isReadOnly", "expiresAt"],
            "exactly the /api/auth/login envelope (ParticipantLoginResponseDto)");
        session.GetProperty("exerciseId").GetString().Should().Be(exercise.Id.ToString());
        session.GetProperty("accountId").GetString().Should().Be(account.Id.ToString());
        session.GetProperty("role").GetString().Should().Be("pio");
        session.GetProperty("isReadOnly").GetBoolean().Should().BeFalse();

        // Rotation: the old word stops on the very next attempt; the new one works.
        using var rotate = await staff.PutAsJsonAsync(StaffRoute, new { word = "Brand New Word 7" });
        rotate.StatusCode.Should().Be(HttpStatusCode.OK);

        using var oldWord = await anonymous.PostAsJsonAsync(WordRoute, new { signInName = "jsmith", word = firstWord });
        using var newWord = await anonymous.PostAsJsonAsync(WordRoute, new { signInName = "jsmith", word = "brand-new-word-7" });

        oldWord.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await oldWord.Content.ReadAsByteArrayAsync()).Should().BeEmpty();
        (oldWord.Headers.CacheControl?.NoStore).Should().BeTrue("the refusal is no-store too");
        newWord.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // =================================================================== helpers

    private static string HostFor() => $"dw{Guid.NewGuid():N}.example.test";

    private async Task<(Pulse.WebApi.Data.Entities.Exercise Exercise, Guid StaffUserId, string Token)> SeedStaffAsync(string role, string? hostname = null)
    {
        var exercise = await SeedExerciseAsync(_fixture, hostname: hostname);
        var staffUserId = await DayWordTestSupport.SeedStaffAsync(_fixture, exercise.Id, role);
        var token = $"staff-{Guid.NewGuid():N}";

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(DayWordHttpTestHost.StaffSession(token, exercise.Id, staffUserId, role));
        await seed.SaveChangesAsync();
        return (exercise, staffUserId, token);
    }

    private static async Task<string?> ReadDetailAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        return JsonDocument.Parse(body).RootElement.TryGetProperty("detail", out var detail) ? detail.GetString() : null;
    }

    /// <summary>The slice on a never-connecting database: only paths that return before SQL are asserted against it.</summary>
    private static async Task<IHost> StartLightHostAsync(IDictionary<string, string?>? settings = null)
    {
        return await new HostBuilder()
            .ConfigureAppConfiguration(configuration => configuration.AddInMemoryCollection(settings ?? new Dictionary<string, string?>()))
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddRouting();
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;"));
                    services.AddScoped<IExerciseContext, ExerciseContext>();
                    services.AddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();
                    services.AddScoped<StaffAssignmentService>();
                    services.AddScoped<ISessionIssuer, RecordingSessionIssuer>();
                    services.AddExerciseClock();
                    services.AddEasyLoginFoundation();
                    services.AddDayWord();
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseRateLimiter();
                    app.UseEndpoints(endpoints => endpoints.MapDayWordEndpoints());
                });
            })
            .StartAsync();
    }

    /// <summary>The real host on a never-connecting database, for DI composition only.</summary>
    private sealed class DummyDatabaseFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public DummyDatabaseFactory() =>
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;");

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
