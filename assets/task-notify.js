(function () {
    const SUPABASE_URL = 'https://tajyrmydwqsijstyzsjr.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_JYGgJw9y87hnCeEM66Lbcg_xJqpMWcy';

    async function scanUserTasks(client, options = {}) {
        if (!client) return;
        const { data: { session } } = await client.auth.getSession();
        if (!session?.access_token) return;

        const cacheKey = options.force
            ? null
            : `task_visibility_notify_${session.user.id}_${new Date().toISOString().slice(0, 10)}`;
        if (cacheKey && sessionStorage.getItem(cacheKey) === '1') return;

        try {
            const response = await fetch(`${SUPABASE_URL}/functions/v1/notify-task-visibility`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ action: 'scan_user', user_id: session.user.id }),
            });
            if (response.ok && cacheKey) {
                sessionStorage.setItem(cacheKey, '1');
            }
        } catch (err) {
            console.warn('[TaskNotify] Visibility scan skipped:', err);
        }
    }

    window.TaskNotify = {
        scanUserTasks,
    };
})();