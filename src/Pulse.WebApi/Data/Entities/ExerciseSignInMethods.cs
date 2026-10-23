namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The participant sign-in methods an exercise may allow (ADMIN-IDENTITY-MODEL §3.4), as a bit set stored in the
/// <c>int</c> column <c>Exercises.SignInMethods</c>. The view-only code (<see cref="SharedCredential"/>) is a separate
/// switch and is deliberately NOT one of these bits.
/// </summary>
/// <remarks>
/// <b>The stored values are a contract with the database</b>: the column defaults to <see cref="All"/> (7) and
/// <c>CK_Exercises_SignInMethods</c> refuses any bit outside <see cref="All"/>. Never renumber a member.
/// </remarks>
[Flags]
public enum ExerciseSignInMethods
{
    /// <summary>No participant sign-in method (a readiness failure while participant accounts exist; story 22).</summary>
    None = 0,

    /// <summary>The personal sign-in link (easy-login 03).</summary>
    PersonalLink = 1,

    /// <summary>The word for the day (easy-login 05).</summary>
    DayWord = 2,

    /// <summary>The participant password (<c>POST /api/auth/login</c>).</summary>
    Password = 4,

    /// <summary>Every method — the default, and the value every pre-A2 exercise is backfilled to.</summary>
    All = PersonalLink | DayWord | Password,
}
