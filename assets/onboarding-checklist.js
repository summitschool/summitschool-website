(function () {
    const ONBOARDING_TASK_TITLE = 'Family Hub Setup Checklist';
    const ONBOARDING_TASK_URL = 'hub://onboarding';
    const ONBOARDING_TASK_CATEGORY = 'Onboarding (Task)';
    const CODE_OF_CONDUCT_TITLE = 'Sign Code of Conduct (required)';
    const CODE_OF_CONDUCT_SIGNED_TITLE = '2026 - 2027 SCS Code of Conduct';
    const CODE_OF_CONDUCT_URL = 'https://enroll.summitchurchschool.org/d/3oBpb3Knk9GsNB';
    const CODE_OF_CONDUCT_SLUG = '3oBpb3Knk9GsNB';
    const ID_TASK_TITLE = 'Upload Government Issued ID (required)';

    const INCOMPLETE_MESSAGES = {
        students: 'Add each enrolled student in Academic Records (name and current grade), then check this box.',
        prior_years: 'Optional for K–9. Students starting in 9th grade have no prior high school years. If your student completed high school years before enrolling (grades 10–12), add those records in Academic Records before checking this off.',
        guide: 'Read how progress reports work below and click "I\'ve read this" to check this off.',
        conduct: 'Sign the Code of Conduct in My Tasks, or open your signed copy under My Documents, then check this box.',
        id: 'Upload your government-issued ID in My Tasks before checking this box.',
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isTaskDocument(doc) {
        const category = String(doc?.category || '').toLowerCase();
        return category.includes('(task)') || category.includes('task');
    }

    function softDueDate(daysFromNow = 14) {
        const d = new Date();
        d.setDate(d.getDate() + daysFromNow);
        return d.toISOString().split('T')[0];
    }

    function isOnboardingTask(task) {
        return String(task.url || '') === ONBOARDING_TASK_URL
            || String(task.title || '').trim() === ONBOARDING_TASK_TITLE;
    }

    function isCodeOfConductTask(task) {
        const title = String(task.title || '').toLowerCase();
        const url = String(task.url || '').toLowerCase();
        return title.includes('code of conduct')
            || url.includes(CODE_OF_CONDUCT_SLUG.toLowerCase());
    }

    async function hasCodeOfConductTask(userId) {
        const tasks = await fetchActiveTasks(userId);
        return tasks.some(isCodeOfConductTask);
    }

    function isIdUploadTask(task) {
        return String(task.title || '').toLowerCase().includes('upload government issued id');
    }

    function getTaskSortRank(task) {
        if (isOnboardingTask(task)) return 0;
        if (isCodeOfConductTask(task)) return 1;
        if (isIdUploadTask(task)) return 2;
        if (window.AcademicRecords?.parseProgressReportStudentId?.(task.url)) return 3;
        if (window.GraduationTasks?.parseGraduationStudentId?.(task.url)) return 4;
        if (window.KindergartenGraduationTasks?.parseKindergartenGraduationStudentId?.(task.url)) return 5;
        return 5;
    }

    function sortTasksForDisplay(tasks) {
        return [...tasks].sort((a, b) => {
            const rankDiff = getTaskSortRank(a) - getTaskSortRank(b);
            if (rankDiff !== 0) return rankDiff;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
    }

    async function fetchActiveTasks(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return [];
        const { data, error } = await client
            .from('family_documents')
            .select('*')
            .eq('user_id', userId);
        if (error) {
            console.warn('[Onboarding] Could not load tasks:', error.message);
            return [];
        }
        return (data || []).filter(isTaskDocument);
    }

    function isNonTaskCodeOfConductDocument(doc, stdTitle = '') {
        if (!doc || isTaskDocument(doc)) return false;

        const title = String(doc.title || '').trim().toLowerCase();
        const category = String(doc.category || '').trim().toLowerCase();
        if (title.includes('enrollment') || category.includes('enrollment')) return false;
        const description = String(doc.description || '').trim().toLowerCase();
        const normalizedStdTitle = String(stdTitle || '').trim().toLowerCase();
        const url = String(doc.url || '').trim();
        const isStoredPdf = Boolean(url) && !/^https?:\/\//i.test(url);

        const signedTitle = CODE_OF_CONDUCT_SIGNED_TITLE.toLowerCase();
        if (title === signedTitle || title.includes('scs code of conduct')) return true;
        if (title.includes('code of conduct')) return true;
        if (normalizedStdTitle && title === normalizedStdTitle) return true;

        if (category.includes('signed form') && isStoredPdf && description.includes('signed and saved to your family hub')) {
            if (title.includes('driver') || title.includes('dmv') || title.includes('enrollment')) return false;
            return title.includes('code of conduct') || title.includes('scs code of conduct');
        }

        return false;
    }

    async function hasSignedCodeOfConductDocument(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return false;

        const std = await fetchCodeOfConductStandard();
        const stdTitle = std?.title || CODE_OF_CONDUCT_TITLE;

        const { data: docs, error } = await client
            .from('family_documents')
            .select('id, title, category, description, url')
            .eq('user_id', userId);

        if (error) {
            console.warn('[Onboarding] Could not load signed Code of Conduct documents:', error.message);
            return false;
        }

        if ((docs || []).some((doc) => isNonTaskCodeOfConductDocument(doc, stdTitle))) {
            return true;
        }

        const { data: archives, error: archiveError } = await client
            .from('hub_form_archive_log')
            .select('family_document_id, archived_at')
            .eq('family_user_id', userId)
            .not('archived_at', 'is', null);

        if (archiveError) {
            console.warn('[Onboarding] Could not load hub form archive log:', archiveError.message);
            return false;
        }

        const archivedDocIds = (archives || [])
            .map((entry) => entry.family_document_id)
            .filter(Boolean);
        if (!archivedDocIds.length) return false;

        const archivedDocs = (docs || []).filter((doc) => archivedDocIds.includes(doc.id));
        return archivedDocs.some((doc) => isNonTaskCodeOfConductDocument(doc, stdTitle));
    }

    function hasConductSignedTimestamp(onboarding) {
        return Boolean(onboarding?.conduct_signed_at);
    }

    async function isConductActuallySigned(userId, onboarding = null) {
        return hasSignedCodeOfConductDocument(userId);
    }

    async function needsCodeOfConductTask(userId) {
        return !(await hasSignedCodeOfConductDocument(userId));
    }

    async function isConductMarkedComplete(userId, onboarding = null) {
        return isConductActuallySigned(userId, onboarding);
    }

    async function isConductSigned(userId, onboarding = null) {
        return isConductActuallySigned(userId, onboarding);
    }

    async function markConductCompleted(userId, onboarding = null, signedAt = null) {
        const client = window.supabaseClient;
        if (!client || !userId) return onboarding;

        const manualChecks = { ...getManualChecks(onboarding), conduct: true };
        const payload = {
            family_user_id: userId,
            manual_checks: manualChecks,
            conduct_signed_at: signedAt || onboarding?.conduct_signed_at || new Date().toISOString(),
        };

        const { data, error } = await client
            .from('family_onboarding')
            .upsert(payload, { onConflict: 'family_user_id' })
            .select('*')
            .single();

        if (error) {
            console.warn('[Onboarding] Could not mark Code of Conduct complete:', error.message);
            return onboarding;
        }

        return data || onboarding;
    }

    async function ensureConductSignedTimestamp(userId, onboarding = null) {
        const signed = await hasSignedCodeOfConductDocument(userId);
        if (hasConductSignedTimestamp(onboarding) && !signed) {
            return clearInvalidConductCompletion(userId, onboarding);
        }
        if (hasConductSignedTimestamp(onboarding)) return onboarding;
        if (!signed) return onboarding;
        return markConductCompleted(userId, onboarding);
    }

    async function syncConductStateFromDocuments(userId, onboarding = null) {
        if (await isConductActuallySigned(userId, onboarding)) {
            return ensureConductManualCheck(userId, onboarding);
        }
        return clearInvalidConductCompletion(userId, onboarding);
    }

    async function assignSetupTasksViaRpc(userId, options = {}) {
        const client = window.supabaseClient;
        if (!client || !userId) return { repaired: false, reason: 'no_client' };

        const throwOnError = options.throwOnError === true;
        const { data, error } = await client.rpc('admin_assign_family_setup_tasks', {
            target_user_id: userId,
        });

        if (error) {
            console.warn('[Onboarding] RPC assign setup tasks failed:', error.message);
            if (throwOnError) throw error;
            return { repaired: false, error };
        }

        const missing = Array.isArray(data?.missing) ? data.missing.filter(Boolean) : [];
        if (missing.length) {
            const message = `Missing setup tasks: ${missing.join(', ')}`;
            if (throwOnError) throw new Error(message);
            return { repaired: false, missing, rpc: data };
        }

        return { repaired: Boolean(data?.ok), rpc: data };
    }

    async function clearInvalidConductCompletion(userId, onboarding = null) {
        if (await isConductActuallySigned(userId, onboarding)) return onboarding;

        const manualChecks = getManualChecks(onboarding);
        const needsClear = Boolean(manualChecks.conduct) || hasConductSignedTimestamp(onboarding);
        if (!needsClear) return onboarding;

        const client = window.supabaseClient;
        if (!client || !userId) return onboarding;

        const { data, error } = await client
            .from('family_onboarding')
            .upsert({
                family_user_id: userId,
                manual_checks: { ...manualChecks, conduct: false },
                conduct_signed_at: null,
            }, { onConflict: 'family_user_id' })
            .select('*')
            .single();

        if (error) {
            console.warn('[Onboarding] Could not clear invalid conduct completion:', error.message);
            return onboarding;
        }

        return data || onboarding;
    }

    async function removeStaleCodeOfConductTasks(userId, onboarding = null) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        if (!(await isConductMarkedComplete(userId, onboarding))) return;

        const tasks = await fetchActiveTasks(userId);
        const staleIds = tasks.filter(isCodeOfConductTask).map((task) => task.id);
        if (!staleIds.length) return;

        const { error } = await client
            .from('family_documents')
            .delete()
            .in('id', staleIds);
        if (error) console.warn('[Onboarding] Could not remove stale Code of Conduct task:', error.message);
    }

    async function ensureConductManualCheck(userId, onboarding = null) {
        if (!(await isConductActuallySigned(userId, onboarding))) return onboarding;
        if (getManualChecks(onboarding).conduct) return onboarding;
        return markConductCompleted(userId, onboarding);
    }

    async function hasIdSubmissionOnFile(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return false;

        const { data: uploads } = await client
            .from('id_uploads')
            .select('id, status')
            .eq('user_id', userId)
            .in('status', ['pending', 'approved'])
            .limit(1);
        if (uploads?.length) return true;

        const { data: idDocs } = await client
            .from('family_documents')
            .select('id, title, category')
            .eq('user_id', userId)
            .ilike('category', '%ID%')
            .not('category', 'ilike', '%task%');

        return (idDocs || []).some((doc) => {
            const title = String(doc.title || '').trim().toLowerCase();
            return title.includes('government id on file')
                || title.includes('government id (pending admin review)')
                || title.includes('government id');
        });
    }

    async function isIdUploaded(userId) {
        return hasIdSubmissionOnFile(userId);
    }

    async function removeStaleIdUploadTasks(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        if (!(await hasIdSubmissionOnFile(userId))) return;

        const tasks = await fetchActiveTasks(userId);
        const staleIds = tasks.filter(isIdUploadTask).map((task) => task.id);
        if (!staleIds.length) return;

        const { error } = await client
            .from('family_documents')
            .delete()
            .in('id', staleIds);
        if (error) console.warn('[Onboarding] Could not remove stale ID task:', error.message);
    }

    async function ensureIdManualCheck(userId, onboarding = null) {
        if (!(await hasIdSubmissionOnFile(userId))) return onboarding;
        if (getManualChecks(onboarding).id) return onboarding;

        await setManualCheck(userId, 'id', true, { soft: true });
        const client = window.supabaseClient;
        if (!client || !userId) return onboarding;

        const { data: refreshed } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();
        return refreshed || onboarding;
    }

    async function markIdSubmitted(userId) {
        if (!userId) return;
        await removeStaleIdUploadTasks(userId);
        await setManualCheck(userId, 'id', true, { soft: true });
    }

    function buildIdTaskDescriptionAfterDenial(denialReason, stdDescription = '') {
        const base = String(stdDescription || '').trim()
            || 'Upload a clear photo of your current valid driver\'s license or government-issued photo ID.';
        const reason = String(denialReason || '').trim();
        if (!reason) {
            return `${base} Your previous submission was not accepted. Please upload a new clear photo.`;
        }
        return `${base} Your previous submission was not accepted. Reason: ${reason} Please upload a new clear photo.`;
    }

    async function reopenIdUploadTaskAfterDenial(userId, denialReason = '') {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const { data: stds } = await client
            .from('standard_documents')
            .select('*')
            .ilike('title', '%Upload Government Issued ID%')
            .limit(1);

        const std = stds?.[0];
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        const description = buildIdTaskDescriptionAfterDenial(denialReason, std?.description);
        const tasks = await fetchActiveTasks(userId);
        const existingIdTasks = tasks.filter(isIdUploadTask);

        for (const task of existingIdTasks) {
            const { error } = await client
                .from('family_documents')
                .delete()
                .eq('id', task.id);
            if (error) console.warn('[Onboarding] Could not remove old ID task:', error.message);
        }

        const { error: insertError } = await client.from('family_documents').insert({
            user_id: userId,
            title: std?.title || ID_TASK_TITLE,
            description,
            url: std?.url || '',
            category: (std?.category || 'Verification') + ' (Task)',
            school_year: schoolYear,
            due_date_1: softDueDate(14),
            due_date_1_cleared: false,
        });
        if (insertError) {
            console.warn('[Onboarding] Could not reopen ID task:', insertError.message);
            throw insertError;
        }

        await setManualCheck(userId, 'id', false, { soft: true });
    }

    async function ensureOnboardingRow(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return null;
        const { data: existing } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();
        if (existing) return existing;

        const { data, error } = await client
            .from('family_onboarding')
            .insert({ family_user_id: userId })
            .select('*')
            .single();
        if (error) {
            console.warn('[Onboarding] Could not create onboarding row:', error.message);
            return null;
        }
        return data;
    }

    async function insertTaskIfMissing(userId, matchFn, payload, options = {}) {
        const client = window.supabaseClient;
        if (!client || !userId) return { created: false, skipped: true };

        const { data: docs } = await client
            .from('family_documents')
            .select('id, title, url, category')
            .eq('user_id', userId);

        const existing = (docs || []).find((doc) => isTaskDocument(doc) && matchFn(doc));
        if (existing?.id) return { created: false, skipped: true, existingId: existing.id };

        const { error } = await client.from('family_documents').insert(payload);
        if (error) {
            console.warn('[Onboarding] Could not create task:', error.message, payload?.title || '');
            if (options.throwOnError) throw error;
            return { created: false, error };
        }

        const { data: docsAfter } = await client
            .from('family_documents')
            .select('id, title, url, category')
            .eq('user_id', userId);

        const created = (docsAfter || []).find((doc) => isTaskDocument(doc) && matchFn(doc));
        if (!created?.id) {
            const message = `Task insert did not persist (${payload?.title || 'task'}). This can happen when conduct is falsely marked complete — refresh and try again.`;
            console.warn('[Onboarding]', message);
            if (options.throwOnError) throw new Error(message);
            return { created: false, error: { message } };
        }

        return { created: true, existingId: created.id };
    }

    async function ensureOnboardingTask(userId, options = {}) {
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        return insertTaskIfMissing(
            userId,
            (doc) => String(doc.url || '') === ONBOARDING_TASK_URL,
            {
                user_id: userId,
                title: ONBOARDING_TASK_TITLE,
                description: 'Complete every step below, check off each item, then finish this checklist. Other required tasks stay in My Tasks until done.',
                url: ONBOARDING_TASK_URL,
                category: ONBOARDING_TASK_CATEGORY,
                school_year: schoolYear,
                due_date_1: softDueDate(14),
                due_date_1_cleared: false,
            },
            options
        );
    }

    async function fetchCodeOfConductStandard() {
        const client = window.supabaseClient;
        if (!client) return null;

        const { data: stds } = await client
            .from('standard_documents')
            .select('*')
            .ilike('title', '%code of conduct%')
            .limit(1);

        return stds?.[0] || null;
    }

    function resolveCodeOfConductUrl(std) {
        const url = String(std?.url || '').trim();
        if (url) return url;
        return CODE_OF_CONDUCT_URL;
    }

    async function syncCodeOfConductTaskUrl(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const std = await fetchCodeOfConductStandard();
        const url = resolveCodeOfConductUrl(std);
        const tasks = await fetchActiveTasks(userId);
        const conductTasks = tasks.filter(isCodeOfConductTask);

        for (const task of conductTasks) {
            const currentUrl = String(task.url || '').trim();
            const needsUrl = !currentUrl || !currentUrl.toLowerCase().includes(CODE_OF_CONDUCT_SLUG.toLowerCase());
            if (!needsUrl && (!std?.title || task.title === std.title)) continue;

            const { error } = await client
                .from('family_documents')
                .update({
                    url,
                    title: std?.title || task.title || CODE_OF_CONDUCT_TITLE,
                    description: std?.description || task.description || 'Read and sign the Summit Church School Code of Conduct.',
                })
                .eq('id', task.id);
            if (error) console.warn('[Onboarding] Could not sync Code of Conduct task URL:', error.message);
        }
    }

    async function assignCodeOfConductTaskOnApproval(userId, onboarding = null, options = {}) {
        if (!window.supabaseClient || !userId) return;

        const client = window.supabaseClient;
        let onboardingRow = onboarding;
        if (!onboardingRow) {
            const { data } = await client
                .from('family_onboarding')
                .select('*')
                .eq('family_user_id', userId)
                .maybeSingle();
            onboardingRow = data;
        }

        onboardingRow = await clearInvalidConductCompletion(userId, onboardingRow);

        if (!(await needsCodeOfConductTask(userId))) {
            await removeStaleCodeOfConductTasks(userId, onboardingRow);
            return { created: false, skipped: true };
        }

        const std = await fetchCodeOfConductStandard();
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        const result = await insertTaskIfMissing(
            userId,
            isCodeOfConductTask,
            {
                user_id: userId,
                title: std?.title || CODE_OF_CONDUCT_TITLE,
                description: std?.description || 'Read and sign the Summit Church School Code of Conduct.',
                url: resolveCodeOfConductUrl(std),
                category: (std?.category || 'Policy') + ' (Task)',
                school_year: schoolYear,
                due_date_1: softDueDate(14),
                due_date_1_cleared: false,
            },
            options
        );
        await syncCodeOfConductTaskUrl(userId);
        return result;
    }

    async function assignIdTaskOnApproval(userId, options = {}) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        if (await hasIdSubmissionOnFile(userId)) {
            await removeStaleIdUploadTasks(userId);
            return { created: false, skipped: true };
        }

        const { data: stds } = await client
            .from('standard_documents')
            .select('*')
            .ilike('title', '%Upload Government Issued ID%')
            .limit(1);

        const std = stds?.[0];
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        return insertTaskIfMissing(
            userId,
            isIdUploadTask,
            {
                user_id: userId,
                title: std?.title || ID_TASK_TITLE,
                description: std?.description || 'Upload a clear photo of your current valid driver\'s license or government-issued photo ID.',
                url: std?.url || '',
                category: (std?.category || 'Verification') + ' (Task)',
                school_year: schoolYear,
                due_date_1: softDueDate(14),
                due_date_1_cleared: false,
            },
            options
        );
    }

    async function reopenInvalidOnboardingCompletion(userId, onboarding = null) {
        const client = window.supabaseClient;
        if (!client || !userId) return { reopened: false, onboarding };

        if (!onboarding) {
            const { data } = await client
                .from('family_onboarding')
                .select('*')
                .eq('family_user_id', userId)
                .maybeSingle();
            onboarding = data;
        }

        if (!onboarding?.completed_at) {
            return { reopened: false, onboarding };
        }

        if (await isConductActuallySigned(userId, onboarding)) {
            return { reopened: false, onboarding };
        }

        const manualChecks = getManualChecks(onboarding);
        const { data, error } = await client
            .from('family_onboarding')
            .upsert({
                family_user_id: userId,
                completed_at: null,
                conduct_signed_at: null,
                manual_checks: { ...manualChecks, conduct: false },
            }, { onConflict: 'family_user_id' })
            .select('*')
            .single();

        if (error) {
            console.warn('[Onboarding] Could not reopen invalid onboarding completion:', error.message);
            return { reopened: false, onboarding };
        }

        return { reopened: true, onboarding: data || onboarding };
    }

    async function isOnboardingCompleted(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return false;

        const { data: onboarding } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();

        if (!onboarding?.completed_at) return false;

        const { reopened } = await reopenInvalidOnboardingCompletion(userId, onboarding);
        if (reopened) return false;

        return true;
    }

    async function forceReopenFamilySetup(userId, options = {}) {
        const client = window.supabaseClient;
        if (!client || !userId) return { repaired: false, reason: 'no_client' };

        const throwOnError = options.throwOnError === true;
        const rpcResult = await assignSetupTasksViaRpc(userId, { throwOnError: false });
        if (rpcResult?.repaired) return rpcResult;

        await ensureOnboardingRow(userId);

        let { data: onboarding } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();

        onboarding = await clearInvalidConductCompletion(userId, onboarding);
        const { reopened, onboarding: reopenedOnboarding } = await reopenInvalidOnboardingCompletion(userId, onboarding);
        if (reopened) onboarding = reopenedOnboarding || onboarding;

        const conductActuallySigned = await isConductActuallySigned(userId, onboarding);
        const manualChecks = getManualChecks(onboarding);
        const resetPayload = { family_user_id: userId };

        if (onboarding?.completed_at && !conductActuallySigned) {
            resetPayload.completed_at = null;
        }
        if (!conductActuallySigned && (hasConductSignedTimestamp(onboarding) || manualChecks.conduct)) {
            resetPayload.conduct_signed_at = null;
            resetPayload.manual_checks = { ...manualChecks, conduct: false };
        }

        if (Object.keys(resetPayload).length > 1) {
            const { data: resetOnboarding, error: resetError } = await client
                .from('family_onboarding')
                .upsert(resetPayload, { onConflict: 'family_user_id' })
                .select('*')
                .single();

            if (resetError) {
                console.warn('[Onboarding] Could not reset family setup state:', resetError.message);
                if (throwOnError) throw resetError;
            } else {
                onboarding = resetOnboarding || onboarding;
            }
        }

        let result = await repairFamilyOnboardingIfNeeded(userId, { ...options, throwOnError });
        if (!result?.repaired && result?.missing?.length) {
            const retryPayload = {
                family_user_id: userId,
                completed_at: null,
                conduct_signed_at: null,
                manual_checks: { ...getManualChecks(onboarding), conduct: false },
            };
            const { error: retryResetError } = await client
                .from('family_onboarding')
                .upsert(retryPayload, { onConflict: 'family_user_id' });
            if (retryResetError) {
                console.warn('[Onboarding] Could not force-reset family setup state:', retryResetError.message);
                if (throwOnError) throw retryResetError;
            } else {
                result = await repairFamilyOnboardingIfNeeded(userId, { ...options, throwOnError });
            }
        }

        return result;
    }

    async function repairFamilyOnboardingIfNeeded(userId, options = {}) {
        const client = window.supabaseClient;
        if (!client || !userId) return { repaired: false, reason: 'no_client' };

        await reopenInvalidOnboardingCompletion(userId);

        if (await isOnboardingCompleted(userId)) {
            return { repaired: false, reason: 'completed' };
        }

        const throwOnError = options.throwOnError === true;
        await ensureOnboardingRow(userId);
        let { data: onboarding } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();
        onboarding = await clearInvalidConductCompletion(userId, onboarding);
        await ensureOnboardingTask(userId, { throwOnError });
        await assignCodeOfConductTaskOnApproval(userId, onboarding, { throwOnError });
        await removeStaleIdUploadTasks(userId);
        await assignIdTaskOnApproval(userId, { throwOnError });

        const missing = [];
        if (!(await fetchActiveTasks(userId)).some(isOnboardingTask)) missing.push(ONBOARDING_TASK_TITLE);
        if (await needsCodeOfConductTask(userId) && !(await hasCodeOfConductTask(userId))) {
            const std = await fetchCodeOfConductStandard();
            missing.push(std?.title || CODE_OF_CONDUCT_TITLE);
        }
        if (!(await fetchActiveTasks(userId)).some(isIdUploadTask) && !await isIdUploaded(userId)) {
            missing.push(ID_TASK_TITLE);
        }

        if (missing.length) {
            const message = `Missing setup tasks: ${missing.join(', ')}`;
            if (throwOnError) throw new Error(message);
            return { repaired: false, reason: 'partial', missing };
        }

        return { repaired: true };
    }

    async function setupFamilyOnApproval(userId) {
        return repairFamilyOnboardingIfNeeded(userId, { throwOnError: true });
    }

    function getManualChecks(onboarding) {
        const raw = onboarding?.manual_checks;
        return raw && typeof raw === 'object' ? raw : {};
    }

    async function setManualCheck(userId, itemId, checked, options = {}) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        await ensureOnboardingRow(userId);
        const { data: onboarding } = await client
            .from('family_onboarding')
            .select('manual_checks')
            .eq('family_user_id', userId)
            .maybeSingle();

        const manualChecks = { ...getManualChecks(onboarding), [itemId]: Boolean(checked) };
        const { error } = await client
            .from('family_onboarding')
            .upsert({
                family_user_id: userId,
                manual_checks: manualChecks,
            }, { onConflict: 'family_user_id' });
        if (error) {
            if (options.soft) {
                console.warn('[Onboarding] Could not update manual check:', error.message);
                return;
            }
            throw error;
        }
    }

    async function getChecklistState(userId) {
        const client = window.supabaseClient;
        const AR = window.AcademicRecords;
        if (!client || !userId || !AR) {
            return { items: [], allTasksComplete: false, allManuallyChecked: false, canFinish: false };
        }

        await ensureOnboardingRow(userId);
        let { data: onboarding } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();

        onboarding = await syncConductStateFromDocuments(userId, onboarding);

        if (!onboarding?.completed_at) {
            await ensureOnboardingTask(userId);

            const activeTasks = await fetchActiveTasks(userId);
            if (activeTasks.some(isOnboardingTask)) {
                await removeStaleCodeOfConductTasks(userId, onboarding);

                const conductMarkedComplete = await isConductMarkedComplete(userId, onboarding);
                if (!conductMarkedComplete) {
                    const refreshedTasks = await fetchActiveTasks(userId);
                    if (!refreshedTasks.some(isCodeOfConductTask)) {
                        await assignCodeOfConductTaskOnApproval(userId, onboarding);
                        await syncCodeOfConductTaskUrl(userId);
                    }
                }

                await removeStaleIdUploadTasks(userId);

                const refreshedTasks = await fetchActiveTasks(userId);
                const hasIdTask = refreshedTasks.some(isIdUploadTask);
                if (!await isIdUploaded(userId) && !hasIdTask) {
                    await assignIdTaskOnApproval(userId);
                }
            }
        }

        onboarding = await ensureConductManualCheck(userId, onboarding);
        onboarding = await ensureIdManualCheck(userId, onboarding);

        const { data: refreshedOnboarding } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();
        onboarding = refreshedOnboarding || onboarding;

        const manualChecks = getManualChecks(onboarding);
        const students = await AR.fetchStudents(userId);
        const hasStudents = students.length > 0;

        const studentNeedsPriorYears = (student) => {
            if (!AR.isHighSchoolGrade(student.current_grade_level)) return false;
            return student.prior_years_status === 'pending';
        };

        const familyRequiresPriorYears = students.some(studentNeedsPriorYears);

        const priorYearsOk = students.every((student) => {
            if (!AR.isHighSchoolGrade(student.current_grade_level)) return true;
            if (student.prior_years_status === 'complete') return true;
            if (student.prior_years_status === 'not_applicable') return true;
            return false;
        });

        const guideRead = Boolean(onboarding?.guide_read);
        const conductSigned = await isConductSigned(userId, onboarding);
        const idUploaded = await isIdUploaded(userId);

        const items = [
            {
                id: 'students',
                label: 'Add each enrolled student (name and current grade)',
                taskComplete: hasStudents,
                manuallyChecked: Boolean(manualChecks.students),
                incompleteMessage: INCOMPLETE_MESSAGES.students,
                action: 'showDashboardTab(\'academic-records\')',
            },
            {
                id: 'prior_years',
                label: 'Add prior year records',
                detail: 'Optional for K–9. Required for grades 10–12 when prior high school years still need to be added.',
                required: familyRequiresPriorYears,
                taskComplete: priorYearsOk,
                manuallyChecked: Boolean(manualChecks.prior_years),
                incompleteMessage: INCOMPLETE_MESSAGES.prior_years,
                action: 'showDashboardTab(\'academic-records\')',
            },
            {
                id: 'guide',
                label: 'Read how progress reports work',
                taskComplete: guideRead,
                manuallyChecked: Boolean(manualChecks.guide),
                incompleteMessage: INCOMPLETE_MESSAGES.guide,
                action: null,
            },
            {
                id: 'conduct',
                label: 'Sign the Code of Conduct',
                taskComplete: conductSigned,
                manuallyChecked: Boolean(manualChecks.conduct),
                incompleteMessage: INCOMPLETE_MESSAGES.conduct,
                action: null,
            },
            {
                id: 'id',
                label: 'Upload your government-issued ID',
                taskComplete: idUploaded,
                manuallyChecked: Boolean(manualChecks.id),
                incompleteMessage: INCOMPLETE_MESSAGES.id,
                action: null,
            },
        ];

        const requiredItems = items.filter((item) => item.required !== false);
        const allTasksComplete = requiredItems.every((item) => item.taskComplete);
        const allManuallyChecked = requiredItems.every((item) => item.manuallyChecked);
        const canFinish = allTasksComplete && allManuallyChecked;

        return { items, requiredItems, allTasksComplete, allManuallyChecked, canFinish, onboarding };
    }

    async function setGuideReadFlag(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const { data: onboarding } = await client
            .from('family_onboarding')
            .select('manual_checks')
            .eq('family_user_id', userId)
            .maybeSingle();

        const manualChecks = { ...getManualChecks(onboarding), guide: true };

        const { error } = await client
            .from('family_onboarding')
            .upsert({
                family_user_id: userId,
                guide_read: true,
                manual_checks: manualChecks,
            }, { onConflict: 'family_user_id' });
        if (error) throw error;
    }

    async function completeOnboarding(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;
        const now = new Date().toISOString();
        await client
            .from('family_onboarding')
            .upsert({
                family_user_id: userId,
                guide_read: true,
                completed_at: now,
            }, { onConflict: 'family_user_id' });

        await client
            .from('family_documents')
            .delete()
            .eq('user_id', userId)
            .eq('url', ONBOARDING_TASK_URL)
            .ilike('category', '%task%');
    }

    function buildProgressReportGuideBodyHtml(guideRead = false) {
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        const readButtonHtml = guideRead
            ? `<button type="button" class="onboarding-guide-read-btn is-complete" disabled aria-disabled="true">
                    <i class="fas fa-check" aria-hidden="true"></i> Marked as read
               </button>`
            : `<button type="button" class="onboarding-guide-read-btn"
                        onclick="window.OnboardingChecklist.markGuideRead()">I've read this</button>`;
        return `
            <div class="onboarding-progress-guide ar-grade-help">
                <div class="ar-grade-help-header">
                    <span class="ar-grade-help-year">${escapeHtml(schoolYear)}</span>
                    <h3 class="ar-grade-help-title">How progress reports work</h3>
                </div>
                <p class="onboarding-guide-lead">Each student has a <strong>Progress Report</strong> in Academic Records for the current school year.</p>
                <div class="ar-grade-help-grid">
                    <section class="ar-grade-help-block">
                        <h4 class="ar-grade-help-label">What you'll do</h4>
                        <ul class="ar-grade-help-list">
                            <li>Enter <strong>Semester 1</strong> grades and attendance (Jul–Dec), then submit</li>
                            <li>Enter <strong>Semester 2</strong> grades, attendance, and finals (Jan–May), then submit</li>
                            <li>Name each course and tag the subject before submitting</li>
                        </ul>
                    </section>
                    <section class="ar-grade-help-block ar-grade-help-dates">
                        <h4 class="ar-grade-help-label">Tasks &amp; due dates</h4>
                        <dl class="ar-grade-help-dl">
                            <div><dt>Semester 1 task</dt><dd>Dec 1</dd></div>
                            <div><dt>Semester 1 due</dt><dd>Dec 31</dd></div>
                            <div><dt>Semester 2 task</dt><dd>May 1</dd></div>
                            <div><dt>Semester 2 due</dt><dd>May 31</dd></div>
                            <div><dt>Seniors</dt><dd>May 15</dd></div>
                        </dl>
                        <p class="ar-grade-help-note">Progress report tasks appear in My Tasks on the 1st of each semester month and email your family when they open. School year ends May 31.</p>
                    </section>
                </div>
                ${readButtonHtml}
            </div>
        `;
    }

    function buildChecklistItemHtml(item) {
        const borderClass = item.manuallyChecked ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white';

        if (item.id === 'guide') {
            return `
                <div class="onboarding-guide-item rounded-xl border ${borderClass}" id="onboarding-guide">
                    <label class="flex items-start gap-3 p-3 cursor-pointer">
                        <input type="checkbox" class="mt-1 accent-navy onboarding-check-item"
                               data-item-id="${item.id}"
                               ${item.manuallyChecked ? 'checked' : ''}
                               onchange="window.OnboardingChecklist.handleItemToggle('${item.id}', this)">
                        <span class="text-sm text-slate-700 flex-1 font-medium">${escapeHtml(item.label)}</span>
                    </label>
                    <div class="onboarding-guide-body">
                        ${buildProgressReportGuideBodyHtml(item.taskComplete)}
                    </div>
                </div>
            `;
        }

        return `
            <label class="flex items-start gap-3 p-3 rounded-xl border ${borderClass}">
                <input type="checkbox" class="mt-1 accent-navy onboarding-check-item"
                       data-item-id="${item.id}"
                       ${item.manuallyChecked ? 'checked' : ''}
                       onchange="window.OnboardingChecklist.handleItemToggle('${item.id}', this)">
                <span class="text-sm text-slate-700 flex-1">
                    ${escapeHtml(item.label)}
                    ${item.detail ? `<span class="block text-xs text-slate-500 mt-0.5 font-normal">${escapeHtml(item.detail)}</span>` : ''}
                </span>
                ${item.action ? `<button type="button" class="text-xs text-navy underline shrink-0" onclick="${item.action}">Open</button>` : ''}
            </label>
        `;
    }

    function buildOnboardingCardBannerHtml(items, canFinish) {
        const doneCount = items.filter((item) => item.taskComplete && item.manuallyChecked).length;
        const totalCount = items.length;
        const readyClass = canFinish ? ' is-ready' : '';

        const headline = canFinish
            ? 'You\'re ready to finish!'
            : 'Complete your family setup';
        const subtitle = canFinish
            ? 'Every step is done — tap the button below to close out this checklist.'
            : 'Work through each step below, then check it off. This stays in My Tasks until everything is finished.';

        return `
            <div class="onboarding-task-card__banner">
                <div class="onboarding-task-card__banner-icon" aria-hidden="true">
                    <i class="fas fa-clipboard-check"></i>
                </div>
                <div class="onboarding-task-card__banner-copy">
                    <p class="onboarding-task-card__eyebrow">Required setup</p>
                    <h4 class="onboarding-task-card__title">${escapeHtml(headline)}</h4>
                    <p class="onboarding-task-card__subtitle">${escapeHtml(subtitle)}</p>
                    <p class="onboarding-task-card__progress">
                        <i class="fas fa-${canFinish ? 'check-circle' : 'list-check'}" aria-hidden="true"></i>
                        ${doneCount} of ${totalCount} steps complete
                    </p>
                </div>
            </div>
        `;
    }

    async function renderOnboardingTaskCard(task, cachedState = null) {
        const client = window.supabaseClient;
        const { data: { user } } = await client.auth.getUser();
        if (!user) return '';

        const { items, canFinish } = cachedState || await getChecklistState(user.id);
        const list = items.map((item) => buildChecklistItemHtml(item)).join('');
        const readyClass = canFinish ? ' is-ready' : '';

        return `
            <div class="onboarding-task-card${readyClass}" id="onboarding-task-card">
                ${buildOnboardingCardBannerHtml(items, canFinish)}
                <div class="onboarding-task-card__body">
                    <p class="onboarding-task-card__lede">${escapeHtml(task.description || 'Complete every step, check each box, then finish this checklist.')}</p>
                    <div class="onboarding-task-card__items space-y-2">${list}</div>
                    <button type="button" class="onboarding-task-card__finish-btn mt-4 w-full py-3 bg-navy hover:bg-[#0F3A5F] text-white font-semibold rounded-2xl text-sm ${canFinish ? '' : 'opacity-50 cursor-not-allowed'}"
                            ${canFinish ? '' : 'disabled'}
                            onclick="window.OnboardingChecklist.finish()">
                        Complete setup checklist
                    </button>
                    ${!canFinish ? '<p class="mt-2 text-xs text-slate-600 text-center">Prior year records are optional for K–9. Grades 10–12 may need prior high school years added.</p>' : ''}
                </div>
            </div>
        `;
    }

    async function refreshOnboardingTaskCard(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return false;

        const existingCard = document.getElementById('onboarding-task-card');
        if (!existingCard) return false;

        const tasks = await fetchActiveTasks(userId);
        const onboardingTask = tasks.find(isOnboardingTask);
        if (!onboardingTask) return false;

        const state = await getChecklistState(userId);
        const html = await renderOnboardingTaskCard(onboardingTask, state);
        const template = document.createElement('template');
        template.innerHTML = html.trim();
        const newCard = template.content.firstElementChild;
        if (!newCard) return false;

        existingCard.replaceWith(newCard);
        return true;
    }

    async function handleItemToggle(itemId, checkbox) {
        const client = window.supabaseClient;
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;

        if (!checkbox.checked) {
            try {
                await setManualCheck(user.id, itemId, false);
                await refreshOnboardingTaskCard(user.id);
            } catch (err) {
                checkbox.checked = true;
                await window.showAppAlert?.(err.message || String(err));
            }
            return;
        }

        const { items } = await getChecklistState(user.id);
        const item = items.find((entry) => entry.id === itemId);
        if (!item?.taskComplete) {
            checkbox.checked = false;
            await window.showAppAlert?.(item?.incompleteMessage || INCOMPLETE_MESSAGES[itemId] || 'Please complete this step first.');
            return;
        }

        try {
            await setManualCheck(user.id, itemId, true);
            const refreshed = await refreshOnboardingTaskCard(user.id);
            if (!refreshed && typeof window.loadMyTasks === 'function') {
                await window.loadMyTasks({ force: true });
            }
        } catch (err) {
            checkbox.checked = false;
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function markGuideRead() {
        const client = window.supabaseClient;
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;
        try {
            await setGuideReadFlag(user.id);
            const refreshed = await refreshOnboardingTaskCard(user.id);
            if (!refreshed && typeof window.loadMyTasks === 'function') {
                await window.loadMyTasks({ force: true });
            }
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function finish() {
        const client = window.supabaseClient;
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;

        const { items, allTasksComplete, allManuallyChecked, canFinish } = await getChecklistState(user.id);
        if (!allManuallyChecked) {
            await window.showAppAlert?.('Please check off every required item on the checklist before finishing.');
            return;
        }
        if (!allTasksComplete) {
            const pending = items.filter((item) => item.required !== false && !item.taskComplete).map((item) => item.label);
            await window.showAppAlert?.(`These steps still need to be completed:\n\n• ${pending.join('\n• ')}`);
            return;
        }
        if (!canFinish) {
            await window.showAppAlert?.('Please complete and check off every checklist item first.');
            return;
        }

        try {
            await completeOnboarding(user.id);
            if (typeof window.loadMyTasks === 'function') await window.loadMyTasks({ force: true });
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function refresh() {
        const client = window.supabaseClient;
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;

        const refreshed = await refreshOnboardingTaskCard(user.id);
        if (!refreshed && typeof window.loadMyTasks === 'function') {
            await window.loadMyTasks({ force: true });
        }
    }

    async function getAdminOnboardingSummary(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return { status: 'unknown' };

        let { data: onboarding, error } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();

        if (error) {
            console.warn('[Onboarding] Could not load admin onboarding summary:', error.message);
            return { status: 'error', message: error.message };
        }

        onboarding = await syncConductStateFromDocuments(userId, onboarding);
        const { reopened, onboarding: reopenedOnboarding } = await reopenInvalidOnboardingCompletion(userId, onboarding);
        if (reopened) onboarding = reopenedOnboarding || onboarding;

        if (onboarding?.completed_at && await isConductActuallySigned(userId, onboarding)) {
            return {
                status: 'completed',
                completedAt: onboarding.completed_at,
                manualChecks: getManualChecks(onboarding),
            };
        }

        const tasks = await fetchActiveTasks(userId);
        const hasOnboardingTask = tasks.some(isOnboardingTask);

        if (hasOnboardingTask || onboarding) {
            const state = await getChecklistState(userId);
            const items = state?.items || [];
            const pendingLabels = items
                .filter((item) => !(item.taskComplete && item.manuallyChecked))
                .map((item) => (
                    item.required === false
                        ? `${item.label} (optional for K–9)`
                        : item.label
                ));

            return {
                status: 'in_progress',
                doneCount: items.filter((item) => item.taskComplete && item.manuallyChecked).length,
                totalCount: items.length,
                pendingLabels,
            };
        }

        return { status: 'missing' };
    }

    window.OnboardingChecklist = {
        ONBOARDING_TASK_TITLE,
        ONBOARDING_TASK_URL,
        CODE_OF_CONDUCT_TITLE,
        CODE_OF_CONDUCT_SIGNED_TITLE,
        CODE_OF_CONDUCT_URL,
        CODE_OF_CONDUCT_SLUG,
        ID_TASK_TITLE,
        isOnboardingTask,
        isCodeOfConductTask,
        hasCodeOfConductTask,
        isIdUploadTask,
        isConductSigned,
        isConductActuallySigned,
        isConductMarkedComplete,
        hasSignedCodeOfConductDocument,
        markConductCompleted,
        removeStaleCodeOfConductTasks,
        removeStaleIdUploadTasks,
        markIdSubmitted,
        hasIdSubmissionOnFile,
        sortTasksForDisplay,
        setupFamilyOnApproval,
        repairFamilyOnboardingIfNeeded,
        assignSetupTasksViaRpc,
        syncConductStateFromDocuments,
        forceReopenFamilySetup,
        forceAssignSetupTasks: forceReopenFamilySetup,
        needsCodeOfConductTask,
        isOnboardingCompleted,
        getAdminOnboardingSummary,
        renderOnboardingTaskCard,
        handleItemToggle,
        markGuideRead,
        finish,
        refresh,
        refreshOnboardingTaskCard,
        getChecklistState,
        reopenIdUploadTaskAfterDenial,
        buildIdTaskDescriptionAfterDenial,
        assignIdTaskOnApproval,
        setManualCheck,
    };
})();