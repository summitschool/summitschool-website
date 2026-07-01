(function () {
    const KG_TASK_PREFIX = 'Kindergarten Graduation —';
    const KG_TASK_URL_PREFIX = 'hub://kindergarten-graduation/';
    const KG_TASK_CATEGORY = 'Kindergarten Graduation (Task)';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getClient() {
        return window.supabaseClient || null;
    }

    function currentSchoolYear() {
        return window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
    }

    function studentDisplayName(student) {
        if (window.AcademicRecords?.studentDisplayName) {
            return window.AcademicRecords.studentDisplayName(student);
        }
        return [student?.first_name, student?.last_name].filter(Boolean).join(' ').trim() || 'Student';
    }

    function parseKindergartenGraduationStudentId(taskUrl) {
        const url = String(taskUrl || '');
        if (!url.startsWith(KG_TASK_URL_PREFIX)) return null;
        return url.slice(KG_TASK_URL_PREFIX.length).trim() || null;
    }

    function formatDateLabel(value) {
        if (!value) return 'TBA';
        try {
            const [y, m, d] = String(value).split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            });
        } catch (err) {
            return String(value);
        }
    }

    function isTaskOverdue(dueDate) {
        if (!dueDate) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(`${dueDate}T00:00:00`);
        return due < today;
    }

    async function fetchKindergartenGraduationSettings(schoolYear, clientOverride) {
        const client = clientOverride || getClient();
        if (!client) return null;
        const year = schoolYear || currentSchoolYear();
        const { data } = await client
            .from('kindergarten_graduation_settings')
            .select('*')
            .eq('school_year', year)
            .maybeSingle();
        return data;
    }

    async function fetchSubmissionForStudent(studentId, schoolYear) {
        const client = getClient();
        if (!client || !studentId) return null;
        const { data } = await client
            .from('kindergarten_graduation_submissions')
            .select('*')
            .eq('student_id', studentId)
            .eq('school_year', schoolYear || currentSchoolYear())
            .maybeSingle();
        return data;
    }

    function submissionStatusLabel(submission) {
        if (!submission) return 'Not started';
        if (submission.status === 'pending_review') return 'Submitted — awaiting school review';
        if (submission.status === 'changes_requested') return 'Changes requested — please update and resubmit';
        if (submission.status === 'approved') return 'Approved';
        return 'In progress';
    }

    async function ensureKindergartenGraduationTask(student, schoolYear) {
        const client = getClient();
        const { data: { user } } = await client?.auth.getUser() || { data: {} };
        if (!client || !user || !student?.id) return;
        if (String(student.current_grade_level) !== 'K') return;

        const settings = await fetchKindergartenGraduationSettings(schoolYear);
        const title = `${KG_TASK_PREFIX} ${studentDisplayName(student)}`;
        const url = `${KG_TASK_URL_PREFIX}${student.id}`;
        const dueDate = settings?.dues_due_date || `${String(schoolYear).split('-')[1]}-03-01`;

        const { data: existing } = await client
            .from('family_documents')
            .select('id')
            .eq('user_id', user.id)
            .eq('url', url)
            .ilike('category', '%task%')
            .maybeSingle();

        if (existing?.id) return;

        const ceremony = settings?.ceremony_date;
        const desc = ceremony
            ? `Complete kindergarten graduation orders and payment. Ceremony: ${formatDateLabel(ceremony)}.`
            : 'Complete your kindergartener\'s graduation order when the form opens in the Family Hub.';

        const { error } = await client.from('family_documents').insert({
            user_id: user.id,
            title,
            description: desc,
            url,
            category: KG_TASK_CATEGORY,
            school_year: schoolYear,
            due_date_1: dueDate,
            due_date_1_cleared: false,
        });
        if (error) {
            console.warn('[Kindergarten Graduation] Could not create task:', error.message);
            return;
        }
        void window.TaskNotify?.scanUserTasks?.(client, { force: true });
    }

    async function removeKindergartenGraduationTask(studentId, familyUserId) {
        const client = getClient();
        if (!client || !studentId) return;
        const url = `${KG_TASK_URL_PREFIX}${studentId}`;
        let query = client
            .from('family_documents')
            .delete()
            .eq('url', url)
            .ilike('category', '%task%');
        if (familyUserId) query = query.eq('user_id', familyUserId);
        await query;
    }

    async function renderKindergartenGraduationTaskCard(task, studentId, options = {}) {
        const client = getClient();
        let student = options.student;
        if (!student) {
            const { data } = await client.from('students').select('*').eq('id', studentId).maybeSingle();
            student = data;
        }
        if (!student) {
            return '<div class="hub-panel hub-panel-padded text-sm text-red-600">Student record not found for this task.</div>';
        }

        const schoolYear = task.school_year || currentSchoolYear();
        const settings = options.settings || await fetchKindergartenGraduationSettings(schoolYear);
        const submission = options.submission || await fetchSubmissionForStudent(studentId, schoolYear);
        const name = studentDisplayName(student);
        const statusLabel = submissionStatusLabel(submission);
        const dueDate = task.due_date_1 || settings?.dues_due_date;
        const overdue = isTaskOverdue(dueDate);
        const dueClass = overdue ? 'text-red-600' : 'text-slate-500';
        const overdueIcon = overdue
            ? '<span class="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-red-100 text-red-600" title="Overdue"><i class="fas fa-exclamation text-sm"></i></span>'
            : (options.overdueIcon || '');

        const hubUrl = `kindergarten-graduation-hub.html?student=${encodeURIComponent(studentId)}`;

        return `
            <div class="hub-surface-card relative" id="kindergarten-graduation-task-${studentId}">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <h4 class="font-semibold text-lg text-navy">${escapeHtml(task.title)}</h4>
                        <p class="text-sm text-slate-600 mt-1">Complete ${escapeHtml(name)}'s kindergarten graduation order in the Family Hub.</p>
                        <p class="text-xs font-medium text-slate-500 mt-2">${escapeHtml(statusLabel)}</p>
                        <div class="mt-2 space-y-0.5">
                            <div class="text-xs font-semibold ${dueClass}">Order due ${escapeHtml(formatDateLabel(dueDate))}</div>
                            ${settings?.ceremony_date ? `<div class="text-xs font-semibold text-slate-500">Ceremony ${escapeHtml(formatDateLabel(settings.ceremony_date))}</div>` : ''}
                        </div>
                    </div>
                    ${overdueIcon}
                </div>
                <a href="${hubUrl}"
                   class="mt-4 block w-full py-3 bg-navy hover:bg-[#0F3A5F] text-white font-semibold rounded-2xl text-sm text-center transition-all active:scale-[0.985]">
                    Open Kindergarten Graduation Hub
                </a>
            </div>
        `;
    }

    window.KindergartenGraduationTasks = {
        KG_TASK_PREFIX,
        KG_TASK_URL_PREFIX,
        KG_TASK_CATEGORY,
        currentSchoolYear,
        studentDisplayName,
        parseKindergartenGraduationStudentId,
        ensureKindergartenGraduationTask,
        removeKindergartenGraduationTask,
        renderKindergartenGraduationTaskCard,
        fetchKindergartenGraduationSettings,
        fetchSubmissionForStudent,
        formatDateLabel,
    };
})();