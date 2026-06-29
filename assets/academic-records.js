(function () {
    const GRADE_LEVELS = ['K3', 'K4', 'K5', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
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

    // Letter-to-percentage scale for parent reference; GPA used when transcripts are generated.
    const LETTER_GRADE_SCALE = [
        { letter: 'A', range: '90–100%', gpa: 4.0 },
        { letter: 'B', range: '80–89%', gpa: 3.0 },
        { letter: 'C', range: '70–79%', gpa: 2.0 },
        { letter: 'D', range: '60–69%', gpa: 1.0 },
        { letter: 'F', range: 'Below 60%', gpa: 0.0 },
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
        if (year === endYear && month >= 1 && month <= 6) return '2';
        if (year === endYear && month > 6) return '1';
        return '2';
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
            if (field !== 'final_grade') return false;
            return canEditSemester(yearRecord, '1');
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

    function getProgressStatusLabel(yearRecord) {
        if (!yearRecord) return 'No current year record';
        if (yearRecord.semester_2_locked) return `${yearRecord.school_year} complete`;
        if (yearRecord.semester_1_locked) return 'Semester 2 due (May)';
        return 'Semester 1 due (December)';
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
            is_core: courseType !== 'elective',
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
        if (isBackfill) return !name && !final;
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

            if (isBackfill || semesterKey === '2') {
                const final = getEffectiveFinal(entry, gradeLevel);
                if (!final) {
                    throw new Error(`Enter grades for "${name}" before submitting.`);
                }
                if (requirePercent && parsePercent(final) === null) {
                    throw new Error(`High school grades must be percentages (0–100) for "${name}".`);
                }
            }

            if (!isBackfill && semesterKey === '1') {
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

            if (!isBackfill && semesterKey === '2') {
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

    async function submitSemester(yearRecord, semesterKey, ackName, entries) {
        const client = await getClient();
        if (!canEditSemester(yearRecord, semesterKey)) {
            throw new Error('This semester is locked. Contact the school office to request changes.');
        }

        const gradeLevel = yearRecord.grade_level;
        validateEntriesForSubmit(entries, yearRecord, gradeLevel, semesterKey);
        await saveGradeEntries(entries, gradeLevel);

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
            <div class="p-3 border border-violet-200 rounded-xl bg-violet-50/40 text-xs text-slate-700 space-y-2"
                 data-credits-summary="${yearRecord.id}" data-student-id="${studentId}" data-grade-level="${escapeHtml(gradeLevel)}">
                <div class="font-semibold text-violet-900">High school credits</div>
                <p>${escapeHtml(yearLine)}</p>
                <p class="text-slate-500">Alabama graduation: 4 English, 4 Math, 4 Science, 4 History, 8 Electives. Tag each course so transcripts count correctly.</p>
                <div class="text-slate-600" data-cumulative-credits="${studentId}">Loading cumulative totals...</div>
            </div>
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
            const type = entry.course_type || 'other';
            const meta = courseTypeMeta(type);
            const editS1 = canEditGradeField(yearRecord, 'semester_1_grade', gradeLevel) && !readonly;
            const editS2 = canEditGradeField(yearRecord, 'semester_2_grade', gradeLevel) && !readonly;
            const editFinal = canEditGradeField(yearRecord, 'final_grade', gradeLevel) && !readonly;
            const autoFinal = isHs;
            const displayFinal = autoFinal
                ? computeFinalGrade(entry.semester_1_grade, entry.semester_2_grade, true)
                : (computeFinalGrade(entry.semester_1_grade, entry.semester_2_grade, false) || entry.final_grade || '');

            rows += `
                <tr class="border-b border-slate-100" data-entry-id="${entry.id}">
                    <td class="py-2 pr-2 align-top">
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
                    </td>
                    ${isBackfill ? `
                        <td class="py-2 px-2 align-top">
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                                   value="${escapeHtml(entry.final_grade || '')}"
                                   data-field="final_grade"
                                   placeholder="${escapeHtml(isHs ? 'e.g. 92' : 'A–F or %')}"
                                   ${editS1 ? '' : 'readonly'}>
                        </td>
                    ` : `
                        <td class="py-2 px-2 align-top">
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl ar-grade-s1"
                                   value="${escapeHtml(entry.semester_1_grade || '')}"
                                   data-field="semester_1_grade"
                                   placeholder="${escapeHtml(gradePlaceholder(gradeLevel, 's1'))}"
                                   ${editS1 ? '' : 'readonly'}>
                            ${!editS1 && calSem === '2' && !yearRecord.semester_1_locked ? '<span class="text-[10px] text-slate-400">Opens Jul–Dec</span>' : ''}
                        </td>
                        <td class="py-2 px-2 align-top">
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl ar-grade-s2"
                                   value="${escapeHtml(entry.semester_2_grade || '')}"
                                   data-field="semester_2_grade"
                                   placeholder="${escapeHtml(gradePlaceholder(gradeLevel, 's2'))}"
                                   ${editS2 ? '' : 'readonly'}>
                            ${!editS2 && calSem === '1' ? '<span class="text-[10px] text-slate-400">Opens Jan–May</span>' : ''}
                        </td>
                        <td class="py-2 pl-2 align-top">
                            <input type="text" class="form-input w-full px-3 py-2 text-sm border border-slate-300 rounded-xl ar-grade-final ${autoFinal ? 'bg-slate-50' : ''}"
                                   value="${escapeHtml(displayFinal)}"
                                   data-field="final_grade"
                                   placeholder="${escapeHtml(gradePlaceholder(gradeLevel, 'final'))}"
                                   ${editFinal ? '' : 'readonly'}
                                   ${autoFinal ? 'readonly' : ''}>
                        </td>
                    `}
                </tr>
            `;
        }

        const gradeLabel = isHs ? '%' : '';
        const headers = isBackfill
            ? `<th class="text-left text-xs font-semibold text-slate-600 pb-2">Course</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Final ${gradeLabel}</th>`
            : `<th class="text-left text-xs font-semibold text-slate-600 pb-2">Course</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Sem 1 ${gradeLabel}</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Sem 2 ${gradeLabel}</th><th class="text-left text-xs font-semibold text-slate-600 pb-2">Final ${gradeLabel}</th>`;

        const addCourseBtn = canEditMeta ? `
            <button type="button" class="mt-3 px-4 py-2 text-sm font-semibold border border-navy text-navy rounded-xl hover:bg-navy hover:text-white"
                    onclick="window.AcademicRecords.handleAddCourse('${yearRecord.id}')">+ Add course</button>
        ` : '';

        const semNote = !isBackfill ? `
            <p class="text-xs text-slate-500 mb-2">
                ${calSem === '1'
                    ? 'Semester 1 (Jul–Dec): enter Semester 1 grades only.'
                    : 'Semester 2 (Jan–May): enter Semester 2 grades. Finals auto-calculate for high school.'}
            </p>
        ` : (isHs ? '<p class="text-xs text-slate-500 mb-2">Prior-year backfill: enter percentages only.</p>' : '<p class="text-xs text-slate-500 mb-2">Prior-year backfill: letter or percentage.</p>');

        return `
            ${semNote}
            <div class="overflow-x-auto">
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

    function bindGradeTableEvents() {
        document.querySelectorAll('.ar-grade-table').forEach((table) => {
            const gradeLevel = table.dataset.gradeLevel || '';
            table.querySelectorAll('tr[data-entry-id]').forEach((row) => {
                row.querySelectorAll('.ar-grade-s1, .ar-grade-s2').forEach((input) => {
                    input.addEventListener('input', () => updateFinalForRow(row, gradeLevel));
                });
            });
        });
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
        const statusLabel = getProgressStatusLabel(current);
        const closed = current && isSchoolYearClosed(current.school_year) && !current.admin_reopened_at;

        let actionHint = `Enter ${name}'s grades in Academic Records.`;
        if (current?.semester_2_locked) {
            actionHint = `${currentYear} progress report is complete for ${name}.`;
        } else if (closed) {
            actionHint = `The ${currentYear} school year is closed. Contact the school office for changes.`;
        } else if (current?.semester_1_locked) {
            actionHint = `Semester 1 is done — add Semester 2 and final grades for ${name} in Academic Records.`;
        } else {
            actionHint = `Add Semester 1 grades for ${name} in Academic Records.`;
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
        return `
            <div class="mb-4 p-3 border border-amber-200 rounded-2xl bg-amber-50/50 text-sm text-slate-700">
                <strong>Grades K–8:</strong> letter (A–F) or percentage.
                <strong class="ml-2">High school (9–12):</strong> percentages only — finals auto-calculate; credits and GPA apply at transcript time.
                Name each course specifically (e.g. Geometry, not Math) and tag the subject type.
                <button type="button" class="ml-1 text-navy font-semibold underline"
                        onclick="window.AcademicRecords.showGradeEquivalencyChart()">Letter grade chart</button>
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
                        ${GRADE_LEVELS.map((g) => `<option value="${g}">${g === 'K3' || g === 'K4' || g === 'K5' ? g : `Grade ${g}`}</option>`).join('')}
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
                <details class="hub-panel hub-panel-padded mt-6 border border-slate-200 rounded-3xl">
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
                    <td class="py-2 pr-4 font-semibold text-navy">${escapeHtml(row.letter)}</td>
                    <td class="py-2 pr-4">${escapeHtml(row.range)}</td>
                    <td class="py-2 text-slate-600">${row.gpa.toFixed(1)}</td>
                </tr>
            `).join('');

            document.body.insertAdjacentHTML('beforeend', `
                <div id="ar-grade-chart-modal" class="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="ar-grade-chart-title">
                    <button type="button" class="absolute inset-0 w-full h-full border-0 p-0 bg-navy/50" aria-label="Close" data-ar-grade-chart-backdrop></button>
                    <div class="relative z-10 w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-2xl p-6">
                        <h3 id="ar-grade-chart-title" class="heading-serif text-xl text-navy tracking-tight">Letter to Percentage</h3>
                        <p class="text-sm text-slate-600 mt-2">If you graded with letters, use this chart to enter the matching percentage. GPA is calculated from the percentage when transcripts are generated.</p>
                        <table class="w-full text-sm mt-4">
                            <thead>
                                <tr class="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                                    <th class="pb-2 pr-4">Letter</th>
                                    <th class="pb-2 pr-4">Use this %</th>
                                    <th class="pb-2">GPA</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                        <button type="button" id="ar-grade-chart-close" class="mt-6 w-full min-h-[2.75rem] px-4 py-3 rounded-2xl text-sm font-semibold bg-navy hover:bg-[#0F3A5F] text-white border border-navy">Got it</button>
                    </div>
                </div>
            `);

            modal = document.getElementById('ar-grade-chart-modal');
            const close = () => modal?.classList.add('hidden');
            modal?.querySelector('[data-ar-grade-chart-backdrop]')?.addEventListener('click', close);
            document.getElementById('ar-grade-chart-close')?.addEventListener('click', close);
            modal?.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) close();
            });
        }

        modal.classList.remove('hidden');
        document.getElementById('ar-grade-chart-close')?.focus({ preventScroll: true });
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
                const years = await fetchSchoolYearsForStudent(student.id);
                const currentYear = currentSchoolYear();
                const currentRecord = years.find((y) => y.school_year === currentYear && y.entry_type === 'current');
                const backfills = years.filter((y) => y.entry_type === 'backfill');
                const statusLabel = getProgressStatusLabel(currentRecord);
                const isFocused = focusId === student.id;
                const gradeLabel = student.current_grade_level === 'K3' || student.current_grade_level === 'K4' || student.current_grade_level === 'K5'
                    ? student.current_grade_level
                    : `Grade ${student.current_grade_level || '—'}`;

                let priorBlock = '';
                if (isHighSchoolGrade(student.current_grade_level)) {
                    priorBlock = `
                        <details class="border border-sky-200 rounded-2xl bg-sky-50/40">
                            <summary class="px-4 py-3 cursor-pointer text-sm font-semibold text-sky-900">Prior school years (high school)</summary>
                            <div class="px-4 pb-4 border-t border-sky-100 space-y-3">
                                <p class="text-xs text-slate-600 pt-3">Add years before Summit if this student joined mid-stream. Full-year grades only.</p>
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
                                ` : student.prior_years_status === 'complete'
                                    ? '<span class="text-xs text-emerald-700">Prior years complete</span>'
                                    : student.prior_years_status === 'not_applicable'
                                        ? '<span class="text-xs text-slate-500">No prior years needed</span>'
                                        : '<span class="text-xs text-amber-700">Add each prior high school year, then mark complete</span>'}
                            </div>
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
                        <details class="border border-amber-200 rounded-2xl bg-amber-50/30" ${isFocused ? 'open' : ''}>
                            <summary class="px-4 py-3 cursor-pointer font-semibold text-navy">${currentYear} progress report — ${escapeHtml(statusLabel)}</summary>
                            <div class="p-4 border-t border-amber-100 space-y-4">
                                <p class="text-xs text-slate-600">Grade ${escapeHtml(currentRecord.grade_level)} for ${currentYear}</p>
                                ${buildGradeTableHtml(currentRecord, entries)}
                                ${isHighSchoolGrade(currentRecord.grade_level) ? buildCreditsSummaryHtml(currentRecord, entries, currentRecord.grade_level, student.id) : ''}
                                ${renderSemesterActions(currentRecord)}
                            </div>
                        </details>
                    `;
                }

                let backfillSections = '';
                if (backfills.length) {
                    const backfillItems = [];
                    for (const bf of backfills) {
                        const entries = await fetchGradeEntries(bf.id);
                        backfillItems.push(`
                            <details class="border border-slate-200 rounded-xl">
                                <summary class="px-3 py-2 cursor-pointer text-sm font-medium text-navy">${escapeHtml(bf.school_year)} — Grade ${escapeHtml(bf.grade_level)} ${bf.year_locked ? '✓' : ''}</summary>
                                <div class="p-3 border-t border-slate-100 space-y-3">
                                    ${buildGradeTableHtml(bf, entries)}
                                    ${isHighSchoolGrade(bf.grade_level) ? buildCreditsSummaryHtml(bf, entries, bf.grade_level, student.id) : ''}
                                    ${renderBackfillActions(bf)}
                                </div>
                            </details>
                        `);
                    }
                    backfillSections = `
                        <details class="border border-slate-200 rounded-2xl">
                            <summary class="px-4 py-3 cursor-pointer text-sm font-semibold text-navy">Prior year records (${backfills.length})</summary>
                            <div class="p-4 border-t border-slate-100 space-y-2">${backfillItems.join('')}</div>
                        </details>
                    `;
                }

                html += `
                    <details class="border border-slate-200 rounded-3xl bg-white overflow-hidden student-record-panel" id="student-panel-${student.id}" data-student-id="${student.id}" ${isFocused ? 'open' : ''}>
                        <summary class="px-5 py-4 cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50">
                            <span class="font-semibold text-lg text-navy">${escapeHtml(studentDisplayName(student))}</span>
                            <span class="text-sm text-slate-500">${escapeHtml(gradeLabel)} · ${escapeHtml(statusLabel)}</span>
                        </summary>
                        <div class="px-5 pb-5 border-t border-slate-100 space-y-4">
                            ${priorBlock}
                            ${currentYearSection}
                            ${backfillSections}
                        </div>
                    </details>
                `;
            }

            html += '</div>';
            html += buildAddStudentFormHtml(true);
            root.innerHTML = html;

            bindGradeTableEvents();
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
        try {
            const client = await getClient();
            const { data: yearRecord } = await client
                .from('student_school_years')
                .select('*')
                .eq('id', yearRecordId)
                .single();
            const entries = await fetchGradeEntries(yearRecordId);
            const nextOrder = entries.length
                ? Math.max(...entries.map((entry) => entry.sort_order || 0)) + 1
                : 0;
            await addCourseRow(yearRecordId, nextOrder, 'elective');
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
        handleAddBackfill,
        markNoPriorYears,
        submitFromSection,
        fetchStudents,
        ensureProgressReportTask,
        adminReopenSchoolYear,
        adminDeleteStudent,
        defaultProgressDueDates,
        studentDisplayName,
    };

    window.loadAcademicRecords = loadAcademicRecords;
})();