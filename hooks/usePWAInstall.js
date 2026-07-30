"use client";

import { useEffect, useState } from "react";

export default function usePWAInstall() {
    const [deferredPrompt, setDeferredPrompt] = useState(null);

    const [isInstalled, setIsInstalled] = useState(false);

    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        const standalone =
            window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true;

        setIsInstalled(standalone);

        const ios =
            /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
            !window.MSStream;

        setIsIOS(ios);

        const handler = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };

        window.addEventListener("beforeinstallprompt", handler);

        window.addEventListener("appinstalled", () => {
            setIsInstalled(true);
            setDeferredPrompt(null);
        });

        return () => {
            window.removeEventListener("beforeinstallprompt", handler);
        };
    }, []);

    async function install() {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();

        await deferredPrompt.userChoice;

        setDeferredPrompt(null);
    }

    return {
        install,
        canInstall: !!deferredPrompt,
        isInstalled,
        isIOS,
    };
}