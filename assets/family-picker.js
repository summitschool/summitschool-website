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

    function renderList(state) {
        const { list, meta, families } = state;
        const filtered = getFilteredFamilies(state);
        const total = families.length;

        if (!total) {
            meta.textContent = state.placeholder || 'No families found';
            list.innerHTML = `<div class="family-picker__empty">${escapeHtml(state.placeholder || 'No families found')}</div>`;
            return;
        }

        if (!filtered.length) {
            meta.textContent = `No families match “${state.filter.trim()}”`;
            list.innerHTML = '<div class="family-picker__empty">No families match your search. Try a different name or email.</div>';
            return;
        }

        meta.textContent = state.filter.trim()
            ? `${filtered.length} of ${total} families match — tap to select`
            : `${total} families — search or scroll`;

        list.innerHTML = filtered.map((profile) => {
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

        const selectedBtn = list.querySelector('.family-picker__option.is-selected');
        if (selectedBtn) {
            selectedBtn.scrollIntoView({ block: 'nearest' });
        }
    }

    function setSelected(state, userId, options = {}) {
        state.selectedId = userId || '';
        if (!options.skipNativeSync) {
            syncNativeSelect(state, state.selectedId);
        }
        renderList(state);
    }

    function bindSelect(select) {
        if (!select || select.dataset.familyPickerBound === 'true') {
            return pickers.get(select?.id);
        }

        select.dataset.familyPickerBound = 'true';
        select.classList.add('family-picker__native');

        const wrap = document.createElement('div');
        wrap.className = 'family-picker';

        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'family-picker__search form-input';
        search.placeholder = 'Search by name or email…';
        search.autocomplete = 'off';
        search.setAttribute('aria-label', 'Search families');
        search.enterKeyHint = 'search';

        const meta = document.createElement('p');
        meta.className = 'family-picker__meta';
        meta.setAttribute('aria-live', 'polite');

        const list = document.createElement('div');
        list.className = 'family-picker__list';
        list.setAttribute('role', 'listbox');
        list.tabIndex = 0;

        const parent = select.parentNode;
        parent.insertBefore(wrap, select);
        wrap.appendChild(search);
        wrap.appendChild(meta);
        wrap.appendChild(list);
        wrap.appendChild(select);

        const state = {
            select,
            wrap,
            search,
            meta,
            list,
            families: [],
            filter: '',
            selectedId: select.value || '',
            placeholder: 'Select a family...',
        };

        search.addEventListener('input', () => {
            state.filter = search.value;
            renderList(state);
        });

        list.addEventListener('click', (event) => {
            const option = event.target.closest('.family-picker__option');
            if (!option) return;
            setSelected(state, option.dataset.value || '');
            search.blur();
        });

        pickers.set(select.id, state);
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
        state.filter = state.search.value.trim();
        syncNativeOptions(state);

        const preserve = preserveUserId || state.selectedId;
        const hasPreserve = preserve && state.families.some((profile) => profile.id === preserve);
        setSelected(state, hasPreserve ? preserve : '', { skipNativeSync: true });
        syncNativeSelect(state, hasPreserve ? preserve : '');
    }

    function setValue(selectOrId, userId) {
        const state = ensureBound(selectOrId);
        if (!state) return false;
        if (userId && !state.families.some((profile) => profile.id === userId)) {
            return false;
        }
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