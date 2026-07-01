(function () {
    const SUPABASE_URL = 'https://tajyrmydwqsijstyzsjr.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_JYGgJw9y87hnCeEM66Lbcg_xJqpMWcy';

    let supabaseClient = null;
    let context = null;
    let settings = null;
    let submission = null;
    let orderFormReached = false;
    let mainTotalVisible = false;
    let passedMainTotal = false;
    let floatingTotalObservers = null;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            studentId: params.get('student')?.trim() || '',
            guestToken: params.get('guest')?.trim() || '',
        };
    }

    function currentSchoolYear() {
        return window.GraduationTasks?.currentSchoolYear?.()
            || window.AcademicRecords?.currentSchoolYear?.()
            || '2026-2027';
    }

    async function initClient() {
        if (supabaseClient) return supabaseClient;
        // Must match members.html — Family Hub session lives in sessionStorage (tab-scoped).
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                storage: window.sessionStorage,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: 'pkce',
            },
        });
        window.supabaseClient = supabaseClient;
        return supabaseClient;
    }

    async function waitForHubSession(client, maxWaitMs = 4000) {
        const started = Date.now();
        while (Date.now() - started < maxWaitMs) {
            const { data: { session } } = await client.auth.getSession();
            if (session?.user) return session;
            await new Promise((resolve) => setTimeout(resolve, 80));
        }
        const { data: { session } } = await client.auth.getSession();
        return session;
    }

    function defaultFormState() {
        return {
            participation_mode: 'full',
            diploma_name: '',
            parent_phone: '',
            parent_email: '',

            cap_gown_size: '',
            special_notes: '',
            add_pictures: false,
            add_tshirt: false,
            tshirt_size: '',
            honor_cords_selected: [],
            beta_club_member: '',
            classical_conversations_student: '',
            requirements_ack: false,
            payment_method: '',
            payment_amount: '',
            payment_note: '',
        };
    }

    function readFormFromDom() {
        const form = defaultFormState();
        const root = document.getElementById('grad-hub-form');
        if (!root) return form;

        form.participation_mode = root.querySelector('[name="participation_mode"]:checked')?.value || 'full';
        form.beta_club_member = root.querySelector('[name="beta_club_member"]:checked')?.value || '';
        form.classical_conversations_student = root.querySelector('[name="classical_conversations_student"]:checked')?.value || '';
        ['diploma_name', 'parent_phone', 'parent_email', 'cap_gown_size',
            'special_notes', 'tshirt_size', 'payment_method', 'payment_amount', 'payment_note'].forEach((key) => {
            const el = root.querySelector(`[name="${key}"]`);
            if (el) form[key] = el.value;
        });
        form.add_pictures = Boolean(root.querySelector('[name="add_pictures"]')?.checked);
        form.add_tshirt = Boolean(root.querySelector('[name="add_tshirt"]')?.checked);
        form.requirements_ack = Boolean(root.querySelector('[name="requirements_ack"]')?.checked);
        form.honor_cords_selected = [...root.querySelectorAll('[name="honor_cord_option"]:checked')]
            .map((el) => el.value)
            .filter(Boolean);
        return form;
    }

    function applyFormToDom(form) {
        const root = document.getElementById('grad-hub-form');
        if (!root || !form) return;
        const mode = form.participation_mode || 'full';
        root.querySelectorAll('[name="participation_mode"]').forEach((radio) => {
            radio.checked = radio.value === mode;
        });
        ['beta_club_member', 'classical_conversations_student'].forEach((key) => {
            root.querySelectorAll(`[name="${key}"]`).forEach((radio) => {
                radio.checked = radio.value === (form[key] || '');
            });
        });
        Object.entries(form).forEach(([key, value]) => {
            if (key === 'honor_cords_selected' || key === 'beta_club_member' || key === 'classical_conversations_student') return;
            const el = root.querySelector(`[name="${key}"]`);
            if (!el) return;
            if (el.type === 'checkbox') el.checked = Boolean(value);
            else el.value = value ?? '';
        });
        const selectedCords = window.GraduationTasks.getHonorCordsSelected(form);
        root.querySelectorAll('[name="honor_cord_option"]').forEach((el) => {
            el.checked = selectedCords.includes(el.value);
        });
        toggleParticipationSections(mode);
        updateTotals();
    }

    function clearFullGraduationOptions() {
        const root = document.getElementById('grad-hub-form');
        if (!root) return;
        const capGown = root.querySelector('[name="cap_gown_size"]');
        if (capGown) capGown.value = '';
        const pictures = root.querySelector('[name="add_pictures"]');
        if (pictures) pictures.checked = false;
        const tshirt = root.querySelector('[name="add_tshirt"]');
        if (tshirt) tshirt.checked = false;
        const tshirtSize = root.querySelector('[name="tshirt_size"]');
        if (tshirtSize) tshirtSize.value = '';
        root.querySelectorAll('[name="honor_cord_option"]').forEach((el) => { el.checked = false; });
        root.querySelectorAll('[name="beta_club_member"], [name="classical_conversations_student"]').forEach((el) => {
            el.checked = false;
        });
    }

    function toggleParticipationSections(mode) {
        const isDiplomaOnly = mode === 'diploma_only';
        document.querySelectorAll('[data-full-only]').forEach((el) => {
            el.classList.toggle('hidden', isDiplomaOnly);
        });
        if (isDiplomaOnly) clearFullGraduationOptions();
        const optOutBlocked = document.getElementById('opt-out-blocked');
        if (optOutBlocked) {
            const fee = settings?.ceremony_opt_out_fee;
            optOutBlocked.classList.toggle('hidden', !isDiplomaOnly || fee != null);
        }
        updateTotals();
    }

    function updateTotals() {
        const form = readFormFromDom();
        const participantType = context?.participantType || 'summit_senior';
        const { items, total } = window.GraduationTasks.computeLineItems(form, settings, participantType);

        const listEl = document.getElementById('grad-fee-lines');
        const totalEl = document.getElementById('grad-fee-total');
        if (listEl) {
            listEl.innerHTML = items.length
                ? items.map((item) => `<div class="flex justify-between text-sm py-1"><span>${escapeHtml(item.label)}</span><span class="font-semibold">$${item.amount.toFixed(2)}</span></div>`).join('')
                : '<p class="text-sm text-slate-500">Select options to see your total.</p>';
        }
        if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;

        const paypal = document.getElementById('grad-paypal-link');
        const cashapp = document.getElementById('grad-cashapp-link');
        const user = settings?.paypal_username || 'macraesmom';
        const tag = settings?.cashapp_cashtag || 'SummitExplorers';
        if (paypal && total > 0) paypal.href = `https://paypal.me/${user}/${total}`;
        if (cashapp && total > 0) cashapp.href = `https://cash.app/$${tag}/${total}`;
        if (paypal) paypal.classList.toggle('pointer-events-none', total <= 0);
        if (cashapp) cashapp.classList.toggle('pointer-events-none', total <= 0);

        updateFloatingTotalDisplay(items, total);
        return { items, total };
    }

    function syncFloatingTotalVisibility() {
        const bar = document.getElementById('grad-floating-total');
        if (!bar) return;
        const show = orderFormReached && !mainTotalVisible && !passedMainTotal;
        bar.classList.toggle('is-visible', show);
        bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    }

    function isPaymentLocked() {
        return submission?.payment_status === 'paid' || Boolean(submission?.admin_marked_paid_at);
    }

    function applyPaymentLockState() {
        const locked = isPaymentLocked();
        document.getElementById('grad-payment-recorded')?.classList.toggle('hidden', !locked);
        document.getElementById('grad-payment-family-fields')?.classList.toggle('hidden', locked);
        document.querySelectorAll('#grad-fee-section [name="payment_method"]').forEach((el) => {
            el.required = !locked;
        });
    }

    function ensureFloatingTotalBar() {
        if (document.getElementById('grad-floating-total')) return;

        const bar = document.createElement('div');
        bar.id = 'grad-floating-total';
        bar.className = 'grad-floating-total';
        bar.setAttribute('aria-hidden', 'true');
        bar.innerHTML = `
            <button type="button" class="grad-floating-total-inner w-full text-left" id="grad-floating-total-btn" aria-label="Scroll to fee breakdown">
                <span class="grad-floating-total-copy">
                    <span class="grad-floating-total-label">Estimated total</span>
                    <span id="grad-floating-total-items" class="grad-floating-total-items">Select options</span>
                </span>
                <span id="grad-floating-total-amount" class="grad-floating-total-amount">$0.00</span>
            </button>
        `;
        bar.querySelector('#grad-floating-total-btn')?.addEventListener('click', () => {
            document.getElementById('grad-fee-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        document.body.appendChild(bar);
    }

    function updateFloatingTotalDisplay(items, total) {
        ensureFloatingTotalBar();
        const amountEl = document.getElementById('grad-floating-total-amount');
        const itemsEl = document.getElementById('grad-floating-total-items');
        if (amountEl) amountEl.textContent = `$${total.toFixed(2)}`;
        if (itemsEl) {
            if (!items?.length) {
                itemsEl.textContent = 'Select options';
            } else if (items.length === 1) {
                itemsEl.textContent = items[0].label;
            } else {
                const preview = items.slice(0, 2).map((item) => item.label).join(', ');
                const extra = items.length > 2 ? ` +${items.length - 2} more` : '';
                itemsEl.textContent = `${preview}${extra}`;
            }
        }
        syncFloatingTotalVisibility();
    }

    function setupFloatingTotalObservers() {
        ensureFloatingTotalBar();
        const orderStart = document.getElementById('grad-order-form-start');
        const totalAnchor = document.getElementById('grad-fee-total-anchor');
        if (!orderStart || !totalAnchor) return;

        if (floatingTotalObservers) {
            floatingTotalObservers.order?.disconnect();
            floatingTotalObservers.total?.disconnect();
        }

        const orderObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                orderFormReached = entry.isIntersecting || entry.boundingClientRect.top < 0;
                syncFloatingTotalVisibility();
            });
        }, { threshold: 0 });

        const totalObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                mainTotalVisible = entry.isIntersecting;
                if (entry.isIntersecting) {
                    passedMainTotal = false;
                } else if (entry.boundingClientRect.top < 0) {
                    passedMainTotal = true;
                } else {
                    passedMainTotal = false;
                }
                syncFloatingTotalVisibility();
            });
        }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });

        orderObserver.observe(orderStart);
        totalObserver.observe(totalAnchor);
        floatingTotalObservers = { order: orderObserver, total: totalObserver };
    }

    function formatEventDetail(date, time, location) {
        const fmt = window.GraduationTasks.formatDateLabel;
        const parts = [fmt(date)];
        if (time) parts.push(time);
        if (location) parts.push(location);
        return parts.join(' · ');
    }

    function renderEventRow(label, date, time, location) {
        const fmt = window.GraduationTasks.formatDateLabel;
        const detail = formatEventDetail(date, time, location);
        return `
            <div>
                <dt class="ar-grade-help-label mb-1">${escapeHtml(label)}</dt>
                <dd class="text-sm font-bold text-navy m-0 leading-snug">${escapeHtml(detail)}</dd>
            </div>
        `;
    }

    function renderEventInfo() {
        const el = document.getElementById('grad-event-info');
        if (!el || !settings) return;
        const fmt = window.GraduationTasks.formatDateLabel;
        el.innerHTML = `
            <div class="ar-grade-help">
                <div class="ar-grade-help-header">
                    <h3 class="ar-grade-help-title">Important dates</h3>
                </div>
                <section class="ar-grade-help-block ar-grade-help-dates">
                    <dl class="grid sm:grid-cols-2 gap-4 m-0">
                        <div>
                            <dt class="ar-grade-help-label mb-1">Dues due</dt>
                            <dd class="text-sm font-bold text-navy m-0">${escapeHtml(fmt(settings.dues_due_date))}</dd>
                        </div>
                        ${renderEventRow('Ceremony', settings.ceremony_date, settings.ceremony_time, settings.ceremony_location)}
                        ${renderEventRow('Practice', settings.practice_date, settings.practice_time, settings.practice_location)}
                        ${renderEventRow('Pictures', settings.pictures_date, settings.pictures_time, settings.pictures_location)}
                    </dl>
                </section>
            </div>
        `;
    }

    function renderAddonPrices() {
        if (!settings) return;
        const fmt = window.GraduationTasks.formatMoney;
        const picturesEl = document.getElementById('grad-pictures-price');
        const tshirtEl = document.getElementById('grad-tshirt-prices');
        const cordEl = document.getElementById('grad-honor-cord-price');
        if (picturesEl) picturesEl.textContent = `${fmt(settings.pictures_fee || 20)} per student`;
        if (tshirtEl) {
            tshirtEl.textContent = `${fmt(settings.tshirt_youth_fee || 15)} for XS–XL · ${fmt(settings.tshirt_adult_fee || 18)} for 2XL+`;
        }
        if (cordEl) cordEl.textContent = `${fmt(settings.honor_cord_fee || 8)} per honor cord — check all that apply`;
    }

    function renderHonorCords() {
        const container = document.getElementById('grad-honor-cords');
        if (!container || !settings) return;
        const options = window.GraduationTasks.parseHonorCordOptions(settings.honor_cord_options);
        if (!options.length) {
            container.innerHTML = '<p class="text-sm text-slate-500">Honor cord options will be posted by the school office.</p>';
            return;
        }
        container.innerHTML = options.map((option) => `
            <label class="flex items-start gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:border-navy/30">
                <input type="checkbox" name="honor_cord_option" value="${escapeHtml(option)}" class="mt-0.5 rounded border-slate-300">
                <span class="text-sm text-slate-700">${escapeHtml(option)}</span>
            </label>
        `).join('');
    }

    function formatRequirementsHtml(text) {
        const sections = [];
        let section = { title: '', paragraphs: [], bullets: [] };

        function flush() {
            if (section.title || section.paragraphs.length || section.bullets.length) {
                sections.push({ ...section });
            }
            section = { title: '', paragraphs: [], bullets: [] };
        }

        const lines = String(text || '').split('\n');
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) {
                if (section.paragraphs.length || section.bullets.length) flush();
                continue;
            }
            if (line.startsWith('•')) {
                section.bullets.push(line.replace(/^•\s*/, ''));
                continue;
            }
            if (!section.paragraphs.length && !section.bullets.length) {
                if (section.title) section.paragraphs.push(line);
                else section.title = line;
            } else if (!section.bullets.length) {
                section.paragraphs.push(line);
            } else {
                flush();
                section.title = line;
            }
        }
        flush();

        if (!sections.length) {
            return '<p class="text-slate-500">Graduation requirements will be posted by the school office.</p>';
        }

        return sections.map((block) => {
            let html = '';
            if (block.title) html += `<h3 class="font-semibold text-navy mb-2">${escapeHtml(block.title)}</h3>`;
            block.paragraphs.forEach((para) => {
                html += `<p>${escapeHtml(para)}</p>`;
            });
            if (block.bullets.length) {
                html += `<ul class="list-disc pl-5 mt-2 space-y-1.5">${block.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
            }
            return `<section>${html}</section>`;
        }).join('');
    }

    function renderRequirements() {
        const el = document.getElementById('grad-requirements-text');
        if (!el || !settings) return;
        el.innerHTML = formatRequirementsHtml(settings.requirements_text?.trim());
    }

    async function loadContext() {
        const client = await initClient();
        const { studentId, guestToken } = getParams();

        if (guestToken) {
            const { data, error } = await client.rpc('get_graduation_guest_by_token', { p_token: guestToken });
            const guest = Array.isArray(data) ? data[0] : data;
            if (error || !guest) throw new Error('This graduation invite link is invalid or has expired.');
            context = {
                mode: 'guest',
                participantType: 'guest',
                guest,
                schoolYear: guest.school_year,
                studentName: guest.student_name,
                familyUserId: null,
                studentId: null,
                guestId: guest.id,
            };
            return true;
        }

        if (!studentId) throw new Error('Missing student. Open this page from My Tasks.');

        const session = await waitForHubSession(client);
        const user = session?.user;
        if (!user) {
            const returnPath = `${window.location.pathname}${window.location.search}`;
            window.location.replace(`members.html?redirect=${encodeURIComponent(returnPath)}`);
            return false;
        }

        const { data: student, error } = await client
            .from('students')
            .select('*')
            .eq('id', studentId)
            .maybeSingle();
        if (error || !student || student.family_user_id !== user.id) {
            throw new Error('You do not have access to this graduation form.');
        }

        const schoolYear = currentSchoolYear();
        context = {
            mode: 'summit',
            participantType: 'summit_senior',
            student,
            schoolYear,
            studentName: window.GraduationTasks.studentDisplayName?.(student)
                || [student.first_name, student.last_name].filter(Boolean).join(' '),
            familyUserId: user.id,
            studentId: student.id,
            guestId: null,
        };
        return true;
    }

    async function loadSettingsAndSubmission() {
        const client = await initClient();
        const year = context.schoolYear || currentSchoolYear();
        settings = await window.GraduationTasks.fetchGraduationSettings(year, client);
        if (!settings) throw new Error(`Graduation settings are not configured for ${year}. Contact the school office.`);

        if (context.mode === 'guest') {
            const { guestToken } = getParams();
            const { data } = await client.rpc('get_graduation_submission_by_guest_token', { p_token: guestToken });
            submission = Array.isArray(data) ? data[0] : data;
        } else {
            const { data } = await client
                .from('graduation_submissions')
                .select('*')
                .eq('school_year', year)
                .eq('student_id', context.studentId)
                .maybeSingle();
            submission = data;
        }

        if (submission?.status === 'approved') {
            showApprovedState();
            return false;
        }
        if (submission?.status === 'pending_review') {
            showPendingState();
            return false;
        }
        return true;
    }

    function showChangesRequestedBanner(note) {
        const main = document.getElementById('grad-hub-main');
        if (!main || !note) return;
        const banner = document.createElement('div');
        banner.className = 'hub-announcement w-full mb-6';
        banner.innerHTML = `
            <div class="min-w-0">
                <strong class="mb-1 block text-sm">Changes requested</strong>
                <p class="text-sm leading-relaxed">The school office asked for updates before approving your order:</p>
                <div class="mt-2 text-sm leading-relaxed font-semibold whitespace-pre-wrap break-words">${escapeHtml(note)}</div>
                <p class="mt-3 text-sm leading-relaxed">Please update the form below and submit again.</p>
            </div>
        `;
        const header = main.querySelector('header');
        if (header?.nextElementSibling) {
            main.insertBefore(banner, header.nextElementSibling);
        } else {
            main.prepend(banner);
        }
    }

    function hideFloatingTotalBar() {
        passedMainTotal = true;
        const bar = document.getElementById('grad-floating-total');
        if (!bar) return;
        bar.classList.remove('is-visible');
        bar.setAttribute('aria-hidden', 'true');
        bar.remove();
    }

    function buildHubReturnCard({ iconWrapClass, iconClass, title, messageHtml }) {
        return `
            <div class="site-card grad-hub-return-card p-8 sm:p-10 text-navy">
                <div class="grad-hub-return-body">
                    <div class="w-14 h-14 mx-auto rounded-2xl ${iconWrapClass} flex items-center justify-center">
                        <i class="${iconClass} text-2xl" aria-hidden="true"></i>
                    </div>
                    <h1 class="heading-serif text-2xl sm:text-3xl mt-5">${escapeHtml(title)}</h1>
                    <p class="mt-4 text-sm sm:text-[15px] text-slate-600 leading-relaxed max-w-md">${messageHtml}</p>
                </div>
                <div class="grad-hub-return-actions">
                    <a href="members.html" class="grad-hub-return-btn">Return to Family Hub</a>
                </div>
            </div>
        `;
    }

    function showReturnState(cardHtml) {
        const main = document.getElementById('grad-hub-main');
        if (!main) return;
        hideFloatingTotalBar();
        main.className = 'grad-hub-return-shell';
        main.innerHTML = cardHtml;
    }

    function showPendingState() {
        showReturnState(buildHubReturnCard({
            iconWrapClass: 'bg-amber-100 text-amber-700',
            iconClass: 'fas fa-hourglass-half',
            title: 'Submitted — awaiting review',
            messageHtml: `Your graduation order for <strong>${escapeHtml(context.studentName)}</strong> has been sent to the school office. You will receive an email once it is approved.`,
        }));
    }

    function showApprovedState() {
        showReturnState(buildHubReturnCard({
            iconWrapClass: 'bg-emerald-100 text-emerald-600',
            iconClass: 'fas fa-check',
            title: 'Graduation order approved',
            messageHtml: 'Your signed graduation order is saved in <strong>My Documents</strong> in the Family Hub.',
        }));
    }

    async function upsertSubmission(row) {
        if (context.mode === 'guest') {
            const { guestToken } = getParams();
            const response = await fetch(`${SUPABASE_URL}/functions/v1/graduation-workflow`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
                body: JSON.stringify({ action: 'guest_upsert', guest_token: guestToken, payload: row }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Could not save submission.');
            submission = result.submission;
            return;
        }

        const client = await initClient();
        if (submission?.id) {
            const { data, error } = await client.from('graduation_submissions').update(row).eq('id', submission.id).select('*').single();
            if (error) throw error;
            submission = data;
        } else {
            const { data, error } = await client.from('graduation_submissions').insert(row).select('*').single();
            if (error) throw error;
            submission = data;
        }
    }

    async function saveDraft() {
        const form = readFormFromDom();
        const { items, total } = updateTotals();
        await upsertSubmission({
            school_year: context.schoolYear,
            participant_type: context.participantType,
            family_user_id: context.familyUserId,
            student_id: context.studentId,
            guest_id: context.guestId,
            status: 'draft',
            form_data: form,
            line_items: items,
            total_due: total,
            updated_at: new Date().toISOString(),
        });
    }

    async function notifyAdminSubmitted() {
        const client = await initClient();
        const { data: { session } } = await client.auth.getSession();
        const headers = {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
        };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

        await fetch(`${SUPABASE_URL}/functions/v1/graduation-workflow`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'family_submitted',
                submission_id: submission?.id,
                student_name: context.studentName,
                school_year: context.schoolYear,
            }),
        }).catch((err) => console.warn('[Graduation] Admin notify failed:', err));
    }

    async function submitForm(event) {
        event.preventDefault();
        const form = readFormFromDom();
        if (!form.requirements_ack) {
            await window.showAppAlert?.('Please acknowledge the graduation requirements before submitting.');
            return;
        }

        const ack = document.getElementById('grad-ack-name')?.value?.trim();
        if (!ack) {
            await window.showAppAlert?.('Type your full legal name to submit.');
            return;
        }

        if (form.participation_mode === 'diploma_only' && (settings.ceremony_opt_out_fee == null || settings.ceremony_opt_out_fee === '')) {
            await window.showAppAlert?.('Diploma-only fee is not set yet. Please contact the school office or choose full graduation.');
            return;
        }

        if (!isPaymentLocked() && !form.payment_method) {
            await window.showAppAlert?.('Select how you paid or plan to pay.');
            return;
        }

        const btn = document.getElementById('grad-submit-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Submitting…';
        }

        try {
            const { items, total } = updateTotals();
            const paymentLocked = isPaymentLocked();
            const paymentStatus = paymentLocked
                ? 'paid'
                : (['paypal', 'cashapp'].includes(form.payment_method)
                    ? 'pending_verification'
                    : 'unpaid');

            const payload = {
                school_year: context.schoolYear,
                participant_type: context.participantType,
                family_user_id: context.familyUserId,
                student_id: context.studentId,
                guest_id: context.guestId,
                status: 'pending_review',
                form_data: form,
                line_items: items,
                total_due: total,
                payment_method: paymentLocked ? submission.payment_method : form.payment_method,
                payment_amount: paymentLocked
                    ? submission.payment_amount
                    : (form.payment_amount ? Number(form.payment_amount) : total),
                payment_note: paymentLocked ? submission.payment_note : (form.payment_note || null),
                payment_status: paymentStatus,
                family_ack_name: ack,
                family_submitted_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            if (paymentLocked) {
                payload.admin_payment_method = submission.admin_payment_method;
                payload.admin_payment_note = submission.admin_payment_note;
                payload.admin_marked_paid_at = submission.admin_marked_paid_at;
            }

            await upsertSubmission(payload);
            await notifyAdminSubmitted();
            showPendingState();
        } catch (err) {
            await window.showAppAlert?.(err.message || String(err));
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Submit graduation order';
            }
        }
    }

    function bindEvents() {
        const root = document.getElementById('grad-hub-form');
        if (!root) return;
        root.addEventListener('input', updateTotals);
        root.addEventListener('change', (e) => {
            if (e.target?.name === 'participation_mode') {
                toggleParticipationSections(e.target.value);
                return;
            }
            updateTotals();
        });
        root.addEventListener('submit', submitForm);
        document.getElementById('grad-save-draft-btn')?.addEventListener('click', async () => {
            try {
                await saveDraft();
                await window.showAppAlert?.('Draft saved.');
            } catch (err) {
                await window.showAppAlert?.(err.message || String(err));
            }
        });
    }

    function prefillFromContext() {
        const form = submission?.form_data || defaultFormState();
        if (!form.diploma_name) form.diploma_name = context.studentName || '';
        if (!form.parent_email && context.guest?.parent_email) form.parent_email = context.guest.parent_email;
        applyFormToDom(form);
        applyPaymentLockState();
        const title = document.getElementById('grad-student-title');
        if (title) title.textContent = context.studentName || 'Graduate';
        const hint = document.getElementById('grad-payment-hint');
        if (hint && settings?.payment_note_hint) hint.textContent = settings.payment_note_hint;
    }

    async function init() {
        const loading = document.getElementById('grad-hub-loading');
        const main = document.getElementById('grad-hub-main');
        try {
            const client = await initClient();
            const ready = await loadContext();
            if (!ready || !context) return;
            const editable = await loadSettingsAndSubmission();
            if (!editable) {
                if (loading) loading.classList.add('hidden');
                if (main) main.classList.remove('hidden');
                return;
            }
            renderEventInfo();
            renderAddonPrices();
            renderHonorCords();
            renderRequirements();
            prefillFromContext();
            if (submission?.status === 'changes_requested' && submission.admin_notes) {
                showChangesRequestedBanner(submission.admin_notes);
            }
            bindEvents();
            setupFloatingTotalObservers();
            if (loading) loading.classList.add('hidden');
            if (main) main.classList.remove('hidden');
        } catch (err) {
            if (loading) loading.classList.add('hidden');
            if (main) {
                main.classList.remove('hidden');
                main.innerHTML = `<div class="site-card p-8 text-red-600 text-sm">${escapeHtml(err.message || String(err))}</div>`;
            }
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();