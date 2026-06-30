(function () {
    const DIALOG_ID = 'app-dialog';
    const TITLE_ID = 'app-dialog-title';
    const MESSAGE_ID = 'app-dialog-message';
    const CANCEL_ID = 'app-dialog-cancel-btn';
    const OK_ID = 'app-dialog-ok-btn';
    const ACTIONS_ID = 'app-dialog-actions';

    const BTN_BASE = 'min-h-[2.75rem] px-4 py-3 rounded-2xl text-sm font-semibold touch-manipulation';
    const BTN_SECONDARY = BTN_BASE + ' flex-1 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
    const BTN_PRIMARY = BTN_BASE + ' flex-1 bg-navy hover:bg-[#0F3A5F] text-white border border-navy';
    const BTN_DANGER = BTN_BASE + ' flex-1 bg-red-600 hover:bg-red-700 text-white border border-red-600';
    const BTN_ALERT_PRIMARY = BTN_BASE + ' w-full bg-navy hover:bg-[#0F3A5F] text-white border border-navy';
    const BTN_ALERT_DANGER = BTN_BASE + ' w-full bg-red-600 hover:bg-red-700 text-white border border-red-600';
    const BTN_ALERT_SUCCESS = BTN_BASE + ' w-full bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600';

    let dialogResolver = null;
    let listenersBound = false;

    function defaultAlertTitle(tone) {
        if (tone === 'danger') return 'Something went wrong';
        if (tone === 'success') return 'Success';
        return 'Notice';
    }

    function buttonClassForTone(tone, mode) {
        if (mode === 'alert') {
            if (tone === 'success') return BTN_ALERT_SUCCESS;
            if (tone === 'danger') return BTN_ALERT_DANGER;
            return BTN_ALERT_PRIMARY;
        }
        if (tone === 'danger') return BTN_DANGER;
        return BTN_PRIMARY;
    }

    function mountDialog() {
        const dialog = document.getElementById(DIALOG_ID);
        if (!dialog) return null;
        if (dialog.parentElement !== document.body) {
            document.body.appendChild(dialog);
        }
        return dialog;
    }

    function ensureDialog() {
        if (document.getElementById(DIALOG_ID)) {
            mountDialog();
            return;
        }

        document.body.insertAdjacentHTML('beforeend', `
            <div id="${DIALOG_ID}" class="hidden" role="dialog" aria-modal="true" aria-labelledby="${TITLE_ID}" aria-describedby="${MESSAGE_ID}">
                <button type="button" data-app-dialog-backdrop aria-label="Close"></button>
                <div class="app-dialog-panel">
                    <h3 id="${TITLE_ID}" class="app-dialog-title heading-serif text-xl text-navy tracking-tight"></h3>
                    <p id="${MESSAGE_ID}" class="app-dialog-message text-sm text-slate-600 mt-2 leading-relaxed"></p>
                    <div id="${ACTIONS_ID}" class="app-dialog-actions">
                        <button type="button" id="${CANCEL_ID}" class="${BTN_SECONDARY}">Cancel</button>
                        <button type="button" id="${OK_ID}" class="${BTN_PRIMARY}">OK</button>
                    </div>
                </div>
            </div>
        `);

        bindDialogListeners();
    }

    function bindDialogListeners() {
        if (listenersBound) return;

        const dialog = document.getElementById(DIALOG_ID);
        const cancelBtn = document.getElementById(CANCEL_ID);
        const okBtn = document.getElementById(OK_ID);
        const backdrop = dialog?.querySelector('[data-app-dialog-backdrop]');

        const cancel = () => closeAppDialog(false);

        cancelBtn?.addEventListener('click', cancel);
        backdrop?.addEventListener('click', cancel);
        okBtn?.addEventListener('click', () => closeAppDialog(true));

        dialog?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && dialog && !dialog.classList.contains('hidden')) {
                cancel();
            }
        });

        listenersBound = true;
    }

    function closeAppDialog(result) {
        const dialog = document.getElementById(DIALOG_ID);
        if (dialog) dialog.classList.add('hidden');
        document.documentElement.classList.remove('app-dialog-open');
        document.body.classList.remove('app-dialog-open');

        if (dialogResolver) {
            dialogResolver(result);
            dialogResolver = null;
        }
    }

    function showAppDialog(options) {
        return new Promise((resolve) => {
            ensureDialog();

            const dialog = mountDialog();
            const titleEl = document.getElementById(TITLE_ID);
            const messageEl = document.getElementById(MESSAGE_ID);
            const cancelBtn = document.getElementById(CANCEL_ID);
            const okBtn = document.getElementById(OK_ID);
            const actionsEl = document.getElementById(ACTIONS_ID);

            if (!dialog || !titleEl || !messageEl || !cancelBtn || !okBtn || !actionsEl) {
                resolve(false);
                return;
            }

            const mode = options.mode === 'alert' ? 'alert' : 'confirm';
            const tone = options.tone || 'primary';
            const title = options.title || (mode === 'alert' ? defaultAlertTitle(tone) : 'Please confirm');
            const message = options.message || '';
            const confirmLabel = options.confirmLabel || (mode === 'alert' ? 'OK' : 'Confirm');
            const cancelLabel = options.cancelLabel || 'Cancel';

            dialogResolver = resolve;
            titleEl.textContent = title;
            messageEl.textContent = message;
            okBtn.textContent = confirmLabel;
            cancelBtn.textContent = cancelLabel;

            if (mode === 'alert') {
                cancelBtn.classList.add('hidden');
                actionsEl.classList.add('is-alert');
                okBtn.className = buttonClassForTone(tone, mode);
            } else {
                cancelBtn.classList.remove('hidden');
                actionsEl.classList.remove('is-alert');
                okBtn.className = buttonClassForTone(tone, mode);
                cancelBtn.className = BTN_SECONDARY;
            }

            document.documentElement.classList.add('app-dialog-open');
            document.body.classList.add('app-dialog-open');
            dialog.classList.remove('hidden');
            okBtn.focus({ preventScroll: true });
        });
    }

    window.showAppConfirm = function (options) {
        const normalized = typeof options === 'string'
            ? { message: options }
            : (options || {});

        return showAppDialog({
            mode: 'confirm',
            title: normalized.title || 'Please confirm',
            message: normalized.message || '',
            confirmLabel: normalized.confirmLabel || 'Confirm',
            cancelLabel: normalized.cancelLabel || 'Cancel',
            tone: normalized.tone || 'primary'
        });
    };

    window.showAppAlert = function (message, options) {
        const opts = options || {};
        return showAppDialog({
            mode: 'alert',
            title: opts.title || defaultAlertTitle(opts.tone || 'primary'),
            message: message || '',
            confirmLabel: opts.confirmLabel || 'OK',
            tone: opts.tone || 'primary'
        });
    };
})();