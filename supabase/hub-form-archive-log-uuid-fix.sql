-- family_documents.id is uuid; hub_form_archive_log had bigint and broke markArchived.
ALTER TABLE public.hub_form_archive_log
  ALTER COLUMN family_document_id TYPE uuid USING NULL;