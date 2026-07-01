(function () {
    const NAVY = '#0A2540';
    const GOLD = '#C9A227';
    const MUTED = '#64748b';
    const LOGO_URL = 'images/logo.png?v=20260615';

    let logoDataUrlPromise = null;
    let pdfMakeLoadPromise = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing?.dataset?.loaded === '1') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => {
                script.dataset.loaded = '1';
                resolve();
            };
            script.onerror = () => reject(new Error(`Could not load ${src}`));
            document.head.appendChild(script);
        });
    }

    async function ensurePdfMake() {
        if (window.pdfMake?.vfs) return window.pdfMake;
        if (!pdfMakeLoadPromise) {
            pdfMakeLoadPromise = (async () => {
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/pdfmake.min.js');
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/vfs_fonts.min.js');
                if (!window.pdfMake?.vfs) throw new Error('PDF library failed to initialize.');
                return window.pdfMake;
            })();
        }
        return pdfMakeLoadPromise;
    }

    function loadLogoDataUrl() {
        if (!logoDataUrlPromise) {
            logoDataUrlPromise = fetch(LOGO_URL)
                .then((r) => (r.ok ? r.blob() : null))
                .then((blob) => {
                    if (!blob) return null;
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                })
                .catch(() => null);
        }
        return logoDataUrlPromise;
    }

    function formatDate(value) {
        if (!value) return '—';
        try {
            return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) {
            return String(value);
        }
    }

    function fieldRow(label, value) {
        return [
            { text: label, style: 'tableHeader', border: [false, false, false, false] },
            { text: String(value || '—'), style: 'tableCell', border: [false, false, false, false] },
        ];
    }

    function buildDocDefinition(payload, logoDataUrl) {
        const form = payload.formData || {};
        const mode = form.participation_mode === 'diploma_only' ? 'Diploma only (no ceremony)' : 'Full graduation';
        const content = [];

        if (logoDataUrl) {
            content.push({
                columns: [
                    { image: logoDataUrl, width: 56 },
                    {
                        stack: [
                            { text: 'Summit Church School', style: 'schoolName' },
                            { text: `${payload.schoolYear || ''} Senior Graduation Order`, style: 'reportTitle' },
                            { text: payload.studentName || '', style: 'studentName' },
                        ],
                        margin: [12, 4, 0, 0],
                    },
                ],
                margin: [0, 0, 0, 16],
            });
        } else {
            content.push(
                { text: 'Summit Church School', style: 'schoolName' },
                { text: `${payload.schoolYear || ''} Senior Graduation Order`, style: 'reportTitle' },
                { text: payload.studentName || '', style: 'studentName', margin: [0, 4, 0, 16] }
            );
        }

        content.push({
            text: [
                { text: 'Participant type: ', bold: true },
                payload.participantType === 'guest' ? 'Guest' : 'Summit family',
                '   ·   ',
                { text: 'Participation: ', bold: true },
                mode,
            ],
            fontSize: 9,
            color: MUTED,
            margin: [0, 0, 0, 12],
        });

        const detailRows = [
            fieldRow('Diploma name', form.diploma_name),
            fieldRow('Parent phone', form.parent_phone),
            fieldRow('Parent email', form.parent_email),
            fieldRow('Mailing address', form.mailing_address),
        ];

        if (form.participation_mode !== 'diploma_only') {
            detailRows.push(fieldRow('Cap & gown size', form.cap_gown_size));
        }

        const cords = window.GraduationTasks?.getHonorCordsSelected?.(form) || [];
        if (cords.length) {
            detailRows.push(fieldRow('Honor cords', cords.join(', ')));
        }

        detailRows.push(fieldRow('Special notes', form.special_notes));

        content.push({ text: 'Order details', style: 'sectionTitle' });
        content.push({
            table: { widths: [140, '*'], body: detailRows },
            layout: 'noBorders',
            margin: [0, 0, 0, 12],
        });

        const lineItems = payload.lineItems || [];
        if (lineItems.length) {
            content.push({ text: 'Fees', style: 'sectionTitle' });
            content.push({
                table: {
                    widths: ['*', 70],
                    body: [
                        [
                            { text: 'Item', style: 'tableHeader' },
                            { text: 'Amount', style: 'tableHeader', alignment: 'right' },
                        ],
                        ...lineItems.map((item) => ([
                            { text: item.label || '', style: 'tableCell' },
                            { text: `$${Number(item.amount || 0).toFixed(2)}`, style: 'tableCell', alignment: 'right' },
                        ])),
                        [
                            { text: 'Total', style: 'tableHeader' },
                            { text: `$${Number(payload.totalDue || 0).toFixed(2)}`, style: 'tableHeader', alignment: 'right' },
                        ],
                    ],
                },
                layout: 'lightHorizontalLines',
                margin: [0, 0, 0, 12],
            });
        }

        content.push({ text: 'Payment', style: 'sectionTitle' });
        content.push({
            table: {
                widths: [140, '*'],
                body: [
                    fieldRow('Status', payload.paymentStatus),
                    fieldRow('Method', payload.paymentMethod || payload.adminPaymentMethod),
                    fieldRow('Amount', payload.paymentAmount != null ? `$${Number(payload.paymentAmount).toFixed(2)}` : '—'),
                    fieldRow('Note', payload.paymentNote || payload.adminPaymentNote),
                ],
            },
            layout: 'noBorders',
            margin: [0, 0, 0, 12],
        });

        if (form.requirements_ack) {
            content.push({ text: 'Requirements', style: 'sectionTitle' });
            content.push({
                text: 'Parent/guardian acknowledged the graduation requirements.',
                fontSize: 9,
                color: MUTED,
                margin: [0, 0, 0, 12],
            });
        }

        content.push({ text: 'Signatures', style: 'sectionTitle' });
        content.push({
            table: {
                widths: ['*', '*', 90],
                body: [
                    [
                        { text: 'Party', style: 'tableHeader' },
                        { text: 'Name', style: 'tableHeader' },
                        { text: 'Date', style: 'tableHeader', alignment: 'right' },
                    ],
                    [
                        { text: 'Family', style: 'tableCell' },
                        { text: payload.familyAckName || '—', style: 'tableCell' },
                        { text: formatDate(payload.familySubmittedAt), style: 'tableCell', alignment: 'right' },
                    ],
                    [
                        { text: 'School admin', style: 'tableCell' },
                        { text: payload.adminAckName || '—', style: 'tableCell' },
                        { text: formatDate(payload.adminApprovedAt), style: 'tableCell', alignment: 'right' },
                    ],
                ],
            },
            layout: 'lightHorizontalLines',
        });

        return {
            pageSize: 'LETTER',
            pageMargins: [40, 44, 40, 52],
            defaultStyle: { font: 'Roboto', fontSize: 10, color: NAVY, lineHeight: 1.25 },
            styles: {
                schoolName: { fontSize: 11, bold: true, color: '#7C8F7E' },
                reportTitle: { fontSize: 16, bold: true, color: NAVY },
                studentName: { fontSize: 13, bold: true, color: NAVY, margin: [0, 4, 0, 0] },
                sectionTitle: { fontSize: 11, bold: true, color: NAVY, margin: [0, 8, 0, 4] },
                tableHeader: { fontSize: 8, bold: true, color: MUTED },
                tableCell: { fontSize: 9, color: NAVY },
            },
            content,
            footer(c, t) {
                return {
                    text: `Summit Church School · Graduation Order · Page ${c} of ${t}`,
                    alignment: 'center',
                    fontSize: 8,
                    color: MUTED,
                };
            },
        };
    }

    async function generateBlob(payload) {
        const pdfMake = await ensurePdfMake();
        const logoDataUrl = await loadLogoDataUrl();
        const docDefinition = buildDocDefinition(payload, logoDataUrl);
        return new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(docDefinition).getBlob((blob) => resolve(blob));
            } catch (err) {
                reject(err);
            }
        });
    }

    async function generateAndDownload(payload) {
        const blob = await generateBlob(payload);
        const filename = payload.filename || 'Graduation-Order.pdf';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    window.GraduationPdf = {
        generateBlob,
        generateAndDownload,
        buildDocDefinition,
    };
})();