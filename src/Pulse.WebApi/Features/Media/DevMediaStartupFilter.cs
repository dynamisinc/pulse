namespace Pulse.WebApi.Features.Media;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Pulse.WebApi.Features.Media.Documents;

/// <summary>
/// The DEVELOPMENT-ONLY <c>GET /dev-media/*</c> static mapping that serves <see cref="LocalFileMediaStore"/>'s files
/// (with HTTP range support, so a video can seek — 206). Installed by <see cref="MediaEndpoints.AddMedia"/> as an
/// <see cref="IStartupFilter"/>, which puts it at the very FRONT of the pipeline — before the session middleware and
/// the default-deny <c>UseAuthorization()</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a startup filter and not a <c>Program.cs</c> line or an endpoint.</b> A browser's <c>&lt;img&gt;</c>/
/// <c>&lt;video&gt;</c> GET carries no bearer token, so the story requires the mapping to sit BEFORE the auth
/// middleware. Mapping it as an anonymous ENDPOINT would mean adding it to <c>PreAuthAllowlist</c>, which the story
/// forbids; and placing static files after <c>UseAuthorization()</c> would only work because
/// <c>AccessRejectionResultHandler</c> happens to pass non-endpoint requests through — coupling a Development
/// convenience to an implementation detail of the security gate. The composition-root slots granted to this story
/// sit after the auth middleware, so the slice installs its own pre-auth middleware here — gated twice: nothing is
/// added at all unless the environment is Development AND the provider is <c>Local</c>. In Production the pipeline
/// is untouched and <c>/dev-media/*</c> is simply unmapped (routing's 404).
/// </para>
/// <para>
/// Only the seven sniffed extensions are served, as their canonical types, with <c>X-Content-Type-Options:
/// nosniff</c> (a <c>.pdf</c> also download-only and CSP-sandboxed). No directory browsing. Path traversal is refused by <see cref="PhysicalFileProvider"/>.
/// </para>
/// </remarks>
public sealed class DevMediaStartupFilter : IStartupFilter
{
    /// <inheritdoc />
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        ArgumentNullException.ThrowIfNull(next);

        return app =>
        {
            var environment = app.ApplicationServices.GetRequiredService<IHostEnvironment>();
            var storage = app.ApplicationServices.GetRequiredService<IOptions<MediaStorageOptions>>().Value;

            if (MediaEndpoints.SelectProvider(storage, environment) == MediaStorageProviders.Local)
            {
                var root = LocalFileMediaStore.ResolveRoot(storage, environment);
                app.UseStaticFiles(new StaticFileOptions
                {
                    RequestPath = LocalMediaUrlSigner.DevMediaPath,
                    FileProvider = new LazyDirectoryFileProvider(root),
                    ContentTypeProvider = CreateContentTypeProvider(),
                    ServeUnknownFileTypes = false,
                    OnPrepareResponse = context => PrepareResponse(context.Context.Response, context.File.Name),
                });
            }

            next(app);
        };
    }

    /// <summary>Maps exactly the seven sniffed extensions to their canonical types; nothing else is served.</summary>
    private static FileExtensionContentTypeProvider CreateContentTypeProvider()
    {
        var provider = new FileExtensionContentTypeProvider();
        provider.Mappings.Clear();
        provider.Mappings[".jpg"] = "image/jpeg";
        provider.Mappings[".png"] = "image/png";
        provider.Mappings[".gif"] = "image/gif";
        provider.Mappings[".webp"] = "image/webp";
        provider.Mappings[".mp4"] = "video/mp4";
        provider.Mappings[".webm"] = "video/webm";
        provider.Mappings[".pdf"] = DocumentDownload.ContentType;
        return provider;
    }

    /// <summary>
    /// <c>nosniff</c> on everything; a document (press-room story 02) is additionally download-only and sandboxed —
    /// <c>Content-Disposition: attachment</c> and <c>Content-Security-Policy: sandbox</c> — because this mapping
    /// serves it from the API's OWN origin.
    /// </summary>
    /// <param name="response">The response being prepared.</param>
    /// <param name="fileName">The served file's name (<c>{Id:N}.{ext}</c>).</param>
    internal static void PrepareResponse(HttpResponse response, string fileName)
    {
        response.Headers.XContentTypeOptions = "nosniff";
        if (fileName.EndsWith(DocumentDownload.Extension, StringComparison.OrdinalIgnoreCase))
        {
            response.Headers.ContentDisposition = DocumentDownload.ContentDisposition(fileName);
            response.Headers.ContentSecurityPolicy = "sandbox";
        }
    }

    /// <summary>
    /// A <see cref="PhysicalFileProvider"/> over a directory that may not exist yet — the local store creates it on
    /// the first upload, so booting a Development host never creates a stray directory.
    /// </summary>
    private sealed class LazyDirectoryFileProvider : IFileProvider, IDisposable
    {
        private readonly string _root;
        private readonly Lock _gate = new();
        private PhysicalFileProvider? _inner;

        public LazyDirectoryFileProvider(string root) => _root = root;

        public IDirectoryContents GetDirectoryContents(string subpath) =>
            Inner()?.GetDirectoryContents(subpath) ?? NotFoundDirectoryContents.Singleton;

        public IFileInfo GetFileInfo(string subpath) =>
            Inner()?.GetFileInfo(subpath) ?? new NotFoundFileInfo(subpath);

        public IChangeToken Watch(string filter) => NullChangeToken.Singleton;

        public void Dispose() => _inner?.Dispose();

        private PhysicalFileProvider? Inner()
        {
            if (_inner is not null)
            {
                return _inner;
            }

            lock (_gate)
            {
                if (_inner is null && Directory.Exists(_root))
                {
                    _inner = new PhysicalFileProvider(_root);
                }

                return _inner;
            }
        }
    }
}
