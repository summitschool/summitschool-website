import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function isTaskCategory(category: string | null | undefined) {
  const normalized = String(category || '').toLowerCase();
  return normalized.includes('(task)') || normalized.includes('task');
}

export function taskUrlMatchesTemplate(taskUrl: string, templateSlug: string) {
  const slug = templateSlug.trim().toLowerCase();
  if (!slug) return false;
  return String(taskUrl || '').toLowerCase().includes(slug);
}

type DocuSealSubmitter = {
  slug?: string;
};

async function fetchSubmissionSubmitterSlugs(
  submissionId: number,
  apiUrl: string,
  apiKey: string,
) {
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/submissions/${submissionId}`, {
      headers: {
        'X-Auth-Token': apiKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('docuseal submission submitter lookup failed', response.status, await response.text());
      return [];
    }

    const submission = await response.json() as { submitters?: DocuSealSubmitter[] };
    return (submission.submitters || [])
      .map((submitter) => submitter.slug?.trim())
      .filter((slug): slug is string => Boolean(slug));
  } catch (error) {
    console.error('docuseal submission submitter lookup error:', error);
    return [];
  }
}

function taskMatchesSubmissionSubmitters(taskUrl: string, submitterSlugs: string[]) {
  const normalizedUrl = String(taskUrl || '').toLowerCase();
  return submitterSlugs.some((slug) => normalizedUrl.includes(slug.toLowerCase()));
}

export async function fetchDocuSealTemplateSlug(
  templateId: number,
  apiUrl: string,
  apiKey: string,
) {
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/templates/${templateId}`, {
      headers: {
        'X-Auth-Token': apiKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('docuseal template slug lookup failed', response.status, await response.text());
      return null;
    }

    const template = await response.json() as { slug?: string };
    return template.slug?.trim() || null;
  } catch (error) {
    console.error('docuseal template slug lookup error:', error);
    return null;
  }
}

export async function findProfileUserIdByEmail(
  supabase: SupabaseClient,
  email: string,
) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', normalized)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to look up profile by email');
  }

  return data?.id ? String(data.id) : null;
}

export async function completeFamilyDocuSealTasks(options: {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  familyEmail: string;
  templateSlug?: string | null;
  templateId?: number;
  submissionId?: number;
  docusealApiUrl?: string;
  docusealApiKey?: string;
}) {
  let templateSlug = options.templateSlug?.trim() || null;

  if (!templateSlug && options.templateId && options.docusealApiUrl && options.docusealApiKey) {
    templateSlug = await fetchDocuSealTemplateSlug(
      options.templateId,
      options.docusealApiUrl,
      options.docusealApiKey,
    );
  }

  const supabase = createClient(options.supabaseUrl, options.supabaseServiceRoleKey);
  const userId = await findProfileUserIdByEmail(supabase, options.familyEmail);

  if (!userId) {
    return { skipped: 'profile_not_found' as const, template_slug: templateSlug };
  }

  const { data: documents, error } = await supabase
    .from('family_documents')
    .select('id, url, category, title')
    .eq('user_id', userId);

  if (error) {
    throw new Error(error.message || 'Failed to load family documents for task completion');
  }

  let matching = (documents || []).filter((doc) => (
    isTaskCategory(doc.category)
    && templateSlug
    && taskUrlMatchesTemplate(String(doc.url || ''), templateSlug)
  ));

  if (
    matching.length === 0
    && options.submissionId
    && options.docusealApiUrl
    && options.docusealApiKey
  ) {
    const submitterSlugs = await fetchSubmissionSubmitterSlugs(
      options.submissionId,
      options.docusealApiUrl,
      options.docusealApiKey,
    );

    matching = (documents || []).filter((doc) => (
      isTaskCategory(doc.category)
      && taskMatchesSubmissionSubmitters(String(doc.url || ''), submitterSlugs)
    ));
  }

  if (matching.length === 0) {
    return {
      skipped: templateSlug ? 'no_matching_tasks' as const : 'template_slug_missing' as const,
      template_slug: templateSlug,
      user_id: userId,
    };
  }

  const ids = matching.map((doc) => doc.id);
  const { error: deleteError } = await supabase
    .from('family_documents')
    .delete()
    .in('id', ids);

  if (deleteError) {
    throw new Error(deleteError.message || 'Failed to remove completed DocuSeal tasks');
  }

  return {
    action: 'hub_tasks_completed' as const,
    template_slug: templateSlug,
    user_id: userId,
    removed_count: ids.length,
    task_ids: ids,
    task_titles: matching.map((doc) => doc.title),
  };
}