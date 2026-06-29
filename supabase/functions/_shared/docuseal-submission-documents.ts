type DocuSealDocument = {
  name?: string;
  url?: string;
};

export async function fetchSubmissionDocuments(
  submissionId: number,
  apiUrl: string,
  apiKey: string,
  merge = true,
) {
  const response = await fetch(
    `${apiUrl.replace(/\/$/, '')}/api/submissions/${submissionId}/documents${merge ? '?merge=true' : ''}`,
    {
      headers: {
        'X-Auth-Token': apiKey,
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`DocuSeal documents lookup failed (${response.status}): ${await response.text()}`);
  }

  const body = await response.json() as { documents?: DocuSealDocument[] };
  return body.documents || [];
}

export async function downloadSubmissionDocument(
  document: DocuSealDocument,
  fallbackName: string,
) {
  const url = String(document.url || '').trim();
  if (!url) {
    throw new Error('Signed document URL missing from DocuSeal response');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download signed document (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || 'application/pdf';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const rawName = String(document.name || fallbackName).trim() || fallbackName;
  const filename = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;

  return { bytes, filename, contentType };
}

export function sanitizeStorageFileName(value: string) {
  return value
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'signed-form';
}