export function setManifestForRoute(route: "/member" | "/exco") {
  const manifestPath = route === "/exco" ? "/manifest-exco.webmanifest" : "/manifest-member.webmanifest";
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');

  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }

  link.href = manifestPath;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute(
    "content",
    route === "/exco" ? "INTIMA Exco" : "INTIMA Member",
  );
}

export function getStandalonePreferredRoute() {
  const lastPublicRoute = localStorage.getItem("intima:lastPublicRoute");
  return lastPublicRoute === "/member" || lastPublicRoute === "/exco" ? lastPublicRoute : null;
}