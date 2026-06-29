(function () {
    const SUPABASE_URL = 'https://tajyrmydwqsijstyzsjr.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_JYGgJw9y87hnCeEM66Lbcg_xJqpMWcy';

    function isTaskDocument(category) {
        const normalized = String(category || '').toLowerCase();
        return normalized.includes('(task)') || normalized.includes('task');
    }

    function getTemplateSlugFromPage(defaultSlug) {
        const params = new URLSearchParams(window.location.search);
        return (params.get('template') || defaultSlug || '').trim();
    }

    async function completeDocuSealTask(defaultSlug) {
        const templateSlug = getTemplateSlugFromPage(defaultSlug);
        if (!templateSlug || !window.supabase) return;

        const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
            },
        });

        const { data: { user } } = await client.auth.getUser();
        if (!user) return;

        const { data: docs, error } = await client
            .from('family_documents')
            .select('id, url, category')
            .eq('user_id', user.id);

        if (error) {
            console.warn('[DocuSeal task] Could not load tasks:', error.message);
            return;
        }

        const ids = (docs || [])
            .filter((doc) => (
                isTaskDocument(doc.category)
                && String(doc.url || '').toLowerCase().includes(templateSlug.toLowerCase())
            ))
            .map((doc) => doc.id);

        if (!ids.length) return;

        const { error: deleteError } = await client
            .from('family_documents')
            .delete()
            .in('id', ids);

        if (deleteError) {
            console.warn('[DocuSeal task] Could not remove completed task:', deleteError.message);
        }
    }

    window.completeDocuSealTask = completeDocuSealTask;
})();