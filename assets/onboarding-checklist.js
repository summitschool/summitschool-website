(function () {
    const ONBOARDING_TASK_TITLE = 'Family Hub Setup Checklist';
    const ONBOARDING_TASK_URL = 'hub://onboarding';
    const ONBOARDING_TASK_CATEGORY = 'Onboarding (Task)';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    async function ensureOnboardingTask(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const { data: existing } = await client
            .from('family_documents')
            .select('id')
            .eq('user_id', userId)
            .eq('url', ONBOARDING_TASK_URL)
            .ilike('category', '%task%')
            .maybeSingle();
        if (existing?.id) return;

        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        const { error } = await client.from('family_documents').insert({
            user_id: userId,
            title: ONBOARDING_TASK_TITLE,
            description: 'Complete these setup steps for your Family Hub account. This checklist closes automatically when finished.',
            url: ONBOARDING_TASK_URL,
            category: ONBOARDING_TASK_CATEGORY,
            school_year: schoolYear,
            due_date_1: softDueDate(14),
            due_date_1_cleared: false,
        });
        if (error) console.warn('[Onboarding] Could not create checklist task:', error.message);
    }

    async function assignIdTaskOnApproval(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;

        const ID_TITLE = 'Upload Government Issued ID (required)';
        const { data: existing } = await client
            .from('family_documents')
            .select('id')
            .eq('user_id', userId)
            .ilike('title', '%Upload Government Issued ID%')
            .ilike('category', '%task%')
            .maybeSingle();
        if (existing?.id) return;

        const { data: stds } = await client
            .from('standard_documents')
            .select('*')
            .ilike('title', '%Upload Government Issued ID%')
            .limit(1);

        const std = stds?.[0];
        const schoolYear = window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
        const { error } = await client.from('family_documents').insert({
            user_id: userId,
            title: std?.title || ID_TITLE,
            description: std?.description || 'Upload a clear photo of your current valid driver\'s license or government-issued photo ID.',
            url: std?.url || '',
            category: (std?.category || 'Verification') + ' (Task)',
            school_year: schoolYear,
            due_date_1: softDueDate(14),
            due_date_1_cleared: false,
        });
        if (error) console.warn('[Onboarding] Could not auto-assign ID task:', error.message);
    }

    async function setupFamilyOnApproval(userId) {
        await ensureOnboardingRow(userId);
        await ensureOnboardingTask(userId);
        await assignIdTaskOnApproval(userId);
    }

    async function getChecklistState(userId) {
        const client = window.supabaseClient;
        const AR = window.AcademicRecords;
        if (!client || !userId || !AR) {
            return { items: [], allComplete: false };
        }

        await ensureOnboardingRow(userId);
        const { data: onboarding } = await client
            .from('family_onboarding')
            .select('*')
            .eq('family_user_id', userId)
            .maybeSingle();

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

        // High school students joining mid-stream need backfill OR explicit not_applicable only when
        // they truly started with Summit — for HS, not_applicable means no years before Summit to report.

        const items = [
            {
                id: 'students',
                label: 'Add each enrolled student (name and current grade)',
                complete: hasStudents,
                action: 'showDashboardTab(\'academic-records\')',
            },
            {
                id: 'prior_years',
                label: 'Add prior year records for high school students, or mark "no prior years"',
                complete: priorYearsOk,
                action: 'showDashboardTab(\'academic-records\')',
            },
            {
                id: 'guide',
                label: 'Read how progress reports work in Academic Records',
                complete: guideRead,
                action: null,
            },
        ];

        const allComplete = items.every((item) => item.complete);
        return { items, allComplete, onboarding };
    }

    async function setGuideReadFlag(userId) {
        const client = window.supabaseClient;
        if (!client || !userId) return;
        const { error } = await client
            .from('family_onboarding')
            .upsert({
                family_user_id: userId,
                guide_read: true,
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

        const { items, allComplete } = await getChecklistState(user.id);

        const list = items.map((item) => `
            <label class="flex items-start gap-3 p-3 rounded-xl border ${item.complete ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'}">
                <input type="checkbox" class="mt-1 accent-navy" ${item.complete ? 'checked disabled' : ''}
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
                    <p>The school year ends <strong>May 31</strong>. Grades submitted after a due date still count toward that school year.</p>
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
                <div class="mt-4 space-y-2">${list}</div>
                ${guideBlock}
                <button type="button" class="mt-4 w-full py-3 bg-navy hover:bg-[#0F3A5F] text-white font-semibold rounded-2xl text-sm ${allComplete ? '' : 'opacity-50 cursor-not-allowed'}"
                        ${allComplete ? '' : 'disabled'}
                        onclick="window.OnboardingChecklist.finish()">
                    Complete setup checklist
                </button>
                ${!allComplete ? '<p class="mt-2 text-xs text-slate-500 text-center">Check off every item above to finish.</p>' : ''}
            </div>
        `;
    }

    async function handleItemToggle(itemId, checkbox) {
        if (itemId !== 'guide' || checkbox.checked) return;
        checkbox.checked = false;
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
        const { allComplete } = await getChecklistState(user.id);
        if (!allComplete) {
            await window.showAppAlert?.('Please complete every checklist item first.');
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
        isOnboardingTask,
        setupFamilyOnApproval,
        renderOnboardingTaskCard,
        handleItemToggle,
        markGuideRead,
        finish,
        refresh,
        getChecklistState,
    };
})();