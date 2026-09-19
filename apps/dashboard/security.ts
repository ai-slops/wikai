import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

type SecurityOptions = {
  readonly csrfToken: string;
  readonly allowedOrigin: string;
  readonly bearerToken?: string;
};

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function equalSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function securityMiddleware(options: SecurityOptions): MiddlewareHandler {
  return async (context, next) => {
    context.header("Cache-Control", "no-store");
    const host = context.req.header("host");
    if (host !== undefined && host !== new URL(options.allowedOrigin).host) {
      return context.json(
        { error: { code: "FORBIDDEN_HOST", message: "Unexpected dashboard host" } },
        403,
      );
    }
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    context.header("Cross-Origin-Opener-Policy", "same-origin");
    context.header("Cross-Origin-Resource-Policy", "same-origin");

    if (options.bearerToken !== undefined) {
      const authorization = context.req.header("authorization") ?? "";
      const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!equalSecret(supplied, options.bearerToken))
        return context.json(
          { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
          401,
        );
    }

    if (MUTATIONS.has(context.req.method)) {
      const origin = context.req.header("origin");
      const csrf = context.req.header("x-csrf-token") ?? "";
      if (origin !== options.allowedOrigin || !equalSecret(csrf, options.csrfToken)) {
        return context.json(
          { error: { code: "FORBIDDEN", message: "Same-origin CSRF proof required" } },
          403,
        );
      }
    }
    await next();
  };
}
