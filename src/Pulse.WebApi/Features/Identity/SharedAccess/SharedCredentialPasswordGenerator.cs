namespace Pulse.WebApi.Features.Identity.SharedAccess;

using System.Security.Cryptography;
using System.Text;

/// <summary>
/// Generates the fresh shared, view-only password a rotation sets (story 07, COR-016 / NFR-009). A shared
/// password is READ ALOUD to / put on a slide for a room of passive participants, so it must be strong enough to
/// resist the (rate-limited, lockout-guarded) internet-facing login yet transcribable without error. This
/// produces a cryptographically-random passphrase from an UNAMBIGUOUS alphabet (no <c>0/O/1/l/I</c>) in
/// hyphen-separated groups. Selection uses <see cref="RandomNumberGenerator.GetInt32(int)"/> so the draw is
/// unbiased and cryptographically secure. The generated plaintext is returned to staff exactly ONCE and is only
/// ever persisted hashed (never logged, never stored in the clear).
/// </summary>
public static class SharedCredentialPasswordGenerator
{
    // Unambiguous alphabet for spoken/printed transcription: lowercase letters and digits with the visually
    // confusable characters (0, o, 1, l, i) removed. 31 symbols → ~4.95 bits/char.
    private const string Alphabet = "abcdefghjkmnpqrstuvwxyz23456789";

    // 4 groups of 4 = 16 random characters ≈ 79 bits of entropy — far beyond anything the rate-limited,
    // lockout-guarded shared login could be brute-forced through, while staying short enough to read to a room.
    private const int GroupCount = 4;
    private const int GroupLength = 4;

    /// <summary>
    /// Produces a new random shared password (e.g. <c>abcd-efgh-jkmn-pqrs</c>). Cryptographically secure and
    /// unbiased; the caller hashes it before persisting and returns the plaintext to staff exactly once.
    /// </summary>
    /// <returns>A fresh, human-transcribable shared password.</returns>
    public static string Generate()
    {
        var builder = new StringBuilder((GroupLength + 1) * GroupCount);

        for (var group = 0; group < GroupCount; group++)
        {
            if (group > 0)
            {
                builder.Append('-');
            }

            for (var index = 0; index < GroupLength; index++)
            {
                builder.Append(Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)]);
            }
        }

        return builder.ToString();
    }
}
