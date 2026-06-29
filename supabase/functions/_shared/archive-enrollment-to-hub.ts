import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { findProfileUserIdByEmail } from './complete-family-docuseal-task.ts';
import {
  downloadSubmissionDocument,
  fetchSubmissionDocuments,
  sanitizeStorageFileName,
} from './docuseal-submission-documents.ts';
import { deliverPendingEnrollmentDocuments } from './deliver-pending-enrollment-documents.ts';

const STORAGE_BUCKET = 'Family-Documents';
const DEFAULT_SCHOOL_YEAR = '2026-2027';
const DEFAULT_CATEGORY = 'Enrollment';
const PROCESSING_STALE_MS = 5 * 60 * 1000;
const PENDING_PREFIX = 'pending-enrollment';

type EnrollmentArchiveRow = {
  submission_id: number;
  archived_at: string;
  delivered_at: string | null;
  family_document_id: string | null;
  processing_started_at: string | null;
};

type FamilyDocumentRow = {
  id: string;
  url: string | null;
};

function supabaseAdmin(supabaseUrl: string, supabaseServiceRoleKey: string) {
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function sanitizeEmailForPath(email: string) {
  return normalizeEmail(email).replace(/[^a-z0-9._-]+/g, '_').slice(0, 120) || 'unknown-email';
}

function isProcessingStale(processingStartedAt: string | null | undefined) {
  if (!processingStartedAt) return false;
  const startedAt = new Date(processingStartedAt).getTime();
  if (!Number.isFinite(startedAt)) return true;
  return (Date.now() - startedAt) > PROCESSING_STALE_MS;
}

async function getEnrollmentArchive(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  submissionId: number,
) {
  const { data, error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('enrollment_document_archive')
    .select('submission_id, archived_at, delivered_at, family_document_id, processing_started_at')
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to load enrollment document archive');
  }

  return data as EnrollmentArchiveRow | null;
}

async function claimEnrollmentArchive(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  options: {
    submissionId: number;
    templateId?: number;
    familyEmail: string;
    familyName?: string;
    title: string;
    schoolYear: string;
    category: string;
  },
) {
  const supabase = supabaseAdmin(supabaseUrl, supabaseServiceRoleKey);

  const { error: upsertError } = await supabase
    .from('enrollment_document_archive')
    .upsert({
      submission_id: options.submissionId,
      template_id: options.templateId ?? null,
      family_email: normalizeEmail(options.familyEmail),
      family_name: options.familyName ?? null,
      title: options.title,
      school_year: options.schoolYear,
      category: options.category,
    }, { onConflict: 'submission_id' });

  if (upsertError) {
    throw new Error(upsertError.message || 'Failed to initialize enrollment archive record');
  }

  const existing = await getEnrollmentArchive(supabaseUrl, supabaseServiceRoleKey, options.submissionId);
  if (existing?.delivered_at) {
    return { claimed: false as const, reason: 'already_delivered' as const, row: existing };
  }

  if (existing?.processing_started_at && !isProcessingStale(existing.processing_started_at)) {
    return { claimed: false as const, reason: 'archive_in_progress' as const, row: existing };
  }

  const { data, error } = await supabase
    .from('enrollment_document_archive')
    .update({
      processing_started_at: new Date().toISOString(),
      family_email: normalizeEmail(options.familyEmail),
      family_name: options.familyName ?? null,
      template_id: options.templateId ?? null,
      title: options.title,
      school_year: options.schoolYear,
      category: options.category,
    })
    .eq('submission_id', options.submissionId)
    .is('delivered_at', null)
    .select('submission_id, archived_at, delivered_at, family_document_id, processing_started_at')
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to claim enrollment archive processing');
  }

  if (!data) {
    const latest = await getEnrollmentArchive(supabaseUrl, supabaseServiceRoleKey, options.submissionId);
    if (latest?.delivered_at) {
      return { claimed: false as const, reason: 'already_delivered' as const, row: latest };
    }
    return { claimed: false as const, reason: 'archive_in_progress' as const, row: latest };
  }

  return { claimed: true as const, row: data as EnrollmentArchiveRow };
}

