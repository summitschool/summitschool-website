(function () {
    const GRADE_LEVELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    const KINDERGARTEN_GRADES = new Set(['K', 'K3', 'K4', 'K5']);
    const HIGH_SCHOOL_GRADES = new Set(['9', '10', '11', '12']);
    const COURSE_TYPES = [
        { id: 'english', label: 'English', placeholder: 'e.g. English 10' },
        { id: 'math', label: 'Math', placeholder: 'e.g. Geometry' },
        { id: 'science', label: 'Science', placeholder: 'e.g. Biology' },
        { id: 'history', label: 'History', placeholder: 'e.g. World History' },
        { id: 'elective', label: 'Elective', placeholder: 'e.g. Spanish I' },
        { id: 'reading', label: 'Reading', placeholder: 'e.g. Reading' },
        { id: 'bible', label: 'Bible', placeholder: 'e.g. Bible' },
        { id: 'pe', label: 'PE', placeholder: 'e.g. Physical Education' },
        { id: 'other', label: 'Other', placeholder: 'Course name' },
    ];

    const TRANSCRIPT_COURSE_TYPES = ['english', 'math', 'science', 'history', 'elective'];
    const AL_GRAD_CREDIT_REQUIREMENTS = {
        english: 4,
        math: 4,
        science: 4,
        history: 4,
        elective: 8,
    };

    const LOWER_GRADE_SEED_TYPES = ['english', 'math', 'science', 'history', 'reading', 'bible', 'pe'];
    const HS_SEED_TYPES = ['english', 'math', 'science', 'history', 'elective'];

    const PROGRESS_TASK_PREFIX = 'Progress Report —';
    const PROGRESS_TASK_URL_PREFIX = 'hub://progress-report/';
    const PROGRESS_TASK_CATEGORY = 'Progress Report (Task)';

    const LETTER_GRADE_SCALE = [
        { letter: 'A', range: '90–100%' },
        { letter: 'B', range: '80–89%' },
        { letter: 'C', range: '70–79%' },
        { letter: 'D', range: '60–69%' },
        { letter: 'F', range: 'Below 60%' },
    ];

    function percentToGpa(percent) {
        const value = parsePercent(percent);
        if (value === null) return null;
        if (value >= 90) return 4.0;
        if (value >= 80) return 3.0;
        if (value >= 70) return 2.0;
        if (value >= 60) return 1.0;
        return 0.0;
    }

    function courseTypeMeta(typeId) {
        return COURSE_TYPES.find((item) => item.id === typeId) || COURSE_TYPES[COURSE_TYPES.length - 1];
    }

    function parsePercent(value) {
        const raw = String(value ?? '').trim().replace(/%/g, '');
        if (!raw) return null;
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0 || num > 100) return null;
        return Math.round(num * 10) / 10;
    }

    function parseLetterGrade(value) {
        const letter = String(value ?? '').trim().toUpperCase().charAt(0);
        return 'ABCDEF'.includes(letter) ? letter : null;
    }

    function letterToMidPercent(letter) {
        const map = { A: 95, B: 85, C: 75, D: 65, F: 50 };
        return map[letter] ?? null;
    }

    function isPassingGrade(value, requirePercent) {
        const percent = parsePercent(value);
        if (percent !== null) return percent >= 60;
        if (requirePercent) return false;
        const letter = parseLetterGrade(value);
        if (!letter) return false;
        return letter !== 'F';
    }

    function getCalendarSemester(schoolYear, date = new Date()) {
        const parts = String(schoolYear || '').split('-');
        const startYear = parseInt(parts[0], 10);
        const endYear = parseInt(parts[1], 10);
        if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return '1';

        const year = date.getFullYear();
        const month = date.getMonth() + 1;

        if (year === startYear && month >= 7) return '1';
        if (year === endYear && month >= 1 && month <= 5) return '2';
        if (year === startYear && month <= 6) return '1';
        if (year === endYear && month >= 6) return '2';
        return '1';
    }

    function computeFinalGrade(s1, s2, requirePercent) {
        const p1 = parsePercent(s1);
        const p2 = parsePercent(s2);
        const hasS1 = String(s1 ?? '').trim();
        const hasS2 = String(s2 ?? '').trim();

        if (requirePercent) {
            if (p1 !== null && p2 !== null) return String(Math.round((p1 + p2) / 2));
            if (p1 !== null && !hasS2) return String(p1);
            if (p2 !== null && !hasS1) return String(p2);
            return '';
        }

        if (p1 !== null && p2 !== null) return String(Math.round((p1 + p2) / 2));
        if (p1 !== null && !hasS2) return String(p1);
        if (p2 !== null && !hasS1) return String(p2);
        return '';
    }

    function getEffectiveFinal(entry, gradeLevel) {
        const requirePercent = isHighSchoolGrade(gradeLevel);
        const computed = computeFinalGrade(entry.semester_1_grade, entry.semester_2_grade, requirePercent);
        if (requirePercent) return computed;
        if (computed) return computed;
        return String(entry.final_grade || '').trim();
    }

    function canEditGradeField(yearRecord, field, gradeLevel) {
        if (!yearRecord) return false;

        if (yearRecord.entry_type === 'backfill') {
            if (!canEditSemester(yearRecord, '1')) return false;
            if (field === 'final_grade' && isHighSchoolGrade(gradeLevel)) return false;
            return field === 'semester_1_grade' || field === 'semester_2_grade' || field === 'final_grade';
        }

        const reopened = Boolean(yearRecord.admin_reopened_at);
        const calSem = getCalendarSemester(yearRecord.school_year);
        const editSem1 = canEditSemester(yearRecord, '1');
        const editSem2 = canEditSemester(yearRecord, '2');
        const requirePercent = isHighSchoolGrade(gradeLevel);

        if (field === 'semester_1_grade') {
            return editSem1 && (reopened || calSem === '1');
        }
        if (field === 'semester_2_grade') {
            return editSem2 && (reopened || calSem === '2');
        }
        if (field === 'final_grade') {
            if (requirePercent) return false;
            return editSem2 && (reopened || calSem === '2');
        }
        return false;
    }

    function gradePlaceholder(gradeLevel, kind) {
        const requirePercent = isHighSchoolGrade(gradeLevel);
        if (requirePercent) {
            if (kind === 's1') return 'e.g. 88';
            if (kind === 's2') return 'e.g. 91';
            return 'Auto';
        }
        if (kind === 'final') return 'Letter or %';
        return 'A–F or %';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeJsString(value) {
        return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    function isKindergartenGrade(level) {
        return KINDERGARTEN_GRADES.has(String(level || '').trim());
    }

    function formatGradeLabel(level) {
        const raw = String(level || '').trim();
        if (!raw) return '—';
        if (isKindergartenGrade(raw)) return 'K';
        return `Grade ${raw}`;
    }

    function parseAttendanceDays(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0 || num > 200 || Math.floor(num) !== num) return null;
        return num;
    }

    const ACCORDION_CHEVRON_SVG = '<svg class="ar-accordion-chevron-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function buildAccordionCloseButton(label) {
        return `
            <button type="button" class="ar-accordion-close-btn" data-ar-collapse>
                <span class="ar-accordion-close-icon" aria-hidden="true">←</span>
                ${escapeHtml(label)}
            </button>
        `;
    }

    function buildAccordionCloseBar(label, bottom = false) {
        const bottomClass = bottom ? ' ar-accordion-closebar--bottom' : '';
        return `<div class="ar-accordion-closebar${bottomClass}">${buildAccordionCloseButton(label)}</div>`;
    }

    function wrapAccordionBody(bodyHtml, closeLabel) {
        return `
            <div class="ar-accordion-body">${bodyHtml}</div>
            ${buildAccordionCloseBar(closeLabel, true)}
        `;
    }

    function buildAccordionSummary(options = {}) {
        const {
            leftHtml,
            rightHtml = '',
            hint = 'Tap to open',
            extraClass = '',
        } = options;

        return `
            <summary class="ar-accordion-trigger ar-summary-row list-none ${extraClass}">
                <span class="ar-accordion-leading ar-summary-left">
                    <span class="ar-accordion-chevron">${ACCORDION_CHEVRON_SVG}</span>
                    <span class="ar-accordion-label">${leftHtml}</span>
                </span>
                ${rightHtml ? `<span class="ar-summary-right">${rightHtml}</span>` : ''}
                <span class="ar-accordion-hint">${escapeHtml(hint)}</span>
            </summary>
        `;
    }

    function buildAttendanceHtml(yearRecord, options = {}) {
        const readonly = options.readonly || false;
        const editS1 = canEditSemester(yearRecord, '1') && !readonly;
        const editS2 = canEditSemester(yearRecord, '2') && !readonly;
        const s1Value = yearRecord.semester_1_attendance_days ?? '';
        const s2Value = yearRecord.semester_2_attendance_days ?? '';
        const s1Display = s1Value === '' || s1Value === null ? '' : String(s1Value);
        const s2Display = s2Value === '' || s2Value === null ? '' : String(s2Value);
        const total = (parseAttendanceDays(s1Display) ?? 0) + (parseAttendanceDays(s2Display) ?? 0);
        const hasAny = parseAttendanceDays(s1Display) !== null || parseAttendanceDays(s2Display) !== null;

        return `
            <div class="ar-attendance-panel p-3 border border-emerald-200 rounded-xl bg-emerald-50/40"
                 data-ar-attendance="${yearRecord.id}">
                <div class="text-sm font-semibold text-emerald-900 mb-1">Attendance</div>
                <p class="text-xs text-slate-600 mb-3">Enter the number of <strong>school days attended</strong> each semester. Total updates automatically.</p>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1">Semester 1 days</label>
                        <input type="number" min="0" max="200" step="1" inputmode="numeric"
                               class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                               value="${escapeHtml(s1Display)}"
                               data-field="semester_1_attendance_days"
                               placeholder="e.g. 88"
                               ${editS1 ? '' : 'readonly'}>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1">Semester 2 days</label>
                        <input type="number" min="0" max="200" step="1" inputmode="numeric"
                               class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                               value="${escapeHtml(s2Display)}"
                               data-field="semester_2_attendance_days"
                               placeholder="e.g. 90"
                               ${editS2 ? '' : 'readonly'}>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1">Total days</label>
                        <input type="text" readonly tabindex="-1"
                               class="form-input w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700"
                               value="${hasAny ? String(total) : ''}"
                               data-field="attendance_total"
                               placeholder="Auto-calculated">
                    </div>
                </div>
            </div>
        `;
    }

    function collectAttendanceFromPanel(yearRecordId) {
        const panel = document.querySelector(`[data-ar-attendance="${yearRecordId}"]`);
        if (!panel) return {};
        return {
            semester_1_attendance_days: parseAttendanceDays(
                panel.querySelector('[data-field="semester_1_attendance_days"]')?.value
            ),
            semester_2_attendance_days: parseAttendanceDays(
                panel.querySelector('[data-field="semester_2_attendance_days"]')?.value
            ),
        };
    }

    function validateAttendanceForSubmit(yearRecord, semesterKey, attendance) {
        if (yearRecord.entry_type === 'backfill') {
            if (attendance.semester_1_attendance_days === null) {
                throw new Error('Enter Semester 1 attendance (school days attended) before submitting.');
            }
            if (attendance.semester_2_attendance_days === null) {
                throw new Error('Enter Semester 2 attendance (school days attended) before submitting.');
            }
            return;
        }

        if (semesterKey === '1' && attendance.semester_1_attendance_days === null) {
            throw new Error('Enter Semester 1 attendance (school days attended) before submitting.');
        }

        if (semesterKey === '2') {
            if (attendance.semester_1_attendance_days === null) {
                throw new Error('Semester 1 attendance is missing. Reopen with the school office if needed.');
            }
            if (attendance.semester_2_attendance_days === null) {
                throw new Error('Enter Semester 2 attendance (school days attended) before submitting.');
            }
        }
    }

    function bindAccordionControls(root) {
        if (!root) return;

        root.querySelectorAll('[data-ar-collapse]').forEach((button) => {
            if (button.dataset.arCollapseBound === '1') return;
            button.dataset.arCollapseBound = '1';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const details = button.closest('details');
                if (!details) return;
                details.removeAttribute('open');
                const summary = details.querySelector('summary');
                if (summary) {
                    summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        });
    }

    function bindAttendanceEvents(root) {
        if (!root) return;

        root.querySelectorAll('[data-ar-attendance]').forEach((panel) => {
            const s1Input = panel.querySelector('[data-field="semester_1_attendance_days"]');
            const s2Input = panel.querySelector('[data-field="semester_2_attendance_days"]');
            const totalInput = panel.querySelector('[data-field="attendance_total"]');

            const updateTotal = () => {
                const total = (parseAttendanceDays(s1Input?.value) ?? 0) + (parseAttendanceDays(s2Input?.value) ?? 0);
                const hasAny = parseAttendanceDays(s1Input?.value) !== null || parseAttendanceDays(s2Input?.value) !== null;
                if (totalInput) totalInput.value = hasAny ? String(total) : '';
            };

            s1Input?.addEventListener('input', updateTotal);
            s2Input?.addEventListener('input', updateTotal);
            updateTotal();
        });
    }

    function isHighSchoolGrade(level) {
        return HIGH_SCHOOL_GRADES.has(String(level || '').trim());
    }

    function schoolYearEndDate(schoolYear) {
        const endYear = parseInt(String(schoolYear).split('-')[1], 10);
        if (!Number.isFinite(endYear)) return null;
        return new Date(`${endYear}-05-31T23:59:59`);
    }

    function isSchoolYearClosed(schoolYear) {
        const end = schoolYearEndDate(schoolYear);
        if (!end) return false;
        return Date.now() > end.getTime();
    }

    function currentSchoolYear(date = new Date()) {
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        let schoolYear;
        if (month >= 7) {
            schoolYear = `${year}-${year + 1}`;
        } else if (month <= 5) {
            schoolYear = `${year - 1}-${year}`;
        } else {
            // June: new enrollments and progress reports use the upcoming school year (Jul–May).
            schoolYear = `${year}-${year + 1}`;
        }

        // Safety net: after May 31 the labeled year is closed (e.g. cached old JS still returning 2025-2026 in June).
        if (isSchoolYearClosed(schoolYear)) {
            const endYear = parseInt(String(schoolYear).split('-')[1], 10);
            if (Number.isFinite(endYear)) {
                schoolYear = `${endYear}-${endYear + 1}`;
            }
        }

        return schoolYear;
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

    function isSeniorGrade(gradeLevel) {
        return String(gradeLevel || '').trim() === '12';
    }

    function semester2DueDate(schoolYear, gradeLevel) {
        const end = parseInt(String(schoolYear).split('-')[1], 10);
        if (!Number.isFinite(end)) return 'May 31';
        return isSeniorGrade(gradeLevel) ? `May 15, ${end}` : `May 31, ${end}`;
    }

    function defaultProgressDueDates(schoolYear, gradeLevel = '') {
        const start = parseInt(String(schoolYear).split('-')[0], 10);
        const end = start + 1;
        return {
            due_date_1: `${start}-12-31`,
            due_date_2: `${end}-05-${isSeniorGrade(gradeLevel) ? '15' : '31'}`,
        };
    }

    function studentDisplayName(student) {
        return [student.first_name, student.last_name].filter(Boolean).join(' ').trim();
    }

    function normalizeStudentName(firstName, lastName) {
        return [firstName, lastName]
            .map((part) => String(part || '').trim().toLowerCase())
            .filter(Boolean)
            .join(' ');
    }

    function getFocusStudentId() {
        return sessionStorage.getItem('ar_focus_student') || null;
    }

    function setFocusStudentId(studentId) {
        if (studentId) {
            sessionStorage.setItem('ar_focus_student', studentId);
        } else {
            sessionStorage.removeItem('ar_focus_student');
        }
    }

    let isAddingStudent = false;

    function getProgressStatusLabel(yearRecord, gradeLevel = '') {
        if (!yearRecord) return 'No current year record';
        if (yearRecord.semester_2_locked) return `${yearRecord.school_year} complete`;
        const level = gradeLevel || yearRecord.grade_level;
        if (yearRecord.semester_1_locked) return `Semester 2 due ${semester2DueDate(yearRecord.school_year, level)}`;
        return 'Semester 1 due Dec 31';
    }

    async function findDuplicateStudent(userId, firstName, lastName) {
        const students = await fetchStudents(userId);
        const key = normalizeStudentName(firstName, lastName);
        return students.find((student) => (
            normalizeStudentName(student.first_name, student.last_name) === key
        )) || null;
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
        return fetchStudentsForFamily(userId);
    }

    async function fetchStudentsForFamily(familyUserId) {
        const client = await getClient();
        if (!client || !familyUserId) return [];
        const { data, error } = await client
            .from('students')
            .select('*')
            .eq('family_user_id', familyUserId)
            .eq('active', true)
            .order('first_name', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    function yearRecordHasProgress(yearRecord, entries) {
        if (!yearRecord) return false;
        if (yearRecord.semester_1_locked || yearRecord.semester_2_locked || yearRecord.year_locked) return true;
        return (entries || []).some((entry) => (
            String(entry.course_name || '').trim()
            || String(entry.semester_1_grade || '').trim()
            || String(entry.semester_2_grade || '').trim()
            || String(entry.final_grade || '').trim()
        ));
    }

    async function reconcileStaleCurrentYearRecords(studentId, activeYear) {
        const client = await getClient();
        const years = await fetchSchoolYearsForStudent(studentId);
        const staleRecords = years.filter((record) => (
            record.entry_type === 'current'
            && record.school_year !== activeYear
            && isSchoolYearClosed(record.school_year)
        ));

        for (const record of staleRecords) {
            const entries = await fetchGradeEntries(record.id);
            if (yearRecordHasProgress(record, entries)) continue;

            await client.from('grade_entries').delete().eq('school_year_record_id', record.id);
            const { error } = await client.from('student_school_years').delete().eq('id', record.id);
            if (error) console.warn('[Academic Records] Could not remove stale school year:', error.message);
        }
    }

    async function ensureCurrentSchoolYearRecord(studentId, gradeLevel) {
        const client = await getClient();
        const year = currentSchoolYear();

        await reconcileStaleCurrentYearRecords(studentId, year);

        const { data: existing, error: fetchError } = await client
            .from('student_school_years')
            .select('*')
            .eq('student_id', studentId)
            .eq('school_year', year)
            .eq('entry_type', 'current')
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
        await seedCoreCourses(data.id, gradeLevel);
        return data;
    }

    async function seedCoreCourses(schoolYearRecordId, gradeLevel) {
        const client = await getClient();
        const types = isHighSchoolGrade(gradeLevel) ? HS_SEED_TYPES : LOWER_GRADE_SEED_TYPES;
        const rows = types.map((courseType, index) => ({
            school_year_record_id: schoolYearRecordId,
            course_name: '',
            course_type: courseType,
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
        const dues = defaultProgressDueDates(schoolYear, student.current_grade_level);

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
            description: `Enter ${schoolYear} semester grades and attendance for ${studentDisplayName(student)}. Semester 1 is due Dec 31; Semester 2 is due ${semester2DueDate(schoolYear, student.current_grade_level)}.`,
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
        await seedCoreCourses(data.id, gradeLevel);
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

    async function saveGradeEntries(entries, gradeLevel) {
        const client = await getClient();
        const requirePercent = isHighSchoolGrade(gradeLevel);
        for (const entry of entries) {
            const finalGrade = requirePercent
                ? computeFinalGrade(entry.semester_1_grade, entry.semester_2_grade, true)
                : (computeFinalGrade(entry.semester_1_grade, entry.semester_2_grade, false) || entry.final_grade || null);

            const { error } = await client
                .from('grade_entries')
                .update({
                    course_name: entry.course_name || '',
                    course_type: entry.course_type || 'other',
                    semester_1_grade: entry.semester_1_grade || null,
                    semester_2_grade: entry.semester_2_grade || null,
                    final_grade: finalGrade || null,
                })
                .eq('id', entry.id);
            if (error) throw error;
        }
    }

    async function addCourseRow(schoolYearRecordId, sortOrder, courseType = 'elective') {
        const client = await getClient();
        const { data, error } = await client
            .from('grade_entries')
            .insert({
                school_year_record_id: schoolYearRecordId,
                course_name: '',
                course_type: courseType,
                is_core: false,
                sort_order: sortOrder,
            })
            .select('*')
            .single();
        if (error) throw error;
        return data;
    }

    function isBlankEntry(entry, semesterKey, isBackfill) {
        const name = String(entry.course_name || '').trim();
        const s1 = String(entry.semester_1_grade || '').trim();
        const s2 = String(entry.semester_2_grade || '').trim();
        const final = String(entry.final_grade || '').trim();
        if (isBackfill) return !name && !s1 && !s2 && !final;
        if (semesterKey === '1') return !name && !s1;
        if (semesterKey === '2') return !name && !s1 && !s2;
        return !name && !s1 && !s2 && !final;
    }

    function validateEntriesForSubmit(entries, yearRecord, gradeLevel, semesterKey) {
        const requirePercent = isHighSchoolGrade(gradeLevel);
        const isBackfill = yearRecord.entry_type === 'backfill';

        for (const entry of entries) {
            if (isBlankEntry(entry, semesterKey, isBackfill)) continue;

            const name = String(entry.course_name || '').trim();
            const type = entry.course_type || 'other';

            if (!name) {
                throw new Error('Enter a specific course name for every row (e.g. Geometry, not just Math).');
            }

            if (isHighSchoolGrade(gradeLevel) && !TRANSCRIPT_COURSE_TYPES.includes(type)) {
                throw new Error(`High school courses must use English, Math, Science, History, or Elective tags. Check "${name}".`);
            }

            if (isBackfill) {
                const s1 = String(entry.semester_1_grade || '').trim();
                const s2 = String(entry.semester_2_grade || '').trim();
                if (!s1) {
                    throw new Error(`Enter Semester 1 grades for "${name}" before submitting.`);
                }
                if (!s2) {
                    throw new Error(`Enter Semester 2 grades for "${name}" before submitting.`);
                }
                if (requirePercent && parsePercent(s1) === null) {
                    throw new Error(`High school Semester 1 grades must be percentages for "${name}".`);
                }
                if (requirePercent && parsePercent(s2) === null) {
                    throw new Error(`High school Semester 2 grades must be percentages for "${name}".`);
                }
                if (!requirePercent && !parsePercent(s1) && !parseLetterGrade(s1)) {
                    throw new Error(`Enter a letter (A–F) or percentage for "${name}" Semester 1.`);
                }
                if (!requirePercent && !parsePercent(s2) && !parseLetterGrade(s2)) {
                    throw new Error(`Enter a letter (A–F) or percentage for "${name}" Semester 2.`);
                }
                const final = getEffectiveFinal(entry, gradeLevel);
                if (!final) {
                    throw new Error(`Enter grades for "${name}" before submitting.`);
                }
                if (requirePercent && parsePercent(final) === null) {
                    throw new Error(`High school grades must be percentages (0–100) for "${name}".`);
                }
                continue;
            }

            if (semesterKey === '2') {
                const final = getEffectiveFinal(entry, gradeLevel);
                if (!final) {
                    throw new Error(`Enter grades for "${name}" before submitting.`);
                }
                if (requirePercent && parsePercent(final) === null) {
                    throw new Error(`High school grades must be percentages (0–100) for "${name}".`);
                }
            }

            if (semesterKey === '1') {
                const s1 = String(entry.semester_1_grade || '').trim();
                if (!s1) {
                    throw new Error(`Enter Semester 1 grades for "${name}" before submitting.`);
                }
                if (requirePercent && parsePercent(s1) === null) {
                    throw new Error(`High school Semester 1 grades must be percentages for "${name}".`);
                }
                if (!requirePercent && !parsePercent(s1) && !parseLetterGrade(s1)) {
                    throw new Error(`Enter a letter (A–F) or percentage for "${name}" Semester 1.`);
                }
            }

            if (semesterKey === '2') {
                const s2 = String(entry.semester_2_grade || '').trim();
                const s1 = String(entry.semester_1_grade || '').trim();
                if (!s2 && !s1) {
                    throw new Error(`Enter Semester 2 grades for "${name}" before submitting.`);
                }
                if (s2 && requirePercent && parsePercent(s2) === null) {
                    throw new Error(`High school Semester 2 grades must be percentages for "${name}".`);
                }
            }
        }
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

    async function submitSemester(yearRecord, semesterKey, ackName, entries, attendance = {}) {
        const client = await getClient();
        if (!canEditSemester(yearRecord, semesterKey)) {
            throw new Error('This semester is locked. Contact the school office to request changes.');
        }

        const gradeLevel = yearRecord.grade_level;
        validateEntriesForSubmit(entries, yearRecord, gradeLevel, semesterKey);
        validateAttendanceForSubmit(yearRecord, semesterKey, attendance);
        await saveGradeEntries(entries, gradeLevel);

        const now = new Date().toISOString();
        const patch = { updated_at: now, admin_reopened_at: null, admin_reopened_note: null };

        if (attendance.semester_1_attendance_days !== null && attendance.semester_1_attendance_days !== undefined) {
            patch.semester_1_attendance_days = attendance.semester_1_attendance_days;
        }
        if (attendance.semester_2_attendance_days !== null && attendance.semester_2_attendance_days !== undefined) {
            patch.semester_2_attendance_days = attendance.semester_2_attendance_days;
        }

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

    function buildCourseTypeOptions(selectedType, gradeLevel) {
        const isHs = isHighSchoolGrade(gradeLevel);
        const allowed = isHs
            ? COURSE_TYPES.filter((item) => TRANSCRIPT_COURSE_TYPES.includes(item.id))
            : COURSE_TYPES;
        return allowed.map((item) => `
            <option value="${item.id}" ${item.id === selectedType ? 'selected' : ''}>${escapeHtml(item.label)}</option>
        `).join('');
    }

    function computeEntryCredits(entry, gradeLevel, yearComplete) {
        if (!isHighSchoolGrade(gradeLevel)) return 0;
        if (!TRANSCRIPT_COURSE_TYPES.includes(entry.course_type)) return 0;
        if (!yearComplete) return 0;

        const final = getEffectiveFinal(entry, gradeLevel);
        if (!isPassingGrade(final, true)) return 0;
        return 1;
    }

    function summarizeCredits(entries, gradeLevel, yearComplete) {
        const totals = { english: 0, math: 0, science: 0, history: 0, elective: 0 };
        for (const entry of entries) {
            const credits = computeEntryCredits(entry, gradeLevel, yearComplete);
            if (credits && totals[entry.course_type] !== undefined) {
                totals[entry.course_type] += credits;
            }
        }
        return totals;
    }

    async function summarizeCumulativeCredits(studentId, gradeLevel) {
        if (!isHighSchoolGrade(gradeLevel)) return null;

        const years = await fetchSchoolYearsForStudent(studentId);
        const totals = { english: 0, math: 0, science: 0, history: 0, elective: 0 };

        for (const year of years) {
            if (!isHighSchoolGrade(year.grade_level)) continue;
            const complete = year.entry_type === 'backfill'
                ? year.year_locked
                : year.semester_2_locked;
            if (!complete) continue;

            const entries = await fetchGradeEntries(year.id);
            const yearTotals = summarizeCredits(entries, year.grade_level, true);
            TRANSCRIPT_COURSE_TYPES.forEach((type) => {
                totals[type] += yearTotals[type] || 0;
            });
        }

        return totals;
    }

    function formatCumulativeCreditsLine(totals) {
        if (!totals) return '';
        return TRANSCRIPT_COURSE_TYPES.map((type) => {
            const earned = totals[type] || 0;
            const required = AL_GRAD_CREDIT_REQUIREMENTS[type];
            return `${courseTypeMeta(type).label} ${earned}/${required}`;
        }).join(', ');
    }

    function captureExpandState(root) {
        if (!root) return null;

        const unique = (items) => [...new Set(items.filter(Boolean))];

        return {
            studentIds: unique(Array.from(root.querySelectorAll('.student-record-panel[open]')).map((el) => el.dataset.studentId)),
            progressYearIds: unique(Array.from(root.querySelectorAll('[data-ar-progress-year][open]')).map((el) => el.dataset.arProgressYear)),
            priorYearStudentIds: unique(Array.from(root.querySelectorAll('[data-ar-prior-years][open]')).map((el) => el.dataset.arPriorYears)),
            backfillGroupStudentIds: unique(Array.from(root.querySelectorAll('[data-ar-backfill-group][open]')).map((el) => el.dataset.arBackfillGroup)),
            backfillYearIds: unique(Array.from(root.querySelectorAll('[data-ar-backfill-year][open]')).map((el) => el.dataset.arBackfillYear)),
            addStudentOpen: Boolean(root.querySelector('#ar-add-student-panel[open]')),
        };
    }

    function restoreExpandState(root, state) {
        if (!root || !state) return;

        state.studentIds.forEach((studentId) => {
            const panel = root.querySelector(`#student-panel-${studentId}`);
            if (panel) panel.setAttribute('open', '');
        });

        state.progressYearIds.forEach((yearId) => {
            const panel = root.querySelector(`[data-ar-progress-year="${yearId}"]`);
            if (panel) panel.setAttribute('open', '');
        });

        state.priorYearStudentIds.forEach((studentId) => {
            const panel = root.querySelector(`[data-ar-prior-years="${studentId}"]`);
            if (panel) panel.setAttribute('open', '');
        });

        state.backfillGroupStudentIds.forEach((studentId) => {
            const panel = root.querySelector(`[data-ar-backfill-group="${studentId}"]`);
            if (panel) panel.setAttribute('open', '');
        });

        state.backfillYearIds.forEach((yearId) => {
            const panel = root.querySelector(`[data-ar-backfill-year="${yearId}"]`);
            if (panel) panel.setAttribute('open', '');
        });

        if (state.addStudentOpen) {
            const addPanel = root.querySelector('#ar-add-student-panel');
            if (addPanel) addPanel.setAttribute('open', '');
        }
    }

    function buildCreditsSummaryHtml(yearRecord, entries, gradeLevel, studentId) {
        if (!isHighSchoolGrade(gradeLevel)) return '';

        const yearComplete = yearRecord.entry_type === 'backfill'
            ? yearRecord.year_locked
            : yearRecord.semester_2_locked;
        const yearTotals = summarizeCredits(entries, gradeLevel, yearComplete);

        const yearParts = TRANSCRIPT_COURSE_TYPES
            .map((type) => {
                const count = yearTotals[type] || 0;
                return count ? `${courseTypeMeta(type).label} ${count}` : null;
            })
            .filter(Boolean);

        const yearTotal = TRANSCRIPT_COURSE_TYPES.reduce((sum, type) => sum + (yearTotals[type] || 0), 0);
        const yearLine = yearComplete
            ? (yearTotal
                ? `Credits earned ${yearRecord.school_year}: ${yearParts.join(', ')} (${yearTotal} total)`
                : `Credits earned ${yearRecord.school_year}: none yet (passing courses earn 1 credit each).`)
            : `Credits for ${yearRecord.school_year} are calculated when the school year is complete (after Semester 2 is submitted). Each passing course earns 1 credit.`;

        return `
            <div class="ar-credits-summary">
                <div class="ar-credits-summary-panel p-3 border border-violet-200 rounded-xl bg-violet-50/40 text-xs text-slate-700 space-y-2"
                     data-credits-summary="${yearRecord.id}" data-student-id="${studentId}" data-grade-level="${escapeHtml(gradeLevel)}">
                    <div class="font-semibold text-violet-900">High school credits</div>
                    <p>${escapeHtml(yearLine)}</p>
                    <p class="text-slate-500">Alabama graduation: 4 English, 4 Math, 4 Science, 4 History, 8 Electives. Tag each course so transcripts count correctly.</p>
                    <div class="text-slate-600" data-cumulative-credits="${studentId}">Loading cumulative totals...</div>
                </div>
            </div>
        `;
    }

    function buildGradeEntryRowHtml(entry, yearRecord, options = {}) {
        const gradeLevel = yearRecord.grade_level;
        const isHs = isHighSchoolGrade(gradeLevel);
        const readonly = options.readonly || false;
        const canEditMeta = !readonly && (canEditSemester(yearRecord, '1') || canEditSemester(yearRecord, '2'));
        const type = entry.course_type || 'other';
        const meta = courseTypeMeta(type);
        const editS1 = canEditGradeField(yearRecord, 'semester_1_grade', gradeLevel) && !readonly;
        const editS2 = canEditGradeField(yearRecord, 'semester_2_grade', gradeLevel) && !readonly;
        const editFinal = canEditGradeField(yearRecord, 'final_grade', gradeLevel) && !readonly;
        const autoFinal = isHs;
        const displayFinal = autoFinal
            ? computeFinalGrade(entry.semester_1_grade, entry.semester_2_grade, true)
            : (computeFinalGrade(entry.semester_1_grade, entry.semester_2_grade, false) || entry.final_grade || '');

        const finalLabel = `Final${isHs ? ' %' : ''}`;
        const showRemove = canEditMeta && !entry.is_core;

        return `
            <tr class="border-b border-slate-100" data-entry-id="${entry.id}">
                <td class="py-2 pr-2 align-top" data-label="Course">
                    <div class="flex items-start gap-2">
                        <div class="flex-1 min-w-0">
                            <select class="form-input w-full px-2 py-2 text-xs border border-slate-300 rounded-xl mb-1"
                                    data-field="course_type"
                                    ${canEditMeta ? '' : 'disabled'}>
                                ${buildCourseTypeOptions(type, gradeLevel)}
                            </select>
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                                   value="${escapeHtml(entry.course_name || '')}"
                                   data-field="course_name"
                                   placeholder="${escapeHtml(meta.placeholder)}"
                                   ${canEditMeta ? '' : 'readonly'}>
                        </div>
                        ${showRemove ? `
                            <button type="button" class="ar-remove-course-btn shrink-0"
                                    title="Remove course"
                                    onclick="window.AcademicRecords.handleRemoveCourse('${entry.id}', '${yearRecord.id}')">Remove</button>
                        ` : ''}
                    </div>
                </td>
                <td class="py-2 px-2 align-top" data-label="Semester 1${isHs ? ' %' : ''}">
                    <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl ar-grade-s1"
                           value="${escapeHtml(entry.semester_1_grade || '')}"
                           data-field="semester_1_grade"
                           placeholder="${escapeHtml(gradePlaceholder(gradeLevel, 's1'))}"
                           ${editS1 ? '' : 'readonly'}>
                </td>
                <td class="py-2 px-2 align-top" data-label="Semester 2${isHs ? ' %' : ''}">
                    <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl ar-grade-s2"
                           value="${escapeHtml(entry.semester_2_grade || '')}"
                           data-field="semester_2_grade"
                           placeholder="${escapeHtml(gradePlaceholder(gradeLevel, 's2'))}"
                           ${editS2 ? '' : 'readonly'}>
                </td>
                <td class="py-2 pl-2 align-top" data-label="${finalLabel || 'Final'}">
                    <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl ar-grade-final ${autoFinal ? 'bg-slate-50' : ''}"
                           value="${escapeHtml(displayFinal)}"
                           data-field="final_grade"
                           placeholder="${escapeHtml(gradePlaceholder(gradeLevel, 'final'))}"
                           ${editFinal ? '' : 'readonly'}
                           ${autoFinal ? 'readonly' : ''}>
                </td>
            </tr>
        `;
    }

    function buildGradeTableHtml(yearRecord, entries, options = {}) {
        const gradeLevel = yearRecord.grade_level;
        const isBackfill = yearRecord.entry_type === 'backfill';
        const isHs = isHighSchoolGrade(gradeLevel);
        const readonly = options.readonly || false;
        const calSem = getCalendarSemester(yearRecord.school_year);
        const canEditMeta = !readonly && (canEditSemester(yearRecord, '1') || canEditSemester(yearRecord, '2'));

        let rows = '';
        for (const entry of entries) {
            rows += buildGradeEntryRowHtml(entry, yearRecord, options);
        }

        const gradeLabel = isHs ? '%' : '';
        const headers = `<th class="text-left text-xs font-semibold text-slate-600 pb-2">Course</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Sem 1 ${gradeLabel}</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Sem 2 ${gradeLabel}</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Final ${gradeLabel}</th>`;

        const addCourseBtn = canEditMeta ? `
            <button type="button" class="mt-3 px-4 py-2 text-sm font-semibold border border-navy text-navy rounded-xl hover:bg-navy hover:text-white"
                    onclick="window.AcademicRecords.handleAddCourse('${yearRecord.id}')">+ Add course</button>
        ` : '';

        const s2Due = semester2DueDate(yearRecord.school_year, gradeLevel);
        const semNote = isBackfill ? `
            <p class="text-xs text-slate-500 mb-2">
                Prior year: enter Semester 1 and Semester 2 grades, attendance, and finals.
                ${isHs ? 'Percentages only; finals auto-calculate.' : 'Letter or percentage.'}
            </p>
        ` : `
            <p class="text-xs text-slate-500 mb-2">
                ${calSem === '1'
                    ? 'Semester 1 (Jul–Dec): enter Semester 1 grades and attendance. Due Dec 31.'
                    : `Semester 2 (Jan–May): enter Semester 2 grades and attendance. Due ${s2Due}. Finals auto-calculate for high school.`}
            </p>
        `;

        return `
            ${semNote}
            <div class="overflow-x-auto ar-grade-scroll">
                <table class="w-full min-w-[640px] text-sm ar-grade-table"
                       data-year-record-id="${yearRecord.id}"
                       data-grade-level="${escapeHtml(gradeLevel)}">
                    <thead><tr>${headers}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${addCourseBtn}
        `;
    }

    function updateFinalForRow(row, gradeLevel) {
        if (!row) return;
        const s1 = row.querySelector('[data-field="semester_1_grade"]')?.value || '';
        const s2 = row.querySelector('[data-field="semester_2_grade"]')?.value || '';
        const finalInput = row.querySelector('[data-field="final_grade"]');
        if (!finalInput) return;

        const requirePercent = isHighSchoolGrade(gradeLevel);
        if (requirePercent) {
            finalInput.value = computeFinalGrade(s1, s2, true);
            return;
        }

        const computed = computeFinalGrade(s1, s2, false);
        if (computed) {
            finalInput.value = computed;
        }
    }

    function bindGradeRowEvents(row, gradeLevel) {
        if (!row) return;
        row.querySelectorAll('.ar-grade-s1, .ar-grade-s2').forEach((input) => {
            input.addEventListener('input', () => updateFinalForRow(row, gradeLevel));
        });
    }

    function bindGradeTableEvents() {
        document.querySelectorAll('.ar-grade-table').forEach((table) => {
            const gradeLevel = table.dataset.gradeLevel || '';
            table.querySelectorAll('tr[data-entry-id]').forEach((row) => {
                bindGradeRowEvents(row, gradeLevel);
            });
        });
    }

    async function fetchSchoolYearRecord(schoolYearRecordId) {
        const client = await getClient();
        const { data, error } = await client
            .from('student_school_years')
            .select('*')
            .eq('id', schoolYearRecordId)
            .single();
        if (error) throw error;
        return data;
    }

    async function hydrateCumulativeCredits() {
        const blocks = document.querySelectorAll('[data-cumulative-credits]');
        for (const block of blocks) {
            const studentId = block.dataset.cumulativeCredits;
            const summary = block.closest('[data-credits-summary]');
            const level = summary?.dataset.gradeLevel || '9';

            try {
                const totals = await summarizeCumulativeCredits(studentId, level);
                if (!totals) {
                    block.textContent = '';
                    continue;
                }

                const parts = TRANSCRIPT_COURSE_TYPES.map((type) => {
                    const earned = totals[type] || 0;
                    const required = AL_GRAD_CREDIT_REQUIREMENTS[type];
                    return `${courseTypeMeta(type).label} ${earned}/${required}`;
                });

                block.textContent = `Cumulative toward graduation: ${parts.join(', ')}`;
            } catch (err) {
                block.textContent = '';
            }
        }
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

        const name = studentDisplayName(student);
        const years = await fetchSchoolYearsForStudent(studentId);
        const currentYear = currentSchoolYear();
        const current = years.find((y) => y.school_year === currentYear && y.entry_type === 'current');
        const statusLabel = getProgressStatusLabel(current, student?.current_grade_level);
        const closed = current && isSchoolYearClosed(current.school_year) && !current.admin_reopened_at;

        let actionHint = `Enter ${name}'s grades in Academic Records.`;
        if (current?.semester_2_locked) {
            actionHint = `${currentYear} progress report is complete for ${name}.`;
        } else if (closed) {
            actionHint = `The ${currentYear} school year is closed. Contact the school office for changes.`;
        } else if (current?.semester_1_locked) {
            actionHint = `Semester 1 is done — add Semester 2 grades, attendance, and finals for ${name} (due ${semester2DueDate(currentYear, student?.current_grade_level)}).`;
        } else {
            actionHint = `Add Semester 1 grades and attendance for ${name} (due Dec 31).`;
        }

        const borderClass = options.overdueIcon
            ? 'border-red-300 ring-1 ring-red-100'
            : 'border-amber-200';

        return `
            <div class="member-card bg-white border ${borderClass} rounded-3xl p-6 relative" id="progress-task-${studentId}">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                        <h4 class="font-semibold text-lg text-navy">${escapeHtml(task.title)}</h4>
                        <p class="text-sm text-slate-600 mt-1">${escapeHtml(actionHint)}</p>
                        <p class="text-xs font-medium text-slate-500 mt-2">${escapeHtml(statusLabel)}</p>
                        ${options.dueDatesHtml || ''}
                    </div>
                    ${options.overdueIcon || ''}
                </div>
                <button type="button"
                        class="mt-4 w-full py-3 bg-navy hover:bg-[#0F3A5F] text-white font-semibold rounded-2xl text-sm transition-all active:scale-[0.985]"
                        onclick="window.AcademicRecords.openStudentRecord('${studentId}')">
                    Open ${escapeHtml(name)} in Academic Records
                </button>
            </div>
        `;
    }

    function openStudentRecord(studentId) {
        setFocusStudentId(studentId);
        if (typeof window.showDashboardTab === 'function') {
            window.showDashboardTab('academic-records');
        } else if (typeof window.loadAcademicRecords === 'function') {
            window.loadAcademicRecords();
        }
    }

    function buildGradeHelpBanner() {
        const schoolYear = currentSchoolYear();
        return `
            <div class="ar-grade-help">
                <div class="ar-grade-help-header">
                    <span class="ar-grade-help-year">${escapeHtml(schoolYear)}</span>
                    <h3 class="ar-grade-help-title">Progress reports</h3>
                </div>
                <div class="ar-grade-help-grid">
                    <section class="ar-grade-help-block">
                        <h4 class="ar-grade-help-label">Entering grades</h4>
                        <ul class="ar-grade-help-list">
                            <li><strong>K–8</strong> Letter or percentage</li>
                            <li><strong>9–12</strong> Percentages only; finals auto-calculate</li>
                            <li>Name each course (e.g. Geometry) and tag the subject</li>
                            <li>Record attendance each semester before submitting</li>
                        </ul>
                    </section>
                    <section class="ar-grade-help-block ar-grade-help-dates">
                        <h4 class="ar-grade-help-label">Due dates</h4>
                        <dl class="ar-grade-help-dl">
                            <div><dt>Semester 1</dt><dd>Dec 31</dd></div>
                            <div><dt>Semester 2</dt><dd>May 31</dd></div>
                            <div><dt>Seniors</dt><dd>May 15</dd></div>
                        </dl>
                        <p class="ar-grade-help-note">School year ends May 31.</p>
                    </section>
                </div>
                <button type="button" class="ar-grade-chart-btn"
                        onclick="event.stopPropagation(); window.AcademicRecords.showGradeEquivalencyChart()">Letter-to-percentage chart</button>
            </div>
        `;
    }

    function buildAddStudentFormHtml(collapsed = false) {
        const formHtml = `
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
                        ${GRADE_LEVELS.map((g) => `<option value="${g}">${escapeHtml(formatGradeLabel(g))}</option>`).join('')}
                    </select>
                </div>
                <div class="sm:col-span-3 flex items-center gap-3">
                    <button type="submit" id="add-student-submit-btn" class="px-6 py-2.5 bg-navy text-white font-semibold rounded-2xl text-sm hover:bg-[#0F3A5F] disabled:opacity-60 disabled:cursor-not-allowed">Add student</button>
                    <span id="add-student-status" class="text-sm text-slate-500 hidden"></span>
                </div>
            </form>
        `;

        if (collapsed) {
            return `
                <details id="ar-add-student-panel" class="hub-panel hub-panel-padded mt-6 border border-slate-200 rounded-3xl">
                    <summary class="text-lg font-semibold text-navy cursor-pointer list-none">Add another student</summary>
                    <div class="pt-4 mt-2 border-t border-slate-100">${formHtml}</div>
                </details>
            `;
        }

        return `
            <div class="hub-panel hub-panel-padded mb-6">
                <h3 class="text-lg font-semibold text-navy mb-2">Add a student</h3>
                ${formHtml}
            </div>
        `;
    }

    function showGradeEquivalencyChart() {
        let modal = document.getElementById('ar-grade-chart-modal');
        if (!modal) {
            const rows = LETTER_GRADE_SCALE.map((row) => `
                <tr class="border-b border-slate-100">
                    <td class="py-2.5 font-semibold text-navy">${escapeHtml(row.letter)}</td>
                    <td class="py-2.5 text-slate-700">${escapeHtml(row.range)}</td>
                </tr>
            `).join('');

            document.body.insertAdjacentHTML('beforeend', `
                <div id="ar-grade-chart-modal" class="hidden" role="dialog" aria-modal="true" aria-labelledby="ar-grade-chart-title">
                    <button type="button" class="ar-grade-chart-backdrop" aria-label="Close" data-ar-grade-chart-backdrop></button>
                    <div class="ar-grade-chart-panel">
                        <h3 id="ar-grade-chart-title" class="heading-serif text-xl text-navy tracking-tight text-center">Letter to Percentage</h3>
                        <p class="text-sm text-slate-600 mt-2 text-center leading-relaxed">If you graded with letters, enter the matching percentage from this chart.</p>
                        <table class="ar-grade-chart-table text-sm mt-4">
                            <thead>
                                <tr class="border-b border-slate-200 text-xs font-semibold text-slate-500">
                                    <th class="pb-2">Letter</th>
                                    <th class="pb-2">Percentage range</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                        <button type="button" id="ar-grade-chart-close" class="mt-6 w-full min-h-[2.75rem] px-4 py-3 rounded-2xl text-sm font-semibold bg-navy hover:bg-[#0F3A5F] text-white border border-navy">Got it</button>
                    </div>
                </div>
            `);

            modal = document.getElementById('ar-grade-chart-modal');
            const close = () => {
                modal?.classList.add('hidden');
                document.documentElement.classList.remove('app-dialog-open');
                document.body.classList.remove('app-dialog-open');
            };
            modal?.querySelector('[data-ar-grade-chart-backdrop]')?.addEventListener('click', close);
            document.getElementById('ar-grade-chart-close')?.addEventListener('click', close);
            modal?.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) close();
            });
        }

        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }

        const chartTable = modal.querySelector('.ar-grade-chart-table') || modal.querySelector('table');
        if (chartTable && !chartTable.classList.contains('ar-grade-chart-table')) {
            chartTable.classList.add('ar-grade-chart-table');
        }

        document.documentElement.classList.add('app-dialog-open');
        document.body.classList.add('app-dialog-open');
        modal.classList.remove('hidden');
        document.getElementById('ar-grade-chart-close')?.focus({ preventScroll: true });
    }

    async function loadAcademicRecords(options = {}) {
        const root = document.getElementById('academic-records-root');
        if (!root) return;

        const user = await getCurrentUser();
        if (!user) {
            root.innerHTML = '<div class="hub-empty-state">Please log in to manage academic records.</div>';
            return;
        }

        const expandState = options.expandState
            || (root.querySelector('.student-record-panel') ? captureExpandState(root) : null);

        root.innerHTML = '<div class="hub-empty-state">Loading academic records...</div>';

        try {
            const students = await fetchStudents(user.id);
            const backfillYears = priorSchoolYears(5);

            let html = buildGradeHelpBanner();

            if (!students.length) {
                html += buildAddStudentFormHtml(false);
                html += '<div class="hub-empty-state">No students yet. Add each enrolled child above to begin tracking grades.</div>';
                root.innerHTML = html;
                return;
            }

            html += '<div class="space-y-3">';
            const focusId = getFocusStudentId();

            for (const student of students) {
                const currentYear = currentSchoolYear();
                if (student.current_grade_level) {
                    await reconcileStaleCurrentYearRecords(student.id, currentYear);
                }
                let years = await fetchSchoolYearsForStudent(student.id);
                let currentRecord = years.find((y) => y.school_year === currentYear && y.entry_type === 'current');
                if (!currentRecord && student.current_grade_level) {
                    currentRecord = await ensureCurrentSchoolYearRecord(student.id, student.current_grade_level);
                    years = await fetchSchoolYearsForStudent(student.id);
                }
                const backfills = years.filter((y) => y.entry_type === 'backfill');
                const statusLabel = getProgressStatusLabel(currentRecord, student.current_grade_level);
                const isFocused = focusId === student.id;
                const gradeLabel = formatGradeLabel(student.current_grade_level);

                let creditHeaderHtml = '';
                if (isHighSchoolGrade(student.current_grade_level)) {
                    const cumulative = await summarizeCumulativeCredits(student.id, student.current_grade_level);
                    const creditLine = formatCumulativeCreditsLine(cumulative);
                    if (creditLine) {
                        creditHeaderHtml = `<span class="block text-xs text-violet-800 font-medium mt-0.5 text-right">Credits: ${escapeHtml(creditLine)}</span>`;
                    }
                }

                let priorBlock = '';
                if (isHighSchoolGrade(student.current_grade_level)) {
                    priorBlock = `
                        <details class="ar-accordion border border-sky-200 rounded-2xl bg-sky-50/40" data-ar-prior-years="${student.id}">
                            ${buildAccordionSummary({
                                leftHtml: '<span class="text-sm font-semibold text-sky-900">Add Prior Year Records</span>',
                                hint: 'Tap to add prior years',
                                extraClass: 'px-4 py-3 cursor-pointer',
                            })}
                            ${wrapAccordionBody(`<div class="px-4 pb-4 border-t border-sky-100 space-y-3">
                                <p class="text-xs text-slate-600 pt-3">Add years before Summit if this student joined mid-stream. Enter both semesters, attendance, and finals.</p>
                                <form class="flex flex-wrap gap-2 items-end" onsubmit="window.AcademicRecords.handleAddBackfill(event, '${student.id}')">
                                    <select name="school_year" class="form-input px-3 py-2 text-sm border border-slate-300 rounded-xl" required>
                                        <option value="">School year</option>
                                        ${backfillYears.map((y) => `<option value="${y}">${y}</option>`).join('')}
                                    </select>
                                    <select name="grade_level" class="form-input px-3 py-2 text-sm border border-slate-300 rounded-xl" required>
                                        ${GRADE_LEVELS.map((g) => `<option value="${g}">${escapeHtml(formatGradeLabel(g))}</option>`).join('')}
                                    </select>
                                    <button type="submit" class="px-4 py-2 text-sm font-semibold border border-navy text-navy rounded-xl hover:bg-navy hover:text-white">Add prior year</button>
                                </form>
                                ${student.current_grade_level === '9' && student.prior_years_status !== 'not_applicable' ? `
                                    <button type="button" class="px-4 py-2 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50"
                                            onclick="window.AcademicRecords.markNoPriorYears('${student.id}')">Started with Summit in 9th — no prior years</button>
                                ` : student.prior_years_status === 'complete'
                                    ? '<span class="text-xs text-emerald-700">Prior years complete</span>'
                                    : student.prior_years_status === 'not_applicable'
                                        ? '<span class="text-xs text-slate-500">No prior years needed</span>'
                                        : '<span class="text-xs text-amber-700">Add each prior high school year, then mark complete</span>'}
                            </div>`, 'Close prior years')}
                        </details>
                    `;
                } else {
                    priorBlock = `
                        <p class="text-xs text-slate-500">
                            Prior-year backfill is optional for this grade.
                            <button type="button" class="ml-1 text-navy underline" onclick="window.AcademicRecords.markNoPriorYears('${student.id}')">Mark no prior years</button>
                        </p>
                    `;
                }

                let currentYearSection = '';
                if (currentRecord) {
                    const entries = await fetchGradeEntries(currentRecord.id);
                    currentYearSection = `
                        <details class="ar-accordion border border-amber-200 rounded-2xl bg-amber-50/30" data-ar-progress-year="${currentRecord.id}" ${isFocused ? 'open' : ''}>
                            ${buildAccordionSummary({
                                leftHtml: `<span class="font-semibold text-navy">${escapeHtml(currentYear)} progress report</span>`,
                                rightHtml: `<span class="text-xs text-slate-500">${escapeHtml(formatGradeLabel(currentRecord.grade_level))} · ${escapeHtml(currentYear)} · ${escapeHtml(statusLabel)}</span>`,
                                hint: 'Tap to open progress report',
                                extraClass: 'px-4 py-3 cursor-pointer',
                            })}
                            ${wrapAccordionBody(`<div class="p-4 border-t border-amber-100 space-y-4">
                                ${buildAttendanceHtml(currentRecord)}
                                ${buildGradeTableHtml(currentRecord, entries)}
                                ${isHighSchoolGrade(currentRecord.grade_level) ? buildCreditsSummaryHtml(currentRecord, entries, currentRecord.grade_level, student.id) : ''}
                                ${renderSemesterActions(currentRecord)}
                            </div>`, 'Close progress report')}
                        </details>
                    `;
                }

                let backfillSections = '';
                if (backfills.length) {
                    const backfillItems = [];
                    for (const bf of backfills) {
                        const entries = await fetchGradeEntries(bf.id);
                        backfillItems.push(`
                            <details class="ar-accordion border border-slate-200 rounded-xl" data-ar-backfill-year="${bf.id}">
                                ${buildAccordionSummary({
                                    leftHtml: '<span class="font-medium text-navy">Prior year</span>',
                                    rightHtml: `<span class="font-medium text-slate-600">${escapeHtml(bf.school_year)} · ${escapeHtml(formatGradeLabel(bf.grade_level))}${bf.year_locked ? ' ✓' : ''}</span>`,
                                    hint: 'Tap to open',
                                    extraClass: 'px-3 py-2 cursor-pointer text-sm',
                                })}
                                ${wrapAccordionBody(`<div class="p-3 border-t border-slate-100 space-y-3">
                                    ${buildAttendanceHtml(bf)}
                                    ${buildGradeTableHtml(bf, entries)}
                                    ${isHighSchoolGrade(bf.grade_level) ? buildCreditsSummaryHtml(bf, entries, bf.grade_level, student.id) : ''}
                                    ${renderBackfillActions(bf)}
                                </div>`, 'Close prior year')}
                            </details>
                        `);
                    }
                    backfillSections = `
                        <details class="ar-accordion border border-slate-200 rounded-2xl" data-ar-backfill-group="${student.id}">
                            ${buildAccordionSummary({
                                leftHtml: `<span class="text-sm font-semibold text-navy">Prior year records (${backfills.length})</span>`,
                                hint: 'Tap to view prior years',
                                extraClass: 'px-4 py-3 cursor-pointer',
                            })}
                            ${wrapAccordionBody(`<div class="p-4 border-t border-slate-100 space-y-2">${backfillItems.join('')}</div>`, 'Close prior year records')}
                        </details>
                    `;
                }

                html += `
                    <details class="ar-accordion border border-slate-200 rounded-3xl bg-white overflow-hidden student-record-panel" id="student-panel-${student.id}" data-student-id="${student.id}" ${isFocused ? 'open' : ''}>
                        ${buildAccordionSummary({
                            leftHtml: `<span class="font-semibold text-lg text-navy">${escapeHtml(studentDisplayName(student))}</span>`,
                            rightHtml: `<span class="text-sm text-slate-500">${escapeHtml(gradeLabel)} · ${escapeHtml(statusLabel)}${creditHeaderHtml}</span>`,
                            hint: 'Tap student to open',
                            extraClass: 'px-5 py-4 cursor-pointer hover:bg-slate-50',
                        })}
                        ${wrapAccordionBody(`<div class="px-5 pb-5 border-t border-slate-100 space-y-4">
                            ${priorBlock}
                            ${currentYearSection}
                            ${backfillSections}
                        </div>`, 'Back to all students')}
                    </details>
                `;
            }

            html += '</div>';
            html += buildAddStudentFormHtml(true);
            root.innerHTML = html;

            restoreExpandState(root, expandState);
            bindGradeTableEvents();
            bindAttendanceEvents(root);
            bindAccordionControls(root);
            hydrateCumulativeCredits();

            if (focusId) {
                setFocusStudentId(null);
                const panel = document.getElementById(`student-panel-${focusId}`);
                if (panel) {
                    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
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
                            onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '1')">Submit Semester 1</button>
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
                            onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '2')">Submit Semester 2 &amp; Final</button>
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
                <div class="text-sm font-semibold text-amber-900 mb-2">Submit prior year</div>
                <input type="text" id="ack-year-${yearRecord.id}" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl mb-2" placeholder="Parent full name">
                <button type="button" class="px-4 py-2 bg-navy text-white text-sm font-semibold rounded-xl"
                        onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '1')">Submit Semester 1 &amp; 2 &amp; Final</button>
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
            const attendance = collectAttendanceFromPanel(yearRecordId);
            const root = document.getElementById('academic-records-root');
            const expandState = root ? captureExpandState(root) : null;
            await submitSemester(yearRecord, semesterKey, ackName, entries, attendance);
            await loadAcademicRecords({ expandState });
            if (typeof window.loadMyTasks === 'function') await window.loadMyTasks();
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function handleAddStudent(event) {
        event.preventDefault();
        if (isAddingStudent) return;

        const form = event.target;
        const submitBtn = document.getElementById('add-student-submit-btn');
        const statusEl = document.getElementById('add-student-status');
        const formData = Object.fromEntries(new FormData(form).entries());
        const firstName = String(formData.first_name || '').trim();
        const lastName = String(formData.last_name || '').trim();
        const displayName = [firstName, lastName].filter(Boolean).join(' ');

        try {
            const user = await getCurrentUser();
            if (!user) throw new Error('You must be logged in.');

            const duplicate = await findDuplicateStudent(user.id, firstName, lastName);
            if (duplicate) {
                const proceed = await window.showAppConfirm?.({
                    title: 'Student already exists',
                    message: `"${displayName}" is already in your academic records. Add another student with the same name anyway?`,
                    confirmLabel: 'Add anyway',
                    tone: 'primary',
                });
                if (!proceed) return;
            }

            isAddingStudent = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Adding student...';
            }
            if (statusEl) {
                statusEl.textContent = 'Creating student record...';
                statusEl.classList.remove('hidden');
            }

            const student = await addStudent(formData);
            form.reset();
            setFocusStudentId(student.id);
            await loadAcademicRecords();
            if (typeof window.OnboardingChecklist?.refresh === 'function') {
                await window.OnboardingChecklist.refresh();
            }
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        } finally {
            isAddingStudent = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add student';
            }
            if (statusEl) {
                statusEl.classList.add('hidden');
                statusEl.textContent = '';
            }
        }
    }

    async function adminDeleteStudent(studentId, familyUserId) {
        const client = await getClient();
        if (!client || !studentId) throw new Error('Missing student.');

        const { data: student } = await client
            .from('students')
            .select('id, first_name, last_name')
            .eq('id', studentId)
            .maybeSingle();
        if (!student) throw new Error('Student not found.');

        const name = studentDisplayName(student);
        const taskUrl = `${PROGRESS_TASK_URL_PREFIX}${studentId}`;

        if (familyUserId) {
            await client
                .from('family_documents')
                .delete()
                .eq('user_id', familyUserId)
                .eq('url', taskUrl)
                .ilike('category', '%task%');
        }

        const { error } = await client
            .from('students')
            .delete()
            .eq('id', studentId);
        if (error) throw error;

        return { name };
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

    async function handleAddCourse(yearRecordId) {
        const table = document.querySelector(`table[data-year-record-id="${yearRecordId}"]`);
        const tbody = table?.querySelector('tbody');
        if (!table || !tbody) {
            await window.showAppAlert?.('Could not find the grade table. Please refresh the page and try again.');
            return;
        }

        try {
            const yearRecord = await fetchSchoolYearRecord(yearRecordId);
            const entries = await fetchGradeEntries(yearRecordId);
            const nextOrder = entries.length
                ? Math.max(...entries.map((entry) => entry.sort_order || 0)) + 1
                : 0;
            const newEntry = await addCourseRow(yearRecordId, nextOrder, 'elective');

            tbody.insertAdjacentHTML('beforeend', buildGradeEntryRowHtml(newEntry, yearRecord));

            const newRow = tbody.querySelector(`tr[data-entry-id="${newEntry.id}"]`);
            bindGradeRowEvents(newRow, yearRecord.grade_level);
            newRow?.querySelector('[data-field="course_name"]')?.focus({ preventScroll: true });
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function handleRemoveCourse(entryId, yearRecordId) {
        const proceed = await window.showAppConfirm?.({
            title: 'Remove course',
            message: 'Remove this course row? You can add it again before submitting.',
            confirmLabel: 'Remove',
            tone: 'danger',
        });
        if (!proceed) return;

        try {
            const yearRecord = await fetchSchoolYearRecord(yearRecordId);
            if (!canEditSemester(yearRecord, '1') && !canEditSemester(yearRecord, '2')) {
                throw new Error('This record is locked. Contact the school office to request changes.');
            }

            const client = await getClient();
            const { data: entry, error: fetchError } = await client
                .from('grade_entries')
                .select('is_core')
                .eq('id', entryId)
                .single();
            if (fetchError) throw fetchError;
            if (entry?.is_core) {
                throw new Error('Core courses cannot be removed.');
            }

            const { error } = await client.from('grade_entries').delete().eq('id', entryId);
            if (error) throw error;

            document.querySelector(`tr[data-entry-id="${entryId}"]`)?.remove();
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function renderAdminFamilyAcademicRecords(container, familyUserId) {
        if (!container) return;

        if (!familyUserId) {
            container.innerHTML = '<span class="text-slate-500">Select a family to view academic records.</span>';
            return;
        }

        container.innerHTML = '<div class="text-slate-500">Loading academic records...</div>';

        try {
            const students = await fetchStudentsForFamily(familyUserId);
            if (!students.length) {
                container.innerHTML = '<div class="text-slate-500 text-xs italic">No students on file for this family yet.</div>';
                return;
            }

            let html = '<div class="ar-admin-records-root space-y-4">';
            for (const student of students) {
                const name = studentDisplayName(student);
                const years = await fetchSchoolYearsForStudent(student.id);
                const gradeLabel = formatGradeLabel(student.current_grade_level);

                let creditHeaderHtml = '';
                if (isHighSchoolGrade(student.current_grade_level)) {
                    const cumulative = await summarizeCumulativeCredits(student.id, student.current_grade_level);
                    const creditLine = formatCumulativeCreditsLine(cumulative);
                    if (creditLine) {
                        creditHeaderHtml = `<div class="text-[11px] text-violet-800 font-medium mt-0.5">Credits: ${escapeHtml(creditLine)}</div>`;
                    }
                }

                let yearSections = '';
                for (const yearRecord of years) {
                    const entries = await fetchGradeEntries(yearRecord.id);
                    const statusLabel = yearRecord.entry_type === 'backfill'
                        ? (yearRecord.year_locked ? 'Complete' : 'In progress')
                        : getProgressStatusLabel(yearRecord, yearRecord.grade_level);
                    const isLocked = yearRecord.year_locked || yearRecord.semester_1_locked || yearRecord.semester_2_locked;
                    const yearLeft = yearRecord.entry_type === 'backfill'
                        ? `<span class="font-medium text-navy">${escapeHtml(yearRecord.school_year)}</span> <span class="text-slate-500">prior year</span>`
                        : `<span class="font-medium text-navy">${escapeHtml(yearRecord.school_year)}</span> <span class="text-slate-500">progress report</span>`;
                    const yearRight = `<span class="text-slate-600">${escapeHtml(formatGradeLabel(yearRecord.grade_level))} · ${escapeHtml(statusLabel)}</span>`;

                    yearSections += `
                        <details class="ar-accordion border border-slate-200 rounded-xl" data-admin-year="${yearRecord.id}">
                            ${buildAccordionSummary({
                                leftHtml: yearLeft,
                                rightHtml: yearRight,
                                hint: 'Tap to open school year',
                                extraClass: 'px-3 py-2 cursor-pointer text-sm',
                            })}
                            ${wrapAccordionBody(`<div class="p-3 border-t border-slate-100 space-y-3">
                                ${buildAttendanceHtml(yearRecord, { readonly: true })}
                                ${buildGradeTableHtml(yearRecord, entries, { readonly: true })}
                                ${isHighSchoolGrade(yearRecord.grade_level) ? buildCreditsSummaryHtml(yearRecord, entries, yearRecord.grade_level, student.id) : ''}
                                ${isLocked ? `
                                    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span class="text-slate-500">Locked — reopen to let the family edit.</span>
                                        <button type="button" class="px-2 py-0.5 border border-navy text-navy rounded hover:bg-navy hover:text-white"
                                                onclick="adminReopenSchoolYear('${yearRecord.id}', '${escapeJsString(name)}', '${escapeJsString(yearRecord.school_year)}')">Reopen</button>
                                    </div>
                                ` : '<span class="text-xs text-slate-500">In progress — family can still edit.</span>'}
                            </div>`, 'Close school year')}
                        </details>
                    `;
                }

                if (!yearSections) {
                    yearSections = '<p class="text-xs text-slate-500 italic">No school year records yet.</p>';
                }

                const studentRightHtml = `
                    <span class="ar-admin-student-summary-right text-right">
                        <button type="button"
                                class="ar-admin-student-delete text-xs px-2 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50 shrink-0"
                                data-student-id="${student.id}"
                                onclick="event.preventDefault(); event.stopPropagation(); adminDeleteStudent(this)">Delete student</button>
                        <div class="ar-admin-student-meta text-[10px] text-slate-500 mt-0.5">
                            <div>Prior years: ${escapeHtml(student.prior_years_status || 'pending')}</div>
                            ${creditHeaderHtml}
                        </div>
                    </span>
                `;

                html += `
                    <details class="ar-accordion border border-sky-200/80 rounded-xl bg-white/80 overflow-hidden" data-admin-student="${student.id}">
                        ${buildAccordionSummary({
                            leftHtml: `<span class="font-medium text-navy text-sm">${escapeHtml(name)}</span> <span class="text-slate-500 font-normal">(${escapeHtml(gradeLabel)})</span>`,
                            rightHtml: studentRightHtml,
                            hint: 'Tap student to open',
                            extraClass: 'px-3 py-3 cursor-pointer',
                        })}
                        ${wrapAccordionBody(`<div class="px-3 pb-3 border-t border-sky-100 space-y-2">${yearSections}</div>`, 'Back to students')}
                    </details>
                `;
            }
            html += '</div>';
            container.innerHTML = html;
            bindAccordionControls(container);
            bindAttendanceEvents(container);
            hydrateCumulativeCredits();
        } catch (err) {
            container.innerHTML = `<div class="text-red-600 text-xs">${escapeHtml(err.message || String(err))}</div>`;
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
        COURSE_TYPES,
        AL_GRAD_CREDIT_REQUIREMENTS,
        LETTER_GRADE_SCALE,
        PROGRESS_TASK_PREFIX,
        PROGRESS_TASK_URL_PREFIX,
        currentSchoolYear,
        priorSchoolYears,
        isHighSchoolGrade,
        parseProgressReportStudentId,
        percentToGpa,
        renderProgressReportTaskCard,
        openStudentRecord,
        loadAcademicRecords,
        showGradeEquivalencyChart,
        handleAddStudent,
        handleAddCourse,
        handleRemoveCourse,
        handleAddBackfill,
        markNoPriorYears,
        submitFromSection,
        fetchStudents,
        ensureProgressReportTask,
        adminReopenSchoolYear,
        adminDeleteStudent,
        renderAdminFamilyAcademicRecords,
        defaultProgressDueDates,
        studentDisplayName,
    };

    window.loadAcademicRecords = loadAcademicRecords;
})();