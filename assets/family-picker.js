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

    function sortFamiliesAlphabetically(families) {
        return [...(families || [])].sort((a, b) => (
            formatFamilyName(a).localeCompare(formatFamilyName(b), undefined, { sensitivity: 'base' })
        ));
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
        const query = state.query.trim().toLowerCase();
        if (!query) return state.families;
        return state.families.filter((profile) => familySearchHaystack(profile).includes(query));
    }

    function getSelectedProfile(state) {
        if (!state.selectedId) return null;
        return state.families.find((profile) => profile.id === state.selectedId) || null;
    }

    function ensureNativeOption(state, userId) {
        if (!userId) return;
        const select = state.select;
        const existing = select.querySelector(`option[value="${userId}"]`);
        if (existing) return;

        const profile = state.families.find((item) => item.id === userId);
        if (!profile) return;

        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = formatFamilyOptionLabel(profile);
        select.appendChild(option);
    }

    function syncNativeSelect(state, userId, options = {}) {
        const select = state.select;
        const nextValue = userId || '';
        if (select.value === nextValue) return;
        ensureNativeOption(state, nextValue);
        select.value = nextValue;
        if (!options.silent) {
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function updateStatus(state, filteredCount) {
        const total = state.families.length;
        if (!total) {
            state.status.textContent = state.placeholder || 'No families found';
            return;
        }

        const query = state.query.trim();
        if (!query) {
            state.status.textContent = total === 1 ? '1 family' : `${total} families`;
            return;
        }

        state.status.textContent = filteredCount === 0
            ? 'No matches'
            : `${filteredCount} of ${total} match`;
    }

    function renderResults(state) {
        const filtered = getFilteredFamilies(state);
        updateStatus(state, filtered.length);

        if (!state.isOpen) {
            return;
        }

        if (!state.families.length) {
            state.results.innerHTML = `<li class="family-picker__empty">${escapeHtml(state.placeholder || 'No families found')}</li>`;
            return;
        }

        if (!filtered.length) {
            state.results.innerHTML = '<li class="family-picker__empty">Try another name or email.</li>';
            return;
        }

        state.results.innerHTML = filtered.map((profile) => {
            const isSelected = profile.id === state.selectedId;
            const name = escapeHtml(formatFamilyName(profile));
            const email = escapeHtml(profile.email || '');
            return `
                <li>
                    <button type="button"
                            class="family-picker__option${isSelected ? ' is-selected' : ''}"
                            role="option"
                            aria-selected="${isSelected ? 'true' : 'false'}"
                            data-value="${escapeHtml(profile.id)}">
                        <span class="family-picker__option-name">${name}</span>
                        ${email ? `<span class="family-picker__option-email">${email}</span>` : ''}
                    </button>
                </li>
            `;
        }).join('');

        const selectedBtn = state.results.querySelector('.family-picker__option.is-selected');
        if (selectedBtn && state.isOpen) {
            selectedBtn.scrollIntoView({ block: 'nearest' });
        }
    }

    function updateClosedDisplay(state) {
        const profile = getSelectedProfile(state);
        const hasFamilies = state.families.length > 0;
        const visible = isPickerVisible(state);

        state.input.disabled = visible && !hasFamilies;
        state.toggle.disabled = visible && !hasFamilies;
        state.clear.disabled = visible && !hasFamilies;

        state.wrap.classList.toggle('has-selection', Boolean(profile));

        if (!hasFamilies) {
            state.input.value = '';
            state.input.placeholder = state.placeholder || 'No families found';
            state.meta.textContent = '';
            return;
        }

        if (profile && !state.isOpen) {
            state.input.value = formatFamilyName(profile);
            state.input.placeholder = '';
            state.meta.textContent = profile.email || '';
            return;
        }

        if (!state.isOpen) {
            state.input.value = '';
            state.input.placeholder = state.searchPlaceholder;
            state.meta.textContent = '';
        }
    }

    function isPickerVisible(state) {
        return Boolean(state?.wrap?.offsetParent);
    }

    function openMenu(state) {
        if (!state.families.length || state.isOpen || !isPickerVisible(state)) return;
        state.isOpen = true;
        state.wrap.classList.add('is-open');
        state.input.readOnly = false;
        state.query = state.input.value.trim();
        if (getSelectedProfile(state) && state.input.value === formatFamilyName(getSelectedProfile(state))) {
            state.query = '';
            state.input.value = '';
        }
        state.input.placeholder = state.searchPlaceholder;
        state.meta.textContent = '';
        if (!state.nativeOptionsFull) {
            syncNativeOptions(state, { full: true });
        }
        renderResults(state);
        window.setTimeout(() => {
            state.input.focus();
            state.input.select();
        }, 0);
    }

    function closeMenu(state, options = {}) {
        if (!state.isOpen && !options.forceDisplayUpdate) {
            updateClosedDisplay(state);
            return;
        }
        state.isOpen = false;
        state.wrap.classList.remove('is-open');
        state.query = '';
        updateClosedDisplay(state);
        if (!options.keepInputValue) {
            state.input.value = '';
        }
    }

    function setSelected(state, userId, options = {}) {
        state.selectedId = userId || '';
        if (!options.skipNativeSync) {
            syncNativeSelect(state, state.selectedId, { silent: options.silent === true });
        }
        closeMenu(state, { forceDisplayUpdate: true });
        renderResults(state);
    }

    function bindSelect(select) {
        if (!select || select.dataset.familyPickerBound === 'true') {
            return pickers.get(select?.id);
        }

        select.dataset.familyPickerBound = 'true';
        select.classList.add('family-picker__native');
        select.setAttribute('aria-hidden', 'true');
        select.tabIndex = -1;

        const wrap = document.createElement('div');
        wrap.className = 'family-picker';

        const field = document.createElement('div');
        field.className = 'family-picker__field';

        const icon = document.createElement('span');
        icon.className = 'family-picker__icon';
        icon.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i>';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'family-picker__input';
        input.id = `${select.id}-input`;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'family-picker__clear';
        clearBtn.setAttribute('aria-label', 'Clear selected family');
        clearBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'family-picker__toggle';
        toggleBtn.setAttribute('aria-label', 'Browse families');
        toggleBtn.innerHTML = '<i class="fas fa-chevron-down" aria-hidden="true"></i>';

        field.appendChild(icon);
        field.appendChild(input);
        field.appendChild(clearBtn);
        field.appendChild(toggleBtn);

        const meta = document.createElement('p');
        meta.className = 'family-picker__meta';

        const menu = document.createElement('div');
        menu.className = 'family-picker__menu';
        menu.setAttribute('aria-hidden', 'true');

        const status = document.createElement('p');
        status.className = 'family-picker__status';
        status.setAttribute('aria-live', 'polite');

        const results = document.createElement('ul');
        results.className = 'family-picker__results';
        results.setAttribute('role', 'listbox');

        menu.appendChild(status);
        menu.appendChild(results);

        const parent = select.parentNode;
        parent.insertBefore(wrap, select);
        wrap.appendChild(field);
        wrap.appendChild(meta);
        wrap.appendChild(menu);
        wrap.appendChild(select);

        const label = document.querySelector(`label[for="${select.id}"]`);
        if (label) label.setAttribute('for', input.id);

        const state = {
            select,
            wrap,
            field,
            input,
            meta,
            menu,
            status,
            results,
            clearBtn,
            toggleBtn,
            families: [],
            query: '',
            selectedId: select.value || '',
            placeholder: 'Select a family...',
            searchPlaceholder: 'Find a family by name or email',
            isOpen: false,
            nativeOptionsFull: false,
        };

        input.addEventListener('focus', () => {
            if (!isPickerVisible(state)) return;
            input.setAttribute('aria-expanded', 'true');
            menu.setAttribute('aria-hidden', 'false');
            openMenu(state);
        });

        input.addEventListener('input', () => {
            state.query = input.value;
            if (!state.isOpen) openMenu(state);
            renderResults(state);
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu(state);
                input.blur();
            }
        });

        toggleBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (state.isOpen) {
                closeMenu(state);
                input.blur();
            } else {
                openMenu(state);
            }
        });

        clearBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setSelected(state, '');
            openMenu(state);
        });

        results.addEventListener('click', (event) => {
            const option = event.target.closest('.family-picker__option');
            if (!option) return;
            setSelected(state, option.dataset.value || '');
            input.blur();
        });

        pickers.set(select.id, state);
        updateClosedDisplay(state);
        renderResults(state);
        return state;
    }

    function ensureBound(selectOrId) {
        const select = typeof selectOrId === 'string'
            ? document.getElementById(selectOrId)
            : selectOrId;
        if (!select) return null;
        return bindSelect(select) || pickers.get(select.id) || null;
    }

    function syncNativeOptions(state, options = {}) {
        const { select, families, placeholder } = state;
        const full = options.full === true;

        if (!families.length) {
            select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
            state.nativeOptionsFull = true;
            return;
        }

        if (!full) {
            const selected = getSelectedProfile(state);
            let html = `<option value="">${escapeHtml(placeholder)}</option>`;
            if (selected) {
                html += `<option value="${escapeHtml(selected.id)}" selected>${escapeHtml(formatFamilyOptionLabel(selected))}</option>`;
            }
            select.innerHTML = html;
            state.nativeOptionsFull = false;
            return;
        }

        let html = `<option value="">${escapeHtml(placeholder)}</option>`;
        families.forEach((profile) => {
            const selectedAttr = profile.id === state.selectedId ? ' selected' : '';
            html += `<option value="${escapeHtml(profile.id)}"${selectedAttr}>${escapeHtml(formatFamilyOptionLabel(profile))}</option>`;
        });
        select.innerHTML = html;
        state.nativeOptionsFull = true;
    }

    function setFamilies(selectOrId, families, placeholder = 'Select a family...', preserveUserId = null) {
        const select = typeof selectOrId === 'string'
            ? document.getElementById(selectOrId)
            : selectOrId;
        if (!select) return;

        const state = ensureBound(select);
        if (!state) return;

        state.families = sortFamiliesAlphabetically(Array.isArray(families) ? families : []);
        state.placeholder = placeholder;
        state.searchPlaceholder = families.length
            ? 'Find a family by name or email'
            : placeholder;
        syncNativeOptions(state);

        const preserve = preserveUserId || state.selectedId;
        const hasPreserve = preserve && state.families.some((profile) => profile.id === preserve);
        state.query = '';
        closeMenu(state, { forceDisplayUpdate: true });
        setSelected(state, hasPreserve ? preserve : '', { skipNativeSync: true, silent: true });
        syncNativeSelect(state, hasPreserve ? preserve : '', { silent: true });
        updateClosedDisplay(state);
        renderResults(state);
        window.requestAnimationFrame(() => {
            if (isPickerVisible(state)) {
                updateClosedDisplay(state);
            }
        });
    }

    function refreshDisplay(selectOrId) {
        const state = ensureBound(selectOrId);
        if (!state) return;
        closeMenu(state, { forceDisplayUpdate: true });
        state.input.setAttribute('aria-expanded', state.isOpen ? 'true' : 'false');
        state.menu.setAttribute('aria-hidden', state.isOpen ? 'false' : 'true');
        updateClosedDisplay(state);
        renderResults(state);
    }

    function refreshVisible() {
        pickers.forEach((state) => {
            if (isPickerVisible(state)) {
                refreshDisplay(state.select);
            } else if (state.isOpen) {
                closeMenu(state, { forceDisplayUpdate: true });
                state.input.setAttribute('aria-expanded', 'false');
                state.menu.setAttribute('aria-hidden', 'true');
            }
        });
    }

    function setValue(selectOrId, userId) {
        const state = ensureBound(selectOrId);
        if (!state) return false;
        if (userId && !state.families.some((profile) => profile.id === userId)) {
            return false;
        }
        state.query = '';
        setSelected(state, userId || '');
        return state.select.value === userId;
    }

    function clearValue(selectOrId, options = {}) {
        const state = ensureBound(selectOrId);
        if (!state) return;
        state.query = '';
        closeMenu(state, { forceDisplayUpdate: true });
        setSelected(state, '', { silent: options.silent === true });
    }

    function getSelectedFamily(selectOrId) {
        const selectId = typeof selectOrId === 'string' ? selectOrId : selectOrId?.id;
        const state = pickers.get(selectId);
        if (!state || !state.selectedId) return null;
        return state.families.find((profile) => profile.id === state.selectedId) || null;
    }

    function closeAll() {
        pickers.forEach((state) => {
            if (!state?.wrap || !state.input || !state.menu) return;
            if (document.activeElement === state.input) {
                state.input.blur();
            }
            closeMenu(state, { forceDisplayUpdate: true });
            state.input.setAttribute('aria-expanded', 'false');
            state.menu.setAttribute('aria-hidden', 'true');
        });
    }

    function bindAll() {
        PICKER_SELECT_IDS.forEach((id) => {
            const select = document.getElementById(id);
            if (select) bindSelect(select);
        });
    }

    window.FamilyPicker = {
        bindAll,
        closeAll,
        ensureBound,
        setFamilies,
        setValue,
        clearValue,
        refreshDisplay,
        refreshVisible,
        getSelectedFamily,
        formatFamilyName,
        formatFamilyOptionLabel,
        sortFamiliesAlphabetically,
    };
})();