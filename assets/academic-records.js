(function () {
    const GRADE_LEVELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    const KINDERGARTEN_GRADES = new Set(['K', 'K3', 'K4', 'K5']);
    const HIGH_SCHOOL_GRADES = new Set(['9', '10', '11', '12']);
    const STUDENT_ACCENT_CLASSES = [
        'ar-accent-student-a',
        'ar-accent-student-b',
        'ar-accent-student-c',
        'ar-accent-student-d',
        'ar-accent-student-e',
    ];

    function getStudentAccentClass(studentIndex) {
        return STUDENT_ACCENT_CLASSES[studentIndex % STUDENT_ACCENT_CLASSES.length];
    }
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
            hintOpen = '',
            extraClass = '',
        } = options;

        const hintHtml = hintOpen
            ? `
                <span class="ar-accordion-hint ar-accordion-hint--closed">${escapeHtml(hint)}</span>
                <span class="ar-accordion-hint ar-accordion-hint--open">${escapeHtml(hintOpen)}</span>
            `
            : `<span class="ar-accordion-hint">${escapeHtml(hint)}</span>`;

        return `
            <summary class="ar-accordion-trigger ar-summary-row list-none ${extraClass}">
                <span class="ar-accordion-leading ar-summary-left">
                    <span class="ar-accordion-chevron">${ACCORDION_CHEVRON_SVG}</span>
                    <span class="ar-accordion-label">${leftHtml}</span>
                </span>
                ${rightHtml ? `<span class="ar-summary-right">${rightHtml}</span>` : ''}
                ${hintHtml}
            </summary>
        `;
    }

    function buildStudentPanelSummary(student, options = {}) {
        const {
            gradeLabel = '',
            statusLabel = '',
            creditHeaderHtml = '',
            rightExtraHtml = '',
            isFocused = false,
            extraClass = 'px-5 py-4 cursor-pointer',
        } = options;

        return buildAccordionSummary({
            leftHtml: `
                <span class="ar-student-panel-heading">
                    <span class="ar-supplemental-eyebrow">Student</span>
                    <span class="ar-student-panel-name">${escapeHtml(studentDisplayName(student))}</span>
                </span>
            `,
            rightHtml: `
                <span class="ar-student-panel-meta">
                    ${rightExtraHtml}
                    <span class="ar-student-panel-meta-line">${escapeHtml(gradeLabel)} · ${escapeHtml(statusLabel)}</span>
                    ${creditHeaderHtml}
                </span>
            `,
            hint: 'Tap student to open',
            hintOpen: 'Tap student to close',
            extraClass,
        });
    }

    function buildSupplementalCardHeader(eyebrow, title, trailingHtml = '') {
        return `
            <div class="ar-supplemental-card-header">
                <div>
                    <p class="ar-supplemental-eyebrow">${escapeHtml(eyebrow)}</p>
                    <h4 class="ar-supplemental-title">${escapeHtml(title)}</h4>
                </div>
                ${trailingHtml}
            </div>
        `;
    }

    function buildSupplementalStatusCard(message, options = {}) {
        const {
            eyebrow = 'Status',
            title = 'Submission',
            complete = true,
        } = options;
        const statusClass = complete ? 'ar-supplemental-status' : 'ar-supplemental-muted';
        return `
            <div class="ar-supplemental-card ${complete ? 'ar-accent-status-complete' : 'ar-accent-status-pending'} ar-submit-panel${complete ? ' ar-submit-panel--complete' : ''}">
                ${buildSupplementalCardHeader(eyebrow, title)}
                <p class="${statusClass}">${escapeHtml(message)}</p>
            </div>
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
            <div class="ar-supplemental-card ar-accent-attendance ar-attendance-panel" data-ar-attendance="${yearRecord.id}">
                ${buildSupplementalCardHeader('Required', 'Attendance')}
                <p class="ar-supplemental-lead">Enter the number of <strong>school days attended</strong> each semester. Total updates automatically.</p>
                <div class="ar-attendance-grid">
                    <div class="ar-attendance-field">
                        <label class="ar-field-label">Semester 1 days</label>
                        <input type="number" min="0" max="200" step="1" inputmode="numeric"
                               class="ar-supplemental-input"
                               value="${escapeHtml(s1Display)}"
                               data-field="semester_1_attendance_days"
                               placeholder="e.g. 88"
                               ${editS1 ? '' : 'readonly'}>
                    </div>
                    <div class="ar-attendance-field">
                        <label class="ar-field-label">Semester 2 days</label>
                        <input type="number" min="0" max="200" step="1" inputmode="numeric"
                               class="ar-supplemental-input"
                               value="${escapeHtml(s2Display)}"
                               data-field="semester_2_attendance_days"
                               placeholder="e.g. 90"
                               ${editS2 ? '' : 'readonly'}>
                    </div>
                    <div class="ar-attendance-field">
                        <label class="ar-field-label">Total days</label>
                        <input type="text" readonly tabindex="-1"
                               class="ar-supplemental-input ar-supplemental-input--readonly"
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
                details.querySelectorAll('details').forEach((nested) => nested.removeAttribute('open'));
                details.removeAttribute('open');
                const summary = details.querySelector('summary');
                if (summary) {
                    summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        });
    }

    const ADD_MODE_STUDENT = 'student';
    const ADD_MODE_PRIOR = 'prior';

    function getYearStatusLabel(yearRecord) {
        if (!yearRecord) return 'No record';
        if (yearRecord.entry_type === 'backfill') {
            return yearRecord.year_locked ? 'Complete' : 'In progress';
        }
        return getProgressStatusLabel(yearRecord, yearRecord.grade_level);
    }

    function formatSchoolYearTabLabel(schoolYear) {
        const parts = String(schoolYear).split('-');
        if (parts.length === 2) {
            const end = parts[1].slice(-2);
            return `${parts[0]}–${end}`;
        }
        return schoolYear;
    }

    function sortSchoolYearsForDisplay(years, activeSchoolYear) {
        return [...years].sort((a, b) => {
            const aCurrent = a.school_year === activeSchoolYear && a.entry_type === 'current';
            const bCurrent = b.school_year === activeSchoolYear && b.entry_type === 'current';
            if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
            return String(b.school_year).localeCompare(String(a.school_year));
        });
    }

    function buildYearTabButton(studentId, yearRecord, isActive) {
        const label = formatSchoolYearTabLabel(yearRecord.school_year);
        const fullLabel = yearRecord.school_year;
        return `
            <button type="button"
                    class="ar-year-tab-btn hub-tab-btn ${isActive ? 'is-active' : ''}"
                    role="tab"
                    aria-selected="${isActive ? 'true' : 'false'}"
                    title="${escapeHtml(fullLabel)}"
                    data-ar-student-tab="${studentId}"
                    data-ar-year-tab="${yearRecord.id}"
                    onclick="window.AcademicRecords.showStudentYearTab('${studentId}', '${yearRecord.id}')">
                <span class="ar-year-tab-short">${escapeHtml(label)}</span>
                <span class="ar-year-tab-full">${escapeHtml(fullLabel)}</span>
            </button>
        `;
    }

    function buildYearTabPanel(studentId, yearRecordId, content, isActive) {
        return `
            <div class="ar-year-tab-panel ${isActive ? '' : 'hidden'}"
                 role="tabpanel"
                 data-ar-year-panel="${yearRecordId}"
                 data-ar-student-panel="${studentId}">${content}</div>
        `;
    }

    function buildStudentYearTabsShell(studentId, tabButtonsHtml, tabPanelsHtml, activeYearId, defaultYearId) {
        return `
            <div class="ar-student-year-tabs"
                 data-ar-student-tabs="${studentId}"
                 data-ar-active-year="${activeYearId || ''}"
                 data-ar-default-year="${defaultYearId || ''}">
                <div class="ar-year-tab-group hub-tab-group" role="tablist" aria-label="School years">
                    ${tabButtonsHtml}
                </div>
                <div class="ar-year-tab-panels">${tabPanelsHtml}</div>
            </div>
        `;
    }

    function getStudentTabsContainer(studentId) {
        return document.querySelector(`#academic-records-root [data-ar-student-tabs="${studentId}"]`)
            || document.querySelector(`.ar-admin-records-root [data-ar-student-tabs="${studentId}"]`);
    }

    function showStudentYearTab(studentId, yearRecordId) {
        const container = getStudentTabsContainer(studentId);
        if (!container) return;

        container.dataset.arActiveYear = yearRecordId;
        container.querySelectorAll('[data-ar-year-tab]').forEach((button) => {
            const isActive = button.dataset.arYearTab === yearRecordId;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        container.querySelectorAll('[data-ar-year-panel]').forEach((panel) => {
            panel.classList.toggle('hidden', panel.dataset.arYearPanel !== yearRecordId);
        });
    }

    function resetStudentYearTab(studentId) {
        const container = getStudentTabsContainer(studentId);
        const defaultYearId = container?.dataset.arDefaultYear;
        if (container && defaultYearId) {
            showStudentYearTab(studentId, defaultYearId);
        }
    }

    function sanitizeStorageFileName(name) {
        return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
    }

    function buildTranscriptStoragePath(userId, yearRecordId, fileName) {
        return `${userId}/academic-records/transcripts/${yearRecordId}/${Date.now()}-${sanitizeStorageFileName(fileName)}`;
    }

    function getFixedHeaderOffset(extra = 12) {
        const nav = document.querySelector('nav.sticky');
        const navHeight = nav ? nav.getBoundingClientRect().height : 0;
        return navHeight + extra;
    }

    function scrollToElementWithOffset(element, options = {}) {
        if (!element) return;
        const { behavior = 'smooth', extra = 12 } = options;
        const offset = getFixedHeaderOffset(extra);
        const top = element.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior });
    }

    function scrollToStudentTop(studentId) {
        const panel = document.getElementById(`student-panel-${studentId}`);
        const target = panel?.querySelector('summary') || panel;
        scrollToElementWithOffset(target, { extra: 10 });
    }

    function buildBackToStudentTopBar(studentId) {
        return `
            <div class="ar-accordion-closebar ar-accordion-closebar--bottom">
                <button type="button" class="ar-accordion-close-btn ar-back-to-top-btn" data-ar-back-to-student-top="${studentId}">
                    <span class="ar-accordion-close-icon" aria-hidden="true">↑</span>
                    Back to top
                </button>
            </div>
        `;
    }

    function buildTranscriptUploadSectionHtml(yearRecord, options = {}) {
        const { readonly = false } = options;
        if (yearRecord.entry_type !== 'backfill' || !isHighSchoolGrade(yearRecord.grade_level)) {
            return '';
        }

        const hasFile = Boolean(yearRecord.transcript_storage_path);
        const uploadedAt = yearRecord.transcript_uploaded_at
            ? new Date(yearRecord.transcript_uploaded_at).toLocaleDateString()
            : '';
        const fileLabel = yearRecord.transcript_file_name || 'Uploaded transcript';

        if (readonly) {
            if (!hasFile) {
                return `
                    <div class="ar-supplemental-card ar-accent-transcript ar-transcript-upload ar-transcript-upload--readonly ar-transcript-upload--empty">
                        ${buildSupplementalCardHeader('Optional', 'Official transcript photo')}
                        <p class="ar-supplemental-muted">No official transcript photo on file.</p>
                    </div>
                `;
            }
            return `
                <div class="ar-supplemental-card ar-accent-transcript-filed ar-transcript-upload ar-transcript-upload--readonly" data-ar-transcript="${yearRecord.id}">
                    ${buildSupplementalCardHeader('On file', 'Official transcript photo')}
                    <p class="ar-transcript-file-meta">${escapeHtml(fileLabel)}${uploadedAt ? ` · ${escapeHtml(uploadedAt)}` : ''}</p>
                    <button type="button"
                            class="ar-supplemental-btn ar-supplemental-btn--secondary"
                            data-ar-transcript-view="${yearRecord.id}"
                            data-transcript-path="${escapeHtml(yearRecord.transcript_storage_path)}">View transcript</button>
                </div>
            `;
        }

        const canUpload = !yearRecord.year_locked;
        return `
            <div class="ar-supplemental-card ar-accent-transcript ar-transcript-upload" data-ar-transcript="${yearRecord.id}">
                ${buildSupplementalCardHeader('Optional', 'Official transcript photo')}
                <p class="ar-supplemental-lead">Upload a photo or PDF of the official transcript for this prior year if you have one. You still need to complete the report above even if you upload a picture.</p>
                ${hasFile ? `
                    <div class="ar-transcript-file-block">
                        <p class="ar-transcript-file-meta">${escapeHtml(fileLabel)} on file${uploadedAt ? ` · uploaded ${escapeHtml(uploadedAt)}` : ''}</p>
                        <button type="button"
                                class="ar-transcript-file-link"
                                data-ar-transcript-view="${yearRecord.id}"
                                data-transcript-path="${escapeHtml(yearRecord.transcript_storage_path)}">View uploaded transcript</button>
                    </div>
                ` : ''}
                ${canUpload ? `
                    <div class="ar-transcript-upload-controls">
                        <input type="file"
                               accept="image/*,.pdf,application/pdf"
                               class="form-input ar-transcript-file-input"
                               data-ar-transcript-input="${yearRecord.id}">
                        <div class="ar-transcript-upload-actions">
                            <button type="button"
                                    class="ar-supplemental-btn ar-supplemental-btn--secondary"
                                    data-ar-transcript-upload="${yearRecord.id}">Upload</button>
                            <span class="ar-transcript-upload-status hidden" data-ar-transcript-status="${yearRecord.id}"></span>
                        </div>
                    </div>
                ` : '<p class="ar-supplemental-muted">Transcript upload is locked after this prior year is submitted.</p>'}
            </div>
        `;
    }

    function buildSchoolYearDetailHtml(yearRecord, entries, student, options = {}) {
        const { readonly = false, admin = false } = options;
        const statusLabel = getYearStatusLabel(yearRecord);
        const reportLabel = yearRecord.entry_type === 'backfill' ? 'prior year record' : 'progress report';
        const isLocked = yearRecord.year_locked || yearRecord.semester_1_locked || yearRecord.semester_2_locked;

        let actionsHtml = '';
        if (!readonly) {
            actionsHtml = yearRecord.entry_type === 'backfill'
                ? renderBackfillActions(yearRecord)
                : renderSemesterActions(yearRecord);
        } else if (admin && isLocked) {
            const name = escapeJsString(studentDisplayName(student));
            const schoolYear = escapeJsString(yearRecord.school_year);
            actionsHtml = `
                <div class="ar-supplemental-card ar-accent-admin ar-admin-panel">
                    ${buildSupplementalCardHeader('Staff', 'Record status')}
                    <p class="ar-supplemental-muted">Locked — reopen to let the family edit.</p>
                    <button type="button" class="ar-supplemental-btn ar-supplemental-btn--secondary ar-admin-reopen-btn"
                            onclick="adminReopenSchoolYear('${yearRecord.id}', '${name}', '${schoolYear}')">Reopen</button>
                </div>
            `;
        } else if (admin) {
            actionsHtml = buildSupplementalStatusCard('In progress — family can still edit.', {
                eyebrow: 'Staff',
                title: 'Record status',
                complete: false,
            });
        }

        const hsSupplemental = isHighSchoolGrade(yearRecord.grade_level)
            ? `${buildCreditsSummaryHtml(yearRecord, entries, yearRecord.grade_level, student.id)}${buildTranscriptUploadSectionHtml(yearRecord, { readonly })}`
            : buildTranscriptUploadSectionHtml(yearRecord, { readonly });

        return `
            <div class="ar-year-detail-intro mb-4 pb-3 border-b border-slate-100">
                <p class="text-sm font-semibold text-navy">${escapeHtml(yearRecord.school_year)} ${reportLabel}</p>
                <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(formatGradeLabel(yearRecord.grade_level))} · ${escapeHtml(statusLabel)}</p>
            </div>
            <div class="ar-year-cards" data-ar-scroll-anchor="${yearRecord.id}">
                ${buildAttendanceHtml(yearRecord, { readonly })}
                ${buildGradeTableHtml(yearRecord, entries, { readonly })}
                ${hsSupplemental}
                ${actionsHtml}
            </div>
            ${buildBackToStudentTopBar(student.id)}
        `;
    }

    function bindBackToStudentTop(root) {
        if (!root) return;

        root.querySelectorAll('[data-ar-back-to-student-top]').forEach((button) => {
            if (button.dataset.arBackToStudentTopBound === '1') return;
            button.dataset.arBackToStudentTopBound = '1';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                scrollToStudentTop(button.dataset.arBackToStudentTop);
            });
        });
    }

    function buildExpandStateForStudent(studentId, yearRecordId) {
        const root = document.getElementById('academic-records-root');
        const expandState = root?.querySelector('.student-record-panel')
            ? captureExpandState(root)
            : { studentIds: [], studentYearTabs: {}, addStudentOpen: false, addPanelMode: ADD_MODE_STUDENT };

        if (!expandState.studentIds.includes(studentId)) {
            expandState.studentIds.push(studentId);
        }
        if (yearRecordId) {
            expandState.studentYearTabs = {
                ...(expandState.studentYearTabs || {}),
                [studentId]: yearRecordId,
            };
        }
        return expandState;
    }

    function isAddPanelOpen(panel) {
        return Boolean(panel && !panel.classList.contains('hidden'));
    }

    function closeAddPanel() {
        const panel = document.getElementById('ar-add-panel');
        const trigger = document.querySelector('.ar-add-trigger');
        if (panel) panel.classList.add('hidden');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    function toggleAddPanel(forceOpen) {
        const panel = document.getElementById('ar-add-panel');
        const trigger = document.querySelector('.ar-add-trigger');
        if (!panel) return;

        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
        if (shouldOpen) {
            panel.classList.remove('hidden');
            trigger?.setAttribute('aria-expanded', 'true');
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            panel.classList.add('hidden');
            trigger?.setAttribute('aria-expanded', 'false');
        }
    }

    function setAddPanelMode(mode) {
        const root = document.getElementById('academic-records-root');
        if (!root) return;

        const studentForm = root.querySelector('#ar-add-student-form-wrap');
        const priorForm = root.querySelector('#ar-add-prior-form-wrap');
        root.querySelectorAll('[data-ar-add-mode]').forEach((button) => {
            const isActive = button.dataset.arAddMode === mode;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        studentForm?.classList.toggle('hidden', mode !== ADD_MODE_STUDENT);
        priorForm?.classList.toggle('hidden', mode !== ADD_MODE_PRIOR);

        const panel = root.querySelector('#ar-add-panel');
        if (panel) panel.dataset.arAddMode = mode;
    }

    function bindAddPanelControls(root) {
        if (!root) return;

        const panel = root.querySelector('#ar-add-panel');
        const trigger = root.querySelector('.ar-add-trigger');
        if (panel && trigger) {
            trigger.setAttribute('aria-expanded', isAddPanelOpen(panel) ? 'true' : 'false');
        }
    }

    function bindAcademicRecordsDelegation() {
        const root = document.getElementById('academic-records-root');
        if (!root || root.dataset.arDelegationBound === '1') return;
        root.dataset.arDelegationBound = '1';

        root.addEventListener('click', (event) => {
            if (event.target.closest('.ar-add-trigger')) {
                event.preventDefault();
                toggleAddPanel();
                return;
            }

            const modeBtn = event.target.closest('[data-ar-add-mode]');
            if (modeBtn) {
                event.preventDefault();
                setAddPanelMode(modeBtn.dataset.arAddMode);
            }
        });
    }

    function bindStudentPanelBehavior(root) {
        if (!root) return;

        root.querySelectorAll('.student-record-panel').forEach((panel) => {
            const summary = panel.querySelector('summary');
            if (!summary) return;

            summary.addEventListener('click', () => {
                const willOpen = !panel.hasAttribute('open');
                if (!willOpen) return;

                root.querySelectorAll('.student-record-panel[open]').forEach((other) => {
                    if (other !== panel) other.removeAttribute('open');
                });

                const scrollAfterOpen = () => {
                    panel.removeEventListener('toggle', scrollAfterOpen);
                    if (!panel.open) return;
                    requestAnimationFrame(() => {
                        scrollToElementWithOffset(panel.querySelector('summary') || panel, { extra: 10 });
                    });
                };
                panel.addEventListener('toggle', scrollAfterOpen);
            });

            panel.addEventListener('toggle', () => {
                if (!panel.open && panel.dataset.studentId) {
                    resetStudentYearTab(panel.dataset.studentId);
                }
            });
        });
    }

    function replaceTranscriptUploadSection(yearRecord, options = {}) {
        const existing = document.querySelector(`[data-ar-transcript="${yearRecord.id}"]`);
        if (!existing) return;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildTranscriptUploadSectionHtml(yearRecord, options).trim();
        const replacement = wrapper.firstElementChild;
        if (!replacement) return;

        existing.replaceWith(replacement);
        bindTranscriptHandlers(document.getElementById('academic-records-root'));
    }

    function bindTranscriptHandlers(root) {
        if (!root) return;

        root.querySelectorAll('[data-ar-transcript-upload]').forEach((button) => {
            if (button.dataset.arTranscriptUploadBound === '1') return;
            button.dataset.arTranscriptUploadBound = '1';
            button.addEventListener('click', () => {
                handleTranscriptUpload(button.dataset.arTranscriptUpload);
            });
        });

        root.querySelectorAll('[data-ar-transcript-view]').forEach((button) => {
            if (button.dataset.arTranscriptViewBound === '1') return;
            button.dataset.arTranscriptViewBound = '1';
            button.addEventListener('click', () => {
                openTranscriptFile(button.dataset.transcriptPath);
            });
        });
    }

    async function openTranscriptFile(storagePath) {
        if (!storagePath) {
            await window.showAppAlert?.('No transcript file found.');
            return;
        }
        try {
            const client = await getClient();
            if (!client) throw new Error('Storage is not available.');
            const { data, error } = await client.storage
                .from('Family-Documents')
                .createSignedUrl(storagePath, 3600);
            if (error) throw error;
            if (!data?.signedUrl) throw new Error('Could not open transcript file.');
            window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        }
    }

    async function handleTranscriptUpload(yearRecordId) {
        const input = document.querySelector(`[data-ar-transcript-input="${yearRecordId}"]`);
        const statusEl = document.querySelector(`[data-ar-transcript-status="${yearRecordId}"]`);
        const file = input?.files?.[0];

        if (!file) {
            await window.showAppAlert?.('Please choose a transcript photo or PDF first.');
            return;
        }

        const allowed = file.type.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (!allowed) {
            await window.showAppAlert?.('Please upload an image or PDF file.');
            return;
        }

        try {
            const user = await getCurrentUser();
            if (!user) throw new Error('You must be logged in.');

            const yearRecord = await fetchSchoolYearRecord(yearRecordId);
            if (yearRecord.entry_type !== 'backfill' || !isHighSchoolGrade(yearRecord.grade_level)) {
                throw new Error('Transcript upload is only available for high school prior years.');
            }
            if (yearRecord.year_locked) {
                throw new Error('This prior year is locked. Contact the school office to upload a transcript.');
            }

            if (statusEl) {
                statusEl.textContent = 'Uploading...';
                statusEl.classList.remove('hidden');
            }

            const storagePath = buildTranscriptStoragePath(user.id, yearRecordId, file.name);
            const client = await getClient();
            const { error: uploadError } = await client.storage
                .from('Family-Documents')
                .upload(storagePath, file, {
                    upsert: true,
                    contentType: file.type || 'application/octet-stream',
                });
            if (uploadError) throw uploadError;

            const { error: updateError } = await client
                .from('student_school_years')
                .update({
                    transcript_storage_path: storagePath,
                    transcript_uploaded_at: new Date().toISOString(),
                    transcript_file_name: file.name,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', yearRecordId);
            if (updateError) throw updateError;

            const uploadedAt = new Date().toISOString();
            replaceTranscriptUploadSection({
                ...yearRecord,
                transcript_storage_path: storagePath,
                transcript_uploaded_at: uploadedAt,
                transcript_file_name: file.name,
            });

            const refreshedStatus = document.querySelector(`[data-ar-transcript-status="${yearRecordId}"]`);
            if (refreshedStatus) {
                refreshedStatus.textContent = 'Uploaded!';
                refreshedStatus.classList.remove('hidden', 'text-slate-500');
                refreshedStatus.classList.add('text-emerald-700');
            }
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
            const errorStatus = document.querySelector(`[data-ar-transcript-status="${yearRecordId}"]`);
            if (errorStatus) {
                errorStatus.classList.add('hidden');
                errorStatus.textContent = '';
            }
        }
    }

    function bindAddFormHandlers(root) {
        if (!root) return;

        const studentForm = root.querySelector('#add-student-form');
        const priorForm = root.querySelector('#add-prior-form');
        const studentBtn = root.querySelector('#add-student-submit-btn');
        const priorBtn = root.querySelector('#add-prior-submit-btn');

        if (studentBtn && studentForm) {
            studentBtn.addEventListener('click', (event) => {
                event.preventDefault();
                if (!studentForm.reportValidity()) return;
                handleAddStudent({ preventDefault: () => {}, target: studentForm, currentTarget: studentForm });
            });
        }

        if (priorBtn && priorForm) {
            priorBtn.addEventListener('click', (event) => {
                event.preventDefault();
                if (!priorForm.reportValidity()) return;
                handleAddBackfill({ preventDefault: () => {}, target: priorForm, currentTarget: priorForm });
            });
        }

        studentForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            if (!studentForm.reportValidity()) return;
            handleAddStudent(event);
        });

        priorForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            if (!priorForm.reportValidity()) return;
            handleAddBackfill(event);
        });
    }

    function buildPriorYearsStatusHtml(student) {
        if (!isHighSchoolGrade(student.current_grade_level)) return '';

        if (student.prior_years_status === 'complete') {
            return '<span class="text-xs text-emerald-700">Prior years complete</span>';
        }
        if (student.prior_years_status === 'not_applicable') {
            return '<span class="text-xs text-slate-500">No prior years needed</span>';
        }
        return '<span class="text-xs text-amber-700">Add each prior school year using + Add above</span>';
    }

    function buildPriorYearsStatusStripHtml(student) {
        const statusHtml = buildPriorYearsStatusHtml(student);
        if (!statusHtml.trim()) return '';
        return `<div class="ar-prior-years-status mt-3 pt-3 border-t border-slate-100">${statusHtml}</div>`;
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

        const studentYearTabs = {};
        root.querySelectorAll('[data-ar-student-tabs]').forEach((el) => {
            const studentId = el.dataset.arStudentTabs;
            if (!studentId) return;
            const yearId = el.dataset.arActiveYear;
            if (yearId) studentYearTabs[studentId] = yearId;
        });

        const addPanel = root.querySelector('#ar-add-panel');

        return {
            studentIds: unique(Array.from(root.querySelectorAll('.student-record-panel[open]')).map((el) => el.dataset.studentId)),
            studentYearTabs,
            addStudentOpen: isAddPanelOpen(addPanel),
            addPanelMode: addPanel?.dataset.arAddMode || ADD_MODE_STUDENT,
        };
    }

    function normalizeExpandState(state) {
        if (!state) return null;
        return {
            studentIds: Array.isArray(state.studentIds) ? state.studentIds : [],
            studentYearTabs: state.studentYearTabs && typeof state.studentYearTabs === 'object'
                ? state.studentYearTabs
                : {},
            addStudentOpen: Boolean(state.addStudentOpen),
            addPanelMode: state.addPanelMode || ADD_MODE_STUDENT,
            scrollAnchor: state.scrollAnchor || null,
        };
    }

    function findScrollAnchorElement(anchorId) {
        if (!anchorId) return null;
        return document.querySelector(`[data-ar-scroll-anchor="${anchorId}"]`)
            || document.querySelector(`[data-ar-transcript="${anchorId}"]`)
            || document.querySelector(`[data-ar-year-panel="${anchorId}"]:not(.hidden)`);
    }

    function restoreScrollAnchor(anchorId) {
        if (!anchorId) return;
        const scrollToAnchor = () => {
            const el = findScrollAnchorElement(anchorId);
            if (el) scrollToElementWithOffset(el, { extra: 10, behavior: 'instant' });
        };
        requestAnimationFrame(() => {
            requestAnimationFrame(scrollToAnchor);
            setTimeout(scrollToAnchor, 120);
            setTimeout(scrollToAnchor, 350);
        });
    }

    function restoreExpandState(root, state) {
        const normalized = normalizeExpandState(state);
        if (!root || !normalized) return;

        const openStudentId = normalized.studentIds[normalized.studentIds.length - 1];
        if (openStudentId) {
            const panel = root.querySelector(`#student-panel-${openStudentId}`);
            if (panel) panel.setAttribute('open', '');
        }

        Object.entries(normalized.studentYearTabs).forEach(([studentId, yearId]) => {
            if (yearId) showStudentYearTab(studentId, yearId);
        });

        if (normalized.addStudentOpen) {
            toggleAddPanel(true);
        } else {
            closeAddPanel();
        }

        if (normalized.addPanelMode) {
            setAddPanelMode(normalized.addPanelMode);
        }
    }

    function buildCreditChipsHtml(totals, options = {}) {
        const { showRequired = false, pending = false } = options;
        const chips = TRANSCRIPT_COURSE_TYPES.map((type) => {
            const meta = courseTypeMeta(type);
            const earned = totals[type] || 0;
            const required = AL_GRAD_CREDIT_REQUIREMENTS[type];
            let value;
            if (pending) {
                value = '—';
            } else if (showRequired) {
                value = `${earned}/${required}`;
            } else {
                value = String(earned);
            }
            const complete = showRequired && earned >= required;
            const chipClass = [
                'ar-credit-chip',
                complete ? 'is-complete' : '',
                pending ? 'is-pending' : '',
            ].filter(Boolean).join(' ');
            return `
                <div class="${chipClass}">
                    <span class="ar-credit-chip-label">${escapeHtml(meta.label)}</span>
                    <span class="ar-credit-chip-value">${escapeHtml(value)}</span>
                </div>
            `;
        }).join('');

        return `<div class="ar-credit-chips">${chips}</div>`;
    }

    function buildCreditsSummaryHtml(yearRecord, entries, gradeLevel, studentId) {
        if (!isHighSchoolGrade(gradeLevel)) return '';

        const yearComplete = yearRecord.entry_type === 'backfill'
            ? yearRecord.year_locked
            : yearRecord.semester_2_locked;
        const yearTotals = summarizeCredits(entries, gradeLevel, yearComplete);
        const yearTotal = TRANSCRIPT_COURSE_TYPES.reduce((sum, type) => sum + (yearTotals[type] || 0), 0);
        const badgeLabel = yearComplete
            ? (yearTotal ? `${yearTotal} credit${yearTotal === 1 ? '' : 's'} this year` : 'No credits yet')
            : 'Pending Semester 2';
        const yearNote = yearComplete
            ? (yearTotal
                ? `Passing courses in ${yearRecord.school_year} earn 1 credit each.`
                : 'Passing courses earn 1 credit each once grades are submitted.')
            : `Credits for ${yearRecord.school_year} are calculated after Semester 2 is submitted. Each passing course earns 1 credit.`;

        return `
            <div class="ar-supplemental-card ar-accent-credits ar-credits-summary"
                 data-credits-summary="${yearRecord.id}" data-student-id="${studentId}" data-grade-level="${escapeHtml(gradeLevel)}">
                ${buildSupplementalCardHeader(
                    'Graduation tracking',
                    'Credit summary',
                    `<span class="ar-credits-badge${yearComplete ? ' is-complete' : ''}">${escapeHtml(badgeLabel)}</span>`
                )}

                <div class="ar-credits-section">
                    <p class="ar-credits-section-label">This school year</p>
                    ${buildCreditChipsHtml(yearTotals, { pending: !yearComplete })}
                    <p class="ar-credits-section-note">${escapeHtml(yearNote)}</p>
                </div>

                <div class="ar-credits-section ar-credits-section--cumulative">
                    <p class="ar-credits-section-label">Toward graduation</p>
                    <div data-cumulative-credits="${studentId}">
                        <div class="ar-credits-loading">Loading cumulative totals...</div>
                    </div>
                </div>

                <p class="ar-credits-footnote">Alabama graduation requires 4 English, 4 Math, 4 Science, 4 History, and 8 Electives. Tag each course so credits count correctly.</p>
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
            <button type="button" class="ar-supplemental-btn ar-supplemental-btn--secondary ar-add-course-btn"
                    onclick="window.AcademicRecords.handleAddCourse('${yearRecord.id}')">+ Add course</button>
        ` : '';

        const s2Due = semester2DueDate(yearRecord.school_year, gradeLevel);
        const semNote = isBackfill
            ? `Prior year: enter Semester 1 and Semester 2 grades, attendance, and finals. ${isHs ? 'Percentages only; finals auto-calculate.' : 'Letter or percentage.'}`
            : (calSem === '1'
                ? 'Semester 1 (Jul–Dec): enter Semester 1 grades and attendance. Due Dec 31.'
                : `Semester 2 (Jan–May): enter Semester 2 grades and attendance. Due ${s2Due}. Finals auto-calculate for high school.`);

        return `
            <div class="ar-supplemental-card ar-accent-courses ar-courses-panel">
                ${buildSupplementalCardHeader('Grades', 'Courses')}
                <p class="ar-supplemental-lead">${escapeHtml(semNote)}</p>
                <div class="overflow-x-auto ar-grade-scroll">
                    <table class="w-full min-w-[640px] text-sm ar-grade-table"
                           data-year-record-id="${yearRecord.id}"
                           data-grade-level="${escapeHtml(gradeLevel)}">
                        <thead><tr>${headers}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                ${addCourseBtn}
            </div>
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

                block.innerHTML = buildCreditChipsHtml(totals, { showRequired: true });
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

    function buildAddModeSwitchHtml() {
        return `
            <div class="ar-add-mode-switch hub-tab-group" role="tablist" aria-label="Add type">
                <button type="button" class="hub-tab-btn is-active" data-ar-add-mode="${ADD_MODE_STUDENT}" aria-selected="true">Student</button>
                <button type="button" class="hub-tab-btn" data-ar-add-mode="${ADD_MODE_PRIOR}" aria-selected="false">Prior year</button>
            </div>
        `;
    }

    function buildAddStudentFormFields() {
        return `
            <form id="add-student-form" class="ar-add-form-grid">
                <div class="ar-add-field">
                    <label class="ar-add-label">First name</label>
                    <input name="first_name" required class="form-input w-full px-4 py-2.5 border border-slate-300 rounded-2xl text-sm">
                </div>
                <div class="ar-add-field">
                    <label class="ar-add-label">Last name</label>
                    <input name="last_name" class="form-input w-full px-4 py-2.5 border border-slate-300 rounded-2xl text-sm">
                </div>
                <div class="ar-add-field">
                    <label class="ar-add-label">Current grade</label>
                    <select name="grade_level" required class="form-input w-full px-4 py-2.5 border border-slate-300 rounded-2xl text-sm">
                        <option value="">Select grade</option>
                        ${GRADE_LEVELS.map((g) => `<option value="${g}">${escapeHtml(formatGradeLabel(g))}</option>`).join('')}
                    </select>
                </div>
                <div class="ar-add-actions">
                    <button type="button" id="add-student-submit-btn" class="ar-add-submit-btn">Add student</button>
                    <span id="add-student-status" class="text-sm text-slate-500 hidden"></span>
                </div>
            </form>
        `;
    }

    function buildAddPriorFormFields(students, backfillYears) {
        const studentOptions = students.map((student) => `
            <option value="${student.id}">${escapeHtml(studentDisplayName(student))}</option>
        `).join('');

        return `
            <form id="add-prior-form" class="ar-add-form-grid">
                <div class="ar-add-field">
                    <label class="ar-add-label">Student</label>
                    <select name="student_id" required class="form-input w-full px-4 py-2.5 border border-slate-300 rounded-2xl text-sm">
                        <option value="">Select student</option>
                        ${studentOptions}
                    </select>
                </div>
                <div class="ar-add-field">
                    <label class="ar-add-label">School year</label>
                    <select name="school_year" required class="form-input w-full px-4 py-2.5 border border-slate-300 rounded-2xl text-sm">
                        <option value="">Select year</option>
                        ${backfillYears.map((y) => `<option value="${y}">${y}</option>`).join('')}
                    </select>
                </div>
                <div class="ar-add-field">
                    <label class="ar-add-label">Grade that year</label>
                    <select name="grade_level" required class="form-input w-full px-4 py-2.5 border border-slate-300 rounded-2xl text-sm">
                        ${GRADE_LEVELS.map((g) => `<option value="${g}">${escapeHtml(formatGradeLabel(g))}</option>`).join('')}
                    </select>
                </div>
                <div class="ar-add-actions">
                    <button type="button" id="add-prior-submit-btn" class="ar-add-submit-btn ar-add-submit-btn--prior">Add prior year</button>
                    <span id="add-prior-status" class="text-sm text-slate-500 hidden"></span>
                </div>
            </form>
        `;
    }

    function buildAddPanelHtml(students, backfillYears, options = {}) {
        const { expanded = false, showModeSwitch = true } = options;
        const schoolYear = currentSchoolYear();

        return `
            <div id="ar-add-panel" class="ar-add-panel ${expanded ? '' : 'hidden'}" data-ar-add-mode="${ADD_MODE_STUDENT}" role="region" aria-label="Add student or prior year">
                <div class="ar-add-panel-body">
                    ${showModeSwitch ? buildAddModeSwitchHtml() : ''}
                    <div id="ar-add-student-form-wrap" class="ar-add-form-wrap mt-4">
                        <p class="ar-add-help">Add each enrolled child. A ${escapeHtml(schoolYear)} progress report is created automatically.</p>
                        ${buildAddStudentFormFields()}
                    </div>
                    ${showModeSwitch ? `
                        <div id="ar-add-prior-form-wrap" class="ar-add-form-wrap mt-4 hidden">
                            <p class="ar-add-help">Add a school year before Summit. Enter both semesters, attendance, and finals.</p>
                            ${buildAddPriorFormFields(students, backfillYears)}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function buildAddToolbarHtml(students, backfillYears) {
        if (!students.length) {
            return `
                <div class="ar-add-toolbar ar-add-toolbar--empty mb-6">
                    <h3 class="text-sm font-semibold text-navy mb-3">Get started</h3>
                    ${buildAddPanelHtml(students, backfillYears, { expanded: true, showModeSwitch: false })}
                </div>
            `;
        }

        return `
            <div class="ar-add-toolbar mb-4">
                <button type="button"
                        class="ar-add-trigger"
                        aria-expanded="false"
                        aria-controls="ar-add-panel">
                    <span class="ar-add-trigger-icon" aria-hidden="true">+</span>
                    <span>Add</span>
                </button>
            </div>
            ${buildAddPanelHtml(students, backfillYears, { expanded: false, showModeSwitch: true })}
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
                html += buildAddToolbarHtml(students, backfillYears);
                html += '<div class="hub-empty-state">No students yet. Add each enrolled child above to begin tracking grades.</div>';
                root.innerHTML = html;
                bindAcademicRecordsDelegation();
                bindAddFormHandlers(root);
                bindStudentPanelBehavior(root);
                bindAddPanelControls(root);
                return;
            }

            html += buildAddToolbarHtml(students, backfillYears);
            html += '<div class="space-y-3">';
            const focusId = getFocusStudentId();
            const focusYearByStudent = {};

            for (let studentIndex = 0; studentIndex < students.length; studentIndex += 1) {
                const student = students[studentIndex];
                const studentAccent = getStudentAccentClass(studentIndex);
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
                const statusLabel = getProgressStatusLabel(currentRecord, student.current_grade_level);
                const isFocused = focusId === student.id;
                const gradeLabel = formatGradeLabel(student.current_grade_level);
                const sortedYears = sortSchoolYearsForDisplay(years, currentYear);

                let creditHeaderHtml = '';
                if (isHighSchoolGrade(student.current_grade_level)) {
                    const cumulative = await summarizeCumulativeCredits(student.id, student.current_grade_level);
                    const creditLine = formatCumulativeCreditsLine(cumulative);
                    if (creditLine) {
                        creditHeaderHtml = `<span class="ar-student-panel-credits">Credits: ${escapeHtml(creditLine)}</span>`;
                    }
                }

                const defaultYearId = currentRecord?.id || sortedYears[0]?.id || null;
                const savedYearTab = expandState?.studentYearTabs?.[student.id] || null;
                const focusYearId = isFocused && currentRecord ? currentRecord.id : null;
                if (focusYearId) focusYearByStudent[student.id] = focusYearId;
                const activeYearId = focusYearId || savedYearTab || defaultYearId;

                let yearTabButtonsHtml = '';
                let yearTabPanelsHtml = '';
                if (!sortedYears.length) {
                    yearTabPanelsHtml = '<p class="text-sm text-slate-500 py-2">No school year records yet.</p>';
                } else {
                    for (const yearRecord of sortedYears) {
                        const isActiveYear = activeYearId === yearRecord.id;
                        yearTabButtonsHtml += buildYearTabButton(student.id, yearRecord, isActiveYear);
                        const entries = await fetchGradeEntries(yearRecord.id);
                        yearTabPanelsHtml += buildYearTabPanel(
                            student.id,
                            yearRecord.id,
                            buildSchoolYearDetailHtml(yearRecord, entries, student),
                            isActiveYear
                        );
                    }
                }

                const studentYearsHtml = sortedYears.length
                    ? `${buildStudentYearTabsShell(student.id, yearTabButtonsHtml, yearTabPanelsHtml, activeYearId, defaultYearId)}${buildPriorYearsStatusStripHtml(student)}`
                    : yearTabPanelsHtml;

                html += `
                    <details class="ar-accordion ar-student-panel ${studentAccent} student-record-panel" id="student-panel-${student.id}" data-student-id="${student.id}" ${isFocused ? 'open' : ''}>
                        ${buildStudentPanelSummary(student, {
                            gradeLabel,
                            statusLabel,
                            creditHeaderHtml,
                            extraClass: 'ar-student-panel-trigger cursor-pointer',
                        })}
                        <div class="ar-accordion-body">
                            <div id="student-content-top-${student.id}" class="ar-student-content-top">
                                ${studentYearsHtml}
                            </div>
                        </div>
                    </details>
                `;
            }

            html += '</div>';
            root.innerHTML = html;

            bindAcademicRecordsDelegation();
            bindAddFormHandlers(root);
            bindStudentPanelBehavior(root);
            restoreExpandState(root, expandState);
            bindGradeTableEvents();
            bindAttendanceEvents(root);
            bindAccordionControls(root);
            bindBackToStudentTop(root);
            bindTranscriptHandlers(root);
            bindAddPanelControls(root);
            await hydrateCumulativeCredits();

            if (focusId) {
                const focusYearId = focusYearByStudent[focusId];
                if (focusYearId) showStudentYearTab(focusId, focusYearId);
                closeAddPanel();
                setFocusStudentId(null);
                const panel = document.getElementById(`student-panel-${focusId}`);
                scrollToElementWithOffset(panel?.querySelector('summary') || panel, { extra: 10 });
            } else if (expandState?.scrollAnchor) {
                restoreScrollAnchor(expandState.scrollAnchor);
            }
        } catch (err) {
            root.innerHTML = `<div class="text-red-600 text-sm p-4">Error loading academic records: ${escapeHtml(err.message || err)}</div>`;
        }
    }

    function renderSemesterActions(yearRecord) {
        const parts = [];
        if (canEditSemester(yearRecord, '1')) {
            parts.push(`
                <div class="ar-supplemental-card ar-accent-submit ar-submit-panel">
                    ${buildSupplementalCardHeader('Signature', 'Submit Semester 1')}
                    <p class="ar-supplemental-muted ar-submit-note">Type your full name to confirm grades and attendance are complete.</p>
                    <input type="text" id="ack-s1-${yearRecord.id}" class="ar-supplemental-input" placeholder="Parent full name">
                    <button type="button" class="ar-supplemental-btn ar-supplemental-btn--primary"
                            onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '1')">Submit Semester 1</button>
                </div>
            `);
        } else if (yearRecord.semester_1_locked) {
            parts.push(buildSupplementalStatusCard(
                `Semester 1 submitted ${yearRecord.semester_1_submitted_at ? new Date(yearRecord.semester_1_submitted_at).toLocaleDateString() : ''}`,
                { title: 'Semester 1' }
            ));
        }

        if (canEditSemester(yearRecord, '2')) {
            parts.push(`
                <div class="ar-supplemental-card ar-accent-submit ar-submit-panel">
                    ${buildSupplementalCardHeader('Signature', 'Submit Semester 2 & Final')}
                    <p class="ar-supplemental-muted ar-submit-note">Type your full name to confirm grades and attendance are complete.</p>
                    <input type="text" id="ack-s2-${yearRecord.id}" class="ar-supplemental-input" placeholder="Parent full name">
                    <button type="button" class="ar-supplemental-btn ar-supplemental-btn--primary"
                            onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '2')">Submit Semester 2 &amp; Final</button>
                </div>
            `);
        } else if (yearRecord.semester_2_locked) {
            parts.push(buildSupplementalStatusCard(
                `Semester 2 & final submitted ${yearRecord.semester_2_submitted_at ? new Date(yearRecord.semester_2_submitted_at).toLocaleDateString() : ''}`,
                { title: 'Semester 2 & Final' }
            ));
        }

        return parts.join('');
    }

    function renderBackfillActions(yearRecord) {
        if (!canEditSemester(yearRecord, '1')) {
            return buildSupplementalStatusCard(
                `Prior year locked ${yearRecord.year_submitted_at ? new Date(yearRecord.year_submitted_at).toLocaleDateString() : ''}`,
                { title: 'Prior year' }
            );
        }
        return `
            <div class="ar-supplemental-card ar-accent-submit ar-submit-panel">
                ${buildSupplementalCardHeader('Signature', 'Submit prior year')}
                <p class="ar-supplemental-muted ar-submit-note">Type your full name to confirm this prior year record is complete.</p>
                <input type="text" id="ack-year-${yearRecord.id}" class="ar-supplemental-input" placeholder="Parent full name">
                <button type="button" class="ar-supplemental-btn ar-supplemental-btn--primary"
                        onclick="window.AcademicRecords.submitFromSection('${yearRecord.id}', '1')">Submit Semester 1 &amp; 2 &amp; Final</button>
            </div>
        `;
    }

    function getAckInputForYearRecord(yearRecordId, semesterKey) {
        const activePanel = document.querySelector(`[data-ar-year-panel="${yearRecordId}"]:not(.hidden)`);
        if (activePanel) {
            const scoped = activePanel.querySelector(`#ack-year-${yearRecordId}`)
                || activePanel.querySelector(`#ack-s2-${yearRecordId}`)
                || activePanel.querySelector(`#ack-s1-${yearRecordId}`);
            if (scoped) return scoped;
        }
        return document.getElementById(`ack-year-${yearRecordId}`)
            || document.getElementById(semesterKey === '2' ? `ack-s2-${yearRecordId}` : `ack-s1-${yearRecordId}`);
    }

    async function submitFromSection(yearRecordId, semesterKey) {
        const panel = document.querySelector(`[data-year-record-id="${yearRecordId}"]`)?.closest('.p-4, .hub-panel, details');
        const table = document.querySelector(`table[data-year-record-id="${yearRecordId}"]`);
        const ack = getAckInputForYearRecord(yearRecordId, semesterKey);
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
            if (expandState) {
                expandState.scrollAnchor = yearRecordId;
            }
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

        const form = event.target instanceof HTMLFormElement
            ? event.target
            : event.target.closest('form');
        if (!form) return;
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
            closeAddPanel();
            setFocusStudentId(student.id);
            await loadAcademicRecords({
                expandState: {
                    studentIds: [],
                    studentYearTabs: {},
                    addStudentOpen: false,
                },
            });
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

    async function handleAddBackfill(event) {
        event.preventDefault();
        const form = event.target instanceof HTMLFormElement
            ? event.target
            : event.target.closest('form');
        if (!form) return;

        const formData = Object.fromEntries(new FormData(form).entries());
        const studentId = String(formData.student_id || '').trim();
        const schoolYear = String(formData.school_year || '').trim();
        const gradeLevel = String(formData.grade_level || '').trim();
        const submitBtn = document.getElementById('add-prior-submit-btn');
        const statusEl = document.getElementById('add-prior-status');

        if (!studentId) {
            await window.showAppAlert?.('Please select a student.');
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Adding...';
            }
            if (statusEl) {
                statusEl.textContent = 'Creating prior year record...';
                statusEl.classList.remove('hidden');
            }

            const yearRecord = await addBackfillYear(studentId, schoolYear, gradeLevel);
            form.reset();
            closeAddPanel();
            await loadAcademicRecords({
                expandState: buildExpandStateForStudent(studentId, yearRecord.id),
            });
            if (typeof window.OnboardingChecklist?.refresh === 'function') {
                await window.OnboardingChecklist.refresh();
            }
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add prior year';
            }
            if (statusEl) {
                statusEl.classList.add('hidden');
                statusEl.textContent = '';
            }
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

            const currentYear = currentSchoolYear();
            let html = '<div class="ar-admin-records-root space-y-3">';

            for (let studentIndex = 0; studentIndex < students.length; studentIndex += 1) {
                const student = students[studentIndex];
                const studentAccent = getStudentAccentClass(studentIndex);
                const years = await fetchSchoolYearsForStudent(student.id);
                const currentRecord = years.find((y) => y.school_year === currentYear && y.entry_type === 'current');
                const statusLabel = getProgressStatusLabel(currentRecord, student.current_grade_level);
                const gradeLabel = formatGradeLabel(student.current_grade_level);
                const sortedYears = sortSchoolYearsForDisplay(years, currentYear);
                const defaultYearId = currentRecord?.id || sortedYears[0]?.id || null;
                const activeYearId = defaultYearId;

                let creditHeaderHtml = '';
                if (isHighSchoolGrade(student.current_grade_level)) {
                    const cumulative = await summarizeCumulativeCredits(student.id, student.current_grade_level);
                    const creditLine = formatCumulativeCreditsLine(cumulative);
                    if (creditLine) {
                        creditHeaderHtml = `<span class="ar-student-panel-credits">Credits: ${escapeHtml(creditLine)}</span>`;
                    }
                }

                const studentRightHtml = `
                    <span class="ar-admin-student-summary-right text-right">
                        <button type="button"
                                class="ar-admin-student-delete text-xs px-2 py-0.5 border border-red-200 text-red-600 rounded hover:bg-red-50 shrink-0"
                                data-student-id="${student.id}"
                                onclick="event.preventDefault(); event.stopPropagation(); adminDeleteStudent(this)">Delete student</button>
                        <div class="ar-admin-student-meta text-[10px] text-slate-500 mt-0.5">
                            <div>Prior years: ${escapeHtml(student.prior_years_status || 'pending')}</div>
                        </div>
                        ${creditHeaderHtml}
                    </span>
                `;

                let yearTabButtonsHtml = '';
                let yearTabPanelsHtml = '';
                if (!sortedYears.length) {
                    yearTabPanelsHtml = '<p class="text-sm text-slate-500 py-2">No school year records yet.</p>';
                } else {
                    for (const yearRecord of sortedYears) {
                        const isActiveYear = activeYearId === yearRecord.id;
                        yearTabButtonsHtml += buildYearTabButton(student.id, yearRecord, isActiveYear);
                        const entries = await fetchGradeEntries(yearRecord.id);
                        yearTabPanelsHtml += buildYearTabPanel(
                            student.id,
                            yearRecord.id,
                            buildSchoolYearDetailHtml(yearRecord, entries, student, { readonly: true, admin: true }),
                            isActiveYear
                        );
                    }
                }

                const studentYearsHtml = sortedYears.length
                    ? buildStudentYearTabsShell(student.id, yearTabButtonsHtml, yearTabPanelsHtml, activeYearId, defaultYearId)
                    : yearTabPanelsHtml;

                html += `
                    <details class="ar-accordion ar-student-panel ${studentAccent} student-record-panel" id="student-panel-${student.id}" data-student-id="${student.id}" data-admin-student="${student.id}">
                        ${buildStudentPanelSummary(student, {
                            gradeLabel,
                            statusLabel,
                            rightExtraHtml: studentRightHtml,
                            extraClass: 'ar-student-panel-trigger cursor-pointer',
                        })}
                        <div class="ar-accordion-body">
                            <div id="student-content-top-${student.id}" class="ar-student-content-top">
                                ${studentYearsHtml}
                            </div>
                        </div>
                    </details>
                `;
            }

            html += '</div>';
            container.innerHTML = html;
            bindStudentPanelBehavior(container);
            bindBackToStudentTop(container);
            bindTranscriptHandlers(container);
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
            await loadAcademicRecords({
                expandState: buildExpandStateForStudent(studentId),
            });
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
        showStudentYearTab,
        scrollToStudentTop,
        toggleAddPanel,
        setAddPanelMode,
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