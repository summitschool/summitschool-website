(function () {
    function getClient() {
        return window.supabaseClient || null;
    }

    function currentSchoolYear() {
        return window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
    }

    function studentDisplayName(student) {
        if (window.KindergartenGraduationTasks?.studentDisplayName) {
            return window.KindergartenGraduationTasks.studentDisplayName(student);
        }
        return [student?.first_name, student?.last_name].filter(Boolean).join(' ').trim() || 'Student';
    }

    const GRAD_ACCORDION_CHEVRON = '<svg class="ar-accordion-chevron-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildGradAccordionSummary(label, hint = 'Tap to open') {
        return `
            <summary class="ar-accordion-trigger grad-admin-accordion-trigger list-none">
                <span class="ar-accordion-leading grad-admin-accordion-leading">
                    <span class="ar-accordion-chevron">${GRAD_ACCORDION_CHEVRON}</span>
                    <span class="grad-admin-accordion-copy">
                        <span class="grad-admin-accordion-title">${escapeHtml(label)}</span>
                        <span class="grad-admin-accordion-hint">${escapeHtml(hint)}</span>
                    </span>
                </span>
            </summary>
        `;
    }

    function buildGradAccordionCloseBar() {
        return `
            <div class="ar-accordion-closebar ar-accordion-closebar--bottom">
                <button type="button" class="ar-accordion-close-btn ar-back-to-top-btn" data-kg-grad-admin-collapse>
                    <span class="ar-accordion-close-icon" aria-hidden="true">↑</span>
                    Back to top
                </button>
            </div>
        `;
    }

    function getFixedHeaderOffset(extra = 16) {
        const nav = document.querySelector('nav.sticky');
        const navHeight = nav ? nav.getBoundingClientRect().height : 0;
        return navHeight + extra;
    }

    function scrollToGradElement(element, behavior = 'smooth') {
        if (!element) return;
        const offset = getFixedHeaderOffset(16);
        const top = element.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior });
    }

    function scrollToGradAccordion(details) {
        if (!details?.open) return;
        const scrollToSummary = () => scrollToGradElement(details.querySelector('summary'), 'smooth');
        requestAnimationFrame(() => {
            requestAnimationFrame(scrollToSummary);
            setTimeout(scrollToSummary, 120);
            setTimeout(scrollToSummary, 350);
        });
    }

    function attachGradAccordionScroll(details) {
        const handler = () => {
            details.removeEventListener('toggle', handler);
            scrollToGradAccordion(details);
        };
        details.addEventListener('toggle', handler);
    }

    function bindKgGradAdminAccordions(root) {
        if (!root) return;
        root.querySelectorAll('[data-kg-grad-year-panel]').forEach((yearPanel) => {
            const accordions = yearPanel.querySelectorAll('[data-kg-grad-admin-accordion]');
            accordions.forEach((details) => {
                const summary = details.querySelector('summary');
                if (!summary || summary.dataset.kgGradAccordionBound === '1') return;
                summary.dataset.kgGradAccordionBound = '1';
                summary.addEventListener('click', () => {
                    if (details.hasAttribute('open')) return;
                    accordions.forEach((other) => {
                        if (other !== details) other.removeAttribute('open');
                    });
                    attachGradAccordionScroll(details);
                });
            });
        });

        root.querySelectorAll('[data-kg-grad-admin-collapse]').forEach((button) => {
            if (button.dataset.kgGradCollapseBound === '1') return;
            button.dataset.kgGradCollapseBound = '1';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const details = button.closest('[data-kg-grad-admin-accordion]');
                if (!details) return;
                details.removeAttribute('open');
                scrollToGradElement(details.querySelector('summary'), 'smooth');
            });
        });
    }

    function formatYearTabLabel(schoolYear) {
        const parts = String(schoolYear).split('-');
        if (parts.length === 2) return `${parts[0]}–${parts[1].slice(-2)}`;
        return schoolYear;
    }

    function shiftYearLabel(schoolYear, delta) {
        const start = parseInt(String(schoolYear).split('-')[0], 10);
        if (!Number.isFinite(start)) return schoolYear;
        const next = start + delta;
        return `${next}-${next + 1}`;
    }

    async function ensureKindergartenGraduationSettingsYear(schoolYear) {
        const client = getClient();
        if (!client || !schoolYear) return null;

        const { data: existing } = await client
            .from('kindergarten_graduation_settings')
            .select('*')
            .eq('school_year', schoolYear)
            .maybeSingle();
        if (existing) return existing;

        const prevYear = shiftYearLabel(schoolYear, -1);
        const { data: prev } = await client
            .from('kindergarten_graduation_settings')
            .select('*')
            .eq('school_year', prevYear)
            .maybeSingle();

        const endYear = parseInt(String(schoolYear).split('-')[1], 10);
        const payload = prev ? {
            school_year: schoolYear,
            base_fee: prev.base_fee,
            dues_due_date: `${endYear}-03-01`,
            ceremony_date: `${endYear}-05-22`,
            practice_date: `${endYear}-05-21`,
            requirements_text: prev.requirements_text,
            payment_note_hint: prev.payment_note_hint,
            paypal_username: prev.paypal_username,
            cashapp_cashtag: prev.cashapp_cashtag,
        } : { school_year: schoolYear };

        const { data, error } = await client
            .from('kindergarten_graduation_settings')
            .insert(payload)
            .select('*')
            .single();
        if (error) {
            console.warn('[Kindergarten Graduation Admin] Could not create settings year:', error.message);
            return null;
        }
        return data;
    }

    async function fetchKindergartenGraduationYears() {
        const client = getClient();
        const current = currentSchoolYear();
        await ensureKindergartenGraduationSettingsYear(current);

        const years = new Set([current]);
        const tables = ['kindergarten_graduation_settings', 'kindergarten_graduation_submissions'];
        for (const table of tables) {
            const { data } = await client.from(table).select('school_year');
            (data || []).forEach((row) => { if (row.school_year) years.add(row.school_year); });
        }

        const { data: tasks } = await client
            .from('family_documents')
            .select('school_year')
            .ilike('category', '%kindergarten%')
            .ilike('category', '%task%');
        (tasks || []).forEach((row) => { if (row.school_year) years.add(row.school_year); });

        return [...years].sort((a, b) => b.localeCompare(a));
    }

    function paymentBadge(status) {
        const map = {
            paid: 'bg-emerald-100 text-emerald-700',
            pending_verification: 'bg-amber-100 text-amber-800',
            unpaid: 'bg-slate-100 text-slate-600',
        };
        const label = status === 'pending_verification' ? 'Pending verification' : (status || 'unpaid');
        return `<span class="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${map[status] || map.unpaid}">${escapeHtml(label)}</span>`;
    }

    function statusBadge(status) {
        const labels = {
            draft: 'Draft',
            pending_review: 'Pending review',
            changes_requested: 'Changes requested',
            approved: 'Approved',
            not_started: 'Not started',
        };
        return escapeHtml(labels[status] || 'Not started');
    }

    function formatSubmittedDate(value) {
        if (!value) return '—';
        try {
            return new Date(value).toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
            });
        } catch (err) {
            return '—';
        }
    }

    function formatPaymentMethod(method) {
        const labels = {
            paypal: 'PayPal',
            cashapp: 'Cash App',
            cash: 'Cash',
            check: 'Check',
            pending: 'Will pay later',
        };
        return labels[method] || method || '—';
    }

    function reviewField(label, value) {
        const display = String(value ?? '').trim() || '—';
        return `<div class="grad-review-field"><dt class="grad-review-label">${escapeHtml(label)}</dt><dd class="grad-review-value">${escapeHtml(display)}</dd></div>`;
    }

    function buildFeeTable(lineItems, totalDue) {
        const rows = (lineItems || []).map((item) => `
            <tr class="border-t border-slate-100">
                <td class="py-2 pr-3 text-sm text-slate-700">${escapeHtml(item.label)}</td>
                <td class="py-2 text-sm font-semibold text-navy text-right">$${Number(item.amount || 0).toFixed(2)}</td>
            </tr>
        `).join('');
        if (!rows) {
            return '<p class="text-sm text-slate-500">No fee line items yet.</p>';
        }
        return `
            <table class="w-full text-left">
                <thead><tr class="text-xs uppercase tracking-wide text-slate-500"><th class="pb-2">Item</th><th class="pb-2 text-right">Amount</th></tr></thead>
                <tbody>${rows}
                    <tr class="border-t border-slate-200">
                        <td class="py-2 font-semibold text-navy">Total</td>
                        <td class="py-2 font-bold text-navy text-right">$${Number(totalDue || 0).toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    function buildFormDataSection(form) {
        const entries = Object.entries(form || {}).filter(([, value]) => value != null && String(value).trim() !== '');
        if (!entries.length) {
            return '<p class="text-sm text-slate-500">The family has not submitted an order form yet.</p>';
        }
        return `<dl class="grad-review-dl">${entries.map(([key, value]) => {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            return reviewField(label, typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value);
        }).join('')}</dl>`;
    }

    function buildReviewModalContent(sub, studentName) {
        const form = sub.form_data || {};
        const priorFeedback = sub.admin_notes ? `
            <div class="grad-review-prior-note">
                <p class="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">Previous staff feedback</p>
                <p class="text-sm text-slate-700">${escapeHtml(sub.admin_notes)}</p>
            </div>
        ` : '';

        return `
            <div class="grad-review-header">
                <div>
                    <p class="text-xs uppercase tracking-wide text-slate-500 font-semibold">Kindergarten graduation order review</p>
                    <h3 class="text-xl font-semibold text-navy mt-1">${escapeHtml(studentName)}</h3>
                    <p class="text-sm text-slate-600 mt-1">${escapeHtml(sub.school_year)} · Summit family</p>
                </div>
                <div class="grad-review-badges">
                    <span class="grad-review-status-pill">${statusBadge(sub.status)}</span>
                    ${paymentBadge(sub.payment_status)}
                </div>
            </div>
            ${priorFeedback}
            <section class="grad-review-section">
                <h4 class="grad-review-heading">Order details</h4>
                ${buildFormDataSection(form)}
            </section>
            <section class="grad-review-section">
                <h4 class="grad-review-heading">Fees</h4>
                ${buildFeeTable(sub.line_items, sub.total_due)}
            </section>
            <section class="grad-review-section">
                <h4 class="grad-review-heading">Payment</h4>
                <dl class="grad-review-dl">
                    ${reviewField('Family reported method', formatPaymentMethod(sub.payment_method))}
                    ${reviewField('Family reported amount', sub.payment_amount != null ? `$${Number(sub.payment_amount).toFixed(2)}` : '—')}
                    ${reviewField('Payment note', sub.payment_note)}
                    ${reviewField('Admin payment method', formatPaymentMethod(sub.admin_payment_method))}
                    ${reviewField('Admin payment note', sub.admin_payment_note)}
                    ${reviewField('Marked paid', sub.admin_marked_paid_at ? formatSubmittedDate(sub.admin_marked_paid_at) : '—')}
                </dl>
            </section>
            <section class="grad-review-section">
                <h4 class="grad-review-heading">Signature</h4>
                <dl class="grad-review-dl">
                    ${reviewField('Signed by', sub.family_ack_name)}
                    ${reviewField('Submitted', formatSubmittedDate(sub.family_submitted_at))}
                    ${reviewField('Approved by', sub.admin_ack_name)}
                    ${reviewField('Approved', formatSubmittedDate(sub.admin_approved_at))}
                </dl>
            </section>
            <p class="text-sm text-slate-500 mt-4">Full approve and payment workflow for kindergarten orders will be enabled when the family order form is ready.</p>
            <div class="grad-review-footer">
                <button type="button" class="grad-review-btn grad-review-btn-secondary" data-kg-grad-review-close>Close</button>
                ${sub.pdf_storage_path ? `<button type="button" class="grad-review-btn grad-review-btn-primary" data-kg-grad-pdf="${escapeHtml(sub.pdf_storage_path)}">Open PDF</button>` : ''}
            </div>
        `;
    }

    function ensureReviewModal() {
        let modal = document.getElementById('kg-grad-review-modal');
        if (modal) return modal;

        document.body.insertAdjacentHTML('beforeend', `
            <div id="kg-grad-review-modal" class="grad-review-modal hidden" role="dialog" aria-modal="true" aria-labelledby="kg-grad-review-title">
                <button type="button" class="grad-review-backdrop" data-kg-grad-review-close aria-label="Close review"></button>
                <div class="grad-review-panel site-card">
                    <button type="button" class="grad-review-close-x" data-kg-grad-review-close aria-label="Close">&times;</button>
                    <div id="kg-grad-review-body" class="grad-review-body"></div>
                </div>
            </div>
        `);

        modal = document.getElementById('kg-grad-review-modal');
        modal.addEventListener('click', async (event) => {
            if (event.target.closest('[data-kg-grad-review-close]')) {
                closeReviewModal();
                return;
            }

            const pdfBtn = event.target.closest('[data-kg-grad-pdf]');
            if (pdfBtn) {
                const client = getClient();
                const { data } = await client.storage.from('Family-Documents').createSignedUrl(pdfBtn.dataset.kgGradPdf, 3600);
                if (data?.signedUrl) window.open(data.signedUrl, '_blank');
            }
        });

        return modal;
    }

    function closeReviewModal() {
        const modal = document.getElementById('kg-grad-review-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        document.body.classList.remove('grad-review-open');
    }

    async function openReviewModal(submissionId) {
        const client = getClient();
        const { data: sub, error } = await client
            .from('kindergarten_graduation_submissions')
            .select('*')
            .eq('id', submissionId)
            .single();
        if (error || !sub) {
            await window.showAppAlert?.('Could not load this kindergarten graduation order.');
            return;
        }

        let studentName = 'Kindergartener';
        if (sub.student_id) {
            const { data: student } = await client.from('students').select('first_name, last_name').eq('id', sub.student_id).maybeSingle();
            if (student) studentName = studentDisplayName(student);
        }

        const modal = ensureReviewModal();
        const body = document.getElementById('kg-grad-review-body');
        if (body) body.innerHTML = buildReviewModalContent(sub, studentName);
        modal.classList.remove('hidden');
        document.body.classList.add('grad-review-open');
    }

    async function fetchRosterForYear(schoolYear) {
        const client = getClient();
        const rows = [];

        const { data: kindergarteners } = await client
            .from('students')
            .select('id, first_name, last_name, family_user_id, current_grade_level')
            .eq('current_grade_level', 'K');

        const studentIds = (kindergarteners || []).map((s) => s.id);
        let yearRecords = [];
        if (studentIds.length) {
            const { data } = await client
                .from('student_school_years')
                .select('student_id, school_year, semester_1_locked')
                .in('student_id', studentIds)
                .eq('school_year', schoolYear)
                .eq('grade_level', 'K')
                .eq('entry_type', 'current');
            yearRecords = data || [];
        }

        const s1Locked = new Set(yearRecords.filter((y) => y.semester_1_locked).map((y) => y.student_id));

        const { data: submissions } = await client
            .from('kindergarten_graduation_submissions')
            .select('*')
            .eq('school_year', schoolYear);
        const subByStudent = {};
        (submissions || []).forEach((s) => {
            if (s.student_id) subByStudent[s.student_id] = s;
        });

        (kindergarteners || []).forEach((student) => {
            if (!s1Locked.has(student.id)) return;
            const sub = subByStudent[student.id];
            rows.push({
                key: `student-${student.id}`,
                studentName: studentDisplayName(student),
                formStatus: sub?.status || 'not_started',
                paymentStatus: sub?.payment_status || 'unpaid',
                submission: sub,
                studentId: student.id,
                familyUserId: student.family_user_id,
            });
        });

        rows.sort((a, b) => a.studentName.localeCompare(b.studentName));
        return rows;
    }

    function summarizeRoster(rows) {
        return {
            total: rows.length,
            paid: rows.filter((r) => r.paymentStatus === 'paid').length,
            pending: rows.filter((r) => r.formStatus === 'pending_review').length,
            submitted: rows.filter((r) => r.formStatus && r.formStatus !== 'not_started' && r.formStatus !== 'draft').length,
        };
    }

    async function saveSettings(schoolYear, formData) {
        const client = getClient();
        const payload = { ...formData, school_year: schoolYear, updated_at: new Date().toISOString() };
        const { error } = await client.from('kindergarten_graduation_settings').upsert(payload);
        if (error) throw error;
    }

    function renderSettingsForm(settings, schoolYear) {
        const s = settings || {};

        function renderInput(key, label, type = 'text', extra = '') {
            const val = s[key] ?? '';
            return `<div><label class="block text-xs font-medium text-slate-600 mb-1">${escapeHtml(label)}</label>
                <input type="${type}" name="${key}" value="${escapeHtml(val)}" ${extra} class="form-input w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"></div>`;
        }

        return `
            <form id="kg-grad-admin-settings-form" class="space-y-6" data-school-year="${escapeHtml(schoolYear)}">
                <div>
                    <h4 class="text-sm font-semibold text-navy mb-3">Fees &amp; dates</h4>
                    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        ${renderInput('base_fee', 'Base fee ($)', 'number', 'step="0.01"')}
                        ${renderInput('dues_due_date', 'Order due date', 'date')}
                        ${renderInput('ceremony_date', 'Ceremony date', 'date')}
                        ${renderInput('practice_date', 'Practice date', 'date')}
                    </div>
                </div>
                <div>
                    <h4 class="text-sm font-semibold text-navy mb-3">Payment links</h4>
                    <div class="grid sm:grid-cols-2 gap-4">
                        ${renderInput('paypal_username', 'PayPal username')}
                        ${renderInput('cashapp_cashtag', 'Cash App $tag')}
                    </div>
                    <div class="mt-4">
                        <label class="block text-xs font-medium text-slate-600 mb-1">Payment note hint</label>
                        <input type="text" name="payment_note_hint" value="${escapeHtml(s.payment_note_hint || '')}" class="form-input w-full px-3 py-2 border border-slate-300 rounded-xl text-sm">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-medium text-slate-600 mb-1">Kindergarten graduation requirements (shown to families)</label>
                    <textarea name="requirements_text" rows="10" class="form-input w-full px-3 py-2 border border-slate-300 rounded-xl text-sm">${escapeHtml(s.requirements_text || '')}</textarea>
                </div>
                <div class="flex gap-3">
                    <button type="submit" class="px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-semibold">Save settings</button>
                    <button type="button" id="kg-grad-copy-settings-btn" class="px-5 py-2.5 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700">Copy from previous year</button>
                </div>
            </form>
        `;
    }

    function renderRosterActionNote(row) {
        if (row.formStatus === 'changes_requested') {
            return '<span class="text-[10px] font-semibold text-amber-700">Awaiting family</span>';
        }
        if (row.formStatus === 'approved') {
            return '<span class="text-[10px] font-semibold text-emerald-700">Complete</span>';
        }
        return '';
    }

    function renderRosterReviewButton(row) {
        const subId = row.submission?.id;
        if (!subId) return '<span class="text-xs text-slate-400">—</span>';
        return `<button type="button" class="text-xs px-3 py-1.5 bg-navy text-white rounded-lg font-semibold" data-kg-grad-review="${subId}">Review</button>`;
    }

    function renderRosterTable(rows) {
        const body = rows.map((row) => `
            <tr class="border-t border-slate-100">
                <td class="py-3 pr-3">
                    <div class="font-medium text-navy">${escapeHtml(row.studentName)}</div>
                </td>
                <td class="py-3 pr-3 text-sm">${statusBadge(row.formStatus)}</td>
                <td class="py-3 pr-3">${paymentBadge(row.paymentStatus)}</td>
                <td class="py-3 pr-3">${renderRosterReviewButton(row)}</td>
                <td class="py-3">${renderRosterActionNote(row)}</td>
            </tr>
        `).join('');

        return `
            <div class="hidden md:block overflow-x-auto">
                <table class="w-full text-left text-sm">
                    <thead>
                        <tr class="text-xs uppercase tracking-wide text-slate-500">
                            <th class="pb-2 pr-3">Student</th>
                            <th class="pb-2 pr-3">Form</th>
                            <th class="pb-2 pr-3">Payment</th>
                            <th class="pb-2 pr-3">Review</th>
                            <th class="pb-2">Status</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        `;
    }

    function renderRosterCards(rows) {
        return rows.map((row) => `
            <article class="grad-roster-card hub-surface-card p-4">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <h4 class="font-semibold text-navy leading-snug">${escapeHtml(row.studentName)}</h4>
                    </div>
                    ${paymentBadge(row.paymentStatus)}
                </div>
                <dl class="grad-roster-card-meta mt-3">
                    <div><dt>Form</dt><dd>${statusBadge(row.formStatus)}</dd></div>
                </dl>
                <div class="mt-4 flex items-center justify-between gap-3">
                    ${renderRosterReviewButton(row)}
                    ${renderRosterActionNote(row)}
                </div>
            </article>
        `).join('');
    }

    function renderRoster(rows) {
        if (!rows.length) {
            return '<div class="hub-empty-state">No kindergarten graduation participants for this school year yet. Kindergarteners appear here after Semester 1 is locked.</div>';
        }
        return `
            <section class="mb-6">
                <h3 class="text-sm font-semibold text-navy mb-3">Kindergarten graduation roster</h3>
                ${renderRosterTable(rows)}
                <div class="md:hidden space-y-3">${renderRosterCards(rows)}</div>
            </section>
        `;
    }

    function renderSummaryBox(summary) {
        const stats = [
            { label: 'Total', value: summary.total, tone: '' },
            { label: 'Paid', value: summary.paid, tone: 'grad-admin-summary-value--paid' },
            { label: 'Pending review', value: summary.pending, tone: 'grad-admin-summary-value--pending' },
            { label: 'Submitted', value: summary.submitted, tone: '' },
        ];
        return `
            <div class="ar-grade-help grad-admin-summary mb-6">
                <div class="ar-grade-help-header">
                    <h3 class="ar-grade-help-title">Roster overview</h3>
                </div>
                <div class="grad-admin-summary-grid">
                    ${stats.map((stat) => `
                        <div class="grad-admin-summary-item">
                            <span class="grad-admin-summary-label">${escapeHtml(stat.label)}</span>
                            <span class="grad-admin-summary-value ${stat.tone}">${stat.value}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    async function renderKindergartenYearPanel(schoolYear) {
        const settings = await ensureKindergartenGraduationSettingsYear(schoolYear);
        const rows = await fetchRosterForYear(schoolYear);
        const summary = summarizeRoster(rows);

        return `
            <div data-kg-grad-year-panel="${escapeHtml(schoolYear)}">
                ${renderSummaryBox(summary)}
                ${renderRoster(rows)}
                <details class="ar-accordion grad-admin-accordion hub-panel hub-panel-padded mb-4" data-kg-grad-admin-accordion>
                    ${buildGradAccordionSummary('Yearly Settings', 'Fees, dates, payment links & requirements')}
                    <div class="ar-accordion-body">
                        <div class="mt-4">${renderSettingsForm(settings, schoolYear)}</div>
                        ${buildGradAccordionCloseBar()}
                    </div>
                </details>
            </div>
        `;
    }

    function showKindergartenYearTab(yearKey) {
        const container = document.getElementById('kg-grad-admin-tabs');
        if (!container) return;
        container.dataset.activeYear = yearKey;
        container.querySelectorAll('[data-kg-grad-year-tab]').forEach((btn) => {
            const active = btn.dataset.kgGradYearTab === yearKey;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        container.querySelectorAll('[data-kg-grad-year-panel]').forEach((panel) => {
            panel.classList.toggle('hidden', panel.dataset.kgGradYearPanel !== yearKey);
        });
    }

    function restoreGradAdminScroll(scrollY) {
        requestAnimationFrame(() => {
            window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
        });
    }

    async function loadKindergartenGraduationAdmin(scrollY = window.scrollY) {
        const root = document.getElementById('admin-graduation-kindergarten-root');
        if (!root || !getClient()) return;
        const minHeight = root.offsetHeight;
        if (minHeight > 0) root.style.minHeight = `${minHeight}px`;
        root.innerHTML = '<div class="hub-empty-state">Loading kindergarten graduation roster…</div>';

        const years = await fetchKindergartenGraduationYears();
        const activeYear = years.includes(currentSchoolYear()) ? currentSchoolYear() : years[0];

        let tabButtons = '';
        let tabPanels = '';
        for (const year of years) {
            const isActive = year === activeYear;
            const label = formatYearTabLabel(year);
            tabButtons += `<button type="button" class="ar-year-tab-btn hub-tab-btn ${isActive ? 'is-active' : ''}" role="tab"
                data-kg-grad-year-tab="${escapeHtml(year)}" aria-selected="${isActive}" onclick="window.KindergartenGraduationAdmin.showYearTab(${JSON.stringify(year)})">
                <span class="ar-year-tab-short">${escapeHtml(label)}</span><span class="ar-year-tab-full">${escapeHtml(year)}</span></button>`;
            const panelHtml = await renderKindergartenYearPanel(year);
            tabPanels += `<div class="ar-year-tab-panel ${isActive ? '' : 'hidden'}" role="tabpanel" data-kg-grad-year-panel="${escapeHtml(year)}">${panelHtml}</div>`;
        }

        root.innerHTML = `
            <div id="kg-grad-admin-tabs" class="hub-document-tabs ar-student-year-tabs mb-6" data-active-year="${escapeHtml(activeYear)}">
                <div class="ar-year-tab-bar hub-tab-group" role="tablist">${tabButtons}</div>
                <div class="ar-year-tab-panels mt-4">${tabPanels}</div>
            </div>
        `;
        root.dataset.gradProgramLoaded = '1';
        root.style.minHeight = '';
        bindAdminEvents();
        bindKgGradAdminAccordions(root);
        restoreGradAdminScroll(scrollY);
    }

    function bindAdminEvents() {
        const root = document.getElementById('admin-graduation-kindergarten-root');
        if (!root || root.dataset.kgGradAdminBound === '1') return;
        root.dataset.kgGradAdminBound = '1';

        root.addEventListener('submit', async (event) => {
            const settingsForm = event.target.closest('#kg-grad-admin-settings-form');
            if (!settingsForm) return;
            event.preventDefault();
            const schoolYear = settingsForm.dataset.schoolYear;
            const formData = Object.fromEntries(new FormData(settingsForm).entries());
            if (formData.base_fee === '') formData.base_fee = null;
            else if (formData.base_fee != null) formData.base_fee = Number(formData.base_fee);
            ['dues_due_date', 'ceremony_date', 'practice_date'].forEach((k) => {
                if (formData[k] === '') formData[k] = null;
            });
            try {
                await saveSettings(schoolYear, formData);
                await window.showAppAlert?.('Kindergarten graduation settings saved.');
            } catch (err) {
                await window.showAppAlert?.(err.message || String(err));
            }
        });

        root.addEventListener('click', async (event) => {
            const copyBtn = event.target.closest('#kg-grad-copy-settings-btn');
            if (copyBtn) {
                const form = copyBtn.closest('form');
                const year = form?.dataset?.schoolYear;
                if (!year) return;
                const prev = shiftYearLabel(year, -1);
                const client = getClient();
                const { data: prevSettings } = await client
                    .from('kindergarten_graduation_settings')
                    .select('*')
                    .eq('school_year', prev)
                    .maybeSingle();
                if (!prevSettings) {
                    await window.showAppAlert?.(`No settings found for ${prev}.`);
                    return;
                }
                const endYear = parseInt(String(year).split('-')[1], 10);
                await saveSettings(year, {
                    ...prevSettings,
                    school_year: year,
                    dues_due_date: `${endYear}-03-01`,
                    ceremony_date: `${endYear}-05-22`,
                    practice_date: `${endYear}-05-21`,
                });
                await loadKindergartenGraduationAdmin();
                return;
            }

            const reviewBtn = event.target.closest('[data-kg-grad-review]');
            if (reviewBtn) {
                await openReviewModal(reviewBtn.dataset.kgGradReview);
            }
        });
    }

    function resetKindergartenGraduationAdmin() {
        closeReviewModal();
        const root = document.getElementById('admin-graduation-kindergarten-root');
        if (!root) return;
        delete root.dataset.kgGradAdminBound;
        delete root.dataset.gradProgramLoaded;
        root.style.minHeight = '';
        root.innerHTML = '<div class="hub-empty-state">Open this tab to load the kindergarten graduation roster.</div>';
        root.classList.add('hidden');
    }

    window.KindergartenGraduationAdmin = {
        loadKindergartenGraduationAdmin,
        showYearTab: showKindergartenYearTab,
        ensureKindergartenGraduationSettingsYear,
        openReviewModal,
        resetKindergartenGraduationAdmin,
        closeReviewModal,
    };
})();