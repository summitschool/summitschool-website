(function () {
    const GRADE_LEVELS = ['K3', 'K4', 'K5', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    const HIGH_SCHOOL_GRADES = new Set(['9', '10', '11', '12']);
    const CORE_COURSES = [
        'English / Language Arts',
        'Math',
        'Science',
        'Social Studies / History',
        'Reading',
        'Bible',
        'Physical Education',
    ];

    const PROGRESS_TASK_PREFIX = 'Progress Report —';
    const PROGRESS_TASK_URL_PREFIX = 'hub://progress-report/';
    const PROGRESS_TASK_CATEGORY = 'Progress Report (Task)';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isHighSchoolGrade(level) {
        return HIGH_SCHOOL_GRADES.has(String(level || '').trim());
    }

    function schoolYearEndDate(schoolYear) {
        const endYear = parseInt(String(schoolYear).split('-')[1], 10);
        if (!Number.isFinite(endYear)) return null;
        return new Date(`${endYear}-06-30T23:59:59`);
    }

    function isSchoolYearClosed(schoolYear) {
        const end = schoolYearEndDate(schoolYear);
        if (!end) return false;
        return Date.now() > end.getTime();
    }

    function currentSchoolYear(date = new Date()) {
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const startYear = month >= 7 ? year : year - 1;
        return `${startYear}-${startYear + 1}`;
    }

    function priorSchoolYears(count = 5, fromYear = currentSchoolYear()) {
        const start = parseInt(String(fromYear).split('-')[0], 10);
        const years = [];
        for (let i = 1; i <= count; i += 1) {
            const y = start - i;
            years.push(`${y}-${y + 1}`);
        }
        return years;
    }

    function defaultProgressDueDates(schoolYear) {
        const start = parseInt(String(schoolYear).split('-')[0], 10);
        const end = start + 1;
        return {
            due_date_1: `${start}-12-15`,
            due_date_2: `${end}-05-15`,
        };
    }

    function studentDisplayName(student) {
        return [student.first_name, student.last_name].filter(Boolean).join(' ').trim();
    }

    function parseProgressReportStudentId(taskUrl) {
        const url = String(taskUrl || '');
        if (!url.startsWith(PROGRESS_TASK_URL_PREFIX)) return null;
        return url.slice(PROGRESS_TASK_URL_PREFIX.length).trim() || null;
    }

    async function getClient() {
        if (!window.supabaseClient) return null;
        return window.supabaseClient;
    }

    async function getCurrentUser() {
        const client = await getClient();
        if (!client) return null;
        const { data: { user } } = await client.auth.getUser();
        return user;
    }

    async function fetchStudents(userId) {
        const client = await getClient();
        if (!client || !userId) return [];
        const { data, error } = await client
            .from('students')
            .select('*')
            .eq('family_user_id', userId)
            .eq('active', true)
            .order('first_name', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function ensureCurrentSchoolYearRecord(studentId, gradeLevel) {
        const client = await getClient();
        const year = currentSchoolYear();
        const { data: existing, error: fetchError } = await client
            .from('student_school_years')
            .select('*')
            .eq('student_id', studentId)
            .eq('school_year', year)
            .maybeSingle();
        if (fetchError) throw fetchError;
        if (existing) return existing;

        const { data, error } = await client
            .from('student_school_years')
            .insert({
                student_id: studentId,
                school_year: year,
                grade_level: gradeLevel,
                entry_type: 'current',
            })
            .select('*')
            .single();
        if (error) throw error;
        await seedCoreCourses(data.id);
        return data;
    }

    async function seedCoreCourses(schoolYearRecordId) {
        const client = await getClient();
        const rows = CORE_COURSES.map((course, index) => ({
            school_year_record_id: schoolYearRecordId,
            course_name: course,
            is_core: true,
            sort_order: index,
        }));
        const { error } = await client.from('grade_entries').insert(rows);
        if (error) throw error;
    }

    async function ensureProgressReportTask(student, schoolYear = currentSchoolYear()) {
        const client = await getClient();
        const user = await getCurrentUser();
        if (!client || !user || !student?.id) return;

        const title = `${PROGRESS_TASK_PREFIX} ${studentDisplayName(student)}`;
        const url = `${PROGRESS_TASK_URL_PREFIX}${student.id}`;
        const dues = defaultProgressDueDates(schoolYear);

        const { data: existing } = await client
            .from('family_documents')
            .select('id')
            .eq('user_id', user.id)
            .eq('url', url)
            .ilike('category', '%task%')
            .maybeSingle();

        if (existing?.id) return;

        const { error } = await client.from('family_documents').insert({
            user_id: user.id,
            title,
            description: `Enter ${schoolYear} semester grades for ${studentDisplayName(student)}. Semester 1 is due in December; Semester 2 and final grades in May.`,
            url,
            category: PROGRESS_TASK_CATEGORY,
            school_year: schoolYear,
            due_date_1: dues.due_date_1,
            due_date_2: dues.due_date_2,
            due_date_1_cleared: false,
        });
        if (error) console.warn('[Academic Records] Could not create progress task:', error.message);
    }

    async function removeProgressReportTaskIfComplete(studentId, yearRecord) {
        if (!yearRecord?.semester_2_locked) return;
        const client = await getClient();
        const user = await getCurrentUser();
        if (!client || !user) return;
        const url = `${PROGRESS_TASK_URL_PREFIX}${studentId}`;
        await client
            .from('family_documents')
            .delete()
            .eq('user_id', user.id)
            .eq('url', url)
            .ilike('category', '%task%');
    }

    async function addStudent(formData) {
        const client = await getClient();
        const user = await getCurrentUser();
        if (!client || !user) throw new Error('You must be logged in.');

        const firstName = String(formData.first_name || '').trim();
        const lastName = String(formData.last_name || '').trim();
        const gradeLevel = String(formData.grade_level || '').trim();
        if (!firstName || !gradeLevel) throw new Error('First name and grade level are required.');

        const priorStatus = !isHighSchoolGrade(gradeLevel)
            ? 'not_applicable'
            : (gradeLevel === '9' ? 'not_applicable' : 'pending');

        const { data: student, error } = await client
            .from('students')
            .insert({
                family_user_id: user.id,
                first_name: firstName,
                last_name: lastName,
                current_grade_level: gradeLevel,
                prior_years_status: priorStatus,
            })
            .select('*')
            .single();
        if (error) throw error;

        await ensureCurrentSchoolYearRecord(student.id, gradeLevel);
        await ensureProgressReportTask(student);
        return student;
    }

    async function setPriorYearsStatus(studentId, status) {
        const client = await getClient();
        const { error } = await client
            .from('students')
            .update({ prior_years_status: status, updated_at: new Date().toISOString() })
            .eq('id', studentId);
        if (error) throw error;
    }

    async function addBackfillYear(studentId, schoolYear, gradeLevel) {
        const client = await getClient();
        const { data, error } = await client
            .from('student_school_years')
            .insert({
                student_id: studentId,
                school_year: schoolYear,
                grade_level: gradeLevel,
                entry_type: 'backfill',
            })
            .select('*')
            .single();
        if (error) throw error;
        await seedCoreCourses(data.id);
        return data;
    }

    async function fetchSchoolYearsForStudent(studentId) {
        const client = await getClient();
        const { data, error } = await client
            .from('student_school_years')
            .select('*')
            .eq('student_id', studentId)
            .order('school_year', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    async function fetchGradeEntries(schoolYearRecordId) {
        const client = await getClient();
        const { data, error } = await client
            .from('grade_entries')
            .select('*')
            .eq('school_year_record_id', schoolYearRecordId)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function saveGradeEntries(entries) {
        const client = await getClient();
        for (const entry of entries) {
            const { error } = await client
                .from('grade_entries')
                .update({
                    course_name: entry.course_name,
                    semester_1_grade: entry.semester_1_grade || null,
                    semester_2_grade: entry.semester_2_grade || null,
                    final_grade: entry.final_grade || null,
                })
                .eq('id', entry.id);
            if (error) throw error;
        }
    }

    async function addElectiveCourse(schoolYearRecordId, sortOrder) {
        const client = await getClient();
        const { data, error } = await client
            .from('grade_entries')
            .insert({
                school_year_record_id: schoolYearRecordId,
                course_name: '',
                is_core: false,
                sort_order: sortOrder,
            })
            .select('*')
            .single();
        if (error) throw error;
        return data;
    }

    function canEditSemester(yearRecord, semesterKey) {
        if (!yearRecord) return false;
        if (yearRecord.entry_type === 'backfill') {
            return !yearRecord.year_locked;
        }
        if (isSchoolYearClosed(yearRecord.school_year)) {
            return Boolean(yearRecord.admin_reopened_at);
        }
        if (semesterKey === '1') return !yearRecord.semester_1_locked;
        if (semesterKey === '2') return !yearRecord.semester_2_locked;
        return false;
    }

    async function submitSemester(yearRecord, semesterKey, ackName, entries) {
        const client = await getClient();
        if (!canEditSemester(yearRecord, semesterKey)) {
            throw new Error('This semester is locked. Contact the school office to request changes.');
        }

        await saveGradeEntries(entries);

        const now = new Date().toISOString();
        const patch = { updated_at: now, admin_reopened_at: null, admin_reopened_note: null };

        if (yearRecord.entry_type === 'backfill') {
            Object.assign(patch, {
                year_locked: true,
                year_submitted_at: now,
                year_ack_name: ackName,
            });
        } else if (semesterKey === '1') {
            Object.assign(patch, {
                semester_1_locked: true,
                semester_1_submitted_at: now,
                semester_1_ack_name: ackName,
            });
        } else {
            Object.assign(patch, {
                semester_2_locked: true,
                semester_2_submitted_at: now,
                semester_2_ack_name: ackName,
            });
        }

        const { data, error } = await client
            .from('student_school_years')
            .update(patch)
            .eq('id', yearRecord.id)
            .select('*')
            .single();
        if (error) throw error;

        if (data.entry_type === 'current' && semesterKey === '1') {
            await client
                .from('family_documents')
                .update({ due_date_1_cleared: true })
                .eq('user_id', (await getCurrentUser())?.id)
                .eq('url', `${PROGRESS_TASK_URL_PREFIX}${yearRecord.student_id}`)
                .ilike('category', '%task%');
        }

        if (data.entry_type === 'current' && semesterKey === '2') {
            const { data: student } = await client.from('students').select('id').eq('id', yearRecord.student_id).maybeSingle();
            await removeProgressReportTaskIfComplete(yearRecord.student_id, data);
        }

        if (data.entry_type === 'backfill') {
            await maybeMarkPriorYearsComplete(yearRecord.student_id);
        }

        return data;
    }

    async function maybeMarkPriorYearsComplete(studentId) {
        const client = await getClient();
        const { data: student } = await client.from('students').select('*').eq('id', studentId).maybeSingle();
        if (!student || !isHighSchoolGrade(student.current_grade_level)) return;

        const years = await fetchSchoolYearsForStudent(studentId);
        const backfills = years.filter((y) => y.entry_type === 'backfill');
        const allLocked = backfills.length > 0 && backfills.every((y) => y.year_locked);
        if (allLocked && student.prior_years_status === 'pending') {
            await setPriorYearsStatus(studentId, 'complete');
        }
    }

    async function adminReopenSchoolYear(yearRecordId, note) {
        const client = await getClient();
        const { data, error } = await client
            .from('student_school_years')
            .update({
                semester_1_locked: false,
                semester_2_locked: false,
                year_locked: false,
                admin_reopened_at: new Date().toISOString(),
                admin_reopened_note: note || null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', yearRecordId)
            .select('*')
            .single();
        if (error) throw error;

        if (data.entry_type === 'current') {
            const { data: student } = await client.from('students').select('*').eq('id', data.student_id).maybeSingle();
            if (student) await ensureProgressReportTask(student, data.school_year);
        }

        return data;
    }

    function buildGradeTableHtml(yearRecord, entries, options = {}) {
        const isBackfill = yearRecord.entry_type === 'backfill';
        const editSem1 = canEditSemester(yearRecord, '1');
        const editSem2 = canEditSemester(yearRecord, '2');
        const readonly = options.readonly || false;

        let rows = '';
        for (const entry of entries) {
            const courseReadonly = entry.is_core || readonly || (!editSem1 && !editSem2);
            rows += `
                <tr class="border-b border-slate-100" data-entry-id="${entry.id}">
                    <td class="py-2 pr-2 align-top">
                        <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                               value="${escapeHtml(entry.course_name)}"
                               data-field="course_name"
                               ${entry.is_core ? 'readonly' : ''}
                               ${courseReadonly && !entry.is_core ? 'readonly' : ''}>
                    </td>
                    ${isBackfill ? `
                        <td class="py-2 px-2 align-top">
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                                   value="${escapeHtml(entry.final_grade || '')}"
                                   data-field="final_grade"
                                   placeholder="Grade"
                                   ${(!editSem1 || readonly) ? 'readonly' : ''}>
                        </td>
                    ` : `
                        <td class="py-2 px-2 align-top">
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                                   value="${escapeHtml(entry.semester_1_grade || '')}"
                                   data-field="semester_1_grade"
                                   placeholder="S1"
                                   ${(!editSem1 || readonly) ? 'readonly' : ''}>
                        </td>
                        <td class="py-2 px-2 align-top">
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                                   value="${escapeHtml(entry.semester_2_grade || '')}"
                                   data-field="semester_2_grade"
                                   placeholder="S2"
                                   ${(!editSem2 || readonly) ? 'readonly' : ''}>
                        </td>
                        <td class="py-2 pl-2 align-top">
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                                   value="${escapeHtml(entry.final_grade || '')}"
                                   data-field="final_grade"
                                   placeholder="Final"
                                   ${(!editSem2 || readonly) ? 'readonly' : ''}>
                        </td>
                    `}
                </tr>
            `;
        }

        const headers = isBackfill
            ? '<th class="text-left text-xs font-semibold text-slate-600 pb-2">Course</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Final grade</th>'
            : '<th class="text-left text-xs font-semibold text-slate-600 pb-2">Course</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Sem 1</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Sem 2</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Final</th>';

        return `
            <div class="overflow-x-auto">
                <table class="w-full min-w-[520px] text-sm" data-year-record-id="${yearRecord.id}">
                    <thead><tr>${headers}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function collectEntriesFromTable(container) {
        const rows = container.querySelectorAll('tr[data-entry-id]');
        return Array.from(rows).map((row) => {
            const entry = { id: row.dataset.entryId };
            row.querySelectorAll('[data-field]').forEach((input) => {
                entry[input.dataset.field] = input.value.trim();
            });
            return entry;
        });
    }

    async function renderProgressReportTaskCard(task, studentId, options = {}) {
        const client = await getClient();
        const { data: student } = await client.from('students').select('*').eq('id', studentId).maybeSingle();
        if (!student) {
            return `<div class="hub-panel hub-panel-padded text-sm text-red-600">Student record not found for this task.</div>`;
        }

        const years = await fetchSchoolYearsForStudent(studentId);
        const current = years.find((y) => y.school_year === currentSchoolYear() && y.entry_type === 'current')
            || await ensureCurrentSchoolYearRecord(studentId, student.current_grade_level);
        const entries = await fetchGradeEntries(current.id);

        const sem1Done = current.semester_1_locked;
        const sem2Done = current.semester_2_locked;
        const activeSem = !sem1Done ? '1' : (!sem2Done ? '2' : null);
        const closed = isSchoolYearClosed(current.school_year) && !current.admin_reopened_at;

        let body = '';
        if (!activeSem && !closed) {
            body = `<p class="text-sm text-emerald-700 font-medium">All semesters submitted for ${current.school_year}. View in Academic Records.</p>`;
        } else if (closed) {
            body = `<p class="text-sm text-slate-600">The ${current.school_year} school year is closed. Contact the school office to request changes.</p>`;
        } else {
            const label = activeSem === '1' ? 'Semester 1 (December)' : 'Semester 2 + Final (May)';
            body = `
                <p class="text-sm text-slate-600 mb-3">Enter grades for <strong>${escapeHtml(studentDisplayName(student))}</strong> — ${label}</p>
                <div id="progress-task-grades-${current.id}">${buildGradeTableHtml(current, entries)}</div>
                <div class="mt-3 space-y-2">
                    <label class="block text-xs font-medium text-slate-600">Type your full name to confirm these grades are accurate</label>
                    <input type="text" id="progress-ack-${current.id}" class="form-input w-full px-4 py-2 border border-slate-300 rounded-2xl text-sm" placeholder="Parent full name">
                    <button type="button" class="w-full py-3 bg-navy hover:bg-[#0F3A5F] text-white font-semibold rounded-2xl text-sm transition-all"
                            onclick="window.AcademicRecords.submitProgressTask('${current.id}', '${activeSem}', '${studentId}')">
                        Submit ${activeSem === '1' ? 'Semester 1' : 'Semester 2 &amp; Final'}
                    </button>
                </div>
            `;
        }

        return `
            <div class="hub-panel hub-panel-padded border-amber-200 !bg-amber-50/80 relative" id="progress-task-${studentId}">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <h4 class="font-semibold text-lg text-navy">${escapeHtml(task.title)}</h4>
                        ${task.description ? `<p class="text-sm text-slate-600 mt-1">${escapeHtml(task.description)}</p>` : ''}
                        ${options.dueDatesHtml || ''}
                    </div>
                    ${options.overdueIcon || ''}
                </div>
                <div class="mt-3">${body}</div>
                <p class="mt-3 text-xs text-slate-500">
                    <a href="#" onclick="showDashboardTab('academic-records'); return false;" class="text-navy underline">Open Academic Records</a> for prior years and full history.
                </p>
            </div>
        `;
    }

    async function submitProgressTask(yearRecordId, semesterKey, studentId) {
        const container = document.getElementById(`progress-task-grades-${yearRecordId}`);
        const ackInput = document.getElementById(`progress-ack-${yearRecordId}`);
        const ackName = (ackInput?.value || '').trim();
        if (!ackName) {
            await window.showAppAlert?.('Please type your full name to confirm submission.');
            return;
        }

        try {
            const client = await getClient();
            const { data: yearRecord } = await client.from('student_school_years').select('*').eq('id', yearRecordId).single();
            const entries = collectEntriesFromTable(container);
            await submitSemester(yearRecord, semesterKey, ackName, entries);
            if (typeof window.loadMyTasks === 'function') await window.loadMyTasks();
            if (typeof window.loadAcademicRecords === 'function') await window.loadAcademicRecords();
            await window.showAppAlert?.(semesterKey === '1'
                ? 'Semester 1 saved and locked. Return in May for Semester 2.'
                : 'Progress report complete for this school year.');
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function loadAcademicRecords() {
        const root = document.getElementById('academic-records-root');
        if (!root) return;

        const user = await getCurrentUser();
        if (!user) {
            root.innerHTML = '<div class="hub-empty-state">Please log in to manage academic records.</div>';
            return;
        }

        root.innerHTML = '<div class="hub-empty-state">Loading academic records...</div>';

        try {
            const students = await fetchStudents(user.id);
            const backfillYears = priorSchoolYears(5);

            let html = `
                <div class="hub-panel hub-panel-padded mb-6">
                    <h3 class="text-lg font-semibold text-navy mb-2">Add a student</h3>
                    <form id="add-student-form" class="grid sm:grid-cols-3 gap-3 items-end" onsubmit="window.AcademicRecords.handleAddStudent(event)">
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1">First name</label>
                            <input name="first_name" required class="form-input w-full px-4 py-2 border border-slate-300 rounded-2xl text-sm">
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1">Last name</label>
                            <input name="last_name" class="form-input w-full px-4 py-2 border border-slate-300 rounded-2xl text-sm">
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1">Current grade</label>
                            <select name="grade_level" required class="form-input w-full px-4 py-2 border border-slate-300 rounded-2xl text-sm">
                                <option value="">Select grade</option>
                                ${GRADE_LEVELS.map((g) => `<option value="${g}">${g === 'K3' || g === 'K4' || g === 'K5' ? g : `Grade ${g}`}</option>`).join('')}
                            </select>
                        </div>
                        <div class="sm:col-span-3">
                            <button type="submit" class="px-6 py-2.5 bg-navy text-white font-semibold rounded-2xl text-sm hover:bg-[#0F3A5F]">Add student</button>
                        </div>
                    </form>
                </div>
            `;

            if (!students.length) {
                html += '<div class="hub-empty-state">No students yet. Add each enrolled child above to begin tracking grades.</div>';
                root.innerHTML = html;
                return;
            }

            for (const student of students) {
                const years = await fetchSchoolYearsForStudent(student.id);
                const currentYear = currentSchoolYear();
                const currentRecord = years.find((y) => y.school_year === currentYear && y.entry_type === 'current');
                const backfills = years.filter((y) => y.entry_type === 'backfill');

                let priorBlock = '';
                if (isHighSchoolGrade(student.current_grade_level)) {
                    priorBlock = `
                        <div class="mt-4 p-4 border border-sky-200 bg-sky-50/50 rounded-2xl">
                            <div class="text-sm font-semibold text-sky-900 mb-2">Prior school years (high school)</div>
                            <p class="text-xs text-slate-600 mb-3">Add any years before Summit if this student joined mid-stream. Full-year grades only — no semester breakdown.</p>
                            <div class="flex flex-wrap gap-2 mb-3">
                                <form class="flex flex-wrap gap-2 items-end" onsubmit="window.AcademicRecords.handleAddBackfill(event, '${student.id}')">
                                    <select name="school_year" class="form-input px-3 py-2 text-sm border border-slate-300 rounded-xl" required>
                                        <option value="">School year</option>
                                        ${backfillYears.map((y) => `<option value="${y}">${y}</option>`).join('')}
                                    </select>
                                    <select name="grade_level" class="form-input px-3 py-2 text-sm border border-slate-300 rounded-xl" required>
                                        ${GRADE_LEVELS.map((g) => `<option value="${g}">${g}</option>`).join('')}
                                    </select>
                                    <button type="submit" class="px-4 py-2 text-sm font-semibold border border-navy text-navy rounded-xl hover:bg-navy hover:text-white">Add prior year</button>
                                </form>
                                ${student.current_grade_level === '9' && student.prior_years_status !== 'not_applicable' ? `
                                    <button type="button" class="px-4 py-2 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50"
                                            onclick="window.AcademicRecords.markNoPriorYears('${student.id}')">Started with Summit in 9th — no prior years</button>
                                ` : student.prior_years_status === 'not_applicable' && student.current_grade_level !== '9'
                                    ? ''
                                    : student.prior_years_status === 'complete'
                                        ? '<span class="text-xs text-emerald-700 self-center">Prior years complete</span>'
                                        : '<span class="text-xs text-amber-700 self-center">Add each prior high school year above</span>'}
                            </div>
                            <div class="text-xs text-slate-600">Status: <strong>${escapeHtml(student.prior_years_status)}</strong></div>
                        </div>
                    `;
                } else {
                    priorBlock = `
                        <div class="mt-4 text-xs text-slate-500">
                            Prior-year backfill is optional for this grade level.
                            <button type="button" class="ml-2 text-navy underline" onclick="window.AcademicRecords.markNoPriorYears('${student.id}')">Mark no prior years</button>
                        </div>
                    `;
                }

                let yearSections = '';
                if (currentRecord) {
                    const entries = await fetchGradeEntries(currentRecord.id);
                    yearSections += `
                        <details class="border border-slate-200 rounded-2xl mt-4" open>
                            <summary class="px-4 py-3 cursor-pointer font-semibold text-navy">${currentYear} (current) — Grade ${escapeHtml(currentRecord.grade_level)}</summary>
                            <div class="p-4 border-t border-slate-100 space-y-4">
                                ${buildGradeTableHtml(currentRecord, entries)}
                                ${renderSemesterActions(currentRecord)}
                            </div>
                        </details>
                    `;
                }

                for (const bf of backfills) {
                    const entries = await fetchGradeEntries(bf.id);
                    yearSections += `
                        <details class="border border-slate-200 rounded-2xl mt-4">
                            <summary class="px-4 py-3 cursor-pointer font-semibold text-navy">${escapeHtml(bf.school_year)} (prior) — Grade ${escapeHtml(bf.grade_level)} ${bf.year_locked ? '✓' : ''}</summary>
                            <div class="p-4 border-t border-slate-100 space-y-4">
                                ${buildGradeTableHtml(bf, entries)}
                                ${renderBackfillActions(bf)}
                            </div>
                        </details>
                    `;
                }

                html += `
                    <div class="hub-panel hub-panel-padded mb-6" data-student-id="${student.id}">
                        <h3 class="text-xl font-semibold text-navy">${escapeHtml(studentDisplayName(student))}</h3>
                        <p class="text-sm text-slate-600">Current grade: ${escapeHtml(student.current_grade_level || '—')}</p>
                        ${priorBlock}
                        ${yearSections}
                    </div>
                `;
            }

            root.innerHTML = html;
        } catch (err) {
            root.innerHTML = `<div class="text-red-600 text-sm p-4">Error loading academic records: ${escapeHtml(err.message || err)}</div>`;
        }
    }

    function renderSemesterActions(yearRecord) {
        const parts = [];
        if (canEditSemester(yearRecord, '1')) {
            parts.push(`
                <div class="p-3 border border-sky-200 rounded-xl">
                    <div class="text-sm font-semibold text-sky-900 mb-2">Submit Semester 1</div>
                    <input type="text" id="ack-s1-${yearRecord.id}" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl mb-2" placeholder="Parent full name">
                    <button type="button" class="px-4 py-2 bg-navy text-white text-sm font-semibold rounded-xl"
                            onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '1')">Lock Semester 1</button>
                </div>
            `);
        } else if (yearRecord.semester_1_locked) {
            parts.push(`<p class="text-xs text-emerald-700">Semester 1 submitted ${yearRecord.semester_1_submitted_at ? new Date(yearRecord.semester_1_submitted_at).toLocaleDateString() : ''}</p>`);
        }

        if (canEditSemester(yearRecord, '2')) {
            parts.push(`
                <div class="p-3 border border-violet-200 rounded-xl">
                    <div class="text-sm font-semibold text-violet-900 mb-2">Submit Semester 2 &amp; Final</div>
                    <input type="text" id="ack-s2-${yearRecord.id}" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl mb-2" placeholder="Parent full name">
                    <button type="button" class="px-4 py-2 bg-navy text-white text-sm font-semibold rounded-xl"
                            onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '2')">Lock Semester 2 &amp; Final</button>
                </div>
            `);
        } else if (yearRecord.semester_2_locked) {
            parts.push(`<p class="text-xs text-emerald-700">Semester 2 &amp; final submitted ${yearRecord.semester_2_submitted_at ? new Date(yearRecord.semester_2_submitted_at).toLocaleDateString() : ''}</p>`);
        }

        return parts.join('');
    }

    function renderBackfillActions(yearRecord) {
        if (!canEditSemester(yearRecord, '1')) {
            return `<p class="text-xs text-emerald-700">Prior year locked ${yearRecord.year_submitted_at ? new Date(yearRecord.year_submitted_at).toLocaleDateString() : ''}</p>`;
        }
        return `
            <div class="p-3 border border-amber-200 rounded-xl">
                <input type="text" id="ack-year-${yearRecord.id}" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl mb-2" placeholder="Parent full name">
                <button type="button" class="px-4 py-2 bg-navy text-white text-sm font-semibold rounded-xl"
                        onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '1')">Mark prior year complete</button>
            </div>
        `;
    }

    async function submitFromSection(yearRecordId, semesterKey) {
        const panel = document.querySelector(`[data-year-record-id="${yearRecordId}"]`)?.closest('.p-4, .hub-panel, details');
        const table = document.querySelector(`table[data-year-record-id="${yearRecordId}"]`);
        const ack = document.getElementById(semesterKey === '1'
            ? `ack-s1-${yearRecordId}`
            : semesterKey === '2'
                ? `ack-s2-${yearRecordId}`
                : `ack-year-${yearRecordId}`);
        const ackName = (ack?.value || '').trim();
        if (!ackName) {
            await window.showAppAlert?.('Please type your full name to confirm.');
            return;
        }
        try {
            const client = await getClient();
            const { data: yearRecord } = await client.from('student_school_years').select('*').eq('id', yearRecordId).single();
            const entries = collectEntriesFromTable(table);
            await submitSemester(yearRecord, semesterKey, ackName, entries);
            await loadAcademicRecords();
            if (typeof window.loadMyTasks === 'function') await window.loadMyTasks();
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function handleAddStudent(event) {
        event.preventDefault();
        const form = event.target;
        const formData = Object.fromEntries(new FormData(form).entries());
        try {
            await addStudent(formData);
            form.reset();
            await loadAcademicRecords();
            if (typeof window.OnboardingChecklist?.refresh === 'function') {
                await window.OnboardingChecklist.refresh();
            }
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function handleAddBackfill(event, studentId) {
        event.preventDefault();
        const form = event.target;
        const schoolYear = form.school_year.value;
        const gradeLevel = form.grade_level.value;
        try {
            await addBackfillYear(studentId, schoolYear, gradeLevel);
            await loadAcademicRecords();
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function markNoPriorYears(studentId) {
        try {
            await setPriorYearsStatus(studentId, 'not_applicable');
            await loadAcademicRecords();
            if (typeof window.OnboardingChecklist?.refresh === 'function') {
                await window.OnboardingChecklist.refresh();
            }
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    window.AcademicRecords = {
        GRADE_LEVELS,
        CORE_COURSES,
        PROGRESS_TASK_PREFIX,
        PROGRESS_TASK_URL_PREFIX,
        currentSchoolYear,
        priorSchoolYears,
        isHighSchoolGrade,
        parseProgressReportStudentId,
        renderProgressReportTaskCard,
        submitProgressTask,
        loadAcademicRecords,
        handleAddStudent,
        handleAddBackfill,
        markNoPriorYears,
        submitFromSection,
        fetchStudents,
        ensureProgressReportTask,
        adminReopenSchoolYear,
        defaultProgressDueDates,
    };

    window.loadAcademicRecords = loadAcademicRecords;
})();