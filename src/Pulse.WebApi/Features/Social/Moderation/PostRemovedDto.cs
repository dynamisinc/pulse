namespace Pulse.WebApi.Features.Social.Moderation;

using System.Text.Json.Serialization;

/// <summary>
/// The wire payload of the SignalR <c>PostRemoved</c> event (demo-polish implementation.md §1.5.3/§1.5.5):
/// <c>{ "postId": "&lt;guid&gt;" }</c>. Sent to the exercise-wide group when a controller takes a post down, so
/// every participant feed drops it live.
/// </summary>
/// <remarks>
/// The post id is the ONLY member, on purpose (XC-002). The event must not carry the post's text, author, the
/// takedown category (which goes only in the console's <c>steering_action</c> telemetry, DP-9), who took it
/// down, or any wall-clock instant.
/// </remarks>
/// <param name="PostId">The taken-down post's id, as a GUID string (the same form <c>ParticipantPostDto.Id</c> uses).</param>
public sealed record PostRemovedDto([property: JsonPropertyName("postId")] string PostId)
{
    /// <summary>Builds the payload for a taken-down post.</summary>
    /// <param name="postId">The taken-down post's id.</param>
    /// <returns>The <c>PostRemoved</c> payload.</returns>
    public static PostRemovedDto For(Guid postId) => new(postId.ToString());
}
