import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { completeFamilyDocuSealTasks, findProfileUserIdByEmail } from './complete-family-docuseal-task.ts';
import {
  downloadSubmissionDocument,
  fetchSubmissionDocuments,
  sanitizeStorageFileName,
} from './docuseal-submission-documents.ts';

const STORAGE_BUCKET = 'Family-Documents';
const DEFAULT_SCHOOL_YEAR = '2026-2027';
const DEFAULT_CATEGORY = 'Signed Form';
const PROCESSING_STALE_MS = 5 * 60 * 1000;
const CODE_OF_CONDUCT_SLUG = '3oBpb3Knk9GsNB';

type HubArchiveLog = {
  submission_id: number;
  archived_at: string | null;
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

async function getArchiveLog(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  submissionId: number,
) {
  const { data, error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('hub_form_archive_log')
    .select('submission_id, archived_at, family_document_id, processing_started_at')
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to load hub form archive log');
  }

  return data as HubArchiveLog | null;
}

function isProcessingStale(processingStartedAt: string | null | undefined) {
  if (!processingStartedAt) return false;
  const startedAt = new Date(processingStartedAt).getTime();
  if (!Number.isFinite(startedAt)) return true;
  return (Date.now() - startedAt) > PROCESSING_STALE_MS;
}

async function claimArchiveProcessing(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  options: {
    submissionId: number;
    templateId?: number;
    familyEmail: string;
    familyUserId: string;
  },
) {
  const supabase = supabaseAdmin(supabaseUrl, supabaseServiceRoleKey);

  const { error: upsertError } = await supabase
    .from('hub_form_archive_log')
    .upsert({
      submission_id: options.submissionId,
      template_id: options.templateId ?? null,
      family_email: options.familyEmail,
      family_user_id: options.familyUserId,
    }, { onConflict: 'submission_id' });

  if (upsertError) {
    throw new Error(upsertError.message || 'Failed to initialize hub form archive record');
  }

  const existing = await getArchiveLog(supabaseUrl, supabaseServiceRoleKey, options.submissionId);
  if (existing?.archived_at) {
    return { claimed: false as const, reason: 'already_archived' as const, log: existing };
  }

  if (existing?.processing_started_at && !isProcessingStale(existing.processing_started_at)) {
    return { claimed: false as const, reason: 'archive_in_progress' as const, log: existing };
  }

  const { data, error } = await supabase
    .from('hub_form_archive_log')
    .update({
      processing_started_at: new Date().toISOString(),
      family_user_id: options.familyUserId,
      family_email: options.familyEmail,
      template_id: options.templateId ?? null,
    })
    .eq('submission_id', options.submissionId)
    .is('archived_at', null)
    .select('submission_id, archived_at, family_document_id, processing_started_at')
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to claim hub form archive processing');
  }

  if (!data) {
    const latest = await getArchiveLog(supabaseUrl, supabaseServiceRoleKey, options.submissionId);
    if (latest?.archived_at) {
      return { claimed: false as const, reason: 'already_archived' as const, log: latest };
    }
    return { claimed: false as const, reason: 'archive_in_progress' as const, log: latest };
  }

  return { claimed: true as const, log: data as HubArchiveLog };
}

async function releaseArchiveProcessing(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  submissionId: number,
) {
  const { error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('hub_form_archive_log')
    .update({ processing_started_at: null })
    .eq('submission_id', submissionId)
    .is('archived_at', null);

  if (error) {
    console.error('Failed to release hub form archive processing lock:', error.message);
  }
}

async function markArchived(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  options: {
    submissionId: number;
    familyUserId: string;
    storagePath: string;
    familyDocumentId: string;
  },
) {
  const { data, error } = await supabaseAdmin(supabaseUrl, supabaseServiceRoleKey)
    .from('hub_form_archive_log')
    .update({
      family_user_id: options.familyUserId,
      storage_path: options.storagePath,
      family_document_id: options.familyDocumentId,
      archived_at: new Date().toISOString(),
      processing_started_at: null,
    })
    .eq('submission_id', options.submissionId)
    .is('archived_at', null)
    .select('submission_id')
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to mark hub form archive complete');
  }

  if (!data) {
    throw new Error(`Failed to mark hub form archive complete for submission ${options.submissionId}`);
  }
}

