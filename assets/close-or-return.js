(function () {
    /**
     * Browsers only allow window.close() on tabs opened by script.
     * Try to close; if the tab is still open, navigate to the fallback URL.
     */
    window.closeOrReturn = function (fallbackUrl) {
        const fallback = fallbackUrl || 'members.html';

        try {
            window.open('', '_self', '');
            window.close();
        } catch (_) {
            // Ignore — fallback navigation handles blocked close.
        }

        window.setTimeout(function () {
            window.location.replace(fallback);
        }, 200);
    };
})();