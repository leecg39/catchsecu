const authentication = ["/login", "/signup", "/password-change-email", "/passwordChange", "/password-change-rule",
  "/two-step", "/auth-code", "/expire", "/identification", "/gpki", "/saeol", "/link/oauth2", "/oauth2", "/logout", "/not-allow-ip", "/gwloginUser/login"];
export function isAuthPath(path: string) {
  return authentication.some(route => path === route || path.startsWith(route + "/")) || path.startsWith("/login-") || path === "/two-step-setting";
}
export function isPublicPath(path: string) {
  return isAuthPath(path) || /^\/(shared-privacy|infoOwner|projects?|url|test-projects|file-view|document|customer-use-case|services)(\/|$)/.test(path) || path === "/jap_intro";
}