async function removePriorSignedCopies(
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
    throw new Error(error.message || 'Failed to load prior signed form copies');
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
      console.error('Failed to remove prior signed form storage files:', storageError.message);
    }
  }

  const ids = docs.map((doc) => doc.id);
  const { error: deleteError } = await supabase
    .from('family_documents')
    .delete()
    .in('id', ids);

  if (deleteError) {
    throw new Error(deleteError.message || 'Failed to remove prior signed form copies');
  }

  return { removed_count: ids.length, removed_ids: ids };
}

export async function archiveDocuSealSubmissionToHub(options: {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  submissionId: number;
  templateId?: number;
  templateSlug?: string | null;
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

  const supabase = supabaseAdmin(options.supabaseUrl, options.supabaseServiceRoleKey);
  const userId = await findProfileUserIdByEmail(supabase, options.familyEmail);

  if (!userId) {
    return { skipped: 'profile_not_found' as const };
  }

  const claim = await claimArchiveProcessing(options.supabaseUrl, options.supabaseServiceRoleKey, {
    submissionId: options.submissionId,
    templateId: options.templateId,
    familyEmail: options.familyEmail,
    familyUserId: userId,
  });

  if (!claim.claimed) {
    return {
      skipped: claim.reason,
      family_document_id: claim.log?.family_document_id ?? null,
    };
  }

  const title = options.templateName.trim() || 'Signed Form';
  const schoolYear = options.schoolYear || DEFAULT_SCHOOL_YEAR;
  const category = options.category || DEFAULT_CATEGORY;

  try {
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

    const priorCopies = await removePriorSignedCopies(supabase, {
      userId,
      title,
      schoolYear,
      category,
    });

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

    const taskResult = await completeFamilyDocuSealTasks({
      supabaseUrl: options.supabaseUrl,
      supabaseServiceRoleKey: options.supabaseServiceRoleKey,
      familyEmail: options.familyEmail,
      templateSlug: options.templateSlug,
      templateId: options.templateId,
      submissionId: options.submissionId,
      docusealApiUrl: options.docusealApiUrl,
      docusealApiKey: options.docusealApiKey,
    });

    const templateSlug = String(options.templateSlug || '').trim().toLowerCase();
    if (templateSlug.includes(CODE_OF_CONDUCT_SLUG.toLowerCase())) {
      const { data: onboarding, error: onboardingError } = await supabase
        .from('family_onboarding')
        .select('manual_checks, conduct_signed_at')
        .eq('family_user_id', userId)
        .maybeSingle();

      if (onboardingError) {
        console.error('Failed to load onboarding row for Code of Conduct completion:', onboardingError.message);
      } else {
        const manualChecks = onboarding?.manual_checks && typeof onboarding.manual_checks === 'object'
          ? onboarding.manual_checks as Record<string, unknown>
          : {};
        const { error: upsertError } = await supabase
          .from('family_onboarding')
          .upsert({
            family_user_id: userId,
            manual_checks: { ...manualChecks, conduct: true },
            conduct_signed_at: onboarding?.conduct_signed_at || new Date().toISOString(),
          }, { onConflict: 'family_user_id' });

        if (upsertError) {
          console.error('Failed to mark Code of Conduct complete after archive:', upsertError.message);
        }
      }
    }

    await markArchived(options.supabaseUrl, options.supabaseServiceRoleKey, {
      submissionId: options.submissionId,
      familyUserId: userId,
      storagePath,
      familyDocumentId: insertedDoc.id,
    });

    return {
      action: 'hub_document_archived' as const,
      user_id: userId,
      family_document_id: insertedDoc.id,
      storage_path: storagePath,
      title,
      replaced_prior_copies: priorCopies.removed_count,
      tasks: taskResult,
    };
  } catch (error) {
    await releaseArchiveProcessing(options.supabaseUrl, options.supabaseServiceRoleKey, options.submissionId);
    throw error;
  }
}