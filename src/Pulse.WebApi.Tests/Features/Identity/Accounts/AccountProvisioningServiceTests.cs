namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Integration tests for <see cref="AccountProvisioningService"/> (story 02, COR-011 / NFR-004) against REAL SQL
/// Server (Testcontainers, <see cref="MsSqlContainerFixture"/>). The staff-caller identity seam is exercised
/// through the <see cref="StubCurrentStaffSessionAccessor"/> double. Proves individual create + bulk CSV import
/// stamp the caller's active exercise, dedupe within it, sanitize free text, hash credentials, reject staff
/// roles, and fail closed for an unauthenticated caller.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class AccountProvisioningServiceTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly ParticipantPasswordHasher _hasher = new();

    public AccountProvisioningServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static CurrentStaffSession AuthenticatedStaff() =>
        new() { SessionId = Guid.NewGuid(), StaffUserId = Guid.NewGuid() };

    private AccountProvisioningService ServiceFor(PulseDbContext context, Guid? scope, CurrentStaffSession? staffSession) =>
        new(context, new ExerciseContext { CurrentExerciseId = scope }, new StubCurrentStaffSessionAccessor(staffSession), _hasher);

    private async Task<Exercise> SeedExerciseAsync()
    {
        var exercise = new Exercise { Id = Guid.NewGuid(), Name = $"Exercise {Guid.NewGuid():N}", TimeZone = "UTC", Status = "active" };
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise;
    }

    private async Task SeedAccountAsync(Guid exerciseId, string username)
    {
        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Username = username,
            DisplayName = username,
            Role = "participant",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    // ----- individual create -----

    [RequiresDockerFact]
    public async Task Create_Success_StampsScope_HashesCredential_NormalizesRole()
    {
        var exercise = await SeedExerciseAsync();

        CreateAccountResult result;
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = ServiceFor(context, exercise.Id, AuthenticatedStaff());
            result = await service.CreateAsync(new CreateAccountRequest
            {
                Username = "mayor",
                DisplayName = "Mayor Vance",
                Role = "PIO",
                Password = "pw-mayor-123",
            });
        }

        result.Outcome.Should().Be(CreateAccountOutcome.Created);
        result.Account!.Role.Should().Be("pio", "the role is stored as the canonical frozen token");
        result.Account.HasCredential.Should().BeTrue();

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var stored = await verify.Accounts.SingleAsync(a => a.Username == "mayor");
        stored.ExerciseId.Should().Be(exercise.Id, "the account is stamped with the caller's active exercise, never a client id");
        stored.DisplayName.Should().Be("Mayor Vance");
        stored.CredentialHash.Should().NotBeNullOrEmpty();
        _hasher.Verify(stored.CredentialHash, "pw-mayor-123").Should().BeTrue("the stored credential is a verifiable slow-KDF hash of the supplied password");
        stored.CredentialHash.Should().NotContain("pw-mayor-123", "the plaintext is never stored");
    }

    [RequiresDockerFact]
    public async Task Create_NoStaffSession_FailsClosed_Unauthenticated_NoWrite()
    {
        var exercise = await SeedExerciseAsync();

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, staffSession: null);

        var result = await service.CreateAsync(new CreateAccountRequest { Username = "x", DisplayName = "X", Role = "participant" });

        result.Outcome.Should().Be(CreateAccountOutcome.Unauthenticated, "account creation is staff-only and fails closed with no staff session");

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        (await verify.Accounts.AnyAsync(a => a.Username == "x")).Should().BeFalse("an unauthenticated request must write nothing");
    }

    [RequiresDockerFact]
    public async Task Create_NoActiveExercise_FailsClosed()
    {
        await using var context = _fixture.CreateContext(new ExerciseContext());
        var service = ServiceFor(context, scope: null, AuthenticatedStaff());

        var result = await service.CreateAsync(new CreateAccountRequest { Username = "x", DisplayName = "X", Role = "participant" });

        result.Outcome.Should().Be(CreateAccountOutcome.NoActiveExercise, "with no active exercise resolved, a staff write fails closed");
    }

    [RequiresDockerFact]
    public async Task Create_DuplicateHandle_ReturnsConflict()
    {
        var exercise = await SeedExerciseAsync();
        await SeedAccountAsync(exercise.Id, "alice");

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, AuthenticatedStaff());

        var result = await service.CreateAsync(new CreateAccountRequest { Username = "alice", DisplayName = "Another Alice", Role = "participant" });

        result.Outcome.Should().Be(CreateAccountOutcome.Duplicate, "a handle already used in this exercise is a 409 conflict");
    }

    [RequiresDockerFact]
    public async Task Create_StaffRole_IsRejectedAsInvalid()
    {
        var exercise = await SeedExerciseAsync();

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, AuthenticatedStaff());

        var result = await service.CreateAsync(new CreateAccountRequest { Username = "ctrl", DisplayName = "Controller", Role = "controller" });

        result.Outcome.Should().Be(CreateAccountOutcome.Invalid,
            "a participant Account may not carry a staff role — that would let a participant-kind session claim a staff surface (XC-002)");
    }

    [RequiresDockerFact]
    public async Task Create_SanitizesDisplayNameOnIngest()
    {
        var exercise = await SeedExerciseAsync();

        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = ServiceFor(context, exercise.Id, AuthenticatedStaff());
            await service.CreateAsync(new CreateAccountRequest
            {
                Username = "evil",
                DisplayName = "<script>alert('xss')</script>Real Name",
                Role = "participant",
            });
        }

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var stored = await verify.Accounts.SingleAsync(a => a.Username == "evil");
        stored.DisplayName.Should().Be("Real Name", "a stored display name is stripped of markup on ingest so it can never execute (COR-007)");
        stored.DisplayName.Should().NotContain("<script>");
    }

    // ----- bulk CSV import -----

    [RequiresDockerFact]
    public async Task Import_ValidCsv_CreatesAllRows_InActiveExercise()
    {
        var exercise = await SeedExerciseAsync();
        const string csv = "username,displayName,role,password\nalice,Alice A,participant,pw-alice-1\nbob,Bob B,pio,pw-bob-1";

        ImportAccountsResult result;
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = ServiceFor(context, exercise.Id, AuthenticatedStaff());
            result = await service.ImportAsync(csv);
        }

        result.Outcome.Should().Be(ImportAccountsOutcome.Ok);
        result.Summary!.TotalRows.Should().Be(2);
        result.Summary.CreatedCount.Should().Be(2);
        result.Summary.FailedCount.Should().Be(0);
        result.Summary.Rows.Should().OnlyContain(r => r.Status == "created");

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var stored = await verify.Accounts.Where(a => a.ExerciseId == exercise.Id).ToListAsync();
        stored.Should().HaveCount(2);
        stored.Should().Contain(a => a.Username == "alice" && a.Role == "participant");
        stored.Should().Contain(a => a.Username == "bob" && a.Role == "pio");
    }

    [RequiresDockerFact]
    public async Task Import_PartialSuccess_ReportsPerRowReasons_CreatesOnlyValidRows()
    {
        var exercise = await SeedExerciseAsync();
        await SeedAccountAsync(exercise.Id, "existing"); // Pre-existing → a CSV row for it must fail as a duplicate.

        // Row 1 valid; row 2 duplicates an EXISTING account; row 3 duplicates row 1 within the file;
        // row 4 has a staff role (invalid); row 5 valid.
        const string csv =
            "username,displayName,role\n" +
            "carol,Carol C,participant\n" +
            "existing,Dup Existing,participant\n" +
            "carol,Dup In File,pio\n" +
            "steve,Staff Steve,controller\n" +
            "dave,Dave D,pio";

        ImportAccountsResult result;
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = ServiceFor(context, exercise.Id, AuthenticatedStaff());
            result = await service.ImportAsync(csv);
        }

        result.Outcome.Should().Be(ImportAccountsOutcome.Ok);
        result.Summary!.TotalRows.Should().Be(5);
        result.Summary.CreatedCount.Should().Be(2, "only carol (row 1) and dave (row 5) are valid, unique new handles");
        result.Summary.FailedCount.Should().Be(3);

        var rows = result.Summary.Rows;
        rows.Single(r => r.RowNumber == 1).Status.Should().Be("created");
        rows.Single(r => r.RowNumber == 2).Status.Should().Be("failed", "row 2 duplicates an existing account");
        rows.Single(r => r.RowNumber == 3).Status.Should().Be("failed", "row 3 duplicates a handle earlier in the same file");
        rows.Single(r => r.RowNumber == 4).Status.Should().Be("failed", "row 4 uses a rejected staff role");
        rows.Single(r => r.RowNumber == 5).Status.Should().Be("created");

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        (await verify.Accounts.CountAsync(a => a.ExerciseId == exercise.Id)).Should().Be(3,
            "the pre-existing account plus the two created rows — the failed rows persisted nothing");
    }

    [RequiresDockerFact]
    public async Task Import_MalformedCsv_FailsClosed()
    {
        var exercise = await SeedExerciseAsync();

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, AuthenticatedStaff());

        var result = await service.ImportAsync("this,is,not,the,right,header\nx,y,z");

        result.Outcome.Should().Be(ImportAccountsOutcome.Malformed, "a CSV missing the required header columns is a 400");
    }

    [RequiresDockerFact]
    public async Task Import_NoStaffSession_FailsClosed_Unauthenticated_NoWrite()
    {
        var exercise = await SeedExerciseAsync();

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, staffSession: null);

        var result = await service.ImportAsync("username,displayName,role\nalice,Alice,participant");

        result.Outcome.Should().Be(ImportAccountsOutcome.Unauthenticated, "import is staff-only and fails closed with no staff session");

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        (await verify.Accounts.AnyAsync(a => a.ExerciseId == exercise.Id)).Should().BeFalse("an unauthenticated import must write nothing");
    }

    [RequiresDockerFact]
    public async Task Import_SanitizesDisplayName_StoredScriptNeverPersistsAsMarkup()
    {
        var exercise = await SeedExerciseAsync();
        const string csv = "username,displayName,role\nevil,\"<script>alert(1)</script>Mayor\",participant";

        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = ServiceFor(context, exercise.Id, AuthenticatedStaff());
            (await service.ImportAsync(csv)).Summary!.CreatedCount.Should().Be(1);
        }

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var stored = await verify.Accounts.SingleAsync(a => a.Username == "evil");
        stored.DisplayName.Should().Be("Mayor", "an imported display name is stripped of markup, so a stored script can never execute (COR-007)");
        stored.DisplayName.Should().NotContain("<script>");
    }
}
