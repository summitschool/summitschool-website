(function () {
    const NAVY = '#0A2540';
    const GOLD = '#C9A227';
    const SAGE = '#7C8F7E';
    const MUTED = '#64748b';
    const LOGO_URL = 'images/logo.png?v=20260615';

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

    function formatSubmittedDate(value) {
        if (!value) return '—';
        try {
            return new Date(value).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            });
        } catch (err) {
            return '—';
        }
    }

    function sectionTitle(text) {
        return {
            text,
            style: 'sectionTitle',
            margin: [0, 14, 0, 6],
        };
    }

    function creditLines(totals, labels, requirements, options = {}) {
        if (!totals) return [];
        const { showRequired = true, order = Object.keys(totals) } = options;
        return order.map((type) => {
            const earned = totals[type] || 0;
            const label = labels?.[type] || type;
            const required = requirements?.[type];
            const value = showRequired && required != null ? `${earned}/${required}` : String(earned);
            return `${label}: ${value}`;
        });
    }

    function buildDocDefinition(payload, logoDataUrl) {
        const gradeSuffix = payload.isHighSchool ? ' %' : '';
        const courseHeader = [
            { text: 'Course', style: 'tableHeader' },
            { text: 'Subject', style: 'tableHeader' },
            { text: `Sem 1${gradeSuffix}`, style: 'tableHeader', alignment: 'center' },
            { text: `Sem 2${gradeSuffix}`, style: 'tableHeader', alignment: 'center' },
            { text: `Final${gradeSuffix}`, style: 'tableHeader', alignment: 'center' },
        ];

        const courseRows = (payload.courses || []).map((course) => ([
            { text: course.name || '—', style: 'tableCell' },
            { text: course.typeLabel || '—', style: 'tableCellMuted' },
            { text: course.sem1 || '—', style: 'tableCell', alignment: 'center' },
            { text: course.sem2 || '—', style: 'tableCell', alignment: 'center' },
            { text: course.final || '—', style: 'tableCell', alignment: 'center' },
        ]));

        const content = [];

        const headerColumns = [];
        if (logoDataUrl) {
            headerColumns.push({ image: logoDataUrl, width: 52, margin: [0, 2, 0, 0] });
        }
        headerColumns.push({
            stack: [
                { text: 'Summit Church School', style: 'schoolName' },
                { text: 'Family Hub Progress Report', style: 'reportTitle' },
                { text: payload.reportLabel || 'Progress Report', style: 'reportSubtitle' },
            ],
            margin: logoDataUrl ? [14, 0, 0, 0] : [0, 0, 0, 0],
        });

        content.push({ columns: headerColumns, columnGap: 0, margin: [0, 0, 0, 10] });
        content.push({
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 1.5, lineColor: GOLD }],
            margin: [0, 0, 0, 14],
        });

        content.push({
            columns: [
                {
                    width: '*',
                    stack: [
                        { text: payload.studentName || 'Student', style: 'studentName' },
                        { text: `${payload.schoolYear || ''} · ${payload.gradeLabel || ''}`, style: 'metaLine' },
                    ],
                },
                {
                    width: 'auto',
                    stack: [
                        { text: payload.statusLabel || 'Complete', style: 'statusBadge' },
                        { text: 'Finalized record', style: 'metaLine', alignment: 'right' },
                    ],
                },
            ],
            margin: [0, 0, 0, 12],
        });

        content.push(sectionTitle('Attendance'));
        content.push({
            table: {
                widths: ['*', '*', '*'],
                body: [
                    [
                        { text: 'Semester 1 days', style: 'tableHeader' },
                        { text: 'Semester 2 days', style: 'tableHeader' },
                        { text: 'Total days', style: 'tableHeader' },
                    ],
                    [
                        { text: payload.attendance?.semester1 ?? '—', style: 'tableCell', alignment: 'center' },
                        { text: payload.attendance?.semester2 ?? '—', style: 'tableCell', alignment: 'center' },
                        { text: payload.attendance?.total ?? '—', style: 'tableCell', alignment: 'center' },
                    ],
                ],
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 4],
        });

        content.push(sectionTitle('Courses & Grades'));
        content.push({
            table: {
                headerRows: 1,
                widths: ['*', 70, 48, 48, 48],
                body: [courseHeader, ...courseRows],
            },
            layout: {
                hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5),
                vLineWidth: () => 0,
                hLineColor: (i) => (i === 1 ? GOLD : '#e2e8f0'),
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 5,
                paddingBottom: () => 5,
            },
        });

        if (payload.isHighSchool && payload.yearCredits) {
            content.push(sectionTitle('Credit Summary'));
            content.push({
                text: 'This school year',
                style: 'creditLabel',
                margin: [0, 0, 0, 4],
            });
            content.push({
                ul: creditLines(
                    payload.yearCredits,
                    payload.courseTypeLabels,
                    payload.creditRequirements,
                    { showRequired: true, order: payload.creditTypeOrder }
                ),
                style: 'creditList',
                margin: [0, 0, 0, 8],
            });

            if (payload.cumulativeCredits) {
                content.push({
                    text: 'Toward graduation (completed high school years)',
                    style: 'creditLabel',
                    margin: [0, 0, 0, 4],
                });
                content.push({
                    ul: creditLines(
                        payload.cumulativeCredits,
                        payload.courseTypeLabels,
                        payload.creditRequirements,
                        { showRequired: true, order: payload.creditTypeOrder }
                    ),
                    style: 'creditList',
                    margin: [0, 0, 0, 4],
                });
                content.push({
                    text: 'Alabama graduation requires 4 English, 4 Math, 4 Science, 4 History, and 8 Electives.',
                    style: 'footnote',
                });
            }
        }

        content.push(sectionTitle('Parent Signatures'));
        const signatureRows = (payload.signatures || []).map((sig) => ([
            { text: sig.label || '—', style: 'tableCellMuted' },
            { text: sig.name || '—', style: 'tableCell' },
            { text: formatSubmittedDate(sig.date), style: 'tableCell', alignment: 'right' },
        ]));

        content.push({
            table: {
                widths: [120, '*', 100],
                body: [
                    [
                        { text: 'Submission', style: 'tableHeader' },
                        { text: 'Parent name', style: 'tableHeader' },
                        { text: 'Date', style: 'tableHeader', alignment: 'right' },
                    ],
                    ...signatureRows,
                ],
            },
            layout: 'lightHorizontalLines',
        });

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
                schoolName: { fontSize: 11, bold: true, color: SAGE, characterSpacing: 0.3 },
                reportTitle: { fontSize: 18, bold: true, color: NAVY, margin: [0, 2, 0, 0] },
                reportSubtitle: { fontSize: 9, color: MUTED, margin: [0, 2, 0, 0] },
                studentName: { fontSize: 14, bold: true, color: NAVY },
                metaLine: { fontSize: 9, color: MUTED, margin: [0, 2, 0, 0] },
                statusBadge: { fontSize: 10, bold: true, color: GOLD, alignment: 'right' },
                sectionTitle: { fontSize: 11, bold: true, color: NAVY },
                tableHeader: { fontSize: 8, bold: true, color: MUTED, fillColor: '#f8fafc' },
                tableCell: { fontSize: 9, color: NAVY },
                tableCellMuted: { fontSize: 9, color: MUTED },
                creditLabel: { fontSize: 9, bold: true, color: NAVY },
                creditList: { fontSize: 9, color: NAVY },
                footnote: { fontSize: 8, color: MUTED, italics: true },
            },
            content,
            footer(currentPage, pageCount) {
                return {
                    text: `Summit Church School · ${payload.schoolYear || ''} · Page ${currentPage} of ${pageCount}`,
                    alignment: 'center',
                    fontSize: 8,
                    color: MUTED,
                    margin: [40, 0, 40, 0],
                };
            },
        };
    }

    async function generateAndDownload(payload) {
        if (!payload) throw new Error('Missing report data.');

        const pdfMake = await ensurePdfMake();
        const logoDataUrl = await loadLogoDataUrl();
        const docDefinition = buildDocDefinition(payload, logoDataUrl);
        const filename = payload.filename || 'Progress-Report.pdf';

        return new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(docDefinition).download(filename, () => resolve());
            } catch (err) {
                reject(err);
            }
        });
    }

    window.ProgressReportPdf = {
        generateAndDownload,
    };
})();