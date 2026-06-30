(function () {
    const ONBOARDING_TASK_TITLE = 'Family Hub Setup Checklist';
    const ONBOARDING_TASK_URL = 'hub://onboarding';
    const ONBOARDING_TASK_CATEGORY = 'Onboarding (Task)';
    const CODE_OF_CONDUCT_TITLE = 'Sign Code of Conduct (required)';
    const ID_TASK_TITLE = 'Upload Government Issued ID (required)';

    const INCOMPLETE_MESSAGES = {
        students: 'Add each enrolled student in Academic Records (name and current grade), then check this box.',
        prior_years: 'Add prior year records for high school students, or mark "no prior years" in Academic Records, then check this box.',
        guide: 'Open "How progress reports work" below and click "I\'ve read this" before checking this box.',
        conduct: 'Sign the Code of Conduct form in My Tasks before checking this box.',
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
        return String(task.title || '').toLowerCase().includes('code of conduct');
    }

    function isIdUploadTask(task) {
        return String(task.title || '').toLowerCase().includes('upload government issued id');
    }

    function getTaskSortRank(task) {
        if (isOnboardingTask(task)) return 0;
        if (isCodeOfConductTask(task)) return 1;
        if (isIdUploadTask(task)) return 2;
        if (window.AcademicRecords?.parseProgressReportStudentId?.(task.url)) return 3;
        return 4;
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

    async function isConductSigned(userId) {
        const tasks = await fetchActiveTasks(userId);
        return !tasks.some(isCodeOfConductTask);
    }

    async function isIdUploaded(userId) {
        const tasks = await fetchActiveTasks(userId);
        if (tasks.some(isIdUploadTask)) return false;

        const client = window.supabaseClient;
        const { data: uploads } = await client
            .from('id_uploads')
            .select('id')
            .eq('user_id', userId)
            .limit(1);
        if (uploads?.length) return true;

        const { data: idDocs } = await client
            .from('family_documents')
            .select('id')
            .eq('user_id', userId)
            .ilike('category', '%ID%')
            .limit(1);
        return Boolean(idDocs?.length);
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

    async function insertTaskIfMissing(userId, matchFn, payload) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const { data: docs } = await client
            .from('family_documents')
            .select('id, title, url, category')
            .eq('user_id', userId);

        const existing = (docs || []).find((doc) => isTaskDocument(doc) && matchFn(doc));
        if (existing?.id) return;

        const { error } = await client.from('family_documents').insert(payload);
        if (error) console.warn('[Onboarding] Could not create task:', error.message);
    }

    async function ensureOnboardingTask(userId) {
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        await insertTaskIfMissing(
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
            }
        );
    }

    async function assignCodeOfConductTaskOnApproval(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const { data: stds } = await client
            .from('standard_documents')
            .select('*')
            .ilike('title', '%code of conduct%')
            .limit(1);

        const std = stds?.[0];
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        await insertTaskIfMissing(
            userId,
            isCodeOfConductTask,
            {
                user_id: userId,
                title: std?.title || CODE_OF_CONDUCT_TITLE,
                description: std?.description || 'Read and sign the Summit Church School Code of Conduct.',
                url: std?.url || '',
                category: (std?.category || 'Policy') + ' (Task)',
                school_year: schoolYear,
                due_date_1: softDueDate(14),
                due_date_1_cleared: false,
            }
        );
    }

    async function assignIdTaskOnApproval(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const { data: stds } = await client
            .from('standard_documents')
            .select('*')
            .ilike('title', '%Upload Government Issued ID%')
            .limit(1);

        const std = stds?.[0];
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        await insertTaskIfMissing(
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
            }
        );
    }

    async function setupFamilyOnApproval(userId) {
        await ensureOnboardingRow(userId);
        await ensureOnboardingTask(userId);
        await assignCodeOfConductTaskOnApproval(userId);
        await assignIdTaskOnApproval(userId);
    }

    function getManualChecks(onboarding) {
        const raw = onboarding?.manual_checks;
        return raw && typeof raw === 'object' ? raw : {};
    }

    async function setManualCheck(userId, itemId, checked) {
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
        if (error) throw error;
    }

    async function getChecklistState(userId) {
        const client = window.supabaseClient;
        const AR = window.AcademicRecords;
        if (!client || !userId || !AR) {
            return { items: [], allTasksComplete: false, allManuallyChecked: false, canFinish: false };
        }

        await ensureOnboardingRow(userId);
        const { data: onboarding } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();

        if (!onboarding?.completed_at) {
            const activeTasks = await fetchActiveTasks(userId);
            if (activeTasks.some(isOnboardingTask)) {
                await assignCodeOfConductTaskOnApproval(userId);
                await assignIdTaskOnApproval(userId);
            }
        }

        const manualChecks = getManualChecks(onboarding);
        const students = await AR.fetchStudents(userId);
        const hasStudents = students.length > 0;

        let priorYearsOk = true;
        if (hasStudents) {
            priorYearsOk = students.every((student) => {
                if (!AR.isHighSchoolGrade(student.current_grade_level)) {
                    return student.prior_years_status === 'not_applicable' || student.prior_years_status === 'complete';
                }
                if (student.prior_years_status === 'complete') return true;
                if (student.current_grade_level === '9' && student.prior_years_status === 'not_applicable') return true;
                return false;
            });
        } else {
            priorYearsOk = false;
        }

        const guideRead = Boolean(onboarding?.guide_read);
        const conductSigned = await isConductSigned(userId);
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
                label: 'Add prior year records for high school students, or mark "no prior years"',
                taskComplete: priorYearsOk,
                manuallyChecked: Boolean(manualChecks.prior_years),
                incompleteMessage: INCOMPLETE_MESSAGES.prior_years,
                action: 'showDashboardTab(\'academic-records\')',
            },
            {
                id: 'guide',
                label: 'Read how progress reports work in Academic Records',
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

        const allTasksComplete = items.every((item) => item.taskComplete);
        const allManuallyChecked = items.every((item) => item.manuallyChecked);
        const canFinish = allTasksComplete && allManuallyChecked;

        return { items, allTasksComplete, allManuallyChecked, canFinish, onboarding };
    }

    async function setGuideReadFlag(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const { data: onboarding } = await client
            .from('family_onboarding')
            .select('manual_checks')
            .eq('family_user_id', userId)
            .maybeSingle();

        const { error } = await client
            .from('family_onboarding')
            .upsert({
                family_user_id: userId,
                guide_read: true,
                manual_checks: getManualChecks(onboarding),
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

    async function renderOnboardingTaskCard(task) {
        const client = window.supabaseClient;
        const { data: { user } } = await client.auth.getUser();
        if (!user) return '';

        const { items, canFinish } = await getChecklistState(user.id);

        const list = items.map((item) => `
            <label class="flex items-start gap-3 p-3 rounded-xl border ${item.manuallyChecked ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}">
                <input type="checkbox" class="mt-1 accent-navy onboarding-check-item"
                       data-item-id="${item.id}"
                       ${item.manuallyChecked ? 'checked' : ''}
                       onchange="window.OnboardingChecklist.handleItemToggle('${item.id}', this)">
                <span class="text-sm text-slate-700 flex-1">${escapeHtml(item.label)}</span>
                ${item.action ? `<button type="button" class="text-xs text-navy underline shrink-0" onclick="${item.action}">Open</button>` : ''}
            </label>
        `).join('');

        const guideBlock = `
            <details class="mt-3 border border-slate-200 rounded-2xl bg-white" id="onboarding-guide">
                <summary class="px-4 py-3 cursor-pointer text-sm font-semibold text-navy">How progress reports work</summary>
                <div class="px-4 pb-4 text-sm text-slate-600 space-y-2 border-t border-slate-100 pt-3">
                    <p>Each student has a <strong>Progress Report</strong> in Academic Records for the current school year.</p>
                    <p><strong>Semester 1</strong> (Jul–Dec) is due <strong>Dec 31</strong>. Enter grades and attendance, then submit.</p>
                    <p><strong>Semester 2</strong> (Jan–May) is due <strong>May 31</strong> (seniors <strong>May 15</strong>). Enter Semester 2 grades, attendance, and finals, then submit.</p>
                    <p>The school year ends <strong>May 31</strong>.</p>
                    <p class="text-xs text-slate-500">Contact the school office if you need a locked semester reopened.</p>
                    <button type="button" class="mt-2 px-4 py-2 text-sm font-semibold bg-navy text-white rounded-xl"
                            onclick="window.OnboardingChecklist.markGuideRead()">I've read this</button>
                </div>
            </details>
        `;

        return `
            <div class="hub-panel hub-panel-padded border-navy/20 !bg-slate-50" id="onboarding-task-card">
                <h4 class="font-semibold text-lg text-navy">${escapeHtml(task.title)}</h4>
                <p class="text-sm text-slate-600 mt-1">${escapeHtml(task.description || '')}</p>
                <p class="text-xs text-slate-500 mt-2">Complete each step, then check it off. The checklist stays until every box is checked and every step is finished.</p>
                <div class="mt-4 space-y-2">${list}</div>
                ${guideBlock}
                <button type="button" class="mt-4 w-full py-3 bg-navy hover:bg-[#0F3A5F] text-white font-semibold rounded-2xl text-sm ${canFinish ? '' : 'opacity-50 cursor-not-allowed'}"
                        ${canFinish ? '' : 'disabled'}
                        onclick="window.OnboardingChecklist.finish()">
                    Complete setup checklist
                </button>
                ${!canFinish ? '<p class="mt-2 text-xs text-slate-500 text-center">Check off every item above after you finish each step.</p>' : ''}
            </div>
        `;
    }

    async function handleItemToggle(itemId, checkbox) {
        const client = window.supabaseClient;
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;

        if (!checkbox.checked) {
            try {
                await setManualCheck(user.id, itemId, false);
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
            if (typeof window.loadMyTasks === 'function') await window.loadMyTasks();
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
            if (typeof window.loadMyTasks === 'function') await window.loadMyTasks();
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
            await window.showAppAlert?.('Please check off every item on the checklist before finishing.');
            return;
        }
        if (!allTasksComplete) {
            const pending = items.filter((item) => !item.taskComplete).map((item) => item.label);
            await window.showAppAlert?.(`These steps still need to be completed:\n\n• ${pending.join('\n• ')}`);
            return;
        }
        if (!canFinish) {
            await window.showAppAlert?.('Please complete and check off every checklist item first.');
            return;
        }

        try {
            await completeOnboarding(user.id);
            if (typeof window.loadMyTasks === 'function') await window.loadMyTasks();
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function refresh() {
        if (typeof window.loadMyTasks === 'function') await window.loadMyTasks();
    }

    window.OnboardingChecklist = {
        ONBOARDING_TASK_TITLE,
        ONBOARDING_TASK_URL,
        CODE_OF_CONDUCT_TITLE,
        ID_TASK_TITLE,
        isOnboardingTask,
        isCodeOfConductTask,
        isIdUploadTask,
        sortTasksForDisplay,
        setupFamilyOnApproval,
        renderOnboardingTaskCard,
        handleItemToggle,
        markGuideRead,
        finish,
        refresh,
        getChecklistState,
    };
})();