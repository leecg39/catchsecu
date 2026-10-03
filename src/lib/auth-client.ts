"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
export const authClient = createAuthClient({
  basePath: "/api/v1/auth",
  plugins: [twoFactorClient()],
});
