export function getPageUrl(): string {
    return typeof window !== "undefined" ? window.location.href : "";
}
