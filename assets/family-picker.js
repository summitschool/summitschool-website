(function () {
    const PICKER_SELECT_IDS = [
        'admin-family-select',
        'admin-records-family-select',
        'admin-academic-family-select',
        'viewer-family-select',
        'staff-add-select',
    ];

    const pickers = new Map();

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatFamilyName(profile) {
        if (!profile) return 'Unknown family';
        if (profile.first_name && profile.last_name) {
            return `${profile.first_name} ${profile.last_name}`.trim();
        }
        if (profile.full_name) return String(profile.full_name).trim();
        return profile.email || 'Unknown family';
    }

    function formatFamilyOptionLabel(profile) {
        const name = formatFamilyName(profile);
        const email = profile?.email ? ` (${profile.email})` : '';
        return `${name}${email}`;
    }

    function familySearchHaystack(profile) {
        return [
            formatFamilyName(profile),
            profile?.email,
            profile?.first_name,
            profile?.last_name,
            profile?.full_name,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
    }

    function getFilteredFamilies(state) {
        const query = state.filter.trim().toLowerCase();
        if (!query) return state.families;
        return state.families.filter((profile) => familySearchHaystack(profile).includes(query));
    }

    function syncNativeSelect(state, userId) {
        const select = state.select;
        const nextValue = userId || '';
        if (select.value === nextValue) return;
        select.value = nextValue;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function getSelectedProfile(state) {
        if (!state.selectedId) return null;
        return state.families.find((profile) => profile.id === state.selectedId) || null;
    }

    function updateTrigger(state) {
        const profile = getSelectedProfile(state);
        const hasFamilies = state.families.length > 0;

        state.trigger.disabled = !hasFamilies;
        state.trigger.setAttribute('aria-disabled', hasFamilies ? 'false' : 'true');

        if (!hasFamilies) {
            state.triggerLabel.textContent = state.placeholder || 'No families found';
            state.triggerEmail.textContent = '';
            state.triggerEmail.classList.add('hidden');
            state.trigger.classList.remove('has-selection');
            return;
        }

        if (profile) {
            state.triggerLabel.textContent = formatFamilyName(profile);
            state.triggerEmail.textContent = profile.email || '';
            state.triggerEmail.classList.toggle('hidden', !profile.email);
            state.trigger.classList.add('has-selection');
            return;
        }

        state.triggerLabel.textContent = state.placeholder || 'Select a family...';
        state.triggerEmail.textContent = 'Search by name or email';
        state.triggerEmail.classList.remove('hidden');
        state.trigger.classList.remove('has-selection');
    }

    function updateHint(state, filteredCount) {
        const total = state.families.length;
        if (!total) {
            state.hint.textContent = state.placeholder || 'No families found';
            return;
        }

        const query = state.filter.trim();
        if (!query) {
            state.hint.textContent = total === 1
                ? '1 family — scroll or type to search'
                : `${total} families — scroll or type to search`;
            return;
        }

        state.hint.textContent = filteredCount === 0
            ? `No matches for “${query}”`
            : `${filteredCount} of ${total} match`;
    }

    function renderList(state) {
        const filtered = getFilteredFamilies(state);
        updateHint(state, filtered.length);

        if (!state.families.length) {
            state.list.innerHTML = `<div class="family-picker__empty">${escapeHtml(state.placeholder || 'No families found')}</div>`;
            return;
        }

        if (!filtered.length) {
            state.list.innerHTML = '<div class="family-picker__empty">Try a different name or email.</div>';
            return;
        }

        state.list.innerHTML = filtered.map((profile) => {
            const isSelected = profile.id === state.selectedId;
            const name = escapeHtml(formatFamilyName(profile));
            const email = escapeHtml(profile.email || '');
            return `
                <button type="button"
                        class="family-picker__option${isSelected ? ' is-selected' : ''}"
                        role="option"
                        aria-selected="${isSelected ? 'true' : 'false'}"
                        data-value="${escapeHtml(profile.id)}">
                    <span class="family-picker__option-name">${name}</span>
                    ${email ? `<span class="family-picker__option-email">${email}</span>` : ''}
                </button>
            `;
        }).join('');

        const selectedBtn = state.list.querySelector('.family-picker__option.is-selected');
        if (selectedBtn && state.isOpen) {
            selectedBtn.scrollIntoView({ block: 'nearest' });
        }
    }

    function closePanel(state) {
        if (!state.isOpen) return;
        state.isOpen = false;
        state.panel.classList.remove('is-open');
        state.panel.setAttribute('aria-hidden', 'true');
        state.trigger.setAttribute('aria-expanded', 'false');
    }

    function openPanel(state) {
        if (!state.families.length || state.isOpen) return;
        state.isOpen = true;
        state.panel.classList.add('is-open');
        state.panel.setAttribute('aria-hidden', 'false');
        state.trigger.setAttribute('aria-expanded', 'true');
        state.search.value = state.filter;
        renderList(state);
        window.setTimeout(() => state.search.focus(), 0);
    }

    function setSelected(state, userId, options = {}) {
        state.selectedId = userId || '';
        if (!options.skipNativeSync) {
            syncNativeSelect(state, state.selectedId);
        }
        updateTrigger(state);
        renderList(state);
        if (!options.keepOpen) {
            closePanel(state);
        }
    }

    function bindSelect(select) {
        if (!select || select.dataset.familyPickerBound === 'true') {
            return pickers.get(select?.id);
        }

        select.dataset.familyPickerBound = 'true';
        select.classList.add('family-picker__native');

        const wrap = document.createElement('div');
        wrap.className = 'family-picker';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'family-picker__trigger';
        trigger.id = `${select.id}-trigger`;
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');

        const triggerIcon = document.createElement('span');
        triggerIcon.className = 'family-picker__trigger-icon';
        triggerIcon.innerHTML = '<i class="fas fa-users" aria-hidden="true"></i>';

        const triggerBody = document.createElement('span');
        triggerBody.className = 'family-picker__trigger-body';

        const triggerLabel = document.createElement('span');
        triggerLabel.className = 'family-picker__trigger-label';

        const triggerEmail = document.createElement('span');
        triggerEmail.className = 'family-picker__trigger-sub';

        triggerBody.appendChild(triggerLabel);
        triggerBody.appendChild(triggerEmail);

        const triggerChevron = document.createElement('span');
        triggerChevron.className = 'family-picker__trigger-chevron';
        triggerChevron.innerHTML = '<i class="fas fa-chevron-down" aria-hidden="true"></i>';

        trigger.appendChild(triggerIcon);
        trigger.appendChild(triggerBody);
        trigger.appendChild(triggerChevron);

        const panel = document.createElement('div');
        panel.className = 'family-picker__panel';
        panel.setAttribute('aria-hidden', 'true');

        const searchWrap = document.createElement('div');
        searchWrap.className = 'family-picker__panel-search';

        const searchIcon = document.createElement('span');
        searchIcon.className = 'family-picker__panel-search-icon';
        searchIcon.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i>';

        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'family-picker__panel-input';
        search.placeholder = 'Search families…';
        search.autocomplete = 'off';
        search.setAttribute('aria-label', 'Search families');
        search.enterKeyHint = 'search';

        searchWrap.appendChild(searchIcon);
        searchWrap.appendChild(search);

        const hint = document.createElement('p');
        hint.className = 'family-picker__panel-hint';
        hint.setAttribute('aria-live', 'polite');

        const list = document.createElement('div');
        list.className = 'family-picker__panel-list';
        list.setAttribute('role', 'listbox');

        panel.appendChild(searchWrap);
        panel.appendChild(hint);
        panel.appendChild(list);

        const parent = select.parentNode;
        parent.insertBefore(wrap, select);
        wrap.appendChild(trigger);
        wrap.appendChild(panel);
        wrap.appendChild(select);

        const label = document.querySelector(`label[for="${select.id}"]`);
        if (label) label.setAttribute('for', trigger.id);

        const state = {
            select,
            wrap,
            trigger,
            triggerLabel,
            triggerEmail,
            panel,
            search,
            hint,
            list,
            families: [],
            filter: '',
            selectedId: select.value || '',
            placeholder: 'Select a family...',
            isOpen: false,
        };

        trigger.addEventListener('click', () => {
            if (!state.families.length) return;
            if (state.isOpen) {
                closePanel(state);
            } else {
                openPanel(state);
            }
        });

        search.addEventListener('input', () => {
            state.filter = search.value;
            renderList(state);
        });

        search.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePanel(state);
                trigger.focus();
            }
        });

        list.addEventListener('click', (event) => {
            const option = event.target.closest('.family-picker__option');
            if (!option) return;
            setSelected(state, option.dataset.value || '');
            state.filter = '';
            state.search.value = '';
            trigger.focus();
        });

        document.addEventListener('click', (event) => {
            if (!state.isOpen) return;
            if (wrap.contains(event.target)) return;
            closePanel(state);
        });

        document.addEventListener('keydown', (event) => {
            if (!state.isOpen || event.key !== 'Escape') return;
            if (!wrap.contains(document.activeElement)) return;
            closePanel(state);
            trigger.focus();
        });

        pickers.set(select.id, state);
        updateTrigger(state);
        renderList(state);
        return state;
    }

    function ensureBound(selectOrId) {
        const select = typeof selectOrId === 'string'
            ? document.getElementById(selectOrId)
            : selectOrId;
        if (!select) return null;
        return bindSelect(select) || pickers.get(select.id) || null;
    }

    function syncNativeOptions(state) {
        const { select, families, placeholder } = state;
        let html = `<option value="">${escapeHtml(placeholder)}</option>`;
        families.forEach((profile) => {
            html += `<option value="${escapeHtml(profile.id)}">${escapeHtml(formatFamilyOptionLabel(profile))}</option>`;
        });
        select.innerHTML = html;
    }

    function setFamilies(selectOrId, families, placeholder = 'Select a family...', preserveUserId = null) {
        const select = typeof selectOrId === 'string'
            ? document.getElementById(selectOrId)
            : selectOrId;
        if (!select) return;

        const state = ensureBound(select);
        if (!state) return;

        state.families = Array.isArray(families) ? families : [];
        state.placeholder = placeholder;
        syncNativeOptions(state);

        const preserve = preserveUserId || state.selectedId;
        const hasPreserve = preserve && state.families.some((profile) => profile.id === preserve);
        state.filter = '';
        state.search.value = '';
        closePanel(state);
        setSelected(state, hasPreserve ? preserve : '', { skipNativeSync: true });
        syncNativeSelect(state, hasPreserve ? preserve : '');
        updateTrigger(state);
        renderList(state);
    }

    function setValue(selectOrId, userId) {
        const state = ensureBound(selectOrId);
        if (!state) return false;
        if (userId && !state.families.some((profile) => profile.id === userId)) {
            return false;
        }
        state.filter = '';
        state.search.value = '';
        setSelected(state, userId || '');
        return state.select.value === userId;
    }

    function clearValue(selectOrId, options = {}) {
        const state = ensureBound(selectOrId);
        if (!state) return;
        if (options.clearSearch) {
            state.search.value = '';
            state.filter = '';
        }
        closePanel(state);
        setSelected(state, '');
    }

    function getSelectedFamily(selectOrId) {
        const selectId = typeof selectOrId === 'string' ? selectOrId : selectOrId?.id;
        const state = pickers.get(selectId);
        if (!state || !state.selectedId) return null;
        return state.families.find((profile) => profile.id === state.selectedId) || null;
    }

    function bindAll() {
        PICKER_SELECT_IDS.forEach((id) => {
            const select = document.getElementById(id);
            if (select) bindSelect(select);
        });
    }

    window.FamilyPicker = {
        bindAll,
        ensureBound,
        setFamilies,
        setValue,
        clearValue,
        getSelectedFamily,
        formatFamilyName,
        formatFamilyOptionLabel,
    };
})();