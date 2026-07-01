(function () {
    const SUPABASE_URL = 'https://tajyrmydwqsijstyzsjr.supabase.co';

    function getClient() {
        return window.supabaseClient || null;
    }

    function currentSchoolYear() {
        return window.AcademicRecords?.currentSchoolYear?.() || '2026-2027';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    async function ensureGraduationSettingsYear(schoolYear) {
        const client = getClient();
        if (!client || !schoolYear) return null;

        const { data: existing } = await client
            .from('graduation_settings')
            .select('*')
            .eq('school_year', schoolYear)
            .maybeSingle();
        if (existing) return existing;

        const prevYear = shiftYearLabel(schoolYear, -1);
        const { data: prev } = await client
            .from('graduation_settings')
            .select('*')
            .eq('school_year', prevYear)
            .maybeSingle();

        const endYear = parseInt(String(schoolYear).split('-')[1], 10);
        const payload = prev ? {
            school_year: schoolYear,
            summit_base_fee: prev.summit_base_fee,
            guest_base_fee: prev.guest_base_fee,
            pictures_fee: prev.pictures_fee,
            tshirt_youth_fee: prev.tshirt_youth_fee,
            tshirt_adult_fee: prev.tshirt_adult_fee,
            honor_cord_fee: prev.honor_cord_fee,
            ceremony_opt_out_fee: prev.ceremony_opt_out_fee,
            dues_due_date: `${endYear}-03-01`,
            ceremony_date: `${endYear}-05-22`,
            ceremony_time: prev.ceremony_time,
            ceremony_location: prev.ceremony_location,
            practice_date: `${endYear}-05-21`,
            practice_time: prev.practice_time,
            practice_location: prev.practice_location,
            pictures_date: null,
            pictures_time: prev.pictures_time,
            pictures_location: prev.pictures_location,
            requirements_text: prev.requirements_text,
            honor_cord_options: prev.honor_cord_options,
            paypal_username: prev.paypal_username,
            cashapp_cashtag: prev.cashapp_cashtag,
            payment_note_hint: prev.payment_note_hint,
        } : { school_year: schoolYear };

        const { data, error } = await client.from('graduation_settings').insert(payload).select('*').single();
        if (error) {
            console.warn('[Graduation Admin] Could not create settings year:', error.message);
            return null;
        }
        return data;
    }

    async function fetchGraduationYears() {
        const client = getClient();
        const current = currentSchoolYear();
        await ensureGraduationSettingsYear(current);

        const years = new Set([current]);
        const tables = ['graduation_settings', 'graduation_submissions', 'graduation_guests'];
        for (const table of tables) {
            const { data } = await client.from(table).select('school_year');
            (data || []).forEach((row) => { if (row.school_year) years.add(row.school_year); });
        }

        const { data: tasks } = await client
            .from('family_documents')
            .select('school_year')
            .ilike('category', '%graduation%')
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

    function formatParticipation(mode) {
        return mode === 'diploma_only' ? 'Diploma only (no ceremony)' : 'Full graduation';
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

    function buildAddonsList(form) {
        const items = [];
        if (form.add_pictures) items.push('Graduation pictures');
        if (form.add_tshirt && form.tshirt_size) items.push(`Graduation t-shirt (${form.tshirt_size})`);
        else if (form.add_tshirt) items.push('Graduation t-shirt');
        const cords = window.GraduationTasks.getHonorCordsSelected(form);
        cords.forEach((cord) => items.push(`Honor cord — ${cord}`));
        if (!items.length) return '<p class="text-sm text-slate-500">None selected</p>';
        return `<ul class="grad-review-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    }

    function buildFeeTable(lineItems, totalDue) {
        const rows = (lineItems || []).map((item) => `
            <tr class="border-t border-slate-100">
                <td class="py-2 pr-3 text-sm text-slate-700">${escapeHtml(item.label)}</td>
                <td class="py-2 text-sm font-semibold text-navy text-right">$${Number(item.amount || 0).toFixed(2)}</td>
            </tr>
        `).join('');
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

    function buildReviewModalContent(sub, studentName) {
        const form = sub.form_data || {};
        const isFull = form.participation_mode !== 'diploma_only';
        const canAct = sub.status === 'pending_review';
        const priorFeedback = sub.admin_notes ? `
            <div class="grad-review-prior-note">
                <p class="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">Previous staff feedback</p>
                <p class="text-sm text-slate-700">${escapeHtml(sub.admin_notes)}</p>
            </div>
        ` : '';

        const capGownSection = isFull ? `
            <section class="grad-review-section">
                <h4 class="grad-review-heading">Cap &amp; gown</h4>
                <dl class="grad-review-dl">
                    ${reviewField('Size', form.cap_gown_size)}
                </dl>
            </section>
        ` : '';

        const actionBlock = canAct ? `
            <section class="grad-review-section grad-review-feedback">
                <h4 class="grad-review-heading">Staff feedback</h4>
                <p class="text-sm text-slate-600 mb-3">If something needs to be corrected, describe the changes below and send back to the family. They can edit and resubmit from the Graduation Hub.</p>
                <label class="block text-xs font-medium text-slate-600 mb-1" for="grad-review-feedback">Recommended changes (optional)</label>
                <textarea id="grad-review-feedback" rows="3" class="form-input w-full px-4 py-3 border border-slate-300 rounded-2xl text-sm" placeholder="e.g. Please update cap &amp; gown size to Large."></textarea>
                <div class="grad-review-mark-paid mt-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                    <p class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Record payment (if paying cash/check)</p>
                    <div class="grid sm:grid-cols-3 gap-3">
                        <div>
                            <label class="block text-xs text-slate-600 mb-1">Method</label>
                            <select id="grad-review-paid-method" class="form-input w-full px-3 py-2 border rounded-xl text-sm">
                                <option value="cash">Cash</option>
                                <option value="check">Check</option>
                                <option value="paypal">PayPal</option>
                                <option value="cashapp">Cash App</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs text-slate-600 mb-1">Amount</label>
                            <input type="number" id="grad-review-paid-amount" step="0.01" value="${escapeHtml(sub.payment_amount || sub.total_due || '')}" class="form-input w-full px-3 py-2 border rounded-xl text-sm">
                        </div>
                        <div>
                            <label class="block text-xs text-slate-600 mb-1">Note</label>
                            <input type="text" id="grad-review-paid-note" class="form-input w-full px-3 py-2 border rounded-xl text-sm" placeholder="Optional">
                        </div>
                    </div>
                </div>
                <div class="mt-4">
                    <label class="block text-xs font-medium text-slate-600 mb-1" for="grad-review-ack-name">Your name (required to approve)</label>
                    <input type="text" id="grad-review-ack-name" class="form-input w-full px-4 py-3 border border-slate-300 rounded-2xl text-sm" placeholder="Type your full name to sign off">
                </div>
            </section>
        ` : '';

        const footerActions = canAct ? `
            <button type="button" class="grad-review-btn grad-review-btn-secondary" data-grad-review-close>Close</button>
            <button type="button" class="grad-review-btn grad-review-btn-warning" data-grad-review-changes="${sub.id}">Request changes</button>
            <button type="button" class="grad-review-btn grad-review-btn-success" data-grad-review-paid="${sub.id}">Mark paid</button>
            <button type="button" class="grad-review-btn grad-review-btn-primary" data-grad-review-approve="${sub.id}">Approve &amp; sign</button>
        ` : `
            <button type="button" class="grad-review-btn grad-review-btn-secondary" data-grad-review-close>Close</button>
            ${sub.pdf_storage_path ? `<button type="button" class="grad-review-btn grad-review-btn-primary" data-grad-pdf="${escapeHtml(sub.pdf_storage_path)}">Open PDF</button>` : ''}
        `;

        return `
            <div class="grad-review-header">
                <div>
                    <p class="text-xs uppercase tracking-wide text-slate-500 font-semibold">Graduation order review</p>
                    <h3 class="text-xl font-semibold text-navy mt-1">${escapeHtml(studentName)}</h3>
                    <p class="text-sm text-slate-600 mt-1">${escapeHtml(sub.school_year)} · ${sub.participant_type === 'guest' ? 'Guest' : 'Summit family'}</p>
                </div>
                <div class="grad-review-badges">
                    <span class="grad-review-status-pill">${statusBadge(sub.status)}</span>
                    ${paymentBadge(sub.payment_status)}
                </div>
            </div>
            ${priorFeedback}
            <section class="grad-review-section">
                <h4 class="grad-review-heading">Participation</h4>
                <p class="text-sm font-medium text-navy">${escapeHtml(formatParticipation(form.participation_mode))}</p>
            </section>
            <section class="grad-review-section">
                <h4 class="grad-review-heading">Graduate &amp; contact</h4>
                <dl class="grad-review-dl">
                    ${reviewField('Diploma name', form.diploma_name)}
                    ${reviewField('Parent phone', form.parent_phone)}
                    ${reviewField('Parent email', form.parent_email)}
                    ${reviewField('Mailing address', form.mailing_address)}
                </dl>
            </section>
            ${capGownSection}
            <section class="grad-review-section">
                <h4 class="grad-review-heading">Optional add-ons</h4>
                ${buildAddonsList(form)}
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
                <h4 class="grad-review-heading">Requirements &amp; signature</h4>
                <dl class="grad-review-dl">
                    ${reviewField('Requirements acknowledged', form.requirements_ack ? 'Yes' : 'No')}
                    ${reviewField('Signed by', sub.family_ack_name)}
                    ${reviewField('Submitted', formatSubmittedDate(sub.family_submitted_at))}
                </dl>
            </section>
            ${form.special_notes ? `
                <section class="grad-review-section">
                    <h4 class="grad-review-heading">Special notes</h4>
                    <p class="text-sm text-slate-700 whitespace-pre-wrap">${escapeHtml(form.special_notes)}</p>
                </section>
            ` : ''}
            ${actionBlock}
            <div class="grad-review-footer">${footerActions}</div>
        `;
    }

    function ensureReviewModal() {
        let modal = document.getElementById('grad-review-modal');
        if (modal) return modal;

        document.body.insertAdjacentHTML('beforeend', `
            <div id="grad-review-modal" class="grad-review-modal hidden" role="dialog" aria-modal="true" aria-labelledby="grad-review-title">
                <button type="button" class="grad-review-backdrop" data-grad-review-close aria-label="Close review"></button>
                <div class="grad-review-panel site-card">
                    <button type="button" class="grad-review-close-x" data-grad-review-close aria-label="Close">&times;</button>
                    <div id="grad-review-body" class="grad-review-body"></div>
                </div>
            </div>
        `);

        modal = document.getElementById('grad-review-modal');
        modal.addEventListener('click', async (event) => {
            if (event.target.closest('[data-grad-review-close]')) {
                closeReviewModal();
                return;
            }

            const changesBtn = event.target.closest('[data-grad-review-changes]');
            if (changesBtn) {
                const note = document.getElementById('grad-review-feedback')?.value?.trim();
                if (!note) {
                    await window.showAppAlert?.('Please describe what the family should change before sending it back.');
                    return;
                }
                try {
                    changesBtn.disabled = true;
                    await requestChanges(changesBtn.dataset.gradReviewChanges, note);
                    closeReviewModal();
                    await loadGraduationAdmin();
                    await window.showAppAlert?.('Feedback sent. The family can update and resubmit their order.', { tone: 'success' });
                } catch (err) {
                    await window.showAppAlert?.(err.message || String(err));
                    changesBtn.disabled = false;
                }
                return;
            }

            const paidBtn = event.target.closest('[data-grad-review-paid]');
            if (paidBtn) {
                const method = document.getElementById('grad-review-paid-method')?.value || 'cash';
                const amount = document.getElementById('grad-review-paid-amount')?.value;
                const note = document.getElementById('grad-review-paid-note')?.value?.trim() || '';
                try {
                    paidBtn.disabled = true;
                    await markSubmissionPaid(paidBtn.dataset.gradReviewPaid, method, amount, note);
                    await openReviewModal(paidBtn.dataset.gradReviewPaid);
                    await loadGraduationAdmin();
                    await window.showAppAlert?.('Payment recorded.', { tone: 'success' });
                } catch (err) {
                    await window.showAppAlert?.(err.message || String(err));
                } finally {
                    paidBtn.disabled = false;
                }
                return;
            }

            const approveBtn = event.target.closest('[data-grad-review-approve]');
            if (approveBtn) {
                const ack = document.getElementById('grad-review-ack-name')?.value?.trim();
                if (!ack) {
                    await window.showAppAlert?.('Type your name to approve and sign.');
                    return;
                }
                const confirmed = await window.showAppConfirm?.({
                    title: 'Approve graduation order?',
                    message: 'This will archive the signed PDF to the family\'s My Documents and remove their My Tasks card.',
                    confirmLabel: 'Approve',
                });
                if (!confirmed) return;
                try {
                    approveBtn.disabled = true;
                    await approveSubmission(approveBtn.dataset.gradReviewApprove, ack);
                    closeReviewModal();
                    await loadGraduationAdmin();
                    await window.showAppAlert?.('Graduation order approved and archived.', { tone: 'success' });
                } catch (err) {
                    await window.showAppAlert?.(err.message || String(err));
                    approveBtn.disabled = false;
                }
                return;
            }

            const pdfBtn = event.target.closest('[data-grad-pdf]');
            if (pdfBtn) {
                const client = getClient();
                const { data } = await client.storage.from('Family-Documents').createSignedUrl(pdfBtn.dataset.gradPdf, 3600);
                if (data?.signedUrl) window.open(data.signedUrl, '_blank');
            }
        });

        return modal;
    }

    function closeReviewModal() {
        const modal = document.getElementById('grad-review-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        document.body.classList.remove('grad-review-open');
    }

    async function openReviewModal(submissionId) {
        const client = getClient();
        const { data: sub, error } = await client
            .from('graduation_submissions')
            .select('*')
            .eq('id', submissionId)
            .single();
        if (error || !sub) {
            await window.showAppAlert?.('Could not load this graduation order.');
            return;
        }

        let studentName = sub.form_data?.diploma_name || 'Graduate';
        if (sub.student_id) {
            const { data: student } = await client.from('students').select('first_name, last_name').eq('id', sub.student_id).maybeSingle();
            if (student) studentName = window.GraduationTasks.studentDisplayName(student);
        } else if (sub.guest_id) {
            const { data: guest } = await client.from('graduation_guests').select('student_name').eq('id', sub.guest_id).maybeSingle();
            if (guest?.student_name) studentName = guest.student_name;
        }

        const modal = ensureReviewModal();
        const body = document.getElementById('grad-review-body');
        if (body) body.innerHTML = buildReviewModalContent(sub, studentName);
        modal.classList.remove('hidden');
        document.body.classList.add('grad-review-open');
    }

    async function fetchRosterForYear(schoolYear) {
        const client = getClient();
        const rows = [];

        const { data: seniors } = await client
            .from('students')
            .select('id, first_name, last_name, family_user_id, current_grade_level')
            .eq('current_grade_level', '12');

        const seniorIds = (seniors || []).map((s) => s.id);
        let yearRecords = [];
        if (seniorIds.length) {
            const { data } = await client
                .from('student_school_years')
                .select('student_id, school_year, semester_1_locked')
                .in('student_id', seniorIds)
                .eq('school_year', schoolYear)
                .eq('grade_level', '12')
                .eq('entry_type', 'current');
            yearRecords = data || [];
        }

        const s1Locked = new Set(yearRecords.filter((y) => y.semester_1_locked).map((y) => y.student_id));

        const { data: submissions } = await client
            .from('graduation_submissions')
            .select('*')
            .eq('school_year', schoolYear);
        const subByStudent = {};
        const subByGuest = {};
        (submissions || []).forEach((s) => {
            if (s.student_id) subByStudent[s.student_id] = s;
            if (s.guest_id) subByGuest[s.guest_id] = s;
        });

        (seniors || []).forEach((student) => {
            if (!s1Locked.has(student.id)) return;
            const sub = subByStudent[student.id];
            rows.push({
                key: `student-${student.id}`,
                studentName: window.GraduationTasks.studentDisplayName(student),
                type: 'Summit',
                participation: sub?.form_data?.participation_mode === 'diploma_only' ? 'Diploma only' : (sub ? 'Walking' : '—'),
                formStatus: sub?.status || 'not_started',
                paymentStatus: sub?.payment_status || 'unpaid',
                submission: sub,
                studentId: student.id,
                familyUserId: student.family_user_id,
            });
        });

        const { data: guests } = await client
            .from('graduation_guests')
            .select('*')
            .eq('school_year', schoolYear)
            .order('created_at', { ascending: false });

        (guests || []).forEach((guest) => {
            const sub = subByGuest[guest.id];
            rows.push({
                key: `guest-${guest.id}`,
                studentName: guest.student_name,
                type: 'Guest',
                participation: sub?.form_data?.participation_mode === 'diploma_only' ? 'Diploma only' : (sub ? 'Walking' : '—'),
                formStatus: sub?.status || 'not_started',
                paymentStatus: sub?.payment_status || 'unpaid',
                submission: sub,
                guest,
                guestId: guest.id,
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
            walking: rows.filter((r) => r.participation === 'Walking').length,
            diplomaOnly: rows.filter((r) => r.participation === 'Diploma only').length,
        };
    }

    async function callWorkflow(body) {
        const client = getClient();
        const { data: { session } } = await client.auth.getSession();
        const headers = {
            'Content-Type': 'application/json',
            apikey: window.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${session?.access_token || window.SUPABASE_ANON_KEY}`,
        };
        const response = await fetch(`${SUPABASE_URL}/functions/v1/graduation-workflow`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) {
            throw new Error(result.error || `Request failed (${response.status})`);
        }
        return result;
    }

    async function approveSubmission(submissionId, adminAckName) {
        const client = getClient();
        const { data: sub } = await client
            .from('graduation_submissions')
            .select('*')
            .eq('id', submissionId)
            .single();
        if (!sub) throw new Error('Submission not found.');

        const studentName = sub.form_data?.diploma_name
            || (sub.student_id ? 'Graduate' : 'Guest graduate');

        const pdfPayload = {
            schoolYear: sub.school_year,
            studentName,
            participantType: sub.participant_type,
            formData: sub.form_data,
            lineItems: sub.line_items,
            totalDue: sub.total_due,
            paymentStatus: sub.payment_status,
            paymentMethod: sub.payment_method,
            paymentAmount: sub.payment_amount || sub.total_due,
            paymentNote: sub.payment_note,
            adminPaymentMethod: sub.admin_payment_method,
            adminPaymentNote: sub.admin_payment_note,
            familyAckName: sub.family_ack_name,
            familySubmittedAt: sub.family_submitted_at,
            adminAckName,
            adminApprovedAt: new Date().toISOString(),
            filename: `Graduation-Order-${studentName.replace(/\s+/g, '-')}.pdf`,
        };

        const blob = await window.GraduationPdf.generateBlob(pdfPayload);
        const path = `graduation/${sub.school_year}/${submissionId}.pdf`;
        const { error: uploadErr } = await client.storage
            .from('Family-Documents')
            .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
        if (uploadErr) throw uploadErr;

        const { data: { user } } = await client.auth.getUser();
        const now = new Date().toISOString();

        let familyDocId = null;
        if (sub.family_user_id) {
            const { data: doc, error: docErr } = await client.from('family_documents').insert({
                user_id: sub.family_user_id,
                title: `Graduation Order — ${studentName}`,
                description: `Approved graduation order for ${sub.school_year}.`,
                url: path,
                category: 'Graduation Order',
                school_year: sub.school_year,
            }).select('id').single();
            if (docErr) throw docErr;
            familyDocId = doc.id;

            await window.GraduationTasks.removeGraduationTask(sub.student_id, sub.family_user_id);
        }

        const { error: updErr } = await client.from('graduation_submissions').update({
            status: 'approved',
            admin_user_id: user?.id,
            admin_ack_name: adminAckName,
            admin_approved_at: now,
            pdf_storage_path: path,
            family_document_id: familyDocId,
            updated_at: now,
        }).eq('id', submissionId);
        if (updErr) throw updErr;

        await callWorkflow({
            action: 'admin_approved',
            submission_id: submissionId,
            family_user_id: sub.family_user_id,
            guest_email: sub.guest_id ? (await client.from('graduation_guests').select('parent_email').eq('id', sub.guest_id).maybeSingle())?.data?.parent_email : null,
            student_name: studentName,
            school_year: sub.school_year,
        });
    }

    async function markSubmissionPaid(submissionId, method, amount, note) {
        const client = getClient();
        const { error } = await client.from('graduation_submissions').update({
            payment_status: 'paid',
            admin_payment_method: method,
            admin_payment_note: note || null,
            payment_amount: amount != null ? Number(amount) : undefined,
            admin_marked_paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }).eq('id', submissionId);
        if (error) throw error;
    }

    async function requestChanges(submissionId, note) {
        const client = getClient();
        const { error } = await client.from('graduation_submissions').update({
            status: 'changes_requested',
            admin_notes: note || null,
            updated_at: new Date().toISOString(),
        }).eq('id', submissionId);
        if (error) throw error;
        const { data: sub } = await client
            .from('graduation_submissions')
            .select('family_user_id, guest_id, school_year, form_data')
            .eq('id', submissionId)
            .single();
        let guestEmail = null;
        if (sub?.guest_id) {
            const { data: guest } = await client.from('graduation_guests').select('parent_email').eq('id', sub.guest_id).maybeSingle();
            guestEmail = guest?.parent_email || null;
        }
        await callWorkflow({
            action: 'changes_requested',
            submission_id: submissionId,
            admin_notes: note,
            family_user_id: sub?.family_user_id,
            guest_email: guestEmail,
            student_name: sub?.form_data?.diploma_name || 'your graduate',
            school_year: sub?.school_year,
        });
    }

    async function saveSettings(schoolYear, formData) {
        const client = getClient();
        const payload = { ...formData, school_year: schoolYear, updated_at: new Date().toISOString() };
        const { error } = await client.from('graduation_settings').upsert(payload);
        if (error) throw error;
    }

    async function addGuest(schoolYear, guestData) {
        const client = getClient();
        const { data: { user } } = await client.auth.getUser();
        const { data, error } = await client.from('graduation_guests').insert({
            school_year: schoolYear,
            student_name: guestData.student_name,
            parent_name: guestData.parent_name || null,
            parent_email: guestData.parent_email || null,
            cover_notes: guestData.cover_notes || null,
            created_by_admin_id: user?.id,
        }).select('*').single();
        if (error) throw error;
        return data;
    }

    function renderSettingsForm(settings, schoolYear) {
        const s = settings || {};
        const feeFields = [
            ['summit_base_fee', 'Summit base fee ($)'],
            ['guest_base_fee', 'Guest base fee ($)'],
            ['ceremony_opt_out_fee', 'Diploma-only fee ($, leave blank for TBD)'],
            ['pictures_fee', 'Pictures ($)'],
            ['tshirt_youth_fee', 'T-shirt youth ($)'],
            ['tshirt_adult_fee', 'T-shirt adult ($)'],
            ['honor_cord_fee', 'Honor cord each ($)'],
        ];
        const dateFields = [
            ['dues_due_date', 'Dues due date'],
            ['ceremony_date', 'Ceremony date'],
            ['practice_date', 'Practice date'],
            ['pictures_date', 'Pictures date (optional)'],
        ];
        const eventDetailFields = [
            ['ceremony_time', 'Ceremony time'],
            ['ceremony_location', 'Ceremony location'],
            ['practice_time', 'Practice time'],
            ['practice_location', 'Practice location'],
            ['pictures_time', 'Pictures time'],
            ['pictures_location', 'Pictures location'],
        ];
        const paymentFields = [
            ['paypal_username', 'PayPal username'],
            ['cashapp_cashtag', 'Cash App $tag'],
        ];

        function renderInput(key, label, type = 'text', extra = '') {
            const val = s[key] ?? '';
            return `<div><label class="block text-xs font-medium text-slate-600 mb-1">${escapeHtml(label)}</label>
                <input type="${type}" name="${key}" value="${escapeHtml(val)}" ${extra} class="form-input w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"></div>`;
        }

        const feeInputs = feeFields.map(([key, label]) => renderInput(key, label, 'number', 'step="0.01"')).join('');
        const dateInputs = dateFields.map(([key, label]) => renderInput(key, label, 'date')).join('');
        const eventInputs = eventDetailFields.map(([key, label]) => renderInput(key, label)).join('');
        const paymentInputs = paymentFields.map(([key, label]) => renderInput(key, label)).join('');

        return `
            <form id="grad-admin-settings-form" class="space-y-6" data-school-year="${escapeHtml(schoolYear)}">
                <div>
                    <h4 class="text-sm font-semibold text-navy mb-3">Fees</h4>
                    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">${feeInputs}</div>
                </div>
                <div>
                    <h4 class="text-sm font-semibold text-navy mb-3">Important dates</h4>
                    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">${dateInputs}</div>
                </div>
                <div>
                    <h4 class="text-sm font-semibold text-navy mb-3">Event times &amp; locations</h4>
                    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">${eventInputs}</div>
                </div>
                <div>
                    <h4 class="text-sm font-semibold text-navy mb-3">Payment links</h4>
                    <div class="grid sm:grid-cols-2 gap-4">${paymentInputs}</div>
                    <div class="mt-4">
                        <label class="block text-xs font-medium text-slate-600 mb-1">Payment note hint</label>
                        <input type="text" name="payment_note_hint" value="${escapeHtml(s.payment_note_hint || '')}" class="form-input w-full px-3 py-2 border border-slate-300 rounded-xl text-sm">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-medium text-slate-600 mb-1">Honor cord options (one per line)</label>
                    <textarea name="honor_cord_options" rows="6" class="form-input w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono">${escapeHtml(s.honor_cord_options || '')}</textarea>
                </div>
                <div>
                    <label class="block text-xs font-medium text-slate-600 mb-1">Graduation requirements (shown to families)</label>
                    <textarea name="requirements_text" rows="10" class="form-input w-full px-3 py-2 border border-slate-300 rounded-xl text-sm">${escapeHtml(s.requirements_text || '')}</textarea>
                </div>
                <div class="flex gap-3">
                    <button type="submit" class="px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-semibold">Save settings</button>
                    <button type="button" id="grad-copy-settings-btn" class="px-5 py-2.5 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700">Copy from previous year</button>
                </div>
            </form>
        `;
    }

    function renderRosterTable(rows, schoolYear) {
        if (!rows.length) {
            return '<div class="hub-empty-state">No graduation participants for this school year yet.</div>';
        }
        const body = rows.map((row) => {
            const subId = row.submission?.id;
            const reviewBtn = subId
                ? `<button type="button" class="text-xs px-3 py-1.5 bg-navy text-white rounded-lg font-semibold" data-grad-review="${subId}">Review</button>`
                : '—';
            const actions = subId && row.formStatus === 'changes_requested'
                ? '<span class="text-[10px] text-amber-700">Awaiting family</span>'
                : (subId && row.formStatus === 'approved' ? '<span class="text-[10px] text-emerald-700">Complete</span>' : '');

            return `<tr class="border-t border-slate-100">
                <td class="py-3 pr-3 font-medium text-navy">${escapeHtml(row.studentName)}</td>
                <td class="py-3 pr-3"><span class="text-[10px] font-bold uppercase ${row.type === 'Summit' ? 'text-sky-700' : 'text-violet-700'}">${row.type}</span></td>
                <td class="py-3 pr-3 text-sm">${escapeHtml(row.participation)}</td>
                <td class="py-3 pr-3 text-sm">${statusBadge(row.formStatus)}</td>
                <td class="py-3 pr-3">${paymentBadge(row.paymentStatus)}</td>
                <td class="py-3 pr-3">${reviewBtn}</td>
                <td class="py-3">${actions}</td>
            </tr>`;
        }).join('');

        return `
            <div class="overflow-x-auto">
                <table class="w-full text-left text-sm min-w-[720px]">
                    <thead>
                        <tr class="text-xs uppercase tracking-wide text-slate-500">
                            <th class="pb-2 pr-3">Student</th>
                            <th class="pb-2 pr-3">Type</th>
                            <th class="pb-2 pr-3">Participation</th>
                            <th class="pb-2 pr-3">Form</th>
                            <th class="pb-2 pr-3">Payment</th>
                            <th class="pb-2 pr-3">Review</th>
                            <th class="pb-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        `;
    }

    async function renderGraduationYearPanel(schoolYear) {
        const client = getClient();
        const settings = await ensureGraduationSettingsYear(schoolYear);
        const rows = await fetchRosterForYear(schoolYear);
        const summary = summarizeRoster(rows);

        return `
            <div data-grad-year-panel="${escapeHtml(schoolYear)}">
                <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                    <div class="hub-panel hub-panel-padded text-center"><div class="text-2xl font-bold text-navy">${summary.total}</div><div class="text-[10px] uppercase text-slate-500">Total</div></div>
                    <div class="hub-panel hub-panel-padded text-center"><div class="text-2xl font-bold text-emerald-700">${summary.paid}</div><div class="text-[10px] uppercase text-slate-500">Paid</div></div>
                    <div class="hub-panel hub-panel-padded text-center"><div class="text-2xl font-bold text-amber-700">${summary.pending}</div><div class="text-[10px] uppercase text-slate-500">Pending</div></div>
                    <div class="hub-panel hub-panel-padded text-center"><div class="text-2xl font-bold text-navy">${summary.walking}</div><div class="text-[10px] uppercase text-slate-500">Walking</div></div>
                    <div class="hub-panel hub-panel-padded text-center"><div class="text-2xl font-bold text-slate-600">${summary.diplomaOnly}</div><div class="text-[10px] uppercase text-slate-500">Diploma only</div></div>
                </div>
                <details class="mb-6 hub-panel hub-panel-padded">
                    <summary class="font-semibold text-navy cursor-pointer">Year settings (${escapeHtml(schoolYear)})</summary>
                    <div class="mt-4">${renderSettingsForm(settings, schoolYear)}</div>
                </details>
                <details class="mb-6 hub-panel hub-panel-padded">
                    <summary class="font-semibold text-navy cursor-pointer">Add guest participant</summary>
                    <form id="grad-add-guest-form" class="mt-4 grid sm:grid-cols-2 gap-3" data-school-year="${escapeHtml(schoolYear)}">
                        <input name="student_name" required placeholder="Student name" class="form-input px-3 py-2 border rounded-xl text-sm">
                        <input name="parent_name" placeholder="Parent name" class="form-input px-3 py-2 border rounded-xl text-sm">
                        <input name="parent_email" type="email" placeholder="Parent email" class="form-input px-3 py-2 border rounded-xl text-sm">
                        <input name="cover_notes" placeholder="Cover notes (CHE, none, etc.)" class="form-input px-3 py-2 border rounded-xl text-sm">
                        <button type="submit" class="sm:col-span-2 px-5 py-2.5 bg-navy text-white rounded-xl text-sm font-semibold w-fit">Create invite link</button>
                    </form>
                    <div id="grad-guest-invite-result" class="mt-3 text-sm hidden"></div>
                </details>
                ${renderRosterTable(rows, schoolYear)}
            </div>
        `;
    }

    function showGraduationYearTab(yearKey) {
        const container = document.getElementById('grad-admin-tabs');
        if (!container) return;
        container.dataset.activeYear = yearKey;
        container.querySelectorAll('[data-grad-year-tab]').forEach((btn) => {
            const active = btn.dataset.gradYearTab === yearKey;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        container.querySelectorAll('[data-grad-year-panel]').forEach((panel) => {
            panel.classList.toggle('hidden', panel.dataset.gradYearPanel !== yearKey);
        });
    }

    async function loadGraduationAdmin() {
        const root = document.getElementById('admin-graduation-root');
        if (!root || !getClient()) return;
        root.innerHTML = '<div class="hub-empty-state">Loading graduation roster…</div>';

        const years = await fetchGraduationYears();
        const activeYear = years.includes(currentSchoolYear()) ? currentSchoolYear() : years[0];

        let tabButtons = '';
        let tabPanels = '';
        for (const year of years) {
            const isActive = year === activeYear;
            const label = formatYearTabLabel(year);
            tabButtons += `<button type="button" class="ar-year-tab-btn hub-tab-btn ${isActive ? 'is-active' : ''}" role="tab"
                data-grad-year-tab="${escapeHtml(year)}" aria-selected="${isActive}" onclick="window.GraduationAdmin.showYearTab(${JSON.stringify(year)})">
                <span class="ar-year-tab-short">${escapeHtml(label)}</span><span class="ar-year-tab-full">${escapeHtml(year)}</span></button>`;
            const panelHtml = await renderGraduationYearPanel(year);
            tabPanels += `<div class="ar-year-tab-panel ${isActive ? '' : 'hidden'}" role="tabpanel" data-grad-year-panel="${escapeHtml(year)}">${panelHtml}</div>`;
        }

        root.innerHTML = `
            <div id="grad-admin-tabs" class="hub-document-tabs ar-student-year-tabs mb-6" data-active-year="${escapeHtml(activeYear)}">
                <div class="ar-year-tab-bar hub-tab-group" role="tablist">${tabButtons}</div>
                <div class="ar-year-tab-panels mt-4">${tabPanels}</div>
            </div>
        `;
        bindAdminEvents();
    }

    function bindAdminEvents() {
        const root = document.getElementById('admin-graduation-root');
        if (!root) return;

        root.addEventListener('submit', async (event) => {
            const settingsForm = event.target.closest('#grad-admin-settings-form');
            if (settingsForm) {
                event.preventDefault();
                const schoolYear = settingsForm.dataset.schoolYear;
                const formData = Object.fromEntries(new FormData(settingsForm).entries());
                ['summit_base_fee', 'guest_base_fee', 'pictures_fee', 'tshirt_youth_fee', 'tshirt_adult_fee', 'honor_cord_fee', 'ceremony_opt_out_fee']
                    .forEach((k) => { if (formData[k] === '') formData[k] = null; else if (formData[k] != null) formData[k] = Number(formData[k]); });
                try {
                    await saveSettings(schoolYear, formData);
                    await window.showAppAlert?.('Graduation settings saved.');
                } catch (err) {
                    await window.showAppAlert?.(err.message || String(err));
                }
                return;
            }

            const guestForm = event.target.closest('#grad-add-guest-form');
            if (guestForm) {
                event.preventDefault();
                const schoolYear = guestForm.dataset.schoolYear;
                const data = Object.fromEntries(new FormData(guestForm).entries());
                try {
                    const guest = await addGuest(schoolYear, data);
                    const origin = window.SITE_ORIGIN || window.location.origin || 'https://summitchurchschool.org';
                    const link = `${origin}/graduation-hub.html?guest=${guest.invite_token}`;
                    const result = document.getElementById('grad-guest-invite-result');
                    if (result) {
                        result.classList.remove('hidden');
                        result.innerHTML = `Invite link: <a href="${escapeHtml(link)}" class="text-navy font-semibold underline break-all" target="_blank">${escapeHtml(link)}</a>`;
                    }
                    guestForm.reset();
                    await loadGraduationAdmin();
                } catch (err) {
                    await window.showAppAlert?.(err.message || String(err));
                }
            }
        });

        root.addEventListener('click', async (event) => {
            const copyBtn = event.target.closest('#grad-copy-settings-btn');
            if (copyBtn) {
                const form = copyBtn.closest('form');
                const year = form?.dataset?.schoolYear;
                if (!year) return;
                const prev = shiftYearLabel(year, -1);
                const client = getClient();
                const { data: prevSettings } = await client.from('graduation_settings').select('*').eq('school_year', prev).maybeSingle();
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
                    pictures_date: null,
                    ceremony_time: prevSettings.ceremony_time,
                    ceremony_location: prevSettings.ceremony_location,
                    practice_time: prevSettings.practice_time,
                    practice_location: prevSettings.practice_location,
                    pictures_time: prevSettings.pictures_time,
                    pictures_location: prevSettings.pictures_location,
                    requirements_text: prevSettings.requirements_text,
                    honor_cord_options: prevSettings.honor_cord_options,
                });
                await loadGraduationAdmin();
                return;
            }

            const reviewBtn = event.target.closest('[data-grad-review]');
            if (reviewBtn) {
                await openReviewModal(reviewBtn.dataset.gradReview);
            }
        });
    }

    window.GraduationAdmin = {
        loadGraduationAdmin,
        showYearTab: showGraduationYearTab,
        ensureGraduationSettingsYear,
        approveSubmission,
        markSubmissionPaid,
        openReviewModal,
    };
})();