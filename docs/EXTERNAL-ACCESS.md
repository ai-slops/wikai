# DIM external studio access

The private publication studio can be reached through DIM's external-url plugin without changing `.dim` or opening the application port directly.

```bash
node scripts/expose.ts
```

The launcher:

1. Loads the configured vault, using `WIKAI_CONFIG` or the local demo configuration.
2. Generates a random password once in `.local/studio-password` with private filesystem permissions.
3. Starts the dashboard on a free loopback port with authentication already enabled.
4. Registers the named `wikai-studio` service through `dim-development-service expose` and the `https-ts` ingress.
5. Uses the returned HTTPS origin for the existing Host and CSRF checks.

Open the printed URL. The browser prompts for HTTP Basic authentication:

- Username: `wikai`
- Password: the contents of `.local/studio-password`

Bearer clients can use the same value as `Authorization: Bearer <password>`. Browser mutations still require same-origin CSRF proof. Credentials are not put in URLs, logs, commits or the public site.

For a persistent process in the current workspace:

```bash
nohup node scripts/expose.ts > .local/external-studio.log 2>&1 &
```

Connection details and the process ID are recorded in `.local/external-studio.json`. Stop the recorded process before restarting the launcher. Reusing the service name preserves the DIM URL while updating its internal target port. The process must be started again after a workspace restart.

Do not assume authentication on one existing DIM URL applies to newly created URLs. This launcher enforces application authentication independently of ingress policy. It exposes the private review studio, not an anonymous public website.
