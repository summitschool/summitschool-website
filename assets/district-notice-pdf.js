(function () {
    const NAVY = '#0A2540';
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
                if (!window.pdfMake?.vfs) throw new Error('PDF library failed to initialize.');
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

    function formatDob(student) {
        if (student?.dateOfBirthDisplay) return student.dateOfBirthDisplay;
        const iso = String(student?.dateOfBirth || '');
        const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return 'DOB on file';
        return `${Number(match[2])}/${Number(match[3])}/${match[1].slice(-2)}`;
    }

    function studentLine(student, schoolName) {
        const parse = window.EnrollmentPacketParse;
        const grade = parse?.gradePhrase(student.gradeLabel || student.gradeLevel) || 'their current grade';
        const school = String(schoolName || student.district || 'public school').trim() || 'public school';
        const name = student.fullName || student.name || 'Student';
        return `${name} DOB: ${formatDob(student)} going into ${grade} and returning to public school at ${school}.`;
    }

    function buildNoticeText(students, schoolName) {
        const list = Array.isArray(students) ? students.filter(Boolean) : [];
        const plural = list.length !== 1;
        return [
            `Hello, this is Ryan Simon with Summit Church School in Rainbow City. I am notifying you that the following student${plural ? 's are' : ' is'} no longer enrolled:`,
            '',
            ...list.map((student) => studentLine(student, schoolName)),
            '',
            'If you have any questions please contact me at 256-328-3966',
            '',
            'Thank you,',
            'Ryan Simon',
            'SCS Administrator',
        ].join('\n');
    }

    function buildDocDefinition(payload, logoDataUrl) {
        const students = payload.students || [];
        const text = payload.text || buildNoticeText(students, payload.schoolName);
        const header = [];
        if (logoDataUrl) {
            header.push({ image: logoDataUrl, width: 48, margin: [0, 0, 14, 0] });
        }
        header.push({
            stack: [
                { text: 'SUMMIT CHURCH SCHOOL', style: 'schoolName' },
                { text: 'Student withdrawal notice', style: 'reportTitle' },
                { text: payload.district ? `Public school district: ${payload.district}` : '', style: 'reportSubtitle' },
            ],
            width: '*',
        });

        return {
            pageSize: 'LETTER',
            pageMargins: [54, 54, 54, 54],
            defaultStyle: { font: 'Roboto', fontSize: 12, color: NAVY, lineHeight: 1.45 },
            styles: {
                schoolName: { fontSize: 10, bold: true, color: SAGE, characterSpacing: 0.4 },
                reportTitle: { fontSize: 16, bold: true, color: NAVY, margin: [0, 2, 0, 0] },
                reportSubtitle: { fontSize: 9, color: MUTED, margin: [0, 2, 0, 0] },
                body: { fontSize: 12, color: NAVY },
            },
            content: [
                { columns: header, margin: [0, 0, 0, 22] },
                { text, style: 'body' },
            ],
        };
    }

    async function generateAndDownload(payload) {
        const pdfMake = await ensurePdfMake();
        const logoDataUrl = await loadLogoDataUrl();
        const docDefinition = buildDocDefinition(payload, logoDataUrl);
        const filename = payload.filename || 'SCS-District-Withdrawal-Notice.pdf';
        return new Promise((resolve, reject) => {
            try {
                pdfMake.createPdf(docDefinition).download(filename, () => resolve());
            } catch (err) {
                reject(err);
            }
        });
    }

    window.DistrictNoticePdf = {
        formatDob,
        studentLine,
        buildNoticeText,
        generateAndDownload,
    };
})();
