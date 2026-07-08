(function () {
    const SUPABASE_URL = 'https://tajyrmydwqsijstyzsjr.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_JYGgJw9y87hnCeEM66Lbcg_xJqpMWcy';
    const CODE_OF_CONDUCT_SLUG = '3oBpb3Knk9GsNB';

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
            return;
        }

        if (templateSlug.toLowerCase().includes(CODE_OF_CONDUCT_SLUG.toLowerCase())) {
            const { data: onboarding } = await client
                .from('family_onboarding')
                .select('manual_checks')
                .eq('family_user_id', user.id)
                .maybeSingle();

            const manualChecks = onboarding?.manual_checks && typeof onboarding.manual_checks === 'object'
                ? onboarding.manual_checks
                : {};

            const { error: onboardingError } = await client
                .from('family_onboarding')
                .upsert({
                    family_user_id: user.id,
                    manual_checks: { ...manualChecks, conduct: true },
                    conduct_signed_at: new Date().toISOString(),
                }, { onConflict: 'family_user_id' });

            if (onboardingError) {
                console.warn('[DocuSeal task] Could not mark Code of Conduct complete:', onboardingError.message);
            }
        }
    }

    window.completeDocuSealTask = completeDocuSealTask;
})();