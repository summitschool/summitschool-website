(function () {
    const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/;
    const GRADE_RE = /\b(kindergarten|k(?:3|4|5)?|pre-?k|[1-9](?:st|nd|rd|th)?|1[0-2](?:th)?)\b/i;
    const SKIP_NAME = /^(name|dob|grade|school year|public school district|please list|teaching parent|email|phone|home address|church school|document id|digitally signed)/i;

    function cleanLine(line) {
        return String(line || '')
            .replace(/[_:]{2,}/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeDistrict(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[.,;]+$/, '');
    }

    function parseDateParts(match) {
        if (!match) return null;
        const month = Number(match[1]);
        const day = Number(match[2]);
        let year = Number(match[3]);
        if (year < 100) year += year >= 50 ? 1900 : 2000;
        if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2025) {
            return null;
        }
        return {
            iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            display: `${month}/${day}/${String(year).slice(-2)}`,
        };
    }

    function normalizeGradeLabel(raw) {
        const value = String(raw || '').replace(/\s+/g, ' ').trim();
        if (!value) return '';
        if (/^k(?:indergarten)?$/i.test(value) || /^k[345]$/i.test(value)) return 'Kindergarten';
        const num = value.match(/\d{1,2}/);
        if (!num) return value;
        const n = Number(num[0]);
        if (n < 1 || n > 12) return value;
        const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
        return `${n}${suffix}`;
    }

    function gradePhrase(label) {
        const normalized = normalizeGradeLabel(label);
        if (!normalized) return 'their current grade';
        if (/kindergarten/i.test(normalized)) return 'kindergarten';
        return `${normalized} grade`;
    }

    function looksLikeName(line) {
        const value = cleanLine(line);
        if (!value || value.length < 3 || value.length > 80) return false;
        if (SKIP_NAME.test(value)) return false;
        if (DATE_RE.test(value)) return false;
        if (/^20\d{2}\s*\/\s*20\d{2}$/.test(value)) return false;
        if (/@/.test(value) || /\d{5}/.test(value)) return false;
        if (/^\d+$/.test(value)) return false;
        const words = value.split(/\s+/);
        if (words.length < 1 || words.length > 6) return false;
        return /[A-Za-z]/.test(value);
    }

    function extractFormSection(text) {
        const raw = String(text || '').replace(/\r/g, '');
        const formStart = raw.search(/SUMMIT CHURCH SCHOOL ENROLLMENT FORM/i);
        const section = formStart >= 0 ? raw.slice(formStart) : raw;
        const parentStart = section.search(/TEACHING PARENT/i);
        return parentStart >= 0 ? section.slice(0, parentStart) : section;
    }

    function extractDistrict(text) {
        const section = extractFormSection(text);
        const marker = section.search(/PUBLIC SCHOOL DISTRICT:/i);
        if (marker < 0) return '';
        const after = section.slice(marker + 'PUBLIC SCHOOL DISTRICT:'.length);
        const stop = after.search(/PLEASE LIST STUDENT/i);
        const chunk = (stop >= 0 ? after.slice(0, stop) : after);
        const lines = chunk.split('\n').map(cleanLine).filter(Boolean);
        for (const line of lines) {
            if (/^20\d{2}\s*\/\s*20\d{2}$/.test(line)) continue;
            if (/^school year/i.test(line)) continue;
            if (/public school district/i.test(line)) continue;
            const district = normalizeDistrict(line);
            if (district) return district;
        }
        return '';
    }

    function extractStudents(text) {
        const section = extractFormSection(text);
        const start = section.search(/PLEASE LIST STUDENT/i);
        if (start < 0) return [];
        const chunk = section.slice(start);
        const lines = chunk.split('\n').map(cleanLine).filter(Boolean);
        const students = [];
        let current = { names: [], date: null, grade: '' };

        function flush() {
            const name = current.names.join(' ').replace(/\s+/g, ' ').trim();
            if (name && (current.date || current.grade)) {
                students.push({
                    fullName: name,
                    dateOfBirth: current.date?.iso || null,
                    dateOfBirthDisplay: current.date?.display || '',
                    gradeLabel: normalizeGradeLabel(current.grade),
                });
            }
            current = { names: [], date: null, grade: '' };
        }

        for (const line of lines) {
            if (/^please list student/i.test(line)) continue;
            if (/^name:/i.test(line) && /dob/i.test(line)) {
                flush();
                continue;
            }

            const dateMatch = line.match(DATE_RE);
            if (dateMatch && !current.date) {
                current.date = parseDateParts(dateMatch);
            }

            const gradeMatch = line.match(GRADE_RE);
            if (gradeMatch && !/^name:/i.test(line)) {
                const candidate = normalizeGradeLabel(gradeMatch[1]);
                if (candidate && !current.grade) current.grade = candidate;
            }

            if (looksLikeName(line) && !dateMatch) {
                const maybeGradeOnly = GRADE_RE.test(line) && line.split(/\s+/).length <= 2;
                if (maybeGradeOnly) continue;
                if (current.names.length && (current.date || current.grade)) {
                    flush();
                }
                current.names.push(line);
            }
        }
        flush();
        return students;
    }

    function parseEnrollmentPacketText(text) {
        return {
            district: extractDistrict(text),
            students: extractStudents(text),
        };
    }

    window.EnrollmentPacketParse = {
        parseEnrollmentPacketText,
        extractDistrict,
        extractStudents,
        normalizeDistrict,
        normalizeGradeLabel,
        gradePhrase,
        parseDateParts,
    };
})();
