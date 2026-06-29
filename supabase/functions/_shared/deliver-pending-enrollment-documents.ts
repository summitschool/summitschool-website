import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { findProfileUserIdByEmail } from './complete-family-docuseal-task.ts';
import { sanitizeStorageFileName } from './docuseal-submission-documents.ts';

const STORAGE_BUCKET = 'Family-Documents';
const PENDING_PREFIX = 'pending-enrollment';

type EnrollmentArchiveRecord = {
  submission_id: number;
  template_id: number | null;
  family_email: string;
  family_name: string | null;
  title: string;
  school_year: string;
  category: string;
  storage_path: string;
  family_user_id: string | null;
  family_document_id: string | null;
  archived_at: string;
  delivered_at: string | null;
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

async function removePriorEnrollmentCopies(
  supabase: SupabaseClient,
  options: {
    userId: string;
    title: string;
    schoolYear: string;
    category: string;
    excludeDocumentId?: string;
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

  const docs = ((existingDocs || []) as FamilyDocumentRow[])
    .filter((doc) => doc.id !== options.excludeDocumentId);

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

async function moveStorageObjectToUserFolder(
  supabase: SupabaseClient,
  options: {
    sourcePath: string;
    userId: string;
    fallbackName: string;
  },
) {
  const sourcePath = options.sourcePath.replace(/^\/+/, '');
  const fileName = sourcePath.split('/').pop() || `${Date.now()}-${sanitizeStorageFileName(options.fallbackName)}.pdf`;
  const destinationPath = `${options.userId}/${fileName}`;

  if (sourcePath === destinationPath) {
    return destinationPath;
  }

  const { error: copyError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .copy(sourcePath, destinationPath);

  if (!copyError) {
    const { error: removeError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([sourcePath]);

    if (removeError) {
      console.error('Failed to remove pending enrollment storage after copy:', removeError.message);
    }

    return destinationPath;
  }

  const { data: downloadData, error: downloadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(sourcePath);

  if (downloadError || !downloadData) {
    throw new Error(downloadError?.message || `Failed to read enrollment document at ${sourcePath}`);
  }

  const bytes = new Uint8Array(await downloadData.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(destinationPath, bytes, {
      contentType: downloadData.type || 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to move enrollment document into family storage');
  }

  const { error: removeError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([sourcePath]);

  if (removeError) {
    console.error('Failed to remove pending enrollment storage after upload:', removeError.message);
  }

  return destinationPath;
}

async function deliverArchiveRecord(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  options: {
    record: EnrollmentArchiveRecord;
    userId: string;
  },
) {
  const supabase = supabaseAdmin(supabaseUrl, supabaseServiceRoleKey);
  const storagePath = await moveStorageObjectToUserFolder(supabase, {
    sourcePath: options.record.storage_path,
    userId: options.userId,
    fallbackName: options.record.title,
  });

  const priorCopies = await removePriorEnrollmentCopies(supabase, {
    userId: options.userId,
    title: options.record.title,
    schoolYear: options.record.school_year,
    category: options.record.category,
  });

  const { data: insertedDoc, error: insertError } = await supabase
    .from('family_documents')
    .insert({
      user_id: options.userId,
      title: options.record.title,
      description: `Signed enrollment application saved to your Family Hub on ${new Date().toLocaleDateString('en-US')}.`,
      url: storagePath,
      category: options.record.category,
      school_year: options.record.school_year,
    })
    .select('id')
    .single();

  if (insertError) {
    throw new Error(insertError.message || 'Failed to create enrollment Family Hub document record');
  }

  const { data: updatedArchive, error: updateError } = await supabase
    .from('enrollment_document_archive')
    .update({
      storage_path: storagePath,
      family_user_id: options.userId,
      family_document_id: insertedDoc.id,
      delivered_at: new Date().toISOString(),
      processing_started_at: null,
    })
    .eq('submission_id', options.record.submission_id)
    .is('delivered_at', null)
    .select('submission_id')
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message || 'Failed to mark enrollment document delivered');
  }

  if (!updatedArchive) {
    return {
      skipped: 'already_delivered' as const,
      submission_id: options.record.submission_id,
      family_document_id: insertedDoc.id,
    };
  }

  return {
    action: 'delivered' as const,
    submission_id: options.record.submission_id,
    family_document_id: insertedDoc.id,
    storage_path: storagePath,
    replaced_prior_copies: priorCopies.removed_count,
  };
}

export async function deliverPendingEnrollmentDocuments(options: {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  familyEmail: string;
  familyUserId?: string;
  includeSubmissionIds?: number[];
  preloadedArchive?: {
    submissionId: number;
    templateId?: number;
    familyEmail: string;
    familyName?: string;
    title: string;
    schoolYear: string;
    category: string;
    storagePath: string;
  };
}) {
  const familyEmail = normalizeEmail(options.familyEmail);
  const supabase = supabaseAdmin(options.supabaseUrl, options.supabaseServiceRoleKey);
  const userId = options.familyUserId || await findProfileUserIdByEmail(supabase, familyEmail);

  if (!userId) {
    return { skipped: 'profile_not_found' as const, family_email: familyEmail };
  }

  const results: Array<Record<string, unknown>> = [];

  if (options.preloadedArchive) {
    const delivered = await deliverArchiveRecord(options.supabaseUrl, options.supabaseServiceRoleKey, {
      record: {
        submission_id: options.preloadedArchive.submissionId,
        template_id: options.preloadedArchive.templateId ?? null,
        family_email: familyEmail,
        family_name: options.preloadedArchive.familyName ?? null,
        title: options.preloadedArchive.title,
        school_year: options.preloadedArchive.schoolYear,
        category: options.preloadedArchive.category,
        storage_path: options.preloadedArchive.storagePath,
        family_user_id: userId,
        family_document_id: null,
        archived_at: new Date().toISOString(),
        delivered_at: null,
      },
      userId,
    });
    results.push(delivered);
  }

  let query = supabase
    .from('enrollment_document_archive')
    .select('*')
    .ilike('family_email', familyEmail)
    .is('delivered_at', null)
    .not('storage_path', 'eq', 'pending')
    .order('archived_at', { ascending: false });

  if (options.includeSubmissionIds?.length) {
    const exclude = new Set(options.includeSubmissionIds);
    const { data: pendingRows, error } = await query;
    if (error) {
      throw new Error(error.message || 'Failed to load pending enrollment documents');
    }

    for (const row of (pendingRows || []) as EnrollmentArchiveRecord[]) {
      if (exclude.has(row.submission_id)) continue;
      if (!row.storage_path || row.storage_path === 'pending') continue;
      results.push(await deliverArchiveRecord(options.supabaseUrl, options.supabaseServiceRoleKey, {
        record: row,
        userId,
      }));
    }
  } else {
    const { data: pendingRows, error } = await query;
    if (error) {
      throw new Error(error.message || 'Failed to load pending enrollment documents');
    }

    for (const row of (pendingRows || []) as EnrollmentArchiveRecord[]) {
      if (!row.storage_path || row.storage_path === 'pending') continue;
      results.push(await deliverArchiveRecord(options.supabaseUrl, options.supabaseServiceRoleKey, {
        record: row,
        userId,
      }));
    }
  }

  if (results.length === 0) {
    return {
      skipped: 'no_pending_documents' as const,
      family_email: familyEmail,
      user_id: userId,
    };
  }

  return {
    action: 'pending_enrollment_documents_delivered' as const,
    family_email: familyEmail,
    user_id: userId,
    delivered_count: results.filter((result) => result.action === 'delivered').length,
    results,
  };
}