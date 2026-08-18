(function () {
    const NAVY = '#0A2540';
    const SAGE = '#7C8F7E';
    const MUTED = '#64748b';
    const LOGO_URL = 'images/logo.png?v=20260615';
    const GRADE_ORDER = ['K', 'K3', 'K4', 'K5', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

    let logoDataUrlPromise = null;
    let pdfMakeLoadPromise = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === '1') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', reject);
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.addEventListener('load', () => {
                script.dataset.loaded = '1';
                resolve();
            });
            script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)));
            document.head.appendChild(script);
        });
    }

    async function ensurePdfMake() {
        if (window.pdfMake?.vfs) return window.pdfMake;
        if (!pdfMakeLoadPromise) {
            pdfMakeLoadPromise = (async () => {
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/pdfmake.min.js');
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/vfs_fonts.min.js');
                if (!window.pdfMake?.vfs) {
                    throw new Error('PDF library failed to initialize.');
                }
                return window.pdfMake;
            })();
        }
        return pdfMakeLoadPromise;
    }

    function loadLogoDataUrl() {
        if (!logoDataUrlPromise) {
            logoDataUrlPromise = fetch(LOGO_URL)
                .then((response) => {
                    if (!response.ok) throw new Error('Logo not found');
                    return response.blob();
                })
                .then((blob) => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                }))
                .catch(() => null);
        }
        return logoDataUrlPromise;
    }

    function formatGradeLabel(level) {
        if (window.AcademicRecords?.formatGradeLabel) {
            return window.AcademicRecords.formatGradeLabel(level);
        }
        const raw = String(level || '').trim();
        if (!raw) return '—';
        if (raw === 'K' || raw === 'K3' || raw === 'K4' || raw === 'K5') return 'K';
        return `Grade ${raw}`;
    }

    function gradeSortIndex(level) {
        const raw = String(level || '').trim();
        const idx = GRADE_ORDER.indexOf(raw);
        return idx === -1 ? GRADE_ORDER.length : idx;
    }

    function formatGeneratedAt(value) {
        try {
            return new Date(value || Date.now()).toLocaleString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            });
        } catch (err) {
            return '';
        }
    }

    function sortStudents(students) {
        return [...(students || [])].sort((a, b) => {
            const gradeCmp = gradeSortIndex(a.gradeLevel) - gradeSortIndex(b.gradeLevel);
            if (gradeCmp !== 0) return gradeCmp;
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        });
    }

    function buildFamilyBlock(family) {
        const students = sortStudents(family.students);
        const header = {
            columns: [
                {
                    stack: [
                        { text: family.name || 'Unknown family', style: 'familyName' },
                        { text: family.district ? `District: ${family.district}` : 'District: not on file', style: 'familyEmail' },
                    ],
                    width: '*',
                },
                { text: family.email || '', style: 'familyEmail', width: 'auto', alignment: 'right' },
            ],
            margin: [0, 8, 0, 3],
        };

        if (!students.length) {
            return {
                unbreakable: true,
                stack: [
                    header,
                    { text: 'No students on file', style: 'emptyStudents' },
                ],
            };
        }

        return {
            unbreakable: true,
            stack: [
                header,
                {
                    table: {
                        widths: ['*', 88],
                        body: [
                            [
                                { text: 'Student', style: 'tableHeader' },
                                { text: 'Current grade', style: 'tableHeader', alignment: 'right' },
                            ],
                            ...students.map((student) => ([
                                { text: student.name || '—', style: 'tableCell' },
                                { text: student.gradeLabel || formatGradeLabel(student.gradeLevel), style: 'tableCell', alignment: 'right' },
                            ])),
                        ],
                    },
                    layout: 'lightHorizontalLines',
                },
            ],
        };
    }

    function buildDocDefinition(payload, logoDataUrl) {
        const families = payload.families || [];
        const familyCount = payload.familyCount ?? families.length;
        const studentCount = payload.studentCount ?? families.reduce((sum, family) => sum + (family.students || []).length, 0);
        const generatedAt = formatGeneratedAt(payload.generatedAt);

        const headerColumns = [];
        if (logoDataUrl) {
            headerColumns.push({
                image: logoDataUrl,
                width: 42,
                margin: [0, 0, 12, 0],
            });
        }
        headerColumns.push({
            stack: [
                { text: 'SUMMIT CHURCH SCHOOL', style: 'schoolName' },
                { text: 'Enrollment Roster', style: 'reportTitle' },
                {
                    text: [payload.schoolYear, generatedAt ? `Generated ${generatedAt}` : '']
                        .filter(Boolean)
                        .join('  ·  '),
                    style: 'reportSubtitle',
                },
            ],
            width: '*',
        });

        const content = [
            { columns: headerColumns, margin: [0, 0, 0, 14] },
            {
                table: {
                    widths: ['*', '*'],
                    body: [[
                        {
                            stack: [
                                { text: 'Families', style: 'statLabel' },
                                { text: String(familyCount), style: 'statValue' },
                            ],
                            fillColor: '#f8fafc',
                            margin: [8, 8, 8, 8],
                        },
                        {
                            stack: [
                                { text: 'Students', style: 'statLabel' },
                                { text: String(studentCount), style: 'statValue' },
                            ],
                            fillColor: '#f8fafc',
                            margin: [8, 8, 8, 8],
                        },
                    ]],
                },
                layout: 'noBorders',
                margin: [0, 0, 0, 8],
            },
        ];

        if (!families.length) {
            content.push({ text: 'No enrolled families found.', style: 'emptyStudents', margin: [0, 12, 0, 0] });
        } else {
            families.forEach((family) => content.push(buildFamilyBlock(family)));
        }

        return {
            pageSize: 'LETTER',
            pageMargins: [40, 44, 40, 52],
            defaultStyle: {
                font: 'Roboto',
                fontSize: 10,
                color: NAVY,
                lineHeight: 1.25,
            },
            styles: {
                schoolName: { fontSize: 10, bold: true, color: SAGE, characterSpacing: 0.4 },
                reportTitle: { fontSize: 18, bold: true, color: NAVY, margin: [0, 2, 0, 0] },
                reportSubtitle: { fontSize: 9, color: MUTED, margin: [0, 2, 0, 0] },
                statLabel: { fontSize: 8, bold: true, color: MUTED, characterSpacing: 0.4 },
                statValue: { fontSize: 16, bold: true, color: NAVY, margin: [0, 2, 0, 0] },
                familyName: { fontSize: 11, bold: true, color: NAVY },
                familyEmail: { fontSize: 8, color: MUTED },
                tableHeader: { fontSize: 8, bold: true, color: MUTED, fillColor: '#f8fafc' },
                tableCell: { fontSize: 9, color: NAVY },
                emptyStudents: { fontSize: 9, italics: true, color: MUTED },
            },
            content,
            footer(currentPage, pageCount) {
                return {
                    columns: [
                        {
                            text: 'Summit Church School · Enrollment roster',
                            fontSize: 8,
                            color: MUTED,
                        },
                        {
                            text: `Page ${currentPage} of ${pageCount}`,
                            alignment: 'right',
                            fontSize: 8,
                            color: MUTED,
                        },
                    ],
                    margin: [40, 0, 40, 0],
                };
            },
        };
    }

    async function generateAndDownload(payload) {
        if (!payload) throw new Error('Missing roster data.');

        const pdfMake = await ensurePdfMake();
        const logoDataUrl = await loadLogoDataUrl();
        const docDefinition = buildDocDefinition(payload, logoDataUrl);
        const schoolYear = payload.schoolYear || 'roster';
        const filename = payload.filename || `Summit-Enrollment-Roster-${schoolYear}.pdf`;

        return new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(docDefinition).download(filename, () => resolve());
            } catch (err) {
                reject(err);
            }
        });
    }

    window.EnrollmentRosterPdf = {
        formatGradeLabel,
        generateAndDownload,
    };
})();