async function releaseEnrollmentArchiveProcessing(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  submissionId: number,
) {
  const { error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('enrollment_document_archive')
    .update({ processing_started_at: null })
    .eq('submission_id', submissionId)
    .is('delivered_at', null);

  if (error) {
    console.error('Failed to release enrollment archive processing lock:', error.message);
  }
}

async function removePriorEnrollmentCopies(
  supabase: SupabaseClient,
  options: {
    userId: string;
    title: string;
    schoolYear: string;
    category: string;
  },
) {
  const { data: existingDocs, error } = await supabase
    .from('family_documents')
    .select('id, url')
    .eq('user_id', options.userId)
    .eq('school_year', options.schoolYear)
    .eq('category', options.category)
    .eq('title', options.title);

  if (error) {
    throw new Error(error.message || 'Failed to load prior enrollment documents');
  }

  const docs = (existingDocs || []) as FamilyDocumentRow[];
  if (docs.length === 0) return { removed_count: 0 };

  const storagePaths = docs
    .map((doc) => String(doc.url || '').trim())
    .filter((url) => url && !/^https?:\/\//i.test(url));

  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(storagePaths);

    if (storageError) {
      console.error('Failed to remove prior enrollment storage files:', storageError.message);
    }
  }

  const ids = docs.map((doc) => doc.id);
  const { error: deleteError } = await supabase
    .from('family_documents')
    .delete()
    .in('id', ids);

  if (deleteError) {
    throw new Error(deleteError.message || 'Failed to remove prior enrollment documents');
  }

  return { removed_count: ids.length, removed_ids: ids };
}

async function markEnrollmentArchived(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  options: {
    submissionId: number;
    storagePath: string;
    familyUserId?: string | null;
    familyDocumentId?: string | null;
    deliveredAt?: string | null;
  },
) {
  const { data, error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('enrollment_document_archive')
    .update({
      storage_path: options.storagePath,
      family_user_id: options.familyUserId ?? null,
      family_document_id: options.familyDocumentId ?? null,
      archived_at: new Date().toISOString(),
      delivered_at: options.deliveredAt ?? null,
      processing_started_at: null,
    })
    .eq('submission_id', options.submissionId)
    .is('delivered_at', null)
    .select('submission_id')
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to mark enrollment archive complete');
  }

  if (!data) {
    throw new Error(`Failed to mark enrollment archive complete for submission ${options.submissionId}`);
  }
}

export async function archiveEnrollmentSubmissionToHub(options: {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  submissionId: number;
  templateId?: number;
  templateName: string;
  familyEmail: string;
  familyName?: string;
  docusealApiUrl: string;
  docusealApiKey: string;
  schoolYear?: string;
  category?: string;
}) {
  if (!options.docusealApiKey) {
    throw new Error('DOCUSEAL_API_KEY must be set to archive enrollment documents.');
  }

  const title = options.templateName.trim() || 'Enrollment Application';
  const schoolYear = options.schoolYear || DEFAULT_SCHOOL_YEAR;
  const category = options.category || DEFAULT_CATEGORY;
  const familyEmail = normalizeEmail(options.familyEmail);

  const claim = await claimEnrollmentArchive(options.supabaseUrl, options.supabaseServiceRoleKey, {
    submissionId: options.submissionId,
    templateId: options.templateId,
    familyEmail,
    familyName: options.familyName,
    title,
    schoolYear,
    category,
  });

  if (!claim.claimed) {
    return {
      skipped: claim.reason,
      family_document_id: claim.row?.family_document_id ?? null,
    };
  }

  const supabase = supabaseAdmin(options.supabaseUrl, options.supabaseServiceRoleKey);

  try {
    const documents = await fetchSubmissionDocuments(
      options.submissionId,
      options.docusealApiUrl,
      options.docusealApiKey,
      true,
    );

    if (documents.length === 0) {
      throw new Error('No signed documents available for completed enrollment submission');
    }

    const downloaded = await downloadSubmissionDocument(
      documents[0],
      `${title}-${options.submissionId}`,
    );

    const storageFileName = `${Date.now()}-${sanitizeStorageFileName(downloaded.filename.replace(/\.pdf$/i, ''))}.pdf`;
    const userId = await findProfileUserIdByEmail(supabase, familyEmail);
    const storagePath = userId
      ? `${userId}/${storageFileName}`
      : `${PENDING_PREFIX}/${sanitizeEmailForPath(familyEmail)}/${storageFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, downloaded.bytes, {
        contentType: downloaded.contentType,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message || 'Failed to upload enrollment document to Family Hub storage');
    }

    if (userId) {
      const delivery = await deliverPendingEnrollmentDocuments({
        supabaseUrl: options.supabaseUrl,
        supabaseServiceRoleKey: options.supabaseServiceRoleKey,
        familyEmail,
        familyUserId: userId,
        includeSubmissionIds: [options.submissionId],
        preloadedArchive: {
          submissionId: options.submissionId,
          templateId: options.templateId,
          familyEmail,
          familyName: options.familyName,
          title,
          schoolYear,
          category,
          storagePath,
        },
      });

      return {
        action: 'enrollment_document_delivered' as const,
        user_id: userId,
        storage_path: storagePath,
        title,
        delivery,
      };
    }

    await markEnrollmentArchived(options.supabaseUrl, options.supabaseServiceRoleKey, {
      submissionId: options.submissionId,
      storagePath,
      familyUserId: null,
      familyDocumentId: null,
      deliveredAt: null,
    });

    return {
      action: 'enrollment_document_queued' as const,
      family_email: familyEmail,
      storage_path: storagePath,
      title,
    };
  } catch (error) {
    await releaseEnrollmentArchiveProcessing(
      options.supabaseUrl,
      options.supabaseServiceRoleKey,
      options.submissionId,
    );
    throw error;
  }
}