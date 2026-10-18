export function requestWithFetch(success: boolean): void {
    const path = success
        ? window.location.pathname
        : `/sdk-demo-fetch-${Date.now()}.json`;
    void fetch(path).catch(() => undefined);
}

export function requestWithXHR(success: boolean): void {
    const xhr = new XMLHttpRequest();
    xhr.open(
        "GET",
        success
            ? window.location.pathname
            : `/sdk-demo-xhr-${Date.now()}.json`,
    );
    xhr.send();
}

export function throwJavaScriptError(): void {
    window.setTimeout(() => {
        throw new Error("demo: JavaScript runtime error");
    });
}

export function rejectPromise(): void {
    void Promise.reject(new Error("demo: unhandled Promise rejection"));
}

export function failResource(): void {
    const image = new Image();
    image.hidden = true;
    image.addEventListener("error", () => image.remove(), { once: true });
    document.body.append(image);
    image.src = `/sdk-demo-resource-${Date.now()}.png`;
}

export function switchRoute(route: string): void {
    window.location.hash = route;
}

/**
 * 用 History API 切换查询参数，触发 SDK 对 pushState 的自动 PV。
 */
export function pushHistoryRoute(route: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("route", route);
    window.history.pushState({ route }, "", url);
}
