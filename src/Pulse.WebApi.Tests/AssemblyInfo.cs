// CorsTests.CorsWebApplicationFactory mutates the process-wide Authentication__FrontendBaseUrl
// environment variable to reach Program.cs's config read before builder.Build() executes (see the
// XML doc on that factory). Disabling cross-class test parallelization keeps that mutation from
// racing another test class's WebApplicationFactory<Program> host construction. This is a small,
// host-bootstrapping suite — the serial-execution cost is negligible.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
