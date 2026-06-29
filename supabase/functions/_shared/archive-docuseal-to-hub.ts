import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { completeFamilyDocuSealTasks, findProfileUserIdByEmail } from './complete-family-docuseal-task.ts';
import {
  downloadSubmissionDocument,
  fetchSubmissionDocuments,
  sanitizeStorageFileName,
} from './docuseal-submission-documents.ts';

const STORAGE_BUCKET = 'Family-Documents';
const DEFAULT_SCHOOL_YEAR = '2026-2027';
const DEFAULT_CATEGORY = 'Signed Form';

type HubArchiveLog = {
  submission_id: number;
  archived_at: string | null;
  family_document_id: number | null;
};

function supabaseAdmin(supabaseUrl: string, supabaseServiceRoleKey: string) {
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

async function getArchiveLog(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  submissionId: number,
) {
  const { data, error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('hub_form_archive_log')
    .select('submission_id, archived_at, family_document_id')
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to load hub form archive log');
  }

  return data as HubArchiveLog | null;
}

async function upsertArchiveRecord(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  options: {
    submissionId: number;
    templateId?: number;
    familyEmail: string;
    familyUserId?: string | null;
  },
) {
  const { error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('hub_form_archive_log')
    .upsert({
      submission_id: options.submissionId,
      template_id: options.templateId ?? null,
      family_email: options.familyEmail,
      family_user_id: options.familyUserId ?? null,
    }, { onConflict: 'submission_id' });

  if (error) {
    throw new Error(error.message || 'Failed to save hub form archive record');
  }
}

async function markArchived(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  options: {
    submissionId: number;
    familyUserId: string;
    storagePath: string;
    familyDocumentId: number;
  },
) {
  const { error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('hub_form_archive_log')
    .update({
      family_user_id: options.familyUserId,
      storage_path: options.storagePath,
      family_document_id: options.familyDocumentId,
      archived_at: new Date().toISOString(),
    })
    .eq('submission_id', options.submissionId)
    .is('archived_at', null);

  if (error) {
    throw new Error(error.message || 'Failed to mark hub form archive complete');
  }
}

export async function archiveDocuSealSubmissionToHub(options: {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  submissionId: number;
  templateId?: number;
  templateName: string;
  familyEmail: string;
  docusealApiUrl: string;
  docusealApiKey: string;
  schoolYear?: string;
  category?: string;
}) {
  if (!options.docusealApiKey) {
    throw new Error('DOCUSEAL_API_KEY must be set to archive signed documents.');
  }

  const existing = await getArchiveLog(
    options.supabaseUrl,
    options.supabaseServiceRoleKey,
    options.submissionId,
  );

  if (existing?.archived_at) {
    return { skipped: 'already_archived' as const, family_document_id: existing.family_document_id };
  }

  const supabase = supabaseAdmin(options.supabaseUrl, options.supabaseServiceRoleKey);
  const userId = await findProfileUserIdByEmail(supabase, options.familyEmail);

  if (!userId) {
    return { skipped: 'profile_not_found' as const };
  }

  await upsertArchiveRecord(options.supabaseUrl, options.supabaseServiceRoleKey, {
    submissionId: options.submissionId,
    templateId: options.templateId,
    familyEmail: options.familyEmail,
    familyUserId: userId,
  });

  const documents = await fetchSubmissionDocuments(
    options.submissionId,
    options.docusealApiUrl,
    options.docusealApiKey,
    true,
  );

  if (documents.length === 0) {
    throw new Error('No signed documents available for completed submission');
  }

  const downloaded = await downloadSubmissionDocument(
    documents[0],
    `${options.templateName || 'signed-form'}-${options.submissionId}`,
  );

  const storageFileName = `${Date.now()}-${sanitizeStorageFileName(downloaded.filename.replace(/\.pdf$/i, ''))}.pdf`;
  const storagePath = `${userId}/${storageFileName}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, downloaded.bytes, {
      contentType: downloaded.contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload signed document to Family Hub storage');
  }

  const title = options.templateName.trim() || 'Signed Form';
  const schoolYear = options.schoolYear || DEFAULT_SCHOOL_YEAR;
  const category = options.category || DEFAULT_CATEGORY;

  const { data: insertedDoc, error: insertError } = await supabase
    .from('family_documents')
    .insert({
      user_id: userId,
      title,
      description: `Signed and saved to your Family Hub on ${new Date().toLocaleDateString('en-US')}.`,
      url: storagePath,
      category,
      school_year: schoolYear,
    })
    .select('id')
    .single();

  if (insertError) {
    throw new Error(insertError.message || 'Failed to create Family Hub document record');
  }

  await markArchived(options.supabaseUrl, options.supabaseServiceRoleKey, {
    submissionId: options.submissionId,
    familyUserId: userId,
    storagePath,
    familyDocumentId: insertedDoc.id,
  });

  const taskResult = await completeFamilyDocuSealTasks({
    supabaseUrl: options.supabaseUrl,
    supabaseServiceRoleKey: options.supabaseServiceRoleKey,
    familyEmail: options.familyEmail,
    templateId: options.templateId,
    docusealApiUrl: options.docusealApiUrl,
    docusealApiKey: options.docusealApiKey,
  });

  return {
    action: 'hub_document_archived' as const,
    user_id: userId,
    family_document_id: insertedDoc.id,
    storage_path: storagePath,
    title,
    tasks: taskResult,
  };
}